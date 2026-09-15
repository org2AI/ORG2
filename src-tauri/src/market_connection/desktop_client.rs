//! Claude Desktop owns inference and calls ORG2's headless credential helper.
//! Only public selection metadata is written to its profile and launcher.
use agent_cli::managed_config::{
    self, command_auth::CredentialCommand, desktop::CredentialHelper, DirectConnection,
};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub async fn configure(
    key: String,
    model: String,
    expected: BTreeMap<String, Option<String>>,
) -> Result<managed_config::CliConfigManagedStatus, String> {
    if !cfg!(target_os = "macos") {
        return Err("Market Desktop connection is not available on this platform yet".into());
    }
    let selection = super::source::Selection::parse(&key, "claude_desktop")?;
    let entries = super::source::options(selection.metadata.clone()).await?;
    super::source::validate_session_purchase(
        &entries,
        &selection.entitlement_id,
        "claude_desktop",
        &model,
        chrono::Utc::now().timestamp_millis(),
    )?;
    let models = entries
        .iter()
        .find(|entry| entry.entitlement_id == selection.entitlement_id)
        .and_then(|entry| entry.models_by_agent.get("claude"))
        .cloned()
        .ok_or("No Claude models available")?;
    // Verify authorization before changing the user's Desktop configuration.
    use crate::dynamic_credentials::Source;
    super::source::instance()
        .credential(&key, "claude_desktop")
        .await?;
    tokio::task::spawn_blocking(move || {
        let executable = std::env::current_exe().map_err(|_| "ORG2 executable is unavailable")?;
        let scope = app_paths::orgii_root();
        let command = CredentialCommand {
            command: executable.to_string_lossy().into_owned(),
            args: vec![
                "--market-auth".into(),
                "claude_desktop".into(),
                key.clone(),
                scope.to_string_lossy().into_owned(),
                "token".into(),
            ],
        };
        let path = scope
            .join("market-helpers")
            .join(format!("{:x}", Sha256::digest(key.as_bytes())));
        let script = format!("#!/bin/sh\nexec {}\n", command.shell_command()?);
        managed_config::write_cli_profile_file_atomic(&path, script.as_bytes())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
                .map_err(|_| "Could not prepare credential helper")?;
        }
        managed_config::enable_direct(
            "claude_desktop",
            DirectConnection {
                profile: None,
                key_id: key,
                provider: "market".into(),
                model,
                base_url: format!(
                    "https://org2-market.fly.dev/w/{}",
                    selection.metadata.workspace_id
                ),
                api_key: String::new(),
                desktop_auth_scheme: Some("bearer".into()),
                desktop_helper: Some(CredentialHelper { path, models }),
            },
            Some(&expected),
        )
    })
    .await
    .map_err(|_| "Desktop configuration task failed")?
}
