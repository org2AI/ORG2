//! Launch the applied Claude Code overlay without replacing native settings.
use agent_cli::managed_config::{self, CliConfigMode};
use std::path::Path;

fn shell_word(value: &str) -> Result<String, String> {
    if value.contains(['\0', '\r', '\n']) {
        return Err("Invalid client launch path".into());
    }
    Ok(format!("'{}'", value.replace('\'', "'\\''")))
}

fn claude_launch_script(
    targets: &[managed_config::CliConfigTargetFileStatus],
    folder: &Path,
    native_home: Option<&Path>,
) -> Result<String, String> {
    let mut settings = targets.iter().filter(|target| target.id == "settings");
    let target = settings.next().ok_or("Claude Code settings are missing")?;
    if settings.next().is_some() {
        return Err("Claude Code settings are ambiguous".into());
    }
    if !target.overlay {
        return Err("Claude Code overlay settings are missing".into());
    }
    let path = Path::new(&target.target_path);
    if !path.is_absolute() || path.file_name().is_none_or(|name| name != "settings.json") {
        return Err("Invalid Claude Code settings path".into());
    }
    let overlay = shell_word(&path.to_string_lossy())?;
    let cwd = shell_word(&folder.to_string_lossy())?;
    let home_override = match native_home {
        Some(path) if path.is_absolute() => format!(
            "export CLAUDE_CONFIG_DIR={}\n",
            shell_word(&path.to_string_lossy())?
        ),
        Some(_) => return Err("Claude Code home must be an absolute path".into()),
        None => String::new(),
    };
    // Terminal may already be running with a different environment. Layer the
    // ORG2-owned overlay over the user's own Claude Code configuration after
    // login-shell setup; the user's settings and history directory are used
    // as they are, so earlier conversations remain resumable.
    Ok(format!(
        "#!/bin/zsh -l\nset -e\nunset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_MODEL CLAUDE_CODE_OAUTH_TOKEN OPENAI_API_KEY\n{home_override}cd -- {cwd}\nexec 'claude' --settings {overlay}\n"
    ))
}

/// Direct/profile connections are local credentials, not Market grants. Keep
/// this entry point separate so it cannot bypass a Market owner lease.
#[tauri::command(rename_all = "camelCase")]
pub async fn harness_connection_open_client(
    agent_name: String,
    key_id: String,
    model: String,
) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("Opening clients is not available on this platform yet".into());
    }
    validate_local_selection(&agent_name, &key_id)?;
    super::verify_installed_version(&agent_name).await?;
    let status = managed_config::cli_config_get_status(agent_name.clone()).await?;
    tokio::task::spawn_blocking(move || {
        if !status.supported
            || status.conflict
            || !status.overlay
            || status.mode == CliConfigMode::Default
            || status.selected_key_id.as_deref() != Some(&key_id)
            || status.selected_model.as_deref() != Some(&model)
        {
            return Err("Selected client configuration changed".into());
        }
        let profile = managed_config::provider_profiles::applied(&agent_name)?;
        let connection =
            super::profiles::selection(&agent_name, &key_id, &model, None, profile.as_ref())?;
        if status.mode == CliConfigMode::Direct {
            managed_config::verify_claude_launch_connection(&managed_config::DirectConnection {
                profile,
                key_id: connection.key_id,
                provider: connection.provider,
                model: connection.model,
                base_url: connection.base_url,
                api_key: connection.api_key,
                desktop_auth_scheme: None,
                desktop_helper: None,
                proxy_token: None,
            })?;
        }
        launch_claude(&status)
    })
    .await
    .map_err(|_| "Could not launch client")?
}

fn validate_local_selection(agent: &str, key: &str) -> Result<(), String> {
    if agent != "claude_code" || key.starts_with("market:") || key.starts_with("market-app:") {
        return Err("Unsupported local client connection".into());
    }
    Ok(())
}

pub(crate) fn launch_claude(status: &managed_config::CliConfigManagedStatus) -> Result<(), String> {
    let folder = app_paths::orgii_root()
        .parent()
        .map(std::path::Path::to_path_buf)
        .ok_or("Home folder is unavailable")?;
    // The isolated acceptance identity wins over inherited agent homes. Normal
    // launches retain native history while using the connection overlay.
    let native_home = std::env::var_os("ORGII_EXTERNAL_HISTORY_HOME")
        .filter(|value| !value.is_empty())
        .map(|value| std::path::PathBuf::from(value).join(".claude"))
        .or_else(|| {
            std::env::var_os("CLAUDE_CONFIG_DIR")
                .filter(|v| !v.is_empty())
                .map(std::path::PathBuf::from)
        });
    let script = claude_launch_script(&status.target_files, &folder, native_home.as_deref())?;
    let launcher = app_paths::orgii_root()
        .join("cli-launchers")
        .join("open-claude_code.command");
    managed_config::write_cli_profile_file_atomic(&launcher, script.as_bytes())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&launcher, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| "Could not prepare client launch")?;
    }
    let status = std::process::Command::new("/usr/bin/open")
        .args(["-a", "Terminal"])
        .arg(&launcher)
        .status()
        .map_err(|_| "Could not open your terminal")?;
    if status.success() {
        Ok(())
    } else {
        Err("Could not open your terminal".into())
    }
}

#[cfg(test)]
mod tests {
    use super::{claude_launch_script, shell_word};

    fn settings(path: &std::path::Path) -> agent_cli::managed_config::CliConfigTargetFileStatus {
        agent_cli::managed_config::CliConfigTargetFileStatus {
            id: "settings".into(),
            target_path: path.to_string_lossy().into_owned(),
            default_backup_path: String::new(),
            managed_profile_path: String::new(),
            target_exists: true,
            has_default_backup: false,
            default_was_missing: true,
            original_hash: None,
            last_applied_hash: None,
            current_hash: None,
            conflict: false,
            overlay: true,
        }
    }

    #[cfg(unix)]
    #[test]
    fn cli_launch_layers_the_overlay_over_the_users_own_configuration() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let bin = root.path().join("bin");
        let cwd = root.path().join("working directory's $(touch unwanted)");
        std::fs::create_dir(&bin).unwrap();
        std::fs::create_dir(&cwd).unwrap();
        let fake_cli = bin.join("claude");
        std::fs::write(
            &fake_cli,
            "#!/bin/sh\nprintf '%s\\n' \"${CLAUDE_CONFIG_DIR-unset}\" \"$PWD\" \"$#\" \"$1\" \"$2\" \"${ANTHROPIC_API_KEY-unset}\" \"${ANTHROPIC_AUTH_TOKEN-unset}\" \"${ANTHROPIC_BASE_URL-unset}\" \"${ANTHROPIC_MODEL-unset}\" \"${CLAUDE_CODE_OAUTH_TOKEN-unset}\" \"${OPENAI_API_KEY-unset}\"\n",
        )
        .unwrap();
        std::fs::set_permissions(&fake_cli, std::fs::Permissions::from_mode(0o700)).unwrap();
        for directory in [
            root.path()
                .join("orgii/cli-config-profiles/claude_code/overlay"),
            root.path().join("overlay dir's $(touch unwanted)"),
        ] {
            let overlay = directory.join("settings.json");
            for explicit in [None, Some("/acceptance/isolated home's/.claude")] {
                let script = claude_launch_script(
                    &[settings(&overlay)],
                    &cwd,
                    explicit.map(std::path::Path::new),
                )
                .unwrap();
                for inherited in [None, Some("/terminal/other-claude-home")] {
                    let mut command = std::process::Command::new("/bin/sh");
                    command
                        .args(["-c", &script])
                        .env_clear()
                        .env("PATH", &bin)
                        .env("ANTHROPIC_API_KEY", "fixture-key")
                        .env("ANTHROPIC_AUTH_TOKEN", "fixture-key")
                        .env("ANTHROPIC_BASE_URL", "https://terminal.invalid")
                        .env("ANTHROPIC_MODEL", "terminal-model")
                        .env("CLAUDE_CODE_OAUTH_TOKEN", "fixture-key")
                        .env("OPENAI_API_KEY", "fixture-key");
                    if let Some(value) = inherited {
                        command.env("CLAUDE_CONFIG_DIR", value);
                    }
                    let output = command.output().unwrap();
                    assert!(output.status.success(), "{:?}", output.stderr);
                    let output = String::from_utf8(output.stdout).unwrap();
                    let lines: Vec<_> = output.lines().collect();
                    // An explicit acceptance home wins over a running Terminal's environment.
                    assert_eq!(lines[0], explicit.or(inherited).unwrap_or("unset"));
                    assert_eq!(lines[1], cwd.to_string_lossy());
                    assert_eq!(lines[2], "2");
                    assert_eq!(lines[3], "--settings");
                    assert_eq!(lines[4], overlay.to_string_lossy());
                    assert_eq!(&lines[5..], &["unset"; 6]);
                    assert!(!cwd.join("unwanted").exists());
                }
            }
        }
    }

    #[test]
    fn cli_launch_rejects_missing_ambiguous_and_invalid_settings_paths() {
        let cwd = std::path::Path::new("/working");
        assert!(claude_launch_script(&[], cwd, None).is_err());
        let target = settings(std::path::Path::new("/config/settings.json"));
        assert!(claude_launch_script(&[target.clone(), target.clone()], cwd, None).is_err());
        let native = agent_cli::managed_config::CliConfigTargetFileStatus {
            overlay: false,
            ..target
        };
        assert!(claude_launch_script(&[native], cwd, None).is_err());
        for path in [
            "relative/settings.json",
            "/config/wrong.json",
            "/bad\npath/settings.json",
        ] {
            assert!(
                claude_launch_script(&[settings(std::path::Path::new(path))], cwd, None).is_err()
            );
        }
    }

    #[test]
    fn local_launcher_rejects_market_grants_and_other_clients() {
        assert!(super::validate_local_selection("claude_code", "local-key").is_ok());
        for (agent, key) in [
            ("claude_code", "market:grant"),
            ("claude_code", "market-app:catalog"),
            ("codex", "local-key"),
        ] {
            assert!(super::validate_local_selection(agent, key).is_err());
        }
    }

    #[test]
    fn isolated_launcher_overrides_inherited_home_after_shell_initialization() {
        let script = claude_launch_script(
            &[settings(std::path::Path::new("/overlay/settings.json"))],
            std::path::Path::new("/working"),
            Some(std::path::Path::new("/isolated/.claude")),
        )
        .unwrap();
        assert!(script.contains("export CLAUDE_CONFIG_DIR='/isolated/.claude'"));
        assert!(claude_launch_script(
            &[settings(std::path::Path::new("/overlay/settings.json"))],
            std::path::Path::new("/working"),
            Some(std::path::Path::new("relative"))
        )
        .is_err());
    }

    #[test]
    fn launch_paths_are_quoted_without_shell_expansion() {
        assert_eq!(
            shell_word("/Users/O'Neil/$(touch unwanted)").unwrap(),
            "'/Users/O'\\''Neil/$(touch unwanted)'"
        );
        assert!(shell_word("bad\npath").is_err());
    }
}
