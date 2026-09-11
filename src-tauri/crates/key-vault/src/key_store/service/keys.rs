//! Credential CRUD: listing, lookup (raw and corruption-aware), save/delete,
//! and the metadata/health/capability write-backs that mutate a stored key.

use chrono::Utc;
use std::collections::{HashMap, HashSet};

use super::super::types::{HealthStatus, ModelKey, ModelType};
use super::KeyService;

impl KeyService {
    /// List all stored keys
    pub fn list_keys(&self) -> Vec<ModelKey> {
        let store = self.load_store();
        store.keys.into_values().collect()
    }

    /// List stored keys while surfacing root-level corruption to user-facing
    /// callers. Invalid individual entries are isolated and logged; valid
    /// siblings remain available.
    pub fn list_keys_checked(&self) -> Result<Vec<ModelKey>, String> {
        let loaded = self.load_store_checked()?;
        loaded.log_diagnostics(&self.storage_file);

        loaded.ensure_any_valid_credentials(&self.storage_file)?;

        Ok(loaded.store.keys.into_values().collect())
    }

    /// Read one credential without turning corruption into a misleading
    /// "not found" response. Invalid siblings remain isolated.
    pub fn get_key_checked(
        &self,
        agent_type: &ModelType,
        key_id: Option<&str>,
    ) -> Result<Option<ModelKey>, String> {
        let loaded = self.load_store_checked()?;
        loaded.log_diagnostics(&self.storage_file);

        if let Some(key) = loaded.store.get(agent_type, key_id).cloned() {
            return Ok(Some(key));
        }
        if let Some(key_id) = key_id {
            if let Some(error) = loaded.invalid_credential_error(key_id) {
                return Err(error);
            }
        }
        loaded.ensure_any_valid_credentials(&self.storage_file)?;

        Ok(None)
    }

    /// Read one credential by ID without turning corruption into a
    /// misleading "not found" response. Invalid siblings remain isolated.
    pub fn get_key_by_id_checked(&self, key_id: &str) -> Result<Option<ModelKey>, String> {
        let loaded = self.load_store_checked()?;
        loaded.log_diagnostics(&self.storage_file);

        if let Some(key) = loaded.store.get_by_id(key_id).cloned() {
            return Ok(Some(key));
        }
        if let Some(error) = loaded.invalid_credential_error(key_id) {
            return Err(error);
        }
        loaded.ensure_any_valid_credentials(&self.storage_file)?;

        Ok(None)
    }

    /// Get key by agent type and optional ID
    pub fn get_key(&self, agent_type: &ModelType, key_id: Option<&str>) -> Option<ModelKey> {
        let store = self.load_store();
        store.get(agent_type, key_id).cloned()
    }

    /// Get key by ID only
    pub fn get_key_by_id(&self, key_id: &str) -> Option<ModelKey> {
        let store = self.load_store();
        store.get_by_id(key_id).cloned()
    }

    /// Get all keys for an agent type
    pub fn get_all_keys_for_agent(&self, agent_type: &ModelType) -> Vec<ModelKey> {
        let store = self.load_store();
        store.get_all(agent_type).into_iter().cloned().collect()
    }

    /// Save or update a key after enforcing persisted catalog invariants.
    pub fn save_key(&self, mut key: ModelKey) -> Result<ModelKey, String> {
        // Explicit aliases are user-owned request IDs, including IDs absent
        // from discovery. Validate before touching the persisted credential.
        //
        // Only aliases the caller actually wrote are validated: partial saves
        // (rename, description, endpoint edits) carry the stored aliases along
        // unchanged, and a historical record that predates these rules must
        // not block every later write to the account.
        let retained: HashMap<String, Vec<String>> = self
            .load_store()
            .get_by_id(&key.id)
            .map(|existing| {
                let mut retained: HashMap<String, Vec<String>> = HashMap::new();
                for alias in &existing.model_aliases {
                    retained
                        .entry(alias.alias.clone())
                        .or_default()
                        .push(alias.display_name.clone());
                }
                retained
            })
            .unwrap_or_default();
        let mut seen: HashMap<&str, usize> = HashMap::new();
        for alias in &mut key.model_aliases {
            let unchanged = retained
                .get(&alias.alias)
                .is_some_and(|labels| labels.contains(&alias.display_name));
            if unchanged {
                continue;
            }
            if alias.alias.is_empty()
                || alias.alias.len() > 256
                || alias
                    .alias
                    .chars()
                    .any(|c| c.is_whitespace() || c.is_control())
            {
                return Err(
                    "Model ID must contain 1–256 bytes without whitespace or control characters"
                        .into(),
                );
            }
            alias.display_name = alias.display_name.trim().to_string();
            if alias.display_name.len() > 256 || alias.display_name.chars().any(char::is_control) {
                return Err(
                    "Model display name must contain at most 256 bytes without control characters"
                        .into(),
                );
            }
        }
        for alias in &key.model_aliases {
            let count = seen.entry(alias.alias.as_str()).or_insert(0);
            *count += 1;
            // A duplicate is new when the write carries more copies of an id
            // than the stored record already had.
            let stored = retained.get(&alias.alias).map_or(0, Vec::len).max(1);
            if *count > stored {
                return Err("Duplicate custom model ID".into());
            }
        }
        for alias in &key.model_aliases {
            if !key.available_models.contains(&alias.alias) {
                key.available_models.push(alias.alias.clone());
            }
        }
        let key_id = key.id.clone();
        self.update_store(|store| {
            store.set(key);
            store
                .get_by_id(&key_id)
                .cloned()
                .expect("KeyStore::set must retain the inserted key")
        })
    }

    /// Record behaviorally-observed reasoning capability for `model` on key
    /// `key_id`. Called by agent-core's side-query layer when a model is
    /// seen emitting thinking-only responses (or rejecting
    /// `thinking: disabled` with a 400) so future capability resolution
    /// skips the failed first attempt.
    ///
    /// Idempotent: when the variant already carries the same reasoning
    /// value, nothing is written to disk (avoids write amplification —
    /// side queries run on every turn).
    pub fn record_observed_reasoning(
        &self,
        key_id: &str,
        model: &str,
        reasoning: &str,
    ) -> Result<(), String> {
        // Read-only fast path: skip the store write lock entirely when the
        // value is already recorded.
        if let Some(key) = self.get_key_by_id(key_id) {
            if key
                .model_variants
                .iter()
                .any(|v| v.model == model && v.reasoning.as_deref() == Some(reasoning))
            {
                return Ok(());
            }
        } else {
            return Err(format!("Key '{}' not found", key_id));
        }

        self.update_store(|store| {
            let Some(entry) = store.keys.get_mut(key_id) else {
                return Err(format!("Key '{}' not found", key_id));
            };
            if let Some(variant) = entry.model_variants.iter_mut().find(|v| v.model == model) {
                variant.reasoning = Some(reasoning.to_string());
            } else {
                entry.model_variants.push(crate::key_store::ModelVariant {
                    model: model.to_string(),
                    base_model: model.to_string(),
                    reasoning: Some(reasoning.to_string()),
                    fast: false,
                    context_window: None,
                });
            }
            entry.updated_at = chrono::Utc::now();
            Ok(())
        })?
    }

    /// Merge account metadata fields onto a stored key.
    pub fn merge_key_account_metadata(
        &self,
        key_id: &str,
        metadata: HashMap<String, String>,
    ) -> Result<Option<ModelKey>, String> {
        if metadata.is_empty() {
            return Ok(self.get_key_by_id(key_id));
        }

        self.update_store(|store| {
            if let Some(entry) = store.keys.get_mut(key_id) {
                for (field, value) in metadata {
                    if !value.trim().is_empty() {
                        entry.account_metadata.insert(field, value);
                    }
                }
                entry.updated_at = Utc::now();
                store.updated_at = Utc::now();
                Some(entry.clone())
            } else {
                None
            }
        })
    }

    /// Update key health status
    #[allow(clippy::too_many_arguments)]
    // Health refreshes atomically merge independent optional facets. Keeping
    // them explicit avoids a second DTO that would mirror the stored key patch.
    pub fn update_key_health(
        &self,
        key_id: &str,
        health_status: HealthStatus,
        error_message: Option<String>,
        available_models: Option<Vec<String>>,
        enabled_models: Option<Vec<String>>,
        quota_info: Option<serde_json::Value>,
        model_context_lengths: Option<&HashMap<String, u64>>,
    ) -> Result<Option<ModelKey>, String> {
        self.update_store(|store| {
            if let Some(entry) = store.keys.get_mut(key_id) {
                entry.health_status = health_status;
                entry.last_validation_error = error_message;
                entry.last_validated_at = Some(Utc::now());

                let refreshed_models: Option<HashSet<String>> = available_models
                    .as_ref()
                    .map(|models| models.iter().cloned().collect());
                if let Some(models) = available_models {
                    entry.available_models = models;
                    for alias in &entry.model_aliases {
                        if !entry.available_models.contains(&alias.alias) {
                            entry.available_models.push(alias.alias.clone());
                        }
                    }
                }
                if let Some(contexts) = model_context_lengths {
                    // Treat the validation/refresh result as authoritative for
                    // the refreshed model list only: absent context_length
                    // means "fall back to FAMILY_RULES", not "keep a stale
                    // proxy cap". Health-only updates may pass an empty map
                    // without refreshing models, so they must not clear
                    // existing provider overrides.
                    if let Some(model_scope) = refreshed_models.as_ref() {
                        for variant in &mut entry.model_variants {
                            if model_scope.contains(&variant.model)
                                && !contexts.contains_key(&variant.model)
                            {
                                variant.context_window = None;
                            }
                        }
                    }

                    // find-or-push: provider-reported context windows override
                    // the static FAMILY_RULES default at runtime. Mirrors the
                    // reasoning writeback above.
                    for (model, ctx) in contexts {
                        if *ctx == 0 {
                            continue;
                        }
                        if let Some(variant) =
                            entry.model_variants.iter_mut().find(|v| &v.model == model)
                        {
                            variant.context_window = Some(*ctx);
                        } else {
                            entry.model_variants.push(crate::key_store::ModelVariant {
                                model: model.clone(),
                                base_model: model.clone(),
                                reasoning: None,
                                fast: false,
                                context_window: Some(*ctx),
                            });
                        }
                    }
                }
                if let Some(enabled) = enabled_models {
                    // Discovery defaults must not change explicit alias choices.
                    let explicit: HashSet<&str> = entry
                        .model_aliases
                        .iter()
                        .map(|a| a.alias.as_str())
                        .collect();
                    let mut merged: Vec<String> = enabled
                        .into_iter()
                        .filter(|m| !explicit.contains(m.as_str()))
                        .collect();
                    for model in &entry.enabled_models {
                        if explicit.contains(model.as_str()) && !merged.contains(model) {
                            merged.push(model.clone());
                        }
                    }
                    entry.enabled_models = merged;
                }
                entry.normalize_model_catalog();
                if let Some(quota) = quota_info {
                    entry.quota_info = Some(quota);
                }

                entry.updated_at = Utc::now();
                store.updated_at = Utc::now();

                Some(entry.clone())
            } else {
                None
            }
        })
    }

    /// Delete key by agent type and optional ID.
    pub fn delete_key(&self, agent_type: &ModelType, key_id: Option<&str>) -> Result<bool, String> {
        self.update_store(|store| store.delete(agent_type, key_id))
    }

    /// Delete key by ID only.
    pub fn delete_key_by_id(&self, key_id: &str) -> Result<bool, String> {
        self.update_store(|store| store.delete_by_id(key_id))
    }
}
