//! Read-only Desktop installation and applied-profile metadata. Never launch the app.
use key_vault::harness_connections::{ConnectionAuthScheme, DesktopConnectionOptions};

pub(super) async fn installation() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        tokio::task::spawn_blocking(|| {
            let home = app_paths::external_history_home_dir();
            let candidates = [
                home.join("Applications/Claude.app/Contents/Info.plist"),
                std::path::PathBuf::from("/Applications/Claude.app/Contents/Info.plist"),
            ];
            for path in candidates {
                if !path.exists() {
                    continue;
                }
                let value = plist::Value::from_file(path)
                    .map_err(|_| "Cannot read Claude Desktop version")?;
                return value
                    .as_dictionary()
                    .and_then(|value| value.get("CFBundleShortVersionString"))
                    .and_then(plist::Value::as_string)
                    .map(|value| Some(value.to_string()))
                    .ok_or_else(|| "Cannot read Claude Desktop version".into());
            }
            Ok(None)
        })
        .await
        .map_err(|_| "Desktop installation lookup failed")?
    }
    #[cfg(windows)]
    {
        // Squirrel installs to `%LOCALAPPDATA%\AnthropicClaude\claude.exe`; keep the
        // older `Claude\Claude.exe` layout as a fallback. First existing file wins.
        let root = app_paths::external_history_data_local_dir();
        let Some(path) = ["AnthropicClaude/claude.exe", "Claude/Claude.exe"]
            .into_iter()
            .map(|relative| root.join(relative))
            .find(|candidate| candidate.is_file())
        else {
            return Ok(None);
        };
        let mut command = tokio::process::Command::new("powershell.exe");
        command
            .kill_on_drop(true)
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "(Get-Item -LiteralPath $env:ORGII_DESKTOP_EXECUTABLE).VersionInfo.ProductVersion",
            ])
            .env("ORGII_DESKTOP_EXECUTABLE", path);
        app_platform::hide_console(command.as_std_mut());
        let output = tokio::time::timeout(std::time::Duration::from_secs(5), command.output())
            .await
            .map_err(|_| "Desktop version lookup timed out")?
            .map_err(|_| "Cannot read Claude Desktop version")?;
        if !output.status.success() {
            return Err("Cannot read Claude Desktop version".into());
        }
        Ok(Some(
            String::from_utf8_lossy(&output.stdout).trim().to_string(),
        ))
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    Ok(None)
}

/// The local-profile schema was verified on Desktop 1.46388.x. Accept 1.x builds
/// from that release onward; a different major line may change the schema, so it
/// is reported rather than silently written. Each segment's leading digits are
/// compared so a `-beta` style suffix does not fail as unparseable.
pub(super) fn validate_version(version: &str) -> Result<(), String> {
    let numbers = version
        .trim()
        .split('.')
        .map(|segment| {
            let digits = segment.trim_start_matches(|c: char| !c.is_ascii_digit());
            let digits = &digits[..digits
                .find(|c: char| !c.is_ascii_digit())
                .unwrap_or(digits.len())];
            digits.parse::<u32>()
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Cannot verify this Claude Desktop version")?;
    if numbers.len() != 3 {
        return Err("Cannot verify this Claude Desktop version".into());
    }
    if numbers[0] != 1 {
        return Err(format!(
            "Claude Desktop {} uses an unverified configuration format; ORGII supports 1.46388.1 and newer 1.x releases",
            version.trim()
        ));
    }
    if numbers.as_slice() < [1, 46388, 1].as_slice() {
        return Err(
            "Update Claude Desktop to 1.46388.1 or newer for this configuration format".into(),
        );
    }
    Ok(())
}

pub(super) fn applied_options(
    config: &agent_cli::managed_config::CliConfigManagedStatus,
) -> Result<Option<DesktopConnectionOptions>, String> {
    if config.mode != agent_cli::managed_config::CliConfigMode::Direct {
        return Ok(None);
    }
    let path = config
        .target_files
        .iter()
        .find(|file| file.id == "profile")
        .ok_or("Desktop profile is missing")?;
    let raw =
        std::fs::read(&path.target_path).map_err(|_| "Cannot read the applied Desktop profile")?;
    let value: serde_json::Value =
        serde_json::from_slice(&raw).map_err(|_| "Invalid applied Desktop profile")?;
    let endpoint = value["inferenceGatewayBaseUrl"]
        .as_str()
        .ok_or("Desktop profile endpoint is missing")?;
    let url = reqwest::Url::parse(endpoint).map_err(|_| "Invalid Desktop endpoint")?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "Desktop profile endpoint contains unsupported credentials or URL parameters".into(),
        );
    }
    let auth_scheme = match value["inferenceGatewayAuthScheme"].as_str() {
        Some("bearer") => ConnectionAuthScheme::Bearer,
        Some("x-api-key") => ConnectionAuthScheme::ApiKey,
        _ => return Err("Unsupported authentication in the applied Desktop profile".into()),
    };
    Ok(Some(DesktopConnectionOptions {
        endpoint: Some(endpoint.into()),
        auth_scheme: Some(auth_scheme),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_verified_schema_versions_and_direct_model_ids_are_accepted() {
        for version in [
            "1.46388.1",
            "1.46388.4",
            "1.46388.1-beta",
            "1.99999.0",
            " 1.46388.4\n",
        ] {
            validate_version(version).unwrap();
        }
        for version in ["1.0.0", "1.46387.9", "1.46388.0-rc1"] {
            assert_eq!(
                validate_version(version).unwrap_err(),
                "Update Claude Desktop to 1.46388.1 or newer for this configuration format"
            );
        }
        for version in ["2.0.0", "0.46388.1", "2.46388.1-beta"] {
            let error = validate_version(version).unwrap_err();
            assert!(error.contains(version), "{error}");
            assert!(error.contains("unverified"), "{error}");
        }
        for version in [
            "",
            "beta",
            "1.x.1",
            "1.46388",
            "1.46388.1.2",
            "1.46388.1-beta.2",
            "1..1",
        ] {
            assert_eq!(
                validate_version(version).unwrap_err(),
                "Cannot verify this Claude Desktop version"
            );
        }
        for model in [
            "claude-sonnet-5",
            "anthropic/claude-opus-5",
            "claude-haiku-4-5",
        ] {
            agent_cli::managed_config::desktop::validate_model(model).unwrap();
        }
        for model in [
            "sonnet",
            "custom-model",
            "claude-opus-",
            "claude-opus-5[1m]",
        ] {
            assert!(agent_cli::managed_config::desktop::validate_model(model).is_err());
        }
    }
}
