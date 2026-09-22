//! Native API connections. These profiles do not depend on an ORGII process.
use std::collections::BTreeMap;

use super::dto::{CliConfigMode, CliConfigProfileManifest};

// Intentionally no Debug/Serialize: this value holds a decrypted credential.
pub struct DirectConnection {
    pub profile: Option<super::provider_profiles::ClaudeProviderProfile>,
    pub key_id: String,
    pub provider: String,
    pub model: String,
    pub base_url: String,
    pub api_key: String,
    pub desktop_auth_scheme: Option<String>,
    /// Claude Desktop can fetch the short-lived local-proxy credential from an
    /// executable helper. The helper contains only a loopback proxy token; it
    /// never receives a Market bearer or refresh credential.
    pub desktop_helper: Option<super::desktop::CredentialHelper>,
    /// Present only when this otherwise-direct Desktop profile is backed by
    /// ORG2's authenticated local proxy.
    pub proxy_token: Option<String>,
}

pub(super) fn generate_direct_configs(
    agent: &str,
    contents: &BTreeMap<String, String>,
    connection: &DirectConnection,
    previous: Option<&CliConfigProfileManifest>,
) -> Result<BTreeMap<String, String>, String> {
    if (connection.api_key.trim().is_empty() && connection.desktop_helper.is_none())
        || connection.model.trim().is_empty()
    {
        return Err("An API key and model are required".into());
    }
    if agent == super::desktop::TARGET {
        return super::desktop::generate(contents, connection, previous);
    }
    if connection.profile.is_some() && !matches!(agent, "claude_code" | "claude_desktop") {
        return Err("Claude profiles cannot configure another app".into());
    }
    if connection.desktop_auth_scheme.is_some() {
        return Err("Desktop authentication settings cannot be applied to a CLI target".into());
    }
    if connection.desktop_helper.is_some() || connection.proxy_token.is_some() {
        return Err("Desktop proxy settings cannot be applied to a CLI target".into());
    }
    let (file_id, generated) = match agent {
        "claude_code" => (
            "settings",
            claude(
                contents.get("settings").map(String::as_str).unwrap_or(""),
                connection,
            )?,
        ),
        "codex" => (
            "config",
            codex(
                contents.get("config").map(String::as_str).unwrap_or(""),
                connection,
                previous,
            )?,
        ),
        _ => return Err("Direct connections currently support Claude Code and Codex".into()),
    };
    Ok(BTreeMap::from([(file_id.to_string(), generated)]))
}

fn claude(raw: &str, connection: &DirectConnection) -> Result<String, String> {
    let mut settings: serde_json::Value = if raw.trim().is_empty() {
        serde_json::json!({})
    } else {
        // Do not include parser diagnostics: source excerpts can contain secrets.
        serde_json::from_str(raw).map_err(|_| "Invalid Claude Code settings JSON")?
    };
    let root = settings
        .as_object_mut()
        .ok_or("Claude Code settings must be an object")?;
    if root.contains_key("apiKeyHelper") {
        return Err(
            "Claude Code uses apiKeyHelper. Resolve that authentication override before switching."
                .into(),
        );
    }
    if connection.profile.is_some()
        && root
            .get("modelOverrides")
            .is_some_and(|v| v.as_object().is_none_or(|m| !m.is_empty()))
    {
        return Err(
            "Resolve Claude Code modelOverrides before applying a role mapping profile".into(),
        );
    }
    let env = root
        .entry("env")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or("Claude Code env must be an object")?;
    if [
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
        "CLAUDE_CODE_USE_FOUNDRY",
    ]
    .iter()
    .any(|key| {
        env.get(*key)
            .is_some_and(|value| value.as_str() == Some("1") || value.as_bool() == Some(true))
    }) {
        return Err(
            "Claude Code has a cloud-provider override. Resolve it before switching.".into(),
        );
    }
    // Remove conflicting authentication/model aliases only; preserve all other settings.
    for key in [
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "CLAUDE_CODE_OAUTH_TOKEN",
        "ANTHROPIC_DEFAULT_OPUS_MODEL",
        "ANTHROPIC_DEFAULT_SONNET_MODEL",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL",
        "ANTHROPIC_SMALL_FAST_MODEL",
    ] {
        env.remove(key);
    }
    super::claude_models::clear_role_overrides(env);
    if let Some(profile) = &connection.profile {
        profile.validate()?;
        profile.models.write_cli(env);
    }
    let auth_field = if connection
        .profile
        .as_ref()
        .map(|p| p.auth_scheme.as_str() == "x-api-key")
        .unwrap_or(connection.base_url == "https://api.anthropic.com")
    {
        "ANTHROPIC_API_KEY"
    } else {
        "ANTHROPIC_AUTH_TOKEN"
    };
    env.insert(auth_field.into(), connection.api_key.clone().into());
    env.insert(
        "ANTHROPIC_BASE_URL".into(),
        connection.base_url.clone().into(),
    );
    let model = connection
        .profile
        .as_ref()
        .map(|p| p.models.default_role.as_str())
        .unwrap_or(&connection.model);
    env.insert("ANTHROPIC_MODEL".into(), model.into());
    root.insert("model".into(), model.into());
    serde_json::to_string_pretty(&settings)
        .map_err(|_| "Failed to serialize Claude Code settings".into())
}

fn codex(
    raw: &str,
    connection: &DirectConnection,
    previous: Option<&CliConfigProfileManifest>,
) -> Result<String, String> {
    use toml_edit::{value, Document, Item, Table};
    let mut config = raw.parse::<Document>().map_err(|_| "Invalid Codex TOML")?;
    if config
        .get("model_providers")
        .is_some_and(|item| !item.is_table())
    {
        return Err("Codex model_providers must be a table".into());
    }
    let owned = previous.is_some_and(|manifest| manifest.mode != CliConfigMode::Default);
    if !owned
        && config
            .get("model_providers")
            .and_then(|item| item.get("orgii"))
            .is_some()
    {
        return Err(
            "A Codex provider named orgii already exists. Rename it before switching.".into(),
        );
    }
    if config.get("model_providers").is_none() {
        config["model_providers"] = Item::Table(Table::new());
    }
    let mut provider = Table::new();
    provider["name"] = value("ORG2");
    provider["base_url"] = value(&connection.base_url);
    provider["wire_api"] = value("responses");
    provider["requires_openai_auth"] = value(false);
    provider["experimental_bearer_token"] = value(&connection.api_key);
    provider["supports_websockets"] = value(false);
    config["model_providers"]["orgii"] = Item::Table(provider);
    config["model_provider"] = value("orgii");
    config["model"] = value(&connection.model);
    // auth.json, the OS credential store, other providers and profiles remain untouched.
    Ok(config.to_string())
}

/// Verify a previously applied Claude overlay against the currently resolved
/// credential/profile, without writing configuration or exposing its secrets.
pub fn verify_claude_launch_connection(connection: &DirectConnection) -> Result<(), String> {
    let _guard = super::config_operation_guard()?;
    let _target_lock = super::target_lock::lock_targets("claude_code")?;
    let manifest = super::manifest::read_manifest("claude_code")?
        .ok_or("Claude Code connection is missing")?;
    if manifest.mode != CliConfigMode::Direct
        || manifest.selected_key_id.as_deref() != Some(&connection.key_id)
        || manifest.selected_model.as_deref() != Some(&connection.model)
        || manifest.provider_profile != connection.profile
    {
        return Err("Selected client configuration changed".into());
    }
    let status = super::operations::status_for_unlocked("claude_code")?;
    if status.conflict || !status.overlay {
        return Err("Selected client configuration changed".into());
    }
    let settings = status
        .target_files
        .iter()
        .find(|target| target.id == "settings")
        .ok_or("Claude Code settings are missing")?;
    let raw = std::fs::read_to_string(&settings.target_path)
        .map_err(|_| "Could not read Claude Code settings")?;
    let refreshed = claude(&raw, connection)?;
    let old: serde_json::Value =
        serde_json::from_str(&raw).map_err(|_| "Invalid Claude Code settings")?;
    let current: serde_json::Value =
        serde_json::from_str(&refreshed).map_err(|_| "Invalid Claude Code settings")?;
    if old != current {
        return Err("Connection credentials or profile changed; apply the connection again".into());
    }
    Ok(())
}
