//! Session-owned native homes keep launch configuration separate from history.
//! The application can bind a profile to an independently owned local route.
use super::{config_operation_guard, file_io, generators};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedLaunchProfile {
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
}
#[derive(Serialize, Deserialize)]
struct OwnedConfig {
    filename: String,
    hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pending_hash: Option<String>,
}
const OWNED_CONFIG: &str = ".org2-launch-config.json";

fn profile_dir(session_id: &str) -> Result<PathBuf, String> {
    if session_id.is_empty()
        || session_id.len() > 128
        || !session_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-'))
    {
        return Err("Invalid launch session".into());
    }
    Ok(app_paths::managed_cli_launch_root().join(session_id))
}

/// The persistent native store used by this Session's launch environment.
/// Resolving it does not create a profile or require a live credential.
pub fn native_home(session_id: &str) -> Result<PathBuf, String> {
    profile_dir(session_id)
}

/// Restore the Session-owned home using a newly authorized local route. The
/// application supplies the durable source; global account selection is not
/// consulted. Existing config is replaced only when its ownership is proven.
pub fn restore_with_proxy_token(
    agent: &str,
    model: &str,
    session_id: &str,
    url: &str,
    token: &str,
) -> Result<ManagedLaunchProfile, String> {
    let _guard = config_operation_guard()?;
    write_profile(agent, model, session_id, url, token)
}

fn owned_hash_matches(owned: &OwnedConfig, hash: &str) -> bool {
    owned.hash == hash || owned.pending_hash.as_deref() == Some(hash)
}

// Codex records project trust in its own config during normal startup. Only
// that narrow runtime-owned table is excluded from the connection fingerprint.
fn connection_hash(filename: &str, content: &[u8]) -> Result<String, String> {
    if filename != "config.toml" {
        return Ok(file_io::sha256_bytes(content));
    }
    let text = std::str::from_utf8(content).map_err(|e| e.to_string())?;
    let mut value: toml::Value = toml::from_str(text).map_err(|e| e.to_string())?;
    let root = value.as_table_mut().ok_or("Invalid launch config")?;
    if let Some(projects) = root.get("projects") {
        let projects = projects.as_table().ok_or("Invalid project trust records")?;
        for project in projects.values() {
            let table = project.as_table().ok_or("Invalid project trust record")?;
            if table.len() != 1
                || !matches!(
                    table.get("trust_level").and_then(toml::Value::as_str),
                    Some("trusted" | "untrusted")
                )
            {
                return Err("Unexpected project configuration changes".into());
            }
        }
    }
    root.remove("projects");
    let canonical = toml::to_string_pretty(&value).map_err(|e| e.to_string())?;
    Ok(file_io::sha256_bytes(canonical.as_bytes()))
}

fn current_connection_hash(path: &Path, filename: &str) -> Result<Option<String>, String> {
    match std::fs::read(path) {
        Ok(content) => connection_hash(filename, &content).map(Some),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn write_profile(
    agent: &str,
    model: &str,
    session_id: &str,
    url: &str,
    token: &str,
) -> Result<ManagedLaunchProfile, String> {
    let (filename, content, env_name) = match agent {
        "codex" => (
            "config.toml",
            generators::generate_codex_managed_config("", Some(model), url, token)?,
            "CODEX_HOME",
        ),
        "claude_code" => (
            "settings.json",
            generators::generate_claude_code_managed_config("", Some(model), url, token)?,
            "CLAUDE_CONFIG_DIR",
        ),
        _ => return Err("Client launch profile is not supported".into()),
    };
    let mut content = content;
    let directory = profile_dir(session_id)?;
    let parent = directory.parent().ok_or("Invalid launch directory")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    // Bound abandoned profiles without introducing a background cleanup timer.
    if !directory.join(OWNED_CONFIG).is_file()
        && std::fs::read_dir(parent)
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .filter(|entry| entry.path().join(OWNED_CONFIG).exists())
            .take(256)
            .count()
            >= 256
    {
        return Err("Too many retained client launch profiles".into());
    }
    match std::fs::symlink_metadata(&directory) {
        Ok(metadata) => {
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err("Launch directory is not available for restoration".into());
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir(&directory).map_err(|error| error.to_string())?;
        }
        Err(error) => return Err(error.to_string()),
    }
    let config = directory.join(filename);
    let marker_path = directory.join(OWNED_CONFIG);
    let marker = match std::fs::read(&marker_path) {
        Ok(bytes) => {
            Some(serde_json::from_slice::<OwnedConfig>(&bytes).map_err(|e| e.to_string())?)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.to_string()),
    };
    if marker
        .as_ref()
        .is_some_and(|owned| owned.filename != filename)
    {
        return Err("Launch configuration belongs to another client".into());
    }
    let previous_hash = current_connection_hash(&config, filename)?;
    if let Some(hash) = &previous_hash {
        if !marker
            .as_ref()
            .is_some_and(|owned| owned_hash_matches(owned, hash))
        {
            return Err("Launch configuration was externally modified".into());
        }
    }
    if filename == "config.toml" && config.is_file() {
        let existing: toml::Value =
            toml::from_str(&std::fs::read_to_string(&config).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        if let Some(projects) = existing.get("projects") {
            let mut generated: toml::Value = toml::from_str(&content).map_err(|e| e.to_string())?;
            generated
                .as_table_mut()
                .ok_or("Invalid generated config")?
                .insert("projects".into(), projects.clone());
            content = toml::to_string_pretty(&generated).map_err(|e| e.to_string())?;
        }
    }
    let result = (|| {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))
                .map_err(|e| e.to_string())?;
        }
        let hash = connection_hash(filename, content.as_bytes())?;
        // Publish both allowed hashes before replacing the config. A crash on
        // either side of the write is retryable without accepting external edits.
        {
            let intent = serde_json::to_vec(&OwnedConfig {
                filename: filename.into(),
                hash: previous_hash.clone().unwrap_or_default(),
                pending_hash: Some(hash.clone()),
            })
            .map_err(|e| e.to_string())?;
            file_io::write_sensitive_file_atomic(&marker_path, &intent)?;
        }
        file_io::write_sensitive_file_atomic(&config, content.as_bytes())?;
        let marker = serde_json::to_vec(&OwnedConfig {
            filename: filename.into(),
            hash,
            pending_hash: None,
        })
        .map_err(|e| e.to_string())?;
        file_io::write_sensitive_file_atomic(&marker_path, &marker)?;
        let args = if agent == "claude_code" {
            vec![
                "--settings".into(),
                config.to_string_lossy().into_owned(),
                "--setting-sources".into(),
                "user".into(),
            ]
        } else {
            vec![]
        };
        Ok(ManagedLaunchProfile {
            args,
            env: BTreeMap::from([(env_name.into(), directory.to_string_lossy().into_owned())]),
        })
    })();
    result
}

pub fn release(session_id: &str) -> Result<(), String> {
    let directory = profile_dir(session_id)?;
    let marker = directory.join(OWNED_CONFIG);
    let bytes = match std::fs::read(&marker) {
        Ok(bytes) => bytes,
        // Older unmarked homes must be retained: ownership is not proven.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.to_string()),
    };
    let owned: OwnedConfig = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    if !matches!(owned.filename.as_str(), "config.toml" | "settings.json") {
        return Err("Invalid owned launch configuration".into());
    }
    let config = directory.join(&owned.filename);
    if let Some(hash) = current_connection_hash(&config, &owned.filename)? {
        if !owned_hash_matches(&owned, &hash) {
            return Err("Launch configuration was externally modified".into());
        }
        std::fs::remove_file(config).map_err(|e| e.to_string())?;
    }
    std::fs::remove_file(marker).map_err(|e| e.to_string())?;
    // Only an empty directory may be removed. Sessions/history and all other
    // native state remain in their original home for later history discovery.
    match std::fs::remove_dir(directory) {
        Ok(()) => Ok(()),
        Err(e)
            if matches!(
                e.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::DirectoryNotEmpty
            ) =>
        {
            Ok(())
        }
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod ownership_tests {
    use super::*;
    #[test]
    fn codex_trust_records_do_not_change_connection_ownership() {
        let original = generators::generate_codex_managed_config(
            "",
            Some("test"),
            "http://127.0.0.1:9",
            "test",
        )
        .unwrap();
        let expected = connection_hash("config.toml", original.as_bytes()).unwrap();
        assert_eq!(expected, file_io::sha256_bytes(original.as_bytes()));
        let updated =
            format!("{original}\n[projects.\"/tmp/project\"]\ntrust_level = \"trusted\"\n");
        assert_eq!(
            connection_hash("config.toml", updated.as_bytes()).unwrap(),
            expected
        );
        let changed = updated.replace("127.0.0.1:9", "127.0.0.1:10");
        assert_ne!(
            connection_hash("config.toml", changed.as_bytes()).unwrap(),
            expected
        );
        assert!(connection_hash(
            "config.toml",
            format!("{updated}command = \"unexpected\"\n").as_bytes()
        )
        .is_err());
    }
}
