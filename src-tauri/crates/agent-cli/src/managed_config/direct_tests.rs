use super::tests::{test_manifest, test_target, OrgiiHomeGuard, TEST_ENV_LOCK};
use super::*;
use std::{collections::BTreeMap, sync::Mutex};

fn connection(key: &str) -> DirectConnection {
    DirectConnection {
        profile: None,
        key_id: "test-key".into(),
        provider: "custom_api".into(),
        model: "fixture-model".into(),
        base_url: "http://127.0.0.1:9999/v1".into(),
        api_key: key.into(),
        desktop_auth_scheme: None,
        desktop_helper: None,
        proxy_token: None,
    }
}

struct ExternalHome(Option<std::ffi::OsString>);
impl ExternalHome {
    fn set(path: &std::path::Path) -> Self {
        let previous = std::env::var_os("ORGII_EXTERNAL_HISTORY_HOME");
        std::env::set_var("ORGII_EXTERNAL_HISTORY_HOME", path);
        Self(previous)
    }
}
impl Drop for ExternalHome {
    fn drop(&mut self) {
        match self.0.take() {
            Some(value) => std::env::set_var("ORGII_EXTERNAL_HISTORY_HOME", value),
            None => std::env::remove_var("ORGII_EXTERNAL_HISTORY_HOME"),
        }
    }
}

#[test]
fn direct_switch_changes_native_credentials_survives_shutdown_and_restores_original() {
    let _lock = TEST_ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(temp.path());
    for (agent, folder, file, original) in [
        (
            "codex",
            ".codex",
            "config.toml",
            "# user comment\nmodel = 'original'\n[features]\nshell_tool = true\n",
        ),
        (
            "claude_code",
            ".claude",
            "settings.json",
            "{\"permissions\":{\"allow\":[\"Read\"]},\"env\":{\"KEEP\":\"value\"}}",
        ),
    ] {
        let dir = temp.path().join(folder);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(file);
        std::fs::write(&path, original).unwrap();
        let auth_path = dir.join("auth.json");
        std::fs::write(&auth_path, "native-login-sentinel").unwrap();
        let status = enable_direct(agent, connection("first-key"), None).unwrap();
        assert_eq!(status.mode, CliConfigMode::Direct);
        assert!(status.proxy_url.is_none());
        assert!(managed_selection_for_agent(agent).unwrap().is_none());
        let status = enable_direct(agent, connection("second-key"), None).unwrap();
        // Codex is rewritten in place; Claude Code gets an ORG2-owned overlay
        // and its own file is never modified.
        let written = std::path::PathBuf::from(&status.target_files[0].target_path);
        assert_eq!(written == path, agent == "codex");
        let generated = std::fs::read_to_string(&written).unwrap();
        assert!(generated.contains("second-key"));
        assert!(!generated.contains("first-key"));
        if agent == "codex" {
            assert!(generated.contains("# user comment"));
        } else {
            assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
        }
        assert_eq!(
            std::fs::read_to_string(&auth_path).unwrap(),
            "native-login-sentinel"
        );
        assert!(restore_managed_configs_for_shutdown()
            .unwrap()
            .restored_agents
            .is_empty());
        assert_eq!(std::fs::read_to_string(&written).unwrap(), generated);
        operations::restore_agent_default_unlocked(agent, false).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
        if agent == "claude_code" {
            assert!(!written.exists());
        }
    }
}

#[test]
fn direct_apply_and_restore_refuse_external_edits() {
    let _lock = TEST_ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(temp.path());
    enable_direct("codex", connection("key"), None).unwrap();
    let path = temp.path().join(".codex/config.toml");
    std::fs::write(&path, "model = 'external-edit'").unwrap();
    assert!(enable_direct("codex", connection("replacement"), None).is_err());
    assert!(operations::status_for_unlocked("codex").unwrap().conflict);
    assert!(operations::restore_agent_default_unlocked("codex", false).is_err());
    assert_eq!(
        std::fs::read_to_string(path).unwrap(),
        "model = 'external-edit'"
    );
}

#[test]
fn malformed_configs_and_existing_provider_collisions_are_preserved() {
    for (agent, id, raw) in [
        (
            "codex",
            "config",
            "[model_providers.orgii]\nname='user-owned'",
        ),
        ("codex", "config", "secret = 'unterminated"),
        ("claude_code", "settings", "{broken-secret"),
        (
            "claude_code",
            "settings",
            "{\"apiKeyHelper\":\"private-command\"}",
        ),
    ] {
        let result = direct::generate_direct_configs(
            agent,
            &BTreeMap::from([(id.into(), raw.into())]),
            &connection("key"),
            None,
        );
        let error = result.unwrap_err();
        assert!(!error.contains("unterminated"));
        assert!(!error.contains("private-command"));
    }
}

#[test]
fn interrupted_transaction_does_not_overwrite_a_later_external_edit() {
    let _lock = TEST_ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let path = temp.path().join("config.toml");
    std::fs::write(&path, b"before").unwrap();
    let target = test_target("config", &path, temp.path());
    let snapshots = snapshot::read_target_snapshots(std::slice::from_ref(&target)).unwrap();
    let mutations = BTreeMap::from([(
        "config".into(),
        snapshot::TargetMutation::Write(b"ours".to_vec()),
    )]);
    transaction::begin_transaction(
        "test-agent",
        &snapshots,
        &test_manifest("test-agent", vec![target]),
        &mutations,
    )
    .unwrap();
    std::fs::write(&path, b"external").unwrap();
    assert!(transaction::recover_pending_transaction_unlocked("test-agent").is_err());
    assert_eq!(std::fs::read(&path).unwrap(), b"external");
    assert!(transaction::transaction_journal_path("test-agent").exists());
}

#[test]
fn target_lock_prevents_another_writer_without_creating_native_config() {
    let _lock = TEST_ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(temp.path());
    let first = target_lock::lock_targets("codex").unwrap();
    assert!(target_lock::lock_targets("codex").is_err());
    assert!(!temp.path().join(".codex").exists());
    drop(first);
    assert!(target_lock::lock_targets("codex").is_ok());
}

#[test]
fn stale_preview_cannot_apply_even_before_first_switch() {
    let _lock = TEST_ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(temp.path());
    let expected = operations::status_for_unlocked("codex")
        .unwrap()
        .target_files
        .into_iter()
        .map(|target| (target.id, target.current_hash))
        .collect();
    std::fs::create_dir_all(temp.path().join(".codex")).unwrap();
    let path = temp.path().join(".codex/config.toml");
    std::fs::write(&path, "model = 'new-external'").unwrap();
    assert!(enable_direct("codex", connection("key"), Some(&expected)).is_err());
    assert_eq!(
        std::fs::read_to_string(path).unwrap(),
        "model = 'new-external'"
    );
}

#[cfg(unix)]
#[test]
fn native_symlinks_are_rejected_and_credentials_are_owner_only() {
    use std::os::unix::{fs::symlink, fs::PermissionsExt};
    let _lock = TEST_ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(temp.path());
    std::fs::create_dir_all(temp.path().join(".codex")).unwrap();
    let original = temp.path().join("original");
    std::fs::write(&original, "model = 'original'").unwrap();
    let path = temp.path().join(".codex/config.toml");
    symlink(&original, &path).unwrap();
    assert!(enable_direct("codex", connection("key"), None).is_err());
    assert_eq!(
        std::fs::read_to_string(&original).unwrap(),
        "model = 'original'"
    );
    std::fs::remove_file(&path).unwrap();
    enable_direct("codex", connection("key"), None).unwrap();
    assert_eq!(
        std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
        0o600
    );
}

#[test]
fn official_anthropic_uses_native_api_key_authentication() {
    let mut connection = connection("synthetic-official-key");
    connection.base_url = "https://api.anthropic.com".into();
    let generated =
        direct::generate_direct_configs("claude_code", &BTreeMap::new(), &connection, None)
            .unwrap();
    let settings: serde_json::Value = serde_json::from_str(&generated["settings"]).unwrap();
    assert_eq!(
        settings["env"]["ANTHROPIC_API_KEY"],
        "synthetic-official-key"
    );
    assert!(settings["env"].get("ANTHROPIC_AUTH_TOKEN").is_none());
}

#[test]
fn claude_code_connection_writes_only_the_overlay_and_native_edits_never_conflict() {
    let _lock = TEST_ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(temp.path());
    let dir = temp.path().join(".claude");
    std::fs::create_dir_all(&dir).unwrap();
    let native = dir.join("settings.json");
    let original =
        "{\"permissions\":{\"allow\":[\"Read\"]},\"env\":{\"KEEP\":\"value\"},\"theme\":\"dark\"}";
    std::fs::write(&native, original).unwrap();
    let status = enable_direct("claude_code", connection("first-key"), None).unwrap();
    assert!(status.overlay);
    assert!(!status.conflict);
    let overlay = std::path::PathBuf::from(&status.target_files[0].target_path);
    assert!(overlay.starts_with(app_paths::cli_config_profile_overlay_dir("claude_code")));
    assert_ne!(overlay, native);
    // The user's own file is untouched; the overlay carries the connection.
    assert_eq!(std::fs::read_to_string(&native).unwrap(), original);
    let generated: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&overlay).unwrap()).unwrap();
    assert!(generated["env"].to_string().contains("first-key"));
    assert!(
        generated.get("permissions").is_none(),
        "overlay holds only ORG2 keys"
    );

    // Whatever Claude Code or the user writes to their own settings file is
    // not a conflict: /model, /theme, or an unrelated edit.
    std::fs::write(
        &native,
        "{\"permissions\":{\"allow\":[]},\"env\":{\"KEEP\":\"changed\"},\"model\":\"other\",\"theme\":\"light\"}",
    )
    .unwrap();
    let status = operations::status_for_unlocked("claude_code").unwrap();
    assert!(!status.conflict);
    enable_direct("claude_code", connection("second-key"), None).unwrap();
    let generated = std::fs::read_to_string(&overlay).unwrap();
    assert!(generated.contains("second-key") && !generated.contains("first-key"));

    // Authentication overrides in the user's file would beat the overlay, so
    // connecting refuses until they are removed; the user's file stays as is.
    let blocked = "{\"env\":{\"ANTHROPIC_API_KEY\":\"personal\"}}";
    std::fs::write(&native, blocked).unwrap();
    assert!(enable_direct("claude_code", connection("third-key"), None).is_err());
    assert_eq!(std::fs::read_to_string(&native).unwrap(), blocked);
    assert!(std::fs::read_to_string(&overlay)
        .unwrap()
        .contains("second-key"));

    // Restore without force just removes the overlay.
    std::fs::write(&native, original).unwrap();
    operations::restore_agent_default_unlocked("claude_code", false).unwrap();
    assert!(!overlay.exists());
    assert_eq!(std::fs::read_to_string(&native).unwrap(), original);
}

#[test]
fn legacy_native_claude_code_manifest_is_restored_on_upgrade() {
    let _lock = TEST_ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(temp.path());
    let dir = temp.path().join(".claude");
    std::fs::create_dir_all(&dir).unwrap();
    let native = dir.join("settings.json");
    // A release that still rewrote the user's file left this behind: the
    // managed content in place, the original in the default backup.
    let original = b"{\"permissions\":{\"allow\":[\"Read\"]}}";
    let managed = b"{\"env\":{\"ANTHROPIC_BASE_URL\":\"http://127.0.0.1:1/v1\"}}";
    std::fs::write(&native, managed).unwrap();
    let mut target = test_target("settings", &native, &temp.path().join("profiles"));
    let backup = std::path::PathBuf::from(&target.default_backup_path);
    std::fs::create_dir_all(backup.parent().unwrap()).unwrap();
    std::fs::write(&backup, original).unwrap();
    target.original_hash = Some(super::file_io::sha256_bytes(original));
    target.last_applied_hash = Some(super::file_io::sha256_bytes(managed));
    super::manifest::write_manifest(&test_manifest("claude_code", vec![target.clone()])).unwrap();
    // Until migrated, status keeps native semantics for that legacy path.
    let status = operations::status_for_unlocked("claude_code").unwrap();
    assert!(!status.overlay);
    assert!(!status.conflict);

    let report = migrate_native_overlay_targets().unwrap();
    assert_eq!(report.restored_agents, vec!["claude_code".to_string()]);
    assert!(report.failed_agents.is_empty());
    assert_eq!(std::fs::read(&native).unwrap(), original);
    let status = operations::status_for_unlocked("claude_code").unwrap();
    assert_eq!(status.mode, CliConfigMode::Default);
    // Migration is idempotent and a fresh apply now goes to the overlay.
    assert!(migrate_native_overlay_targets()
        .unwrap()
        .restored_agents
        .is_empty());
    let applied = enable_direct("claude_code", connection("key"), None).unwrap();
    assert!(applied.overlay);
    assert_eq!(std::fs::read(&native).unwrap(), original);

    // An external edit since the last apply is never overwritten: the legacy
    // manifest stays and the ordinary conflict path takes over.
    operations::restore_agent_default_unlocked("claude_code", false).unwrap();
    std::fs::write(&native, managed).unwrap();
    let mut edited = target;
    edited.last_applied_hash = Some(super::file_io::sha256_bytes(b"something-else"));
    super::manifest::write_manifest(&test_manifest("claude_code", vec![edited])).unwrap();
    let report = migrate_native_overlay_targets().unwrap();
    assert!(report.restored_agents.is_empty());
    assert_eq!(report.failed_agents.len(), 1);
    assert_eq!(std::fs::read(&native).unwrap(), managed);
    let status = operations::status_for_unlocked("claude_code").unwrap();
    assert!(!status.overlay);
    assert!(status.conflict);
}

#[test]
fn claude_code_overlay_is_regenerated_from_scratch_on_every_apply() {
    let _lock = TEST_ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(temp.path());
    std::fs::create_dir_all(temp.path().join(".claude")).unwrap();
    let catalog = model_catalog::ModelCatalog {
        models: vec![
            model_catalog::PickerModel {
                id: "alias-a".into(),
                label: "Package A · model".into(),
                native_metadata: None,
            },
            model_catalog::PickerModel {
                id: "alias-b".into(),
                label: "Package B · model".into(),
                native_metadata: None,
            },
        ],
    };
    let status = enable_orgii_managed_catalog(
        "claude_code",
        "market-app:test".into(),
        "org2_market".into(),
        "alias-a".into(),
        &catalog,
        &BTreeMap::from([("settings".to_string(), None)]),
    )
    .unwrap();
    let overlay = std::path::PathBuf::from(&status.target_files[0].target_path);
    let first: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&overlay).unwrap()).unwrap();
    assert_eq!(
        first["availableModels"],
        serde_json::json!(["alias-a", "alias-b"])
    );
    assert_eq!(first["modelPicker"]["options"][1]["model"], "alias-b");

    // A later plain apply must not inherit the picker from the previous overlay.
    let expected = BTreeMap::from([(
        "settings".to_string(),
        status.target_files[0].current_hash.clone(),
    )]);
    enable_orgii_managed_checked(
        "claude_code",
        Some("key".into()),
        Some("openai_api".into()),
        Some("plain-model".into()),
        false,
        Some(&expected),
    )
    .unwrap();
    let second: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&overlay).unwrap()).unwrap();
    assert!(second.get("modelPicker").is_none());
    assert!(second.get("availableModels").is_none());
    assert_eq!(second["model"], "plain-model");
}

#[test]
fn direct_launch_rejects_rotated_credentials_and_external_overlay_edits() {
    let _lock = TEST_ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(temp.path());
    let applied = enable_direct("claude_code", connection("original-key"), None).unwrap();
    verify_claude_launch_connection(&connection("original-key")).unwrap();
    assert!(verify_claude_launch_connection(&connection("rotated-key")).is_err());
    let settings = &applied.target_files[0].target_path;
    let before = std::fs::read(settings).unwrap();
    // Failed validation must not silently rewrite credentials.
    assert_eq!(std::fs::read(settings).unwrap(), before);
    std::fs::write(settings, "{}").unwrap();
    assert!(verify_claude_launch_connection(&connection("original-key")).is_err());
    assert_eq!(std::fs::read_to_string(settings).unwrap(), "{}");
}
