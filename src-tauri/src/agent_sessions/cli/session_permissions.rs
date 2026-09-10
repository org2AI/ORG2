//! Per-session native permission policy, independent of ORG2 execution mode.
use super::session_runner::launch_profiles::{
    default_profile_for_mode, defaults_for_agent, CliPermissionMode, ResolvedCliLaunchProfile,
};
use key_vault::key_store::ModelType;
use rusqlite::OptionalExtension;

pub fn load(session: &str) -> Result<Option<CliPermissionMode>, String> {
    let conn = database::db::get_connection().map_err(|e| e.to_string())?;
    let raw: Option<String> = conn
        .query_row(
            "SELECT mode FROM code_session_permissions WHERE session_id=?1",
            [session],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    raw.map(|s| serde_json::from_value(serde_json::Value::String(s)).map_err(|e| e.to_string()))
        .transpose()
}

pub fn apply(
    profile: &mut ResolvedCliLaunchProfile,
    agent: &ModelType,
    mode: CliPermissionMode,
) -> Result<(), String> {
    let defaults = defaults_for_agent(agent).ok_or("CLI has no permission profile")?;
    let selected =
        default_profile_for_mode(defaults, mode).ok_or("Unsupported CLI permission mode")?;
    // Explicit per-session selection owns permission flags. Preserve unrelated custom arguments.
    let mut args = Vec::new();
    let mut iter = profile.args.iter();
    while let Some(arg) = iter.next() {
        if matches!(arg.as_str(), "--permission-mode" | "--sandbox") {
            iter.next();
            continue;
        }
        if matches!(
            arg.as_str(),
            "--dangerously-skip-permissions" | "--dangerously-bypass-approvals-and-sandbox"
        ) {
            continue;
        }
        if arg.starts_with("--permission-mode=") || arg.starts_with("--sandbox=") {
            continue;
        }
        args.push(arg.clone());
    }
    args.extend(selected.args.iter().map(|s| s.to_string()));
    profile.args = args;
    profile.permission_mode = mode;
    Ok(())
}

#[tauri::command]
pub async fn cli_session_permission(
    session_id: String,
    mode: Option<CliPermissionMode>,
) -> Result<CliPermissionMode, String> {
    tokio::task::spawn_blocking(move || {
        let session = super::persistence::get_session(&session_id).map_err(|e| e.to_string())?.ok_or("CLI session not found")?;
        let agent = match session.cli_agent_type.as_deref() {
            Some("codex") => ModelType::Codex,
            Some("claude_code") => ModelType::ClaudeCode,
            _ => return Err("Permissions are supported only for Codex and Claude Code sessions".into()),
        };
        if let Some(mode) = mode {
            if mode == CliPermissionMode::Plan { return Err("Plan is an execution mode, not a permission choice".into()); }
            let conn = database::db::get_connection().map_err(|e| e.to_string())?;
            let value = serde_json::to_value(mode).map_err(|e| e.to_string())?;
            conn.execute("INSERT INTO code_session_permissions(session_id,mode) VALUES(?1,?2) ON CONFLICT(session_id) DO UPDATE SET mode=excluded.mode", rusqlite::params![session_id, value.as_str()]).map_err(|e| e.to_string())?;
            return Ok(mode);
        }
        Ok(load(&session_id)?.unwrap_or(super::launch_profile_store::resolve_cli_launch_profile(&agent)?.permission_mode))
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn session_permission_replaces_bypass_and_preserves_unrelated_arguments() {
        let mut profile = ResolvedCliLaunchProfile {
            permission_mode: CliPermissionMode::FullPermission,
            command: "claude".into(),
            args: vec!["--dangerously-skip-permissions".into(), "--verbose".into()],
            env: Default::default(),
            transport: None,
        };
        apply(
            &mut profile,
            &ModelType::ClaudeCode,
            CliPermissionMode::Manual,
        )
        .unwrap();
        assert_eq!(
            profile.args,
            vec!["--verbose", "--permission-mode", "default"]
        );
        apply(
            &mut profile,
            &ModelType::ClaudeCode,
            CliPermissionMode::AutoEdit,
        )
        .unwrap();
        assert_eq!(
            profile.args,
            vec!["--verbose", "--permission-mode", "acceptEdits"]
        );
        apply(
            &mut profile,
            &ModelType::ClaudeCode,
            CliPermissionMode::Plan,
        )
        .unwrap();
        assert_eq!(profile.args, vec!["--verbose", "--permission-mode", "plan"]);
    }
}
