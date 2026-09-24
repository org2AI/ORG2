//! Discovery-only write boundary. User choices are read under the store lock,
//! never replayed from the UI snapshot that started a network request.
use std::collections::{HashMap, HashSet};

use super::super::{DefaultVariant, ModelKey, ModelVariant};
use super::KeyService;

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCatalogRefresh {
    pub expected_credential_generation: u64,
    pub expected_catalog_generation: u64,
    pub available_models: Vec<String>,
    /// None means this discovery protocol does not describe effort variants.
    pub model_variants: Option<Vec<ModelVariant>>,
    pub default_variants: Option<Vec<DefaultVariant>>,
    pub model_context_lengths: HashMap<String, u64>,
}

impl KeyService {
    pub fn refresh_model_catalog(
        &self,
        key_id: &str,
        refresh: ModelCatalogRefresh,
    ) -> Result<ModelKey, String> {
        if refresh.available_models.is_empty() {
            return Err("Provider returned an empty model list".into());
        }
        self.update_store(|store| {
            let entry = store
                .keys
                .get_mut(key_id)
                .ok_or("Account no longer exists")?;
            if entry.credential_generation != refresh.expected_credential_generation
                || entry.model_catalog_generation != refresh.expected_catalog_generation
            {
                return Err(
                    "Account or model catalog changed during discovery; refresh again".into(),
                );
            }
            let next_generation = entry
                .model_catalog_generation
                .checked_add(1)
                .ok_or("Model catalog generation exhausted")?;
            let aliases: HashSet<&str> = entry
                .model_aliases
                .iter()
                .map(|alias| alias.alias.as_str())
                .collect();
            let incoming: HashSet<&str> = refresh
                .available_models
                .iter()
                .map(String::as_str)
                .collect();
            let discovered_contexts: HashMap<String, u64> = refresh
                .model_variants
                .as_ref()
                .into_iter()
                .flatten()
                .filter_map(|variant| {
                    variant
                        .context_window
                        .filter(|value| *value > 0)
                        .map(|value| (variant.model.clone(), value))
                })
                .collect();
            if let Some(variants) = refresh.model_variants {
                // A live ladder replaces the old ladder. Keep manual IDs and
                // behaviorally observed bare records; discovery must not erase
                // explicit custom requests or runtime capability observations.
                entry.model_variants.retain(|variant| {
                    aliases.contains(variant.model.as_str())
                        || (incoming.contains(variant.model.as_str())
                            && variant.model == variant.base_model
                            && variant.reasoning.is_some()
                            && !variants.iter().any(|new| new.model == variant.model))
                });
                for mut variant in variants {
                    if aliases.contains(variant.model.as_str()) {
                        continue;
                    }
                    variant.context_window = variant.context_window.filter(|value| *value > 0);
                    entry.model_variants.push(variant);
                }
            } else {
                entry.model_variants.retain(|variant| {
                    aliases.contains(variant.model.as_str())
                        || incoming.contains(variant.model.as_str())
                        || incoming.contains(variant.base_model.as_str())
                });
            }
            for variant in &mut entry.model_variants {
                if !aliases.contains(variant.model.as_str())
                    && incoming.contains(variant.model.as_str())
                {
                    variant.context_window = refresh
                        .model_context_lengths
                        .get(&variant.model)
                        .copied()
                        .filter(|value| *value > 0)
                        .or_else(|| discovered_contexts.get(&variant.model).copied());
                }
            }
            for (model, context_window) in refresh.model_context_lengths {
                if context_window == 0
                    || !incoming.contains(model.as_str())
                    || aliases.contains(model.as_str())
                {
                    continue;
                }
                if let Some(variant) = entry
                    .model_variants
                    .iter_mut()
                    .find(|variant| variant.model == model)
                {
                    variant.context_window = Some(context_window);
                } else {
                    entry.model_variants.push(ModelVariant {
                        base_model: model.clone(),
                        model,
                        reasoning: None,
                        fast: false,
                        context_window: Some(context_window),
                    });
                }
            }
            if let Some(defaults) = refresh.default_variants {
                entry.discovered_default_variants = defaults;
            }
            entry.available_models = refresh.available_models;
            for alias in &entry.model_aliases {
                if !entry.available_models.contains(&alias.alias) {
                    entry.available_models.push(alias.alias.clone());
                }
            }
            // Product-supported completion remains distinct from live discovery.
            entry.normalize_model_catalog();
            entry.model_catalog_generation = next_generation;
            entry.updated_at = chrono::Utc::now();
            store.updated_at = entry.updated_at;
            Ok(entry.clone())
        })?
    }
}

impl KeyService {
    /// Merge only explicitly chosen families, reading the current user layer
    /// under the persistence lock so concurrent family picks cannot erase one
    /// another or turn provider defaults into pinned user choices.
    pub fn update_default_variant_overrides(
        &self,
        key_id: &str,
        model_type: &super::super::ModelType,
        overrides: Vec<DefaultVariant>,
    ) -> Result<ModelKey, String> {
        self.update_store(|store| {
            let entry = store
                .keys
                .get_mut(key_id)
                .ok_or("Account no longer exists")?;
            if &entry.model_type != model_type {
                return Err("Account provider changed; choose the model again".into());
            }
            let mut families = HashSet::new();
            for choice in &overrides {
                if !families.insert(&choice.base_model) {
                    return Err("Duplicate model family default".into());
                }
                if choice.base_model.is_empty()
                    || choice.model.is_empty()
                    || choice
                        .base_model
                        .chars()
                        .chain(choice.model.chars())
                        .any(|character| character.is_whitespace() || character.is_control())
                {
                    return Err("Default model and family must be non-empty request IDs".into());
                }
            }
            for choice in overrides {
                entry
                    .default_variants
                    .retain(|previous| previous.base_model != choice.base_model);
                entry.default_variants.push(choice);
            }
            entry.updated_at = chrono::Utc::now();
            store.updated_at = entry.updated_at;
            Ok(entry.clone())
        })?
    }
}
