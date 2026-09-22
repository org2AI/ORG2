//! Claude Desktop's local third-party inference profile. This is a configuration
//! target only: Desktop is never registered as an executable CLI agent.
use super::{
    direct::DirectConnection,
    dto::{CliConfigProfileManifest, CliConfigTargetFileManifest},
};
use serde_json::{json, Value};
use std::{collections::BTreeMap, path::PathBuf};

pub const TARGET: &str = "claude_desktop";
pub(super) const PROFILE_ID: &str = "01704638-8000-4000-8000-000000000002";
const MANAGED_DEPLOYMENT_MODE: &str = "3p";

pub struct CredentialHelper {
    pub path: PathBuf,
    pub token: String,
    pub models: Vec<super::model_catalog::PickerModel>,
}

pub fn credential_helper_path() -> PathBuf {
    let helper_name = if cfg!(windows) {
        "claude-desktop-market.cmd"
    } else {
        "claude-desktop-market.sh"
    };
    app_paths::orgii_root()
        .join("market-helpers")
        .join(helper_name)
}

pub fn supported() -> bool {
    cfg!(any(target_os = "macos", windows))
}

pub(super) fn targets() -> Result<Vec<(&'static str, String, PathBuf)>, String> {
    if !supported() {
        return Err("Claude Desktop connections currently support macOS and Windows".into());
    }
    // Desktop reads deploymentMode beside its third-party profile library.
    // That file also contains runtime preferences, so ownership checks and
    // restoration below are scoped to deploymentMode, not those preferences.
    let local = app_paths::external_history_data_local_dir();
    let library = local.join("Claude-3p/configLibrary");
    let helper_name = if cfg!(windows) {
        "claude-desktop-market.cmd"
    } else {
        "claude-desktop-market.sh"
    };
    let helper = credential_helper_path();
    Ok(vec![
        (
            "desktop",
            "desktop.json".into(),
            local.join("Claude-3p/claude_desktop_config.json"),
        ),
        (
            "profile",
            "profile.json".into(),
            library.join(format!("{PROFILE_ID}.json")),
        ),
        ("catalog", "catalog.json".into(), library.join("_meta.json")),
        ("helper", helper_name.into(), helper),
    ])
}

pub(super) fn owns_runtime_mode(target: &CliConfigTargetFileManifest) -> bool {
    target.id == "desktop"
        && (std::path::Path::new(&target.target_path)
            == app_paths::external_history_data_local_dir()
                .join("Claude-3p/claude_desktop_config.json")
            || super::native_app::is_desktop_runtime_path(std::path::Path::new(
                &target.target_path,
            )))
}

fn runtime_object(bytes: &[u8]) -> Result<serde_json::Map<String, Value>, String> {
    if bytes.is_empty() {
        return Ok(Default::default());
    }
    serde_json::from_slice::<Value>(bytes)
        .ok()
        .and_then(|value| value.as_object().cloned())
        .ok_or_else(|| "Invalid Claude Desktop runtime configuration".into())
}

/// Native preference writes do not transfer ownership of deploymentMode.
/// Whole-file snapshots still guard the actual transaction against races.
pub(super) fn runtime_mode_matches(current: &[u8]) -> bool {
    runtime_object(current).is_ok_and(|current| {
        !current.contains_key("enterpriseConfig")
            && current.get("deploymentMode").and_then(Value::as_str)
                == Some(MANAGED_DEPLOYMENT_MODE)
    })
}

pub(super) fn restore_runtime_mode(
    target: &CliConfigTargetFileManifest,
    current: &[u8],
    original: Option<&[u8]>,
) -> Result<super::snapshot::TargetMutation, String> {
    use super::snapshot::TargetMutation;
    // A failed apply may have prepared a newer managed-profile copy without
    // committing its manifest. Only committed manifest hashes are evidence.
    if target.last_applied_hash.as_ref() == Some(&super::file_io::sha256_bytes(current)) {
        return Ok(original.map_or(TargetMutation::Remove, |bytes| {
            TargetMutation::Write(bytes.to_vec())
        }));
    }
    let mut value = runtime_object(current)?;
    let original_value = runtime_object(original.unwrap_or_default())?;
    if let Some(mode) = original_value.get("deploymentMode") {
        value.insert("deploymentMode".into(), mode.clone());
    } else {
        value.remove("deploymentMode");
    }
    if original.is_none() && value.is_empty() {
        return Ok(TargetMutation::Remove);
    }
    serde_json::to_vec_pretty(&value)
        .map(TargetMutation::Write)
        .map_err(|_| "Invalid Claude Desktop runtime configuration".into())
}

/// Do not claim a local profile can override administrator policy. Read-only
/// detection is conservative; no system preferences or registry values are written.
pub fn ensure_unmanaged() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let user = app_paths::external_history_home_dir()
            .file_name()
            .ok_or("Cannot determine the Desktop configuration user")?
            .to_owned();
        let root = PathBuf::from("/Library/Managed Preferences");
        for path in [
            root.join("com.anthropic.claudefordesktop.plist"),
            root.join(user).join("com.anthropic.claudefordesktop.plist"),
        ] {
            if path
                .try_exists()
                .map_err(|_| "Cannot inspect managed Claude Desktop preferences")?
            {
                return Err("Claude Desktop has managed preferences. Use your administrator's configuration; ORG2 will not override it.".into());
            }
        }
    }
    #[cfg(windows)]
    {
        use winreg::{
            enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_64KEY},
            RegKey,
        };
        for hive in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
            match RegKey::predef(hive)
                .open_subkey_with_flags(r"SOFTWARE\Policies\Claude", KEY_READ | KEY_WOW64_64KEY)
            {
                Ok(_) => {
                    return Err(
                        "Claude Desktop has managed policy. ORG2 will not override it.".into(),
                    )
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err("Cannot inspect managed Claude Desktop policy".into()),
            }
        }
    }
    Ok(())
}

fn object(contents: &BTreeMap<String, String>, id: &str) -> Result<Value, String> {
    let raw = contents.get(id).map(String::as_str).unwrap_or("");
    let value = if raw.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(raw).map_err(|_| "Invalid Claude Desktop configuration JSON")?
    };
    if !value.is_object() {
        return Err("Claude Desktop configuration must be a JSON object".into());
    }
    Ok(value)
}

pub fn validate_model(model: &str) -> Result<(), String> {
    let id = model.strip_prefix("anthropic/").unwrap_or(model);
    if [
        "claude-sonnet-",
        "claude-opus-",
        "claude-haiku-",
        "claude-fable-",
    ]
    .iter()
    .any(|prefix| {
        id.strip_prefix(prefix)
            .is_some_and(|suffix| !suffix.is_empty())
    }) && model
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || b"-._/".contains(&byte))
    {
        Ok(())
    } else {
        Err("Desktop direct connections require a full Claude Sonnet, Opus, Haiku or Fable model ID. For other IDs, use a model mapping profile in App connections.".into())
    }
}

/// Expose the vendor's user-initiated import flow in isolated Market profiles.
/// This does not enable automatic imports or read the primary App's history.
/// https://claude.com/docs/third-party/claude-desktop/import
pub(super) fn enable_history_import(contents: &mut BTreeMap<String, String>) -> Result<(), String> {
    let mut profile = object(contents, "profile")?;
    profile["claudeAiImport"] = json!({ "enabled": true });
    contents.insert(
        "profile".into(),
        serde_json::to_string_pretty(&profile)
            .map_err(|_| "Cannot serialize Desktop history import settings")?,
    );
    Ok(())
}

pub(super) fn generate(
    contents: &BTreeMap<String, String>,
    connection: &DirectConnection,
    previous: Option<&CliConfigProfileManifest>,
) -> Result<BTreeMap<String, String>, String> {
    if let Some(profile) = &connection.profile {
        profile.validate()?;
    } else if connection.desktop_helper.is_none() {
        validate_model(&connection.model)?;
    }
    if let Some(helper) = &connection.desktop_helper {
        if connection.profile.is_some()
            || !connection.api_key.is_empty()
            || connection.proxy_token.as_deref() != Some(helper.token.as_str())
            || !helper.path.is_absolute()
            || helper.models.is_empty()
            || helper.models.len() > 256
            || !helper
                .models
                .iter()
                .any(|model| model.id == connection.model)
            || helper.token.len() != 64
            || !helper.token.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err("Invalid Desktop credential helper configuration".into());
        }
        for model in &helper.models {
            // Dynamic catalogs are validated against live source capabilities
            // before reaching this writer. Their aliases can name GPT through
            // the Messages gateway; direct account IDs keep the Claude guard.
            if model.id.is_empty()
                || model.id.len() > 256
                || !model
                    .id
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"-._/".contains(&byte))
            {
                return Err("Invalid Desktop catalog model ID".into());
            }
            if model.label.trim().is_empty()
                || model.label.len() > 512
                || model.label.chars().any(char::is_control)
            {
                return Err("Invalid Desktop model label".into());
            }
        }
    } else if connection.proxy_token.is_some() {
        return Err("Desktop proxy token requires a credential helper".into());
    }
    let owned = previous.is_some_and(|manifest| manifest.mode != super::CliConfigMode::Default);
    if !owned
        && contents
            .get("profile")
            .is_some_and(|raw| !raw.trim().is_empty())
    {
        return Err("An existing Claude Desktop profile uses ORG2's profile ID. Resolve that conflict before switching.".into());
    }
    let options = connection
        .desktop_auth_scheme
        .as_deref()
        .ok_or("Desktop connection settings are required")?;
    if !matches!(options, "bearer" | "x-api-key") {
        return Err("Unsupported Desktop authentication scheme".into());
    }
    let mut generated = BTreeMap::new();
    let mut desktop = object(contents, "desktop")?;
    if desktop.get("enterpriseConfig").is_some() {
        return Err("Claude Desktop has inline enterprise configuration. Resolve it in Desktop before switching.".into());
    }
    desktop["deploymentMode"] = json!(MANAGED_DEPLOYMENT_MODE);
    generated.insert("desktop".into(), desktop);
    let mut catalog = object(contents, "catalog")?;
    let mut entries = match catalog.get("entries") {
        Some(value) => value
            .as_array()
            .ok_or("Invalid Claude Desktop profile catalog")?
            .clone(),
        None => Vec::new(),
    };
    if !owned && entries.iter().any(|entry| entry["id"] == PROFILE_ID) {
        return Err("An existing Claude Desktop catalog entry uses ORG2's profile ID".into());
    }
    entries.retain(|entry| entry["id"] != PROFILE_ID);
    entries.push(json!({"id": PROFILE_ID, "name": "ORG2"}));
    catalog["entries"] = json!(entries);
    catalog["appliedId"] = json!(PROFILE_ID);
    generated.insert("catalog".into(), catalog);
    generated.insert(
        "profile".into(),
        json!({
            "inferenceProvider": "gateway",
            "inferenceGatewayBaseUrl": connection.base_url,
            "inferenceGatewayApiKey": connection.api_key,
            "inferenceGatewayAuthScheme": options,
            "inferenceModels": connection.profile.as_ref().map(|p| p.models.desktop_catalog()).unwrap_or_else(|| vec![json!({"name": connection.model})]),
            "modelDiscoveryEnabled": false
        }),
    );
    if let Some(helper) = &connection.desktop_helper {
        let profile = generated
            .get_mut("profile")
            .and_then(Value::as_object_mut)
            .ok_or("Desktop profile is invalid")?;
        profile.remove("inferenceGatewayApiKey");
        profile.insert("inferenceCredentialKind".into(), json!("helper-script"));
        profile.insert(
            "inferenceCredentialHelper".into(),
            json!(helper.path.to_string_lossy()),
        );
        profile.insert("inferenceCredentialHelperTtlSec".into(), json!(60));
        let mut models = helper.models.clone();
        models.sort_by_key(|model| model.id != connection.model);
        models.dedup_by(|a, b| a.id == b.id);
        profile.insert(
            "inferenceModels".into(),
            json!(models
                .into_iter()
                .map(|model| json!({"name": model.id, "labelOverride": model.label}))
                .collect::<Vec<_>>()),
        );
        let helper_contents = if cfg!(windows) {
            format!("@echo off\r\necho {}\r\n", helper.token)
        } else {
            format!("#!/bin/sh\nprintf '%s\\n' '{}'\n", helper.token)
        };
        generated.insert("helper".into(), Value::String(helper_contents));
    }
    generated
        .into_iter()
        .map(|(id, value)| {
            if id == "helper" {
                return value
                    .as_str()
                    .map(|raw| (id, raw.to_owned()))
                    .ok_or_else(|| "Cannot serialize Desktop credential helper".into());
            }
            serde_json::to_string_pretty(&value)
                .map(|raw| (id, raw))
                .map_err(|_| "Cannot serialize Claude Desktop configuration".into())
        })
        .collect()
}
