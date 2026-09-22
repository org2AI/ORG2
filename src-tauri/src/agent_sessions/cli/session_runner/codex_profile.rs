//! Seed/advance a generation's auth without replaying a delayed launch snapshot.
use std::path::Path;

pub(super) fn write_auth(home: &Path, payload: &serde_json::Value) -> Result<(), String> {
    std::fs::create_dir_all(home).map_err(|err| format!("Create Codex home: {err}"))?;
    let mut options = std::fs::OpenOptions::new();
    options.create(true).read(true).write(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let lock = options
        .open(home.join(".orgii-seed.lock"))
        .map_err(|err| err.to_string())?;
    fs2::FileExt::try_lock_exclusive(&lock)
        .map_err(|_| "Codex profile is busy; retry this turn".to_string())?;
    let path = home.join("auth.json");
    let original = match std::fs::read_to_string(&path) {
        Ok(content) => Some(content),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
        Err(err) => return Err(format!("Read Codex profile: {err}")),
    };
    if let Some(original) = original
        .as_deref()
        .filter(|_| payload.get("tokens").is_some())
    {
        let existing: serde_json::Value = serde_json::from_str(original)
            .map_err(|err| format!("Invalid Codex profile; refusing to overwrite it: {err}"))?;
        let current = existing
            .pointer("/tokens/access_token")
            .and_then(serde_json::Value::as_str);
        let candidate = payload
            .pointer("/tokens/access_token")
            .and_then(serde_json::Value::as_str);
        if let (Some(current), Some(candidate)) = (current, candidate) {
            if current == candidate
                || !key_vault::key_store::codex_access_token_is_newer(candidate, current)
            {
                return Ok(());
            }
        } else {
            return Err("Codex profile identity changed; reconnect before replacing it".into());
        }
    }
    let bytes = serde_json::to_vec_pretty(payload).map_err(|err| err.to_string())?;
    if std::fs::read_to_string(&path).ok() != original {
        return Err("Codex profile changed during setup; retry this turn".into());
    }
    // Native processes do not acquire our lock. This final check reduces, but
    // does not eliminate, the external check/replace window.
    agent_cli::managed_config::write_cli_profile_file_atomic(&path, &bytes)?;
    app_paths::set_sensitive_file_permissions(&path).map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    fn auth(exp: i64, refresh: &str) -> serde_json::Value {
        let claims = serde_json::json!({"exp": exp, "https://api.openai.com/auth": {"chatgpt_account_id": "fixture"}});
        let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(claims.to_string());
        serde_json::json!({"tokens": {"access_token": format!("h.{encoded}.s"), "refresh_token": refresh}})
    }

    #[test]
    fn late_launch_cannot_reseed_a_rotated_profile() {
        let dir = tempfile::tempdir().unwrap();
        let old = auth(1000, "r0");
        let rotated = auth(2000, "r1");
        write_auth(dir.path(), &old).unwrap();
        // A native CLI has rotated while a sibling launch was suspended.
        std::fs::write(dir.path().join("auth.json"), rotated.to_string()).unwrap();
        write_auth(dir.path(), &old).unwrap();
        let actual: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(dir.path().join("auth.json")).unwrap())
                .unwrap();
        assert_eq!(actual, rotated);
        write_auth(dir.path(), &auth(3000, "r2")).unwrap();
        let actual: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(dir.path().join("auth.json")).unwrap())
                .unwrap();
        assert_eq!(actual, auth(3000, "r2"));
    }
}
