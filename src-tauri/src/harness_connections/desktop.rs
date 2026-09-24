//! Read-only Desktop installation and applied-profile metadata. Never launch the app.
use key_vault::harness_connections::{ConnectionAuthScheme, DesktopConnectionOptions};

pub(super) struct Installation {
    pub(super) version: Option<String>,
}

pub(super) async fn installation() -> Result<Option<Installation>, String> {
    #[cfg(target_os = "macos")]
    {
        tokio::task::spawn_blocking(|| {
            let home = app_paths::external_history_home_dir();
            let candidates = [
                home.join("Applications/Claude.app"),
                std::path::PathBuf::from("/Applications/Claude.app"),
            ];
            for bundle in candidates {
                if let Some(installation) = inspect_bundle(&bundle) {
                    return Ok(Some(installation));
                }
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
        // A missing product-version resource does not make an existing App
        // incompatible. Only the actual configuration contract controls apply.
        let version =
            match tokio::time::timeout(std::time::Duration::from_secs(5), command.output()).await {
                Ok(Ok(output)) if output.status.success() => {
                    diagnostic_version(Some(&String::from_utf8_lossy(&output.stdout)))
                }
                _ => None,
            };
        Ok(Some(Installation { version }))
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    Ok(None)
}

#[cfg(any(target_os = "macos", test))]
fn inspect_bundle(bundle: &std::path::Path) -> Option<Installation> {
    // Version metadata can be absent or use any vendor label. Presence is
    // determined by an actual App executable, independently of that label.
    let value = plist::Value::from_file(bundle.join("Contents/Info.plist")).ok();
    let metadata = value.as_ref().and_then(plist::Value::as_dictionary);
    let executable = metadata
        .and_then(|value| value.get("CFBundleExecutable"))
        .and_then(plist::Value::as_string)
        .filter(|value| !value.is_empty() && !value.contains(['/', '\\']))
        .unwrap_or("Claude");
    if !bundle.join("Contents/MacOS").join(executable).is_file() {
        return None;
    }
    Some(Installation {
        version: diagnostic_version(
            metadata
                .and_then(|value| value.get("CFBundleShortVersionString"))
                .and_then(plist::Value::as_string),
        ),
    })
}

/// Vendor versions are display metadata, including future/non-semver builds.
#[cfg(any(target_os = "macos", windows, test))]
fn diagnostic_version(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
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
    fn desktop_version_is_optional_diagnostic_metadata() {
        for version in ["1.0.0", "2.2553.1", "3.0.0", "2027.preview", "nightly"] {
            assert_eq!(diagnostic_version(Some(version)), Some(version.into()));
        }
        assert_eq!(diagnostic_version(Some(" 3.0.0\n")), Some("3.0.0".into()));
        assert_eq!(diagnostic_version(Some(" ")), None);
        assert_eq!(diagnostic_version(None), None);
    }

    #[test]
    fn executable_presence_is_independent_of_vendor_version_metadata() {
        let temp = tempfile::tempdir().unwrap();
        let bundle = temp.path().join("Claude.app");
        let executable = bundle.join("Contents/MacOS/Claude");
        std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
        let info = bundle.join("Contents/Info.plist");
        let mut metadata = plist::Dictionary::new();
        metadata.insert(
            "CFBundleExecutable".into(),
            plist::Value::String("Claude".into()),
        );
        for version in ["1.0.0", "3.0.0", "nightly"] {
            metadata.insert(
                "CFBundleShortVersionString".into(),
                plist::Value::String(version.into()),
            );
            plist::Value::Dictionary(metadata.clone())
                .to_file_xml(&info)
                .unwrap();
            assert!(inspect_bundle(&bundle).is_none());
            std::fs::write(&executable, b"fixture executable").unwrap();
            assert_eq!(
                inspect_bundle(&bundle).unwrap().version.as_deref(),
                Some(version)
            );
            std::fs::remove_file(&executable).unwrap();
        }
        std::fs::write(&executable, b"fixture executable").unwrap();
        std::fs::remove_file(&info).unwrap();
        assert!(inspect_bundle(&bundle).unwrap().version.is_none());
        std::fs::write(&info, b"malformed optional metadata").unwrap();
        assert!(inspect_bundle(&bundle).unwrap().version.is_none());
    }

    #[test]
    fn direct_models_still_require_full_ids() {
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
