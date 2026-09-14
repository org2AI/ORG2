//! Agent definitions store — in-memory state + disk persistence.
//!
//! # Storage layout (Storage contract §12)
//!
//! Two JSON files on disk:
//!
//! - `~/.orgii/agent-definitions.json` — user-created agents (no prefix).
//!   Editable via `update(id, patch)`; builtins are rejected.
//! - `~/.orgii/builtin-overrides.json` — map of `builtin:*` → **field-level
//!   delta** against the compiled-in builtin (top-level JSON keys whose
//!   value differs). The effective definition is composed at load time as
//!   `compiled builtin + delta`, so ship-time changes to builtin tool
//!   lists / prompts / rosters still reach users who customised other
//!   fields. Written via `update_with_overlay(id, patch)` for builtin
//!   ids. "Reset to builtin" = remove the key from this file. Legacy
//!   full-snapshot entries are reduced to deltas on first load.
//!
//! # Lookup order (`get`)
//!
//! 1. If `id.starts_with("builtin:")`:
//!    - Return the in-memory effective definition (compiled + delta,
//!      composed at load/write time), or the compiled-in builtin when no
//!      overlay exists.
//! 2. Else: lookup in the user-definitions vec.
//!
//! # Change notification
//!
//! Every successful mutation invokes the process-wide `on_change` hook
//! (installed once at Tauri setup) with the affected agent id; the hook
//! emits `orgii-agent-defs-changed` so frontend atoms refresh without
//! manual polling. Mutating definitions outside the store's methods is
//! a bug.

use std::collections::{BTreeMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
#[cfg(not(test))]
use std::sync::OnceLock;
use std::sync::{Arc, Mutex};
use tracing::{error, info, warn};

use super::schema::AgentDefinition;
use app_paths::{agent_definitions as storage_path, builtin_overrides as overrides_path};

#[cfg(not(test))]
static PROCESS_STORE: OnceLock<Arc<AgentDefinitionsStore>> = OnceLock::new();

/// Process-wide shared `AgentDefinitionsStore`.
///
/// This is the ONLY way production code should obtain a store. The Tauri
/// setup manages the same `Arc`, so command handlers
/// (`State<'_, Arc<AgentDefinitionsStore>>`) and library callers observe
/// one consistent in-memory state — no per-call disk re-reads, no
/// write-path/read-path split brain, and the one-shot migrations in
/// `AgentDefinitionsStore::new()` run exactly once per process.
///
/// In `cfg(test)` builds this returns a FRESH store per call so tests that
/// point `ORGII_HOME` at a tempdir (`OrgiiHomeGuard`) stay isolated from
/// each other — mirroring the historical ad-hoc-construction behavior.
pub fn definitions_store() -> Arc<AgentDefinitionsStore> {
    #[cfg(test)]
    {
        Arc::new(AgentDefinitionsStore::new())
    }
    #[cfg(not(test))]
    {
        PROCESS_STORE
            .get_or_init(|| Arc::new(AgentDefinitionsStore::new()))
            .clone()
    }
}

/// Store for user-created agent definitions and builtin overrides.
pub struct AgentDefinitionsStore {
    mutation_lock: Mutex<()>,
    agents: Mutex<Vec<AgentDefinition>>,
    storage_path: PathBuf,
    overrides_path: PathBuf,
    /// Effective (compiled + delta) definitions for overridden builtins.
    /// Persistence reduces these back to top-level field deltas.
    builtin_overrides: Mutex<BTreeMap<String, AgentDefinition>>,
}

type ChangeHook = Box<dyn Fn(&str) + Send + Sync>;

static ON_CHANGE: std::sync::OnceLock<ChangeHook> = std::sync::OnceLock::new();

/// Install the process-wide definition-change hook. Called once from the
/// Tauri setup; the hook emits `orgii-agent-defs-changed` to the frontend.
/// Subsequent calls are ignored.
pub fn set_definitions_changed_hook(hook: impl Fn(&str) + Send + Sync + 'static) {
    let _ = ON_CHANGE.set(Box::new(hook));
}

pub(crate) fn notify_change(agent_id: &str) {
    if let Some(hook) = ON_CHANGE.get() {
        hook(agent_id);
    }
}

impl Default for AgentDefinitionsStore {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentDefinitionsStore {
    pub fn new() -> Self {
        Self::from_paths(storage_path(), overrides_path())
    }

    fn from_paths(storage_path: PathBuf, overrides_path: PathBuf) -> Self {
        let mut agents = load_from_disk(&storage_path);
        let mut builtin_overrides = load_overrides_from_disk(&overrides_path);

        // One-shot migration: pre-existing on-disk overlays / user defs may
        // list `builtin:explore` / `builtin:general` (and other internal
        // primitives) as explicit sub-agents — remnants from before these
        // were declared runtime primitives. Strip them eagerly and re-
        // persist so the file on disk converges to the new shape.
        let mut overlays_changed = false;
        for agent in builtin_overrides.values_mut() {
            if super::builtin::strip_forbidden_sub_agents(agent) {
                overlays_changed = true;
            }
        }
        let mut agents_changed = false;
        for agent in agents.iter_mut() {
            if super::builtin::strip_forbidden_sub_agents(agent) {
                agents_changed = true;
            }
        }
        if overlays_changed {
            if let Err(err) = save_overrides_to_disk(&overrides_path, &builtin_overrides) {
                error!("[agent-definitions] migration: failed to persist overrides: {err}");
            } else {
                info!(
                    "[agent-definitions] migration: stripped internal sub-agent ids from {} \
                     overlay(s)",
                    builtin_overrides.len()
                );
            }
        }
        if agents_changed {
            if let Err(err) = save_to_disk(&storage_path, &agents) {
                error!("[agent-definitions] migration: failed to persist agents: {err}");
            } else {
                info!(
                    "[agent-definitions] migration: stripped internal sub-agent ids from \
                     user definitions"
                );
            }
        }

        Self {
            mutation_lock: Mutex::new(()),
            storage_path,
            overrides_path,
            agents: Mutex::new(agents),
            builtin_overrides: Mutex::new(builtin_overrides),
        }
    }

    /// Commit one complete candidate while retaining its owner lock. Readers and
    /// later writers cannot observe it until the atomic file replacement succeeds.
    /// Snapshot locks stay short: readers keep seeing the last committed value during I/O.
    fn commit_users<R>(
        &self,
        mutate: impl FnOnce(&mut Vec<AgentDefinition>) -> Result<R, String>,
    ) -> Result<R, String> {
        self.commit_users_if_changed(|candidate| mutate(candidate).map(|result| (result, true)))
    }

    fn commit_users_if_changed<R>(
        &self,
        mutate: impl FnOnce(&mut Vec<AgentDefinition>) -> Result<(R, bool), String>,
    ) -> Result<R, String> {
        let _writer = self
            .mutation_lock
            .lock()
            .map_err(|err| format!("Lock error: {err}"))?;
        let mut candidate = self.snapshot();
        let (result, changed) = mutate(&mut candidate)?;
        if !changed {
            return Ok(result);
        }
        let mut ids = HashSet::new();
        for agent in &mut candidate {
            if agent.id.trim().is_empty()
                || super::builtin::is_builtin_agent(&agent.id)
                || agent.built_in
                || !ids.insert(agent.id.clone())
            {
                return Err(format!(
                    "Invalid or duplicate custom agent identity: {:?}",
                    agent.id
                ));
            }
            super::builtin::strip_forbidden_sub_agents(agent);
        }
        save_to_disk(&self.storage_path, &candidate)?;
        *self
            .agents
            .lock()
            .map_err(|err| format!("Lock error: {err}"))? = candidate;
        Ok(result)
    }

    fn commit_overrides<R>(
        &self,
        mutate: impl FnOnce(&mut BTreeMap<String, AgentDefinition>) -> Result<R, String>,
    ) -> Result<R, String> {
        let _writer = self
            .mutation_lock
            .lock()
            .map_err(|err| format!("Lock error: {err}"))?;
        let mut candidate = self
            .builtin_overrides
            .lock()
            .map_err(|err| format!("Lock error: {err}"))?
            .clone();
        let result = mutate(&mut candidate)?;
        for (id, agent) in &mut candidate {
            if agent.id != *id || !agent.built_in || super::builtin::get_builtin_agent(id).is_none()
            {
                return Err(format!("Invalid builtin override identity: {id:?}"));
            }
            super::builtin::strip_forbidden_sub_agents(agent);
        }
        save_overrides_to_disk(&self.overrides_path, &candidate)?;
        *self
            .builtin_overrides
            .lock()
            .map_err(|err| format!("Lock error: {err}"))? = candidate;
        Ok(result)
    }

    /// Look up an agent by id. For `builtin:*`, the compiled-in definition
    /// is first consulted, then replaced by any entry in
    /// `builtin-overrides.json`. For non-builtin ids, returns the user
    /// agent from the on-disk store.
    pub fn get(&self, id: &str) -> Option<AgentDefinition> {
        if super::builtin::is_builtin_agent(id) {
            let overlay = self
                .builtin_overrides
                .lock()
                .expect("builtin-overrides mutex poisoned")
                .get(id)
                .cloned();
            if let Some(override_def) = overlay {
                return Some(override_def);
            }
            return super::builtin::get_builtin_agent(id);
        }
        let guard = self
            .agents
            .lock()
            .expect("agent-definitions mutex poisoned");
        guard.iter().find(|a| a.id == id).cloned()
    }

    /// Snapshot of all user-defined agents currently in the store. Does
    /// NOT include builtin agents — consult `builtin::get_builtin_agents`
    /// for those.
    pub fn snapshot(&self) -> Vec<AgentDefinition> {
        self.agents
            .lock()
            .expect("agent-definitions mutex poisoned")
            .clone()
    }

    /// Effective builtin definitions followed by user definitions, matching `get`.
    /// Both locks stay held while taking the snapshot; callers cannot bypass overlays.
    pub fn list_effective(&self) -> Result<Vec<AgentDefinition>, String> {
        let overrides = self
            .builtin_overrides
            .lock()
            .map_err(|err| format!("Lock error: {err}"))?;
        let agents = self
            .agents
            .lock()
            .map_err(|err| format!("Lock error: {err}"))?;
        let mut all = super::builtin::get_builtin_agents();
        for agent in &mut all {
            if let Some(effective) = overrides.get(&agent.id) {
                *agent = effective.clone();
            }
        }
        all.extend(agents.iter().cloned());
        Ok(all)
    }

    /// Atomically mutate a custom definition; errors leave memory and disk unchanged.
    pub fn update<F>(&self, id: &str, patch: F) -> Result<AgentDefinition, String>
    where
        F: FnOnce(&mut AgentDefinition),
    {
        if super::builtin::is_builtin_agent(id) {
            return Err(format!(
                "update() rejects builtin id '{id}'; use update_with_overlay()"
            ));
        }
        let updated = self.commit_users(|candidate| {
            let agent = candidate
                .iter_mut()
                .find(|agent| agent.id == id)
                .ok_or_else(|| format!("agent '{id}' not found"))?;
            patch(agent);
            if agent.id != id {
                return Err("Agent identity cannot be changed by a patch".into());
            }
            super::builtin::strip_forbidden_sub_agents(agent);
            Ok(agent.clone())
        })?;
        notify_change(id);
        Ok(updated)
    }

    /// Update a builtin's effective definition and commit its field delta.
    pub fn update_with_overlay<F>(&self, id: &str, patch: F) -> Result<AgentDefinition, String>
    where
        F: FnOnce(&mut AgentDefinition),
    {
        if !super::builtin::is_builtin_agent(id) {
            return Err(format!(
                "update_with_overlay() requires a builtin id; got '{id}'"
            ));
        }
        let updated = self.commit_overrides(|candidate| {
            let mut agent = candidate
                .get(id)
                .cloned()
                .or_else(|| super::builtin::get_builtin_agent(id))
                .ok_or_else(|| format!("builtin '{id}' does not exist"))?;
            patch(&mut agent);
            super::builtin::strip_forbidden_sub_agents(&mut agent);
            candidate.insert(id.to_string(), agent.clone());
            Ok(agent)
        })?;
        notify_change(id);
        Ok(updated)
    }

    /// Remove an overlay, reverting to the compiled-in definition after commit.
    pub fn reset_builtin(&self, id: &str) -> Result<(), String> {
        if !super::builtin::is_builtin_agent(id) {
            return Err(format!("reset_builtin requires a builtin id; got '{id}'"));
        }
        self.commit_overrides(|candidate| {
            candidate.remove(id);
            Ok(())
        })?;
        notify_change(id);
        Ok(())
    }

    /// Insert a custom agent. The candidate commit validates identity and subagents.
    pub fn insert(&self, agent: AgentDefinition) -> Result<String, String> {
        let id = agent.id.clone();
        self.commit_users(|candidate| {
            if candidate.iter().any(|existing| existing.id == id) {
                return Err(format!("Agent with id '{id}' already exists"));
            }
            candidate.push(agent);
            Ok(())
        })?;
        notify_change(&id);
        Ok(id)
    }

    /// Explicit import replacement, sharing the same commit and notification boundary.
    pub fn upsert(&self, agent: AgentDefinition) -> Result<(), String> {
        let id = agent.id.clone();
        self.commit_users(|candidate| {
            if let Some(existing) = candidate.iter_mut().find(|entry| entry.id == id) {
                *existing = agent;
            } else {
                candidate.push(agent);
            }
            Ok(())
        })?;
        notify_change(&id);
        Ok(())
    }

    pub fn remove(&self, id: &str) -> Result<bool, String> {
        let referencing = super::orgs::orgs_store().org_names_referencing_agent(id);
        if !referencing.is_empty() {
            return Err(format!(
                "Agent '{id}' is still referenced by org(s): {}. Remove it from those orgs first.",
                referencing.join(", ")
            ));
        }
        let removed = self.commit_users_if_changed(|candidate| {
            let before = candidate.len();
            candidate.retain(|agent| agent.id != id);
            let removed = before != candidate.len();
            Ok((removed, removed))
        })?;
        if removed {
            notify_change(id);
        }
        Ok(removed)
    }
}

// ── File I/O ──

/// One-shot migration for the retired `loadWorkspaceSettings` field: if an
/// on-disk definition still carries it, fold its value into the two fields
/// that replaced it (`loadWorkspaceResources` / `loadWorkspaceRules`) when
/// those are unset, then drop the legacy key. Returns `true` when the value
/// was changed and should be re-persisted.
fn migrate_legacy_workspace_settings(value: &mut serde_json::Value) -> bool {
    let Some(obj) = value.as_object_mut() else {
        return false;
    };
    let Some(legacy) = obj.remove("loadWorkspaceSettings") else {
        return false;
    };
    if legacy.as_bool().is_some() {
        for key in ["loadWorkspaceResources", "loadWorkspaceRules"] {
            if obj.get(key).is_none_or(serde_json::Value::is_null) {
                obj.insert(key.to_string(), legacy.clone());
            }
        }
    }
    true
}

/// One-shot migration for the stale `summaryMaxTokens: 4096` compaction
/// override. 4096 was the shipped default before it was raised to 20_000
/// (a 4k cap truncates the 9-section compaction summary mid-section, cf.
/// claude_code COMPACT_MAX_OUTPUT_TOKENS = 20_000); overlays written back
/// then froze the old default as if the user had chosen it. Values other
/// than 4096 are genuine user choices and are left alone. Returns `true`
/// when the value was changed and should be re-persisted.
fn migrate_stale_summary_max_tokens(value: &mut serde_json::Value) -> bool {
    const STALE_DEFAULT: u64 = 4096;
    let Some(summary_max) = value
        .pointer_mut("/sessionModel/compaction/summaryMaxTokens")
        .filter(|v| v.as_u64() == Some(STALE_DEFAULT))
    else {
        return false;
    };
    *summary_max = serde_json::json!(super::schema::CompactionConfig::default().summary_max_tokens);
    true
}

fn load_from_disk(path: &std::path::Path) -> Vec<AgentDefinition> {
    if !path.exists() {
        return Vec::new();
    }
    match std::fs::read_to_string(path) {
        Ok(content) => match serde_json::from_str::<Vec<serde_json::Value>>(&content) {
            Ok(mut raw) => {
                let migrated = raw.iter_mut().fold(false, |acc, v| {
                    migrate_legacy_workspace_settings(v) | migrate_stale_summary_max_tokens(v) | acc
                });
                let agents: Vec<AgentDefinition> = raw
                    .into_iter()
                    .filter_map(|v| match serde_json::from_value(v) {
                        Ok(agent) => Some(agent),
                        Err(err) => {
                            error!(
                                "[agent-definitions] Skipping unparsable entry in {}: {}",
                                path.display(),
                                err
                            );
                            None
                        }
                    })
                    .collect();
                if migrated {
                    if let Err(err) = save_to_disk(path, &agents) {
                        error!(
                            "[agent-definitions] migration: failed to persist \
                             loadWorkspaceSettings removal: {err}"
                        );
                    }
                }
                info!(
                    "[agent-definitions] Loaded {} agents from {}",
                    agents.len(),
                    path.display()
                );
                agents
            }
            Err(err) => {
                error!(
                    "[agent-definitions] Failed to parse {}: {}",
                    path.display(),
                    err
                );
                Vec::new()
            }
        },
        Err(err) => {
            error!(
                "[agent-definitions] Failed to read {}: {}",
                path.display(),
                err
            );
            Vec::new()
        }
    }
}

fn save_to_disk(path: &std::path::Path, agents: &[AgentDefinition]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create directory: {}", err))?;
    }
    let content = serde_json::to_string_pretty(agents)
        .map_err(|err| format!("Failed to serialize agents: {}", err))?;
    atomic_write(path, content.as_bytes())?;
    info!(
        "[agent-definitions] Saved {} agents to {}",
        agents.len(),
        path.display()
    );
    Ok(())
}

fn load_overrides_from_disk(path: &std::path::Path) -> BTreeMap<String, AgentDefinition> {
    if !path.exists() {
        return BTreeMap::new();
    }
    match std::fs::read_to_string(path) {
        Ok(content) => {
            match serde_json::from_str::<BTreeMap<String, serde_json::Value>>(&content) {
                Ok(mut raw) => {
                    let migrated = raw.values_mut().fold(false, |acc, v| {
                        migrate_legacy_workspace_settings(v)
                            | migrate_stale_summary_max_tokens(v)
                            | acc
                    });
                    let overrides: BTreeMap<String, AgentDefinition> = raw
                        .into_iter()
                        .filter_map(
                            |(id, delta)| match compose_builtin_with_delta(&id, &delta) {
                                Some(agent) => Some((id, agent)),
                                None => {
                                    warn!(
                                        "[builtin-overrides] Skipping overlay '{}' in {} \
                                     (unknown builtin or unparsable delta)",
                                        id,
                                        path.display()
                                    );
                                    None
                                }
                            },
                        )
                        .collect();
                    if migrated {
                        if let Err(err) = save_overrides_to_disk(path, &overrides) {
                            error!(
                                "[builtin-overrides] migration: failed to persist \
                             loadWorkspaceSettings removal: {err}"
                            );
                        }
                    }
                    info!(
                        "[builtin-overrides] Loaded {} overrides from {}",
                        overrides.len(),
                        path.display()
                    );
                    overrides
                }
                Err(err) => {
                    warn!(
                        "[builtin-overrides] Failed to parse {}: {} — ignoring overlay",
                        path.display(),
                        err
                    );
                    BTreeMap::new()
                }
            }
        }
        Err(err) => {
            warn!(
                "[builtin-overrides] Failed to read {}: {} — ignoring overlay",
                path.display(),
                err
            );
            BTreeMap::new()
        }
    }
}

/// Compose `compiled builtin + on-disk delta` into an effective definition.
///
/// The delta is a JSON object holding only the top-level fields the user
/// changed. Unknown builtin ids return `None` (e.g. a builtin retired in a
/// newer release). Legacy full-snapshot entries compose identically —
/// every field overwrites the compiled value — and are reduced to true
/// deltas on the next write.
fn compose_builtin_with_delta(id: &str, delta: &serde_json::Value) -> Option<AgentDefinition> {
    let builtin = super::builtin::get_builtin_agent(id)?;
    let mut base = serde_json::to_value(&builtin).ok()?;
    let (Some(base_obj), Some(delta_obj)) = (base.as_object_mut(), delta.as_object()) else {
        return None;
    };
    for (key, value) in delta_obj {
        // Identity/structural keys never come from the overlay.
        if key == "id" || key == "builtIn" {
            continue;
        }
        base_obj.insert(key.clone(), value.clone());
    }
    serde_json::from_value(base).ok()
}

/// Reduce an effective builtin definition back to the top-level field
/// delta against the compiled-in builtin. Fields whose serialized value
/// equals the compiled value are dropped; an explicit `null` is written
/// when the user cleared a field the builtin sets.
fn delta_against_builtin(id: &str, effective: &AgentDefinition) -> Option<serde_json::Value> {
    let builtin = super::builtin::get_builtin_agent(id)?;
    let base = serde_json::to_value(&builtin).ok()?;
    let full = serde_json::to_value(effective).ok()?;
    let (Some(base_obj), Some(full_obj)) = (base.as_object(), full.as_object()) else {
        return None;
    };
    let mut delta = serde_json::Map::new();
    for (key, value) in full_obj {
        if key == "id" || key == "builtIn" {
            continue;
        }
        if base_obj.get(key) != Some(value) {
            delta.insert(key.clone(), value.clone());
        }
    }
    // Fields present on the compiled builtin but absent from the effective
    // serialization were cleared by the user — record explicit null.
    for key in base_obj.keys() {
        if key == "id" || key == "builtIn" {
            continue;
        }
        if !full_obj.contains_key(key) {
            delta.insert(key.clone(), serde_json::Value::Null);
        }
    }
    Some(serde_json::Value::Object(delta))
}

fn save_overrides_to_disk(
    path: &std::path::Path,
    overrides: &BTreeMap<String, AgentDefinition>,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create directory: {}", err))?;
    }
    let deltas: BTreeMap<&String, serde_json::Value> = overrides
        .iter()
        .filter_map(|(id, agent)| delta_against_builtin(id, agent).map(|d| (id, d)))
        .collect();
    let content = serde_json::to_string_pretty(&deltas)
        .map_err(|err| format!("Failed to serialize overrides: {}", err))?;
    atomic_write(path, content.as_bytes())?;
    info!(
        "[builtin-overrides] Saved {} override delta(s) to {}",
        deltas.len(),
        path.display()
    );
    Ok(())
}

/// Write beside the destination so installation is one same-filesystem rename.
/// No failure before installation can truncate or remove the previous definition file.
fn atomic_write(path: &Path, content: &[u8]) -> Result<(), String> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create definition directory: {error}"))?;
    let mut temp = tempfile::Builder::new()
        .prefix(".agent-definitions-")
        .suffix(".tmp")
        .tempfile_in(parent)
        .map_err(|error| format!("Failed to prepare definition write: {error}"))?;
    temp.write_all(content)
        .and_then(|()| temp.as_file().sync_all())
        .map_err(|error| format!("Failed to sync definition write: {error}"))?;
    temp.persist(path)
        .map_err(|error| format!("Failed to install definition file: {}", error.error))?;
    // Some platforms do not permit syncing directories; the file itself was synced
    // before rename. Match the sibling Org store's best-effort directory durability.
    if let Ok(directory) = std::fs::File::open(parent) {
        let _ = directory.sync_all();
    }
    Ok(())
}

#[cfg(test)]
#[path = "store_tests.rs"]
mod store_tests;

#[cfg(test)]
mod overlay_tests {
    use super::*;

    #[test]
    fn compose_applies_delta_field_over_builtin() {
        let delta = serde_json::json!({"name": "My SDE"});
        let agent = compose_builtin_with_delta("builtin:sde", &delta).expect("composes");
        assert_eq!(agent.name, "My SDE");
        // Untouched fields keep compiled-in values.
        let compiled = crate::definitions::builtin::get_builtin_agent("builtin:sde").unwrap();
        assert_eq!(agent.tools.excluded_tools, compiled.tools.excluded_tools);
    }

    #[test]
    fn compose_legacy_full_snapshot_still_composes() {
        let compiled = crate::definitions::builtin::get_builtin_agent("builtin:os").unwrap();
        let mut snapshot = serde_json::to_value(&compiled).unwrap();
        snapshot["name"] = serde_json::json!("Renamed OS");
        let agent = compose_builtin_with_delta("builtin:os", &snapshot).expect("composes");
        assert_eq!(agent.name, "Renamed OS");
    }

    #[test]
    fn delta_round_trip_keeps_only_changed_fields() {
        let mut effective = crate::definitions::builtin::get_builtin_agent("builtin:sde").unwrap();
        effective.name = "Custom SDE".to_string();
        effective.temperature = Some(0.3);

        let delta = delta_against_builtin("builtin:sde", &effective).expect("delta");
        let obj = delta.as_object().expect("object");
        assert!(obj.contains_key("name"));
        assert!(obj.contains_key("temperature"));
        assert!(
            !obj.contains_key("soulContent"),
            "untouched field must not be in the delta"
        );

        let recomposed = compose_builtin_with_delta("builtin:sde", &delta).expect("recompose");
        assert_eq!(recomposed.name, "Custom SDE");
        assert_eq!(recomposed.temperature, Some(0.3));
    }

    #[test]
    fn delta_records_cleared_field_as_null() {
        let mut effective = crate::definitions::builtin::get_builtin_agent("builtin:sde").unwrap();
        // SDE ships a soul; the user clears it.
        assert!(effective.soul_content.is_some());
        effective.soul_content = None;

        let delta = delta_against_builtin("builtin:sde", &effective).expect("delta");
        assert!(delta.get("soulContent").is_some_and(|v| v.is_null()));

        let recomposed = compose_builtin_with_delta("builtin:sde", &delta).expect("recompose");
        assert!(recomposed.soul_content.is_none());
    }

    #[test]
    fn compose_unknown_builtin_returns_none() {
        let delta = serde_json::json!({"name": "ghost"});
        assert!(compose_builtin_with_delta("builtin:retired-agent", &delta).is_none());
    }

    #[test]
    fn stale_summary_max_tokens_4096_is_migrated_to_current_default() {
        let mut value = serde_json::json!({
            "sessionModel": { "compaction": { "summaryMaxTokens": 4096 } }
        });
        assert!(migrate_stale_summary_max_tokens(&mut value));
        assert_eq!(
            value["sessionModel"]["compaction"]["summaryMaxTokens"].as_u64(),
            Some(u64::from(
                super::super::schema::CompactionConfig::default().summary_max_tokens
            ))
        );
    }

    #[test]
    fn user_chosen_summary_max_tokens_is_left_alone() {
        let mut value = serde_json::json!({
            "sessionModel": { "compaction": { "summaryMaxTokens": 8000 } }
        });
        assert!(!migrate_stale_summary_max_tokens(&mut value));
        assert_eq!(
            value["sessionModel"]["compaction"]["summaryMaxTokens"].as_u64(),
            Some(8000)
        );
    }

    #[test]
    fn missing_summary_max_tokens_is_no_op() {
        let mut value = serde_json::json!({ "name": "no compaction override" });
        assert!(!migrate_stale_summary_max_tokens(&mut value));
    }
}
