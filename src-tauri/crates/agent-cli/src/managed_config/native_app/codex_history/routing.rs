//! Append-only routing snapshot for the audited Codex 0.155.0-alpha.9.2 wire format.
//! Native optional settings additionally audited from 0.155.0-alpha.16.3 desktop output.
//!
//! A paginated rollout keeps every original byte (including ancestor cutoffs).
//! Its appended event receives the caller's checked next ordinal; legacy rollouts
//! omit ordinal entirely. The caller holds writer locks and chooses credentials,
//! provider, model and permissions from the DESTINATION profile, never the source.
//! New destination threads use the conservative helpers below. Unknown permission
//! shapes fail closed instead of becoming a default that could expand access.

use std::path::Path;

use serde_json::{json, Map, Value};

const MAX_PERMISSION_BYTES: usize = 64 * 1024;
const MAX_PERMISSION_ENTRIES: usize = 256;

pub(super) fn conservative_permission_profile() -> Value {
    json!({"type":"managed","file_system":{"type":"restricted","entries":[
        {"path":{"type":"special","value":{"kind":"root"}},"access":"read"}
    ]},"network":"restricted"})
}

pub(super) fn conservative_approval_policy() -> Value {
    json!("on-request")
}

fn object<'a>(
    value: &'a Value,
    required: &[&str],
    optional: &[&str],
) -> Result<&'a Map<String, Value>, String> {
    let object = value
        .as_object()
        .ok_or("Codex routing settings require an object")?;
    if required.iter().any(|key| !object.contains_key(*key))
        || object
            .keys()
            .any(|key| !required.contains(&key.as_str()) && !optional.contains(&key.as_str()))
    {
        return Err("Unsupported Codex routing settings fields".into());
    }
    Ok(object)
}

fn text(value: &Value, max: usize) -> Result<&str, String> {
    let value = value
        .as_str()
        .ok_or("Codex routing settings require a string")?;
    if value.is_empty() || value.len() > max || value.chars().any(char::is_control) {
        return Err("Invalid Codex routing settings string".into());
    }
    Ok(value)
}

fn choice(value: &Value, choices: &[&str]) -> Result<(), String> {
    if value.as_str().is_some_and(|value| choices.contains(&value)) {
        Ok(())
    } else {
        Err("Unsupported Codex routing settings value".into())
    }
}

fn validate_path(value: &Value) -> Result<(), String> {
    match value.get("type").and_then(Value::as_str) {
        Some("path") => {
            let value = object(value, &["type", "path"], &[])?;
            if !Path::new(text(&value["path"], 4096)?).is_absolute() {
                return Err("Codex permission paths must be absolute".into());
            }
        }
        Some("glob_pattern") => {
            let value = object(value, &["type", "pattern"], &[])?;
            text(&value["pattern"], 4096)?;
        }
        Some("special") => {
            let value = object(value, &["type", "value"], &[])?;
            let special = &value["value"];
            match special.get("kind").and_then(Value::as_str) {
                Some("root" | "minimal" | "tmpdir" | "slash_tmp") => {
                    object(special, &["kind"], &[])?;
                }
                Some("project_roots" | "current_working_directory") => {
                    let special = object(special, &["kind"], &["subpath"])?;
                    if let Some(subpath) = special.get("subpath").filter(|value| !value.is_null()) {
                        let subpath = text(subpath, 4096)?;
                        if Path::new(subpath).is_absolute()
                            || Path::new(subpath)
                                .components()
                                .any(|part| part == std::path::Component::ParentDir)
                        {
                            return Err(
                                "Codex permission subpaths must remain inside project roots".into(),
                            );
                        }
                    }
                }
                _ => return Err("Unsupported Codex permission special path".into()),
            }
        }
        _ => return Err("Unsupported Codex permission path".into()),
    }
    Ok(())
}

fn validate_profile(value: &Value) -> Result<(), String> {
    match value.get("type").and_then(Value::as_str) {
        Some("disabled") => {
            object(value, &["type"], &[])?;
        }
        Some("external") => {
            let value = object(value, &["type", "network"], &[])?;
            choice(&value["network"], &["restricted", "enabled"])?;
        }
        Some("managed") => {
            let value = object(value, &["type", "file_system", "network"], &[])?;
            choice(&value["network"], &["restricted", "enabled"])?;
            let file_system = &value["file_system"];
            match file_system.get("type").and_then(Value::as_str) {
                Some("unrestricted") => {
                    object(file_system, &["type"], &[])?;
                }
                Some("restricted") => {
                    let file_system =
                        object(file_system, &["type", "entries"], &["glob_scan_max_depth"])?;
                    if let Some(depth) = file_system
                        .get("glob_scan_max_depth")
                        .filter(|value| !value.is_null())
                    {
                        if !depth
                            .as_u64()
                            .is_some_and(|depth| depth > 0 && depth <= usize::MAX as u64)
                        {
                            return Err("Invalid Codex permission glob scan depth".into());
                        }
                    }
                    let entries = file_system["entries"]
                        .as_array()
                        .ok_or("Invalid Codex permission entries")?;
                    if entries.len() > MAX_PERMISSION_ENTRIES {
                        return Err("Codex permission entry limit exceeded".into());
                    }
                    for entry in entries {
                        let entry = object(entry, &["path", "access"], &["missing_path_behavior"])?;
                        choice(&entry["access"], &["read", "write", "deny", "none"])?;
                        if let Some(behavior) = entry
                            .get("missing_path_behavior")
                            .filter(|value| !value.is_null())
                        {
                            choice(behavior, &["skip"])?;
                        }
                        validate_path(&entry["path"])?;
                    }
                }
                _ => return Err("Unsupported Codex filesystem permission profile".into()),
            }
        }
        _ => return Err("Unsupported Codex permission profile".into()),
    }
    Ok(())
}

/// Normalizes only native legacy shapes whose exact semantics need no filesystem
/// inspection. Legacy workspace-write needs gitdir and metadata protections; it
/// must be materialized by native Codex first, not approximated here.
fn permission_profile(value: &Value) -> Result<Value, String> {
    if serde_json::to_vec(value)
        .map_err(|error| error.to_string())?
        .len()
        > MAX_PERMISSION_BYTES
    {
        return Err("Codex permission profile size limit exceeded".into());
    }
    let normalized = match value.get("type").and_then(Value::as_str) {
        Some("read-only") => {
            let value = object(value, &["type"], &["network_access"])?;
            let enabled = match value.get("network_access") {
                Some(value) => value.as_bool().ok_or("Invalid legacy Codex network permission")?,
                None => false,
            };
            let mut profile = conservative_permission_profile();
            profile["network"] = json!(if enabled { "enabled" } else { "restricted" });
            profile
        }
        Some("danger-full-access") => { object(value, &["type"], &[])?; json!({"type":"disabled"}) }
        Some("external-sandbox") => {
            let value = object(value, &["type"], &["network_access"])?;
            let network = value.get("network_access").cloned().unwrap_or_else(|| json!("restricted"));
            choice(&network, &["restricted", "enabled"])?;
            json!({"type":"external","network":network})
        }
        Some("workspace-write") => return Err("Legacy Codex workspace-write permissions require native materialization before history sharing".into()),
        _ => value.clone(),
    };
    validate_profile(&normalized)?;
    Ok(normalized)
}

fn approval_policy(value: &Value) -> Result<Value, String> {
    if value == "on-failure" {
        return Ok(json!("on-request"));
    }
    if value.is_string() {
        choice(value, &["on-request", "untrusted", "never"])?;
    } else {
        let policy = object(value, &["granular"], &[])?;
        let granular = object(
            &policy["granular"],
            &["sandbox_approval", "rules", "mcp_elicitations"],
            &["skill_approval", "request_permissions"],
        )?;
        if granular.values().any(|value| !value.is_boolean()) {
            return Err("Invalid granular Codex approval policy".into());
        }
    }
    Ok(value.clone())
}

pub(super) fn settings_event(
    id: &str,
    model: &str,
    provider: &str,
    cwd: &Path,
    destination_permission_profile: &Value,
    destination_approval_policy: &Value,
    next_ordinal: Option<u64>,
) -> Result<Value, String> {
    if id.len() != 36
        || id.bytes().enumerate().any(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte != b'-'
            } else {
                !byte.is_ascii_hexdigit()
            }
        })
    {
        return Err("Invalid Codex thread ID for routing event".into());
    }
    for value in [model, provider] {
        if value.is_empty()
            || value.len() > 256
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"-_.:/".contains(&byte))
        {
            return Err("Invalid destination Codex model/provider".into());
        }
    }
    let cwd = cwd.to_str().ok_or("Codex routing cwd must be UTF-8")?;
    if !Path::new(cwd).is_absolute() || cwd.len() > 4096 || cwd.chars().any(char::is_control) {
        return Err("Invalid destination Codex cwd".into());
    }
    if next_ordinal.is_some_and(|ordinal| ordinal > i64::MAX as u64) {
        return Err("Codex routing ordinal exceeds native SQLite range".into());
    }
    let permission_profile = permission_profile(destination_permission_profile)?;
    let approval_policy = approval_policy(destination_approval_policy)?;
    let mut event = json!({
        "timestamp":chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "type":"event_msg",
        "payload":{
            "type":"thread_settings_applied","thread_id":id,
            "thread_settings":{
                "model":model,"model_provider_id":provider,
                "approval_policy":approval_policy,"approvals_reviewer":"user",
                "permission_profile":permission_profile,"cwd":cwd,
                "collaboration_mode":{"mode":"default","settings":{
                    "model":model,"reasoning_effort":null,"developer_instructions":null
                }}
            }
        }
    });
    // Omit optional runtime roots and disabled_plugin_ids: these belong to the
    // destination runtime. A source profile's plugin policy is never imported.
    if let Some(ordinal) = next_ordinal {
        event["ordinal"] = json!(ordinal);
    }
    Ok(event)
}

#[cfg(test)]
mod tests {
    use super::*;
    const ID: &str = "01a0c752-37df-7e70-ab1e-2cfcac78b96f";

    fn event(profile: &Value, policy: &Value, ordinal: Option<u64>) -> Result<Value, String> {
        settings_event(
            ID,
            "gpt-5.4-mini",
            "test_b",
            Path::new("/tmp/native-probe"),
            profile,
            policy,
            ordinal,
        )
    }

    #[test]
    fn audited_native_event_shape_has_identity_route_and_safe_new_permissions() {
        let result = event(
            &conservative_permission_profile(),
            &conservative_approval_policy(),
            Some(13),
        )
        .unwrap();
        // Snapshot shape captured from native 0.155.0-alpha.9.2 app-server,
        // then independently resumed by it with a loopback-only model.
        let expected = json!({"type":"thread_settings_applied","thread_id":ID,"thread_settings":{
            "model":"gpt-5.4-mini","model_provider_id":"test_b","approval_policy":"on-request","approvals_reviewer":"user",
            "permission_profile":{"type":"managed","file_system":{"type":"restricted","entries":[{"path":{"type":"special","value":{"kind":"root"}},"access":"read"}]},"network":"restricted"},
            "cwd":"/tmp/native-probe","collaboration_mode":{"mode":"default","settings":{"model":"gpt-5.4-mini","reasoning_effort":null,"developer_instructions":null}}
        }});
        assert_eq!(result["payload"], expected);
        assert_eq!(result["ordinal"], 13);
        assert!(
            chrono::DateTime::parse_from_rfc3339(result["timestamp"].as_str().unwrap()).is_ok()
        );
        assert!(event(
            &conservative_permission_profile(),
            &json!("on-request"),
            None
        )
        .unwrap()
        .get("ordinal")
        .is_none());
    }

    #[test]
    fn preserves_destination_permissions_and_granular_approval() {
        let mut profile = conservative_permission_profile();
        profile["file_system"]["entries"]
            .as_array_mut()
            .unwrap()
            .push(json!({"path":{"type":"path","path":"/tmp/destination"},"access":"write"}));
        let approval = json!({"granular":{"sandbox_approval":false,"rules":true,"mcp_elicitations":false,"skill_approval":false,"request_permissions":true}});
        let result = event(&profile, &approval, Some(7)).unwrap();
        assert_eq!(
            result["payload"]["thread_settings"]["permission_profile"],
            profile
        );
        assert_eq!(
            result["payload"]["thread_settings"]["approval_policy"],
            approval
        );
    }

    #[test]
    fn normalizes_only_audited_legacy_permissions() {
        assert_eq!(
            permission_profile(&json!({"type":"read-only"})).unwrap(),
            conservative_permission_profile()
        );
        assert_eq!(
            permission_profile(&json!({"type":"read-only","network_access":true})).unwrap()
                ["network"],
            "enabled"
        );
        assert_eq!(
            permission_profile(&json!({"type":"danger-full-access"})).unwrap(),
            json!({"type":"disabled"})
        );
        assert_eq!(
            permission_profile(&json!({"type":"external-sandbox"})).unwrap(),
            json!({"type":"external","network":"restricted"})
        );
        assert_eq!(
            approval_policy(&json!("on-failure")).unwrap(),
            json!("on-request")
        );
        assert!(permission_profile(&json!({"type":"workspace-write"})).is_err());
    }

    #[test]
    fn malformed_or_future_permissions_never_become_defaults() {
        for profile in [
            json!({"type":"future"}),
            json!({"type":"disabled","source_key":"secret"}),
            json!({"type":"read-only","network_access":"true"}),
            json!({"type":"managed","file_system":{"type":"restricted","entries":[]},"network":"unlimited"}),
        ] {
            assert!(event(&profile, &json!("on-request"), Some(1)).is_err());
        }
        assert!(event(
            &conservative_permission_profile(),
            &json!({"granular":{"sandbox_approval":true,"rules":true,"mcp_elicitations":"yes"}}),
            Some(1)
        )
        .is_err());
        assert!(event(
            &conservative_permission_profile(),
            &json!("on-request"),
            Some(u64::MAX)
        )
        .is_err());
        assert!(settings_event(
            "not-a-thread",
            "model",
            "provider",
            Path::new("/tmp"),
            &conservative_permission_profile(),
            &json!("on-request"),
            None
        )
        .is_err());
    }
}
