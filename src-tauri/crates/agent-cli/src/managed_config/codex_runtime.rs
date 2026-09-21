//! Official Codex writes runtime preferences beside ORG2's routing fields.
//! Only verified isolated profiles get this exception to whole-file ownership.
use super::{
    dto::{CliConfigProfileManifest, CliConfigTargetFileManifest},
    file_io::sha256_bytes,
    snapshot::TargetMutation,
};
use std::io::Read;

const MAX_CONFIG_BYTES: usize = 4 * 1024 * 1024;

pub(super) fn owns_target(
    manifest: &CliConfigProfileManifest,
    target: &CliConfigTargetFileManifest,
) -> bool {
    manifest.agent == "codex"
        && target.id == "config"
        && manifest.native_app.as_ref().is_some_and(|profile| {
            profile
                .validate_target("codex", &target.id, &target.target_path)
                .is_ok()
        })
}

fn parse(bytes: &[u8]) -> Result<toml::Table, String> {
    if bytes.len() > MAX_CONFIG_BYTES {
        return Err("Isolated Codex configuration exceeds inspection limit".into());
    }
    std::str::from_utf8(bytes)
        .ok()
        .and_then(|text| toml::from_str(text).ok())
        .ok_or_else(|| "Invalid isolated Codex runtime configuration".into())
}

fn applied(target: &CliConfigTargetFileManifest) -> Result<toml::Table, String> {
    let file = std::fs::File::open(&target.managed_profile_path)
        .map_err(|_| "Cannot inspect committed Codex configuration")?;
    let mut bytes = Vec::new();
    file.take((MAX_CONFIG_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot inspect committed Codex configuration")?;
    if bytes.len() > MAX_CONFIG_BYTES {
        return Err("Committed Codex configuration exceeds inspection limit".into());
    }
    if target.last_applied_hash.as_ref() != Some(&sha256_bytes(&bytes)) {
        return Err("Committed Codex configuration hash mismatch".into());
    }
    parse(&bytes)
}

fn without_runtime(mut value: toml::Table) -> Option<toml::Table> {
    // These sections are written by the supported official App on first open.
    // Unknown root fields, profiles and all provider routing remain protected.
    for key in ["marketplaces", "mcp_servers", "plugins"] {
        if value.remove(key).is_some_and(|entry| !entry.is_table()) {
            return None;
        }
    }
    if value.remove("notify").is_some_and(|entry| {
        !entry
            .as_array()
            .is_some_and(|items| items.iter().all(toml::Value::is_str))
    }) {
        return None;
    }
    if value.remove("model_reasoning_effort").is_some_and(|entry| {
        !matches!(
            entry.as_str(),
            Some("none" | "minimal" | "low" | "medium" | "high" | "xhigh")
        )
    }) {
        return None;
    }
    if let Some(desktop) = value.get_mut("desktop") {
        let desktop = desktop.as_table_mut()?;
        for key in ["followUpQueueMode", "conversationDetailMode"] {
            if desktop.remove(key).is_some_and(|entry| !entry.is_str()) {
                return None;
            }
        }
        if desktop
            .remove("ambient-suggestions-enabled")
            .is_some_and(|entry| !entry.is_bool())
        {
            return None;
        }
        if desktop.is_empty() {
            value.remove("desktop");
        }
    }
    if let Some(projects) = value.get_mut("projects") {
        let projects = projects.as_table_mut()?;
        for (_, project) in projects.iter_mut() {
            let project = project.as_table_mut()?;
            if project
                .remove("trust_level")
                .is_some_and(|entry| !matches!(entry.as_str(), Some("trusted" | "untrusted")))
            {
                return None;
            }
        }
        // Preserve any other project fields for the strict comparison below.
        projects.retain(|_, project| project.as_table().is_none_or(|entry| !entry.is_empty()));
        if projects.is_empty() {
            value.remove("projects");
        }
    }
    Some(value)
}

fn catalog_contains_models(
    manifest: &CliConfigProfileManifest,
    current: &toml::Table,
    applied: &toml::Table,
) -> bool {
    let Some(profile) = manifest.native_app.as_ref() else {
        return false;
    };
    let Some(target) = manifest
        .target_files
        .iter()
        .find(|target| target.id == super::model_catalog::TARGET_ID)
        .filter(|target| {
            manifest.native_model_catalog
                && profile
                    .validate_target("codex", &target.id, &target.target_path)
                    .is_ok()
                && current
                    .get("model_catalog_json")
                    .and_then(toml::Value::as_str)
                    == Some(target.target_path.as_str())
                && applied.get("model_catalog_json") == current.get("model_catalog_json")
        })
    else {
        return false;
    };
    let Ok(file) = std::fs::File::open(&target.target_path) else {
        return false;
    };
    let mut bytes = Vec::new();
    if file
        .take((MAX_CONFIG_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .is_err()
        || bytes.len() > MAX_CONFIG_BYTES
        || target.last_applied_hash.as_ref() != Some(&sha256_bytes(&bytes))
    {
        return false;
    }
    let Ok(catalog) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return false;
    };
    let Some(models) = catalog.get("models").and_then(serde_json::Value::as_array) else {
        return false;
    };
    let (Some(current_model), Some(applied_model)) = (
        current.get("model").and_then(toml::Value::as_str),
        applied.get("model").and_then(toml::Value::as_str),
    ) else {
        return false;
    };
    [current_model, applied_model].iter().all(|model| {
        models
            .iter()
            .any(|entry| entry.get("slug").and_then(serde_json::Value::as_str) == Some(*model))
    })
}

fn runtime_matches(
    manifest: &CliConfigProfileManifest,
    mut current: toml::Table,
    mut applied: toml::Table,
) -> bool {
    if current.get("model") != applied.get("model") {
        // A native picker choice may change only to an alias already committed
        // in this isolated profile's unchanged catalog, never an arbitrary model.
        if !catalog_contains_models(manifest, &current, &applied) {
            return false;
        }
        current.remove("model");
        applied.remove("model");
    }
    match (without_runtime(current), without_runtime(applied)) {
        (Some(current), Some(applied)) => current == applied,
        _ => false,
    }
}

pub(super) fn drift_only(
    manifest: &CliConfigProfileManifest,
    target: &CliConfigTargetFileManifest,
    current: &[u8],
) -> bool {
    if !owns_target(manifest, target) {
        return false;
    }
    let (Ok(current), Ok(applied)) = (parse(current), applied(target)) else {
        return false;
    };
    runtime_matches(manifest, current, applied)
}

pub(super) fn restore(
    manifest: &CliConfigProfileManifest,
    target: &CliConfigTargetFileManifest,
    current: Option<&[u8]>,
    original: Option<&[u8]>,
    force: bool,
) -> Result<TargetMutation, String> {
    let merged = current
        .ok_or_else(|| "Isolated Codex configuration is missing".to_owned())
        .and_then(|current| restore_fields(manifest, target, current, original));
    match merged {
        Ok(mutation) => Ok(mutation),
        // The caller has already verified the original backup's hash. Explicit
        // Force Restore must still recover a malformed or untrusted profile.
        Err(_) if force => Ok(original.map_or(TargetMutation::Remove, |bytes| {
            TargetMutation::Write(bytes.to_vec())
        })),
        Err(error) => Err(error),
    }
}

fn restore_fields(
    manifest: &CliConfigProfileManifest,
    target: &CliConfigTargetFileManifest,
    current: &[u8],
    original: Option<&[u8]>,
) -> Result<TargetMutation, String> {
    // An exact committed current file is its own trusted snapshot. Runtime
    // drift instead requires the managed copy to match the committed hash.
    let mut value = parse(current)?;
    if target.last_applied_hash.as_ref() != Some(&sha256_bytes(current)) {
        let applied = applied(target)?;
        if !runtime_matches(manifest, value.clone(), applied) {
            return Err("Isolated Codex configuration has non-runtime edits".into());
        }
    }
    let original_value = parse(original.unwrap_or_default())?;
    for key in ["model", "model_provider", "model_catalog_json"] {
        if let Some(previous) = original_value.get(key) {
            value.insert(key.into(), previous.clone());
        } else {
            value.remove(key);
        }
    }
    let original_providers = original_value
        .get("model_providers")
        .map(|entry| entry.as_table().ok_or("Invalid original Codex providers"))
        .transpose()?;
    let original_orgii = original_providers.and_then(|entries| entries.get("orgii"));
    if original_orgii.is_some() && !value.contains_key("model_providers") {
        value.insert(
            "model_providers".into(),
            toml::Value::Table(Default::default()),
        );
    }
    if let Some(providers) = value.get_mut("model_providers") {
        let providers = providers
            .as_table_mut()
            .ok_or("Invalid current Codex providers")?;
        if let Some(previous) = original_orgii {
            providers.insert("orgii".into(), previous.clone());
        } else {
            providers.remove("orgii");
        }
        if providers.is_empty() && original_providers.is_none() {
            value.remove("model_providers");
        }
    }
    if original.is_none() && value.is_empty() {
        return Ok(TargetMutation::Remove);
    }
    toml::to_string_pretty(&value)
        .map(|text| TargetMutation::Write(text.into_bytes()))
        .map_err(|_| "Cannot restore isolated Codex runtime configuration".into())
}
