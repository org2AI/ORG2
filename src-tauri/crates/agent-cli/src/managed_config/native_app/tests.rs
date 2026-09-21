use super::*;
use crate::managed_config::tests::{OrgiiHomeGuard, TEST_ENV_LOCK};
use crate::managed_config::{
    self as config, manifest,
    model_catalog::{ModelCatalog, PickerModel},
    operations,
};
use std::{collections::BTreeMap, ffi::OsString};
struct ExternalHome(Option<OsString>);
impl ExternalHome {
    fn set(path: &Path) -> Self {
        let old = std::env::var_os("ORGII_EXTERNAL_HISTORY_HOME");
        std::env::set_var("ORGII_EXTERNAL_HISTORY_HOME", path);
        Self(old)
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
fn expected(agent: &str) -> BTreeMap<String, Option<String>> {
    operations::status_for_unlocked(agent)
        .unwrap()
        .target_files
        .into_iter()
        .map(|t| (t.id, t.current_hash))
        .collect()
}
fn apply(profile: &NativeAppProfile) -> Result<config::CliConfigManagedStatus, String> {
    let catalog = ModelCatalog {
        models: ["package-a", "package-b"]
            .into_iter()
            .map(|id| PickerModel {
                id: id.into(),
                label: id.into(),
                native_metadata: Some(serde_json::json!({"slug":id,"context_window":12345})),
            })
            .collect(),
    };
    config::enable_native_app(
        profile,
        "market-app:fixture".into(),
        "market".into(),
        "package-a".into(),
        Some(&catalog),
        None,
        &expected("codex"),
    )
}
fn write(path: &Path, value: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, value).unwrap();
}

// The supported official App writes these sections on first launch. Values are
// synthetic; no installed App, credential store or user's configuration is read.
const CODEX_RUNTIME: &str = r#"
notify = ["fixture-notify"]
[desktop]
followUpQueueMode = "queue"
[marketplaces.openai-bundled]
source = "fixture"
[mcp_servers.node_repl]
command = "fixture-node"
[plugins."fixture@openai-bundled"]
enabled = true
"#;

fn add_codex_runtime(path: &Path) -> toml::Table {
    let mut value: toml::Table = toml::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    value.extend(toml::from_str::<toml::Table>(CODEX_RUNTIME).unwrap());
    write(path, &toml::to_string_pretty(&value).unwrap());
    value
}

fn select_codex_runtime_model(path: &Path) -> toml::Table {
    let mut value = add_codex_runtime(path);
    value.insert("model".into(), "package-b".into());
    value.insert("model_reasoning_effort".into(), "medium".into());
    let desktop = value.get_mut("desktop").unwrap().as_table_mut().unwrap();
    desktop.insert("conversationDetailMode".into(), "STEPS_COMMANDS".into());
    desktop.insert("ambient-suggestions-enabled".into(), true.into());
    let projects = value
        .entry("projects")
        .or_insert_with(|| toml::Value::Table(Default::default()))
        .as_table_mut()
        .unwrap();
    projects.insert(
        "fixture-workspace".into(),
        toml::Value::Table(toml::from_str("trust_level = 'trusted'").unwrap()),
    );
    write(path, &toml::to_string_pretty(&value).unwrap());
    value
}

#[test]
fn codex_native_picker_and_workspace_preferences_allow_reopen_reapply_and_restore() {
    let _lock = TEST_ENV_LOCK.get_or_init(Default::default).lock().unwrap();
    for reapply in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
        let _external = ExternalHome::set(&temp.path().join("external"));
        let profile = NativeAppProfile::new("codex", "https://cloud.example", "alice").unwrap();
        let path = profile.target("config").unwrap();
        write(
            &path,
            "model = 'personal'\nmodel_provider = 'personal'\n[model_providers.personal]\nname = 'Personal'\n[projects.original]\ntrust_level = 'untrusted'\n",
        );
        apply(&profile).unwrap();
        select_codex_runtime_model(&path);
        let status = operations::status_for_unlocked("codex").unwrap();
        assert!(!status.conflict);
        // The connection's default selection remains unchanged; the native
        // picker routes the per-turn alias independently.
        assert_eq!(status.selected_model.as_deref(), Some("package-a"));
        with_launch("codex", &profile, "market-app:fixture", "package-a", || {
            Ok(())
        })
        .unwrap();
        if reapply {
            apply(&profile).unwrap();
            let reapplied: toml::Table =
                toml::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
            assert_eq!(reapplied["model"].as_str(), Some("package-a"));
            assert_eq!(reapplied["model_reasoning_effort"].as_str(), Some("medium"));
            select_codex_runtime_model(&path);
        }
        let history = profile.home().join("sessions/history-marker");
        write(&history, "retained");
        operations::restore_agent_default_unlocked("codex", false).unwrap();
        let restored: toml::Table =
            toml::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(restored["model"].as_str(), Some("personal"));
        assert_eq!(restored["model_provider"].as_str(), Some("personal"));
        assert!(!restored.contains_key("model_catalog_json"));
        let providers = restored["model_providers"].as_table().unwrap();
        assert_eq!(providers.len(), 1);
        assert_eq!(providers["personal"]["name"].as_str(), Some("Personal"));
        assert_eq!(restored["model_reasoning_effort"].as_str(), Some("medium"));
        assert_eq!(
            restored["desktop"]["conversationDetailMode"].as_str(),
            Some("STEPS_COMMANDS")
        );
        assert_eq!(
            restored["desktop"]["ambient-suggestions-enabled"].as_bool(),
            Some(true)
        );
        assert_eq!(
            restored["projects"]["fixture-workspace"]["trust_level"].as_str(),
            Some("trusted")
        );
        assert_eq!(
            restored["projects"]["original"]["trust_level"].as_str(),
            Some("untrusted")
        );
        assert_eq!(std::fs::read_to_string(history).unwrap(), "retained");
    }
}

#[test]
fn codex_runtime_writes_allow_reopen_reapply_and_restore_without_losing_preferences_or_history() {
    let _lock = TEST_ENV_LOCK.get_or_init(Default::default).lock().unwrap();
    for original in [None, Some("model = 'personal'\nmodel_provider = 'personal'\nmodel_catalog_json = '/fixture/catalog.json'\n[model_providers.personal]\nname = 'Personal'\n"), Some("model = 'old-orgii'\nmodel_provider = 'orgii'\n[model_providers.orgii]\nname = 'Original'\nbase_url = 'https://original.example'\n[model_providers.personal]\nname = 'Personal'\n")] {
        for phase in [0, 1, 2] {
            let temp = tempfile::tempdir().unwrap();
            let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
            let _external = ExternalHome::set(&temp.path().join("external"));
            let primary = crate::generic_config::resolve_config_path("codex", "config").unwrap();
            write(&primary, "model = 'primary'\n");
            let profile = NativeAppProfile::new("codex", "https://cloud.example", "alice").unwrap();
            let path = profile.target("config").unwrap();
            if let Some(original) = original {
                write(&path, original);
            }
            apply(&profile).unwrap();
            add_codex_runtime(&path);
            let status = operations::status_for_unlocked("codex").unwrap();
            assert!(!status.conflict);
            profile.validate_launch(&status).unwrap();
            with_launch("codex", &profile, "market-app:fixture", "package-a", || Ok(())).unwrap();
            let mut runtime: toml::Table = toml::from_str(CODEX_RUNTIME).unwrap();
            if phase > 0 {
                apply(&profile).unwrap();
            }
            if phase == 2 {
                runtime.get_mut("desktop").unwrap()["followUpQueueMode"] = "interrupt".into();
                runtime.get_mut("plugins").unwrap()["fixture@openai-bundled"]["enabled"] = false.into();
                runtime.remove("notify");
                let mut current: toml::Table = toml::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
                current.remove("notify");
                current.extend(runtime.clone());
                write(&path, &toml::to_string_pretty(&current).unwrap());
                assert!(!operations::status_for_unlocked("codex").unwrap().conflict);
            }
            let history = profile.home().join("sessions/history-marker");
            write(&history, "retained");
            operations::restore_agent_default_unlocked("codex", false).unwrap();
            let restored: toml::Table = toml::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
            let mut expected: toml::Table = toml::from_str(original.unwrap_or_default()).unwrap();
            expected.extend(runtime);
            assert_eq!(restored, expected);
            assert!(!profile.target(config::model_catalog::TARGET_ID).unwrap().exists());
            assert_eq!(std::fs::read_to_string(history).unwrap(), "retained");
            assert_eq!(std::fs::read_to_string(primary).unwrap(), "model = 'primary'\n");
        }
    }
}

#[test]
fn codex_runtime_exception_rejects_routing_unknown_fields_and_untrusted_snapshots() {
    let _lock = TEST_ENV_LOCK.get_or_init(Default::default).lock().unwrap();
    for change in [
        "model",
        "provider",
        "provider-url",
        "catalog",
        "catalog-file",
        "unknown",
        "profile-override",
        "desktop-unknown",
        "desktop-detail-type",
        "desktop-ambient-type",
        "reasoning-unknown",
        "reasoning-type",
        "project-unknown",
        "project-trust-unknown",
        "project-trust-type",
        "owned-model-catalog-changed",
        "owned-model-catalog-missing",
        "runtime-type",
        "snapshot-changed",
        "snapshot-missing",
    ] {
        let temp = tempfile::tempdir().unwrap();
        let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
        let _external = ExternalHome::set(&temp.path().join("external"));
        let profile = NativeAppProfile::new("codex", "https://cloud.example", "alice").unwrap();
        apply(&profile).unwrap();
        let path = profile.target("config").unwrap();
        let mut value = select_codex_runtime_model(&path);
        let manifest = manifest::read_manifest("codex").unwrap().unwrap();
        let target = manifest
            .target_files
            .iter()
            .find(|target| target.id == "config")
            .unwrap();
        match change {
            "model" => {
                value.insert("model".into(), "unowned-model".into());
            }
            "provider" => {
                value.insert("model_provider".into(), "other".into());
            }
            "provider-url" => {
                value.get_mut("model_providers").unwrap()["orgii"]["base_url"] =
                    "https://other.example".into();
            }
            "catalog" => {
                value.insert("model_catalog_json".into(), "/unowned/catalog.json".into());
            }
            "catalog-file" => {
                write(
                    &profile.target(config::model_catalog::TARGET_ID).unwrap(),
                    "{\"models\":[]}",
                );
            }
            "unknown" => {
                value.insert("unknown_setting".into(), true.into());
            }
            "profile-override" => {
                value.insert("profile".into(), "other".into());
            }
            "desktop-unknown" => {
                value
                    .get_mut("desktop")
                    .unwrap()
                    .as_table_mut()
                    .unwrap()
                    .insert("unknown_setting".into(), true.into());
            }
            "desktop-detail-type" => {
                value.get_mut("desktop").unwrap()["conversationDetailMode"] = false.into();
            }
            "desktop-ambient-type" => {
                value.get_mut("desktop").unwrap()["ambient-suggestions-enabled"] = "yes".into();
            }
            "reasoning-unknown" => {
                value.insert("model_reasoning_effort".into(), "unknown".into());
            }
            "reasoning-type" => {
                value.insert("model_reasoning_effort".into(), 42.into());
            }
            "project-unknown" => {
                value.get_mut("projects").unwrap()["fixture-workspace"]
                    .as_table_mut()
                    .unwrap()
                    .insert("model_provider".into(), "other".into());
            }
            "project-trust-unknown" => {
                value.get_mut("projects").unwrap()["fixture-workspace"]["trust_level"] =
                    "always".into();
            }
            "project-trust-type" => {
                value.get_mut("projects").unwrap()["fixture-workspace"]["trust_level"] =
                    true.into();
            }
            "owned-model-catalog-changed" => {
                write(
                    &profile.target(config::model_catalog::TARGET_ID).unwrap(),
                    "{\"models\":[{\"slug\":\"package-a\"},{\"slug\":\"package-b\"}]}",
                );
            }
            "owned-model-catalog-missing" => {
                std::fs::remove_file(profile.target(config::model_catalog::TARGET_ID).unwrap())
                    .unwrap();
            }
            "runtime-type" => {
                value.insert("notify".into(), 42.into());
            }
            "snapshot-changed" => {
                write(
                    Path::new(&target.managed_profile_path),
                    "model = 'uncommitted'\n",
                );
            }
            "snapshot-missing" => {
                std::fs::remove_file(&target.managed_profile_path).unwrap();
            }
            _ => unreachable!(),
        }
        write(&path, &toml::to_string_pretty(&value).unwrap());
        let before = std::fs::read(&path).unwrap();
        assert!(
            operations::status_for_unlocked("codex").unwrap().conflict,
            "{change}"
        );
        assert!(
            with_launch::<()>(
                "codex",
                &profile,
                "market-app:fixture",
                "package-a",
                || panic!("must not launch conflicting config")
            )
            .is_err(),
            "{change}"
        );
        assert!(apply(&profile).is_err(), "{change}");
        assert!(
            operations::restore_agent_default_unlocked("codex", false).is_err(),
            "{change}"
        );
        assert_eq!(std::fs::read(&path).unwrap(), before, "{change}");
    }
}

#[test]
fn codex_restore_uses_exact_committed_current_when_managed_snapshot_is_unavailable() {
    let _lock = TEST_ENV_LOCK.get_or_init(Default::default).lock().unwrap();
    for snapshot_missing in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
        let _external = ExternalHome::set(&temp.path().join("external"));
        let profile = NativeAppProfile::new("codex", "https://cloud.example", "alice").unwrap();
        apply(&profile).unwrap();
        let path = profile.target("config").unwrap();
        add_codex_runtime(&path);
        apply(&profile).unwrap();
        let manifest = manifest::read_manifest("codex").unwrap().unwrap();
        let target = manifest
            .target_files
            .iter()
            .find(|target| target.id == "config")
            .unwrap();
        if snapshot_missing {
            std::fs::remove_file(&target.managed_profile_path).unwrap();
        } else {
            write(
                Path::new(&target.managed_profile_path),
                "model = 'uncommitted'\n",
            );
        }
        operations::restore_agent_default_unlocked("codex", false).unwrap();
        let restored: toml::Table =
            toml::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(
            restored,
            toml::from_str::<toml::Table>(CODEX_RUNTIME).unwrap()
        );
    }
}

#[test]
fn codex_force_restore_recovers_damaged_profiles_and_preserves_mergeable_runtime() {
    let _lock = TEST_ENV_LOCK.get_or_init(Default::default).lock().unwrap();
    for original in [None, Some("# original backup\nmodel = 'personal'\nmodel_provider = 'personal'\n[model_providers.personal]\nname = 'Personal'\nbase_url = 'https://personal.example'\n[projects.fixture]\ntrust_level = 'trusted'\n")] {
        for damage in [
            "malformed",
            "missing",
            "empty",
            "unknown-edit",
            "snapshot-missing",
            "snapshot-changed",
            "runtime",
            "oversized",
        ] {
            let temp = tempfile::tempdir().unwrap();
            let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
            let _external = ExternalHome::set(&temp.path().join("external"));
            let profile = NativeAppProfile::new("codex", "https://cloud.example", "alice").unwrap();
            let path = profile.target("config").unwrap();
            if let Some(original) = original {
                write(&path, original);
            }
            apply(&profile).unwrap();
            add_codex_runtime(&path);
            let manifest = manifest::read_manifest("codex").unwrap().unwrap();
            let target = manifest
                .target_files
                .iter()
                .find(|target| target.id == "config")
                .unwrap();
            match damage {
                "malformed" => write(&path, "model = ["),
                "missing" => std::fs::remove_file(&path).unwrap(),
                "empty" => write(&path, ""),
                "unknown-edit" => {
                    let mut current: toml::Table = toml::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
                    current.insert("unknown_setting".into(), true.into());
                    write(&path, &toml::to_string_pretty(&current).unwrap());
                }
                "snapshot-missing" => std::fs::remove_file(&target.managed_profile_path).unwrap(),
                "snapshot-changed" => write(
                    Path::new(&target.managed_profile_path),
                    "model = 'uncommitted'\n",
                ),
                "oversized" => write(&path, &format!("#{}", "x".repeat(4 * 1024 * 1024))),
                "runtime" => (),
                _ => unreachable!(),
            }
            if damage != "runtime" {
                assert!(
                    operations::restore_agent_default_unlocked("codex", false).is_err(),
                    "{damage}"
                );
            }
            operations::restore_agent_default_unlocked("codex", true).unwrap();
            if damage == "runtime" {
                let restored: toml::Table =
                    toml::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
                let mut expected: toml::Table =
                    toml::from_str(original.unwrap_or_default()).unwrap();
                expected.extend(toml::from_str::<toml::Table>(CODEX_RUNTIME).unwrap());
                assert_eq!(restored, expected);
            } else if let Some(original) = original {
                let restored = std::fs::read_to_string(&path).unwrap();
                assert_eq!(restored, original, "{damage}");
            } else {
                assert!(!path.exists(), "{damage}");
            }
        }
    }
}

#[test]
fn codex_runtime_exception_does_not_apply_to_legacy_or_foreign_target_paths() {
    let _lock = TEST_ENV_LOCK.get_or_init(Default::default).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(&temp.path().join("external"));
    let profile = NativeAppProfile::new("codex", "https://cloud.example", "alice").unwrap();
    apply(&profile).unwrap();
    let path = profile.target("config").unwrap();
    select_codex_runtime_model(&path);
    let current = std::fs::read(path).unwrap();
    let mut manifest = manifest::read_manifest("codex").unwrap().unwrap();
    let mut target = manifest
        .target_files
        .iter()
        .find(|target| target.id == "config")
        .unwrap()
        .clone();
    assert!(config::codex_runtime::drift_only(
        &manifest, &target, &current
    ));
    let catalog_index = manifest
        .target_files
        .iter()
        .position(|target| target.id == config::model_catalog::TARGET_ID)
        .unwrap();
    let catalog_path = manifest.target_files[catalog_index].target_path.clone();
    let foreign_catalog = temp.path().join("unowned-catalog.json");
    std::fs::copy(&catalog_path, &foreign_catalog).unwrap();
    manifest.target_files[catalog_index].target_path =
        foreign_catalog.to_string_lossy().into_owned();
    assert!(!config::codex_runtime::drift_only(
        &manifest, &target, &current
    ));
    manifest.target_files[catalog_index].target_path = catalog_path;
    manifest.native_model_catalog = false;
    assert!(!config::codex_runtime::drift_only(
        &manifest, &target, &current
    ));
    manifest.native_model_catalog = true;
    target.target_path = temp
        .path()
        .join("unowned-config.toml")
        .to_string_lossy()
        .into_owned();
    assert!(!config::codex_runtime::drift_only(
        &manifest, &target, &current
    ));
    target.target_path = profile
        .target("config")
        .unwrap()
        .to_string_lossy()
        .into_owned();
    manifest.native_app = None;
    assert!(!config::codex_runtime::drift_only(
        &manifest, &target, &current
    ));
}
#[test]
fn scope_is_stable_per_cloud_owner_and_instance_without_package_or_credentials() {
    let _lock = TEST_ENV_LOCK.get_or_init(Default::default).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(temp.path());
    let a = NativeAppProfile::new("codex", "https://cloud.example/", "alice").unwrap();
    assert_eq!(
        a,
        NativeAppProfile::new("codex", "https://cloud.example", "alice").unwrap()
    );
    assert_ne!(
        a.home(),
        NativeAppProfile::new("codex", "https://cloud.example", "bob")
            .unwrap()
            .home()
    );
    assert_ne!(
        a.home(),
        NativeAppProfile::new("codex", "https://other.example", "alice")
            .unwrap()
            .home()
    );
    assert!(!serde_json::to_string(&a).unwrap().contains("alice"));
    assert!(NativeAppProfile::new("codex", "https://secret@cloud.example", "alice").is_err());
    assert!(NativeAppProfile::new("claude_code", "https://cloud.example", "alice").is_err());
    let previous = a.home();
    let _other_home = OrgiiHomeGuard::set(&temp.path().join("instance-2"));
    assert_ne!(previous, a.home());
}
#[test]
fn isolated_catalog_manifest_and_launch_use_same_root_without_mutating_primary() {
    let _lock = TEST_ENV_LOCK.get_or_init(Default::default).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(&temp.path().join("external"));
    let native = crate::generic_config::resolve_config_path("codex", "config").unwrap();
    assert!(native.starts_with(temp.path()));
    write(&native, "model = 'primary-model'\n");
    let profile = NativeAppProfile::new("codex", "https://cloud.example", "alice").unwrap();
    let status = apply(&profile).unwrap();
    assert_eq!(
        std::fs::read_to_string(&native).unwrap(),
        "model = 'primary-model'\n"
    );
    assert_eq!(status.native_app.as_ref(), Some(&profile));
    let raw = std::fs::read_to_string(profile.target("config").unwrap()).unwrap();
    let value: toml::Value = toml::from_str(&raw).unwrap();
    assert_eq!(
        value["model_catalog_json"].as_str(),
        profile
            .target(config::model_catalog::TARGET_ID)
            .unwrap()
            .to_str()
    );
    assert_eq!(
        manifest::read_manifest("codex")
            .unwrap()
            .unwrap()
            .native_app,
        Some(profile.clone())
    );
    with_launch("codex", &profile, "market-app:fixture", "package-a", || {
        Ok(())
    })
    .unwrap();
    assert!(with_launch::<()>(
        "codex",
        &profile,
        "market-app:wrong",
        "package-a",
        || panic!("must not dispatch stale selection")
    )
    .is_err());
    let other = NativeAppProfile::new("codex", "https://cloud.example", "bob").unwrap();
    assert!(apply(&other).is_err());
    assert!(with_launch::<()>(
        "codex",
        &other,
        "market-app:fixture",
        "package-a",
        || panic!("wrong owner profile must not launch")
    )
    .is_err());
    let claude = NativeAppProfile::new("claude_desktop", "https://cloud.example", "alice").unwrap();
    assert!(claude.validate_launch(&status).is_err());
    let history = profile.home().join("sessions/history-marker");
    write(&history, "retained");
    operations::restore_agent_default_unlocked("codex", false).unwrap();
    assert_eq!(std::fs::read_to_string(history).unwrap(), "retained");
    assert_eq!(
        std::fs::read_to_string(&native).unwrap(),
        "model = 'primary-model'\n"
    );
    assert!(operations::status_for_unlocked("codex")
        .unwrap()
        .native_app
        .is_none());
    assert!(apply(&other).is_ok());
}
#[test]
fn legacy_active_and_reverse_cli_switch_require_restore_without_touching_primary() {
    let _lock = TEST_ENV_LOCK.get_or_init(Default::default).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(&temp.path().join("external"));
    let native = crate::generic_config::resolve_config_path("codex", "config").unwrap();
    assert!(native.starts_with(temp.path()));
    write(&native, "model = 'primary'\n");
    config::enable_orgii_managed(
        "codex",
        Some("local-key".into()),
        Some("openai".into()),
        Some("local-model".into()),
        false,
    )
    .unwrap();
    let before = std::fs::read(&native).unwrap();
    let recorded = std::fs::read(manifest::manifest_path("codex")).unwrap();
    let backups = manifest::read_manifest("codex")
        .unwrap()
        .unwrap()
        .target_files
        .into_iter()
        .filter_map(|target| {
            std::fs::read(&target.default_backup_path)
                .ok()
                .map(|bytes| (target.default_backup_path, bytes))
        })
        .collect::<Vec<_>>();
    assert!(!backups.is_empty());
    let profile = NativeAppProfile::new("codex", "https://cloud.example", "alice").unwrap();
    assert_eq!(apply(&profile).unwrap_err(), "native_app_restore_required");
    assert_eq!(std::fs::read(&native).unwrap(), before);
    assert_eq!(
        std::fs::read(manifest::manifest_path("codex")).unwrap(),
        recorded
    );
    operations::restore_agent_default_unlocked("codex", false).unwrap();
    apply(&profile).unwrap();
    for (path, bytes) in &backups {
        assert_eq!(&std::fs::read(path).unwrap(), bytes);
    }
    assert_eq!(
        config::enable_orgii_managed(
            "codex",
            Some("local-key".into()),
            Some("openai".into()),
            Some("model".into()),
            false
        )
        .unwrap_err(),
        "native_app_restore_required"
    );
    assert_eq!(
        std::fs::read_to_string(&native).unwrap(),
        "model = 'primary'\n"
    );
    operations::restore_agent_default_unlocked("codex", false).unwrap();
    config::enable_orgii_managed(
        "codex",
        Some("local-key".into()),
        Some("openai".into()),
        Some("model".into()),
        false,
    )
    .unwrap();
    assert!(std::fs::read_to_string(&native)
        .unwrap()
        .contains("model_provider"));
}
#[test]
fn claude_helper_runtime_and_restore_stay_isolated_and_preserve_runtime_preferences() {
    let _lock = TEST_ENV_LOCK.get_or_init(Default::default).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(&temp.path().join("external"));
    let native =
        app_paths::external_history_data_local_dir().join("Claude-3p/claude_desktop_config.json");
    assert!(native.starts_with(temp.path()));
    write(&native, r#"{"deploymentMode":"1p","theme":"dark"}"#);
    let original = std::fs::read(&native).unwrap();
    let profile =
        NativeAppProfile::new("claude_desktop", "https://cloud.example", "alice").unwrap();
    let token = "a".repeat(64);
    let connection = config::DirectConnection {
        profile: None,
        key_id: "market:fixture".into(),
        provider: "market".into(),
        model: "claude-sonnet-4-6".into(),
        base_url: config::claude_desktop_proxy_base_url(&config::managed_proxy_url(), &token),
        api_key: String::new(),
        desktop_auth_scheme: Some("bearer".into()),
        desktop_helper: Some(config::desktop::CredentialHelper {
            path: profile.helper(),
            token: token.clone(),
            models: ["claude-sonnet-4-6", "claude-opus-4-6"]
                .into_iter()
                .map(|model| config::model_catalog::PickerModel {
                    id: model.into(),
                    label: format!("Package · {model}"),
                    native_metadata: None,
                })
                .collect(),
        }),
        proxy_token: Some(token),
    };
    let status = config::enable_native_app(
        &profile,
        connection.key_id.clone(),
        "market".into(),
        connection.model.clone(),
        None,
        Some(&connection),
        &expected("claude_desktop"),
    )
    .unwrap();
    profile.validate_launch(&status).unwrap();
    let value: serde_json::Value =
        serde_json::from_slice(&std::fs::read(profile.target("profile").unwrap()).unwrap())
            .unwrap();
    assert_eq!(
        value["inferenceCredentialHelper"].as_str(),
        profile.helper().to_str()
    );
    assert_eq!(value["inferenceModels"].as_array().unwrap().len(), 2);
    assert_eq!(
        value["claudeAiImport"],
        serde_json::json!({"enabled": true})
    );
    write(
        &profile.target("desktop").unwrap(),
        r#"{"deploymentMode":"3p","theme":"light"}"#,
    );
    operations::restore_agent_default_unlocked("claude_desktop", false).unwrap();
    let runtime: serde_json::Value =
        serde_json::from_slice(&std::fs::read(profile.target("desktop").unwrap()).unwrap())
            .unwrap();
    assert_eq!(runtime, serde_json::json!({"theme":"light"}));
    assert_eq!(std::fs::read(native).unwrap(), original);
}
#[cfg(unix)]
#[test]
fn symlink_destination_and_tampered_scope_fail_before_primary_writes() {
    let _lock = TEST_ENV_LOCK.get_or_init(Default::default).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(&temp.path().join("external"));
    let profile = NativeAppProfile::new("codex", "https://cloud.example", "alice").unwrap();
    std::fs::create_dir_all(profile.root()).unwrap();
    let primary = temp.path().join("primary");
    std::fs::create_dir_all(&primary).unwrap();
    write(&primary.join("config.toml"), "unchanged");
    std::os::unix::fs::symlink(&primary, profile.home()).unwrap();
    assert!(apply(&profile).is_err());
    assert_eq!(
        std::fs::read_to_string(primary.join("config.toml")).unwrap(),
        "unchanged"
    );
    let malformed: NativeAppProfile = serde_json::from_value(
        serde_json::json!({"version":1,"agent":"codex","scope":"../../escape"}),
    )
    .unwrap();
    assert!(malformed.validate("codex").is_err());
}

#[test]
fn single_model_without_catalog_can_launch_but_owned_missing_catalog_cannot() {
    let _lock = TEST_ENV_LOCK.get_or_init(Default::default).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(&temp.path().join("external"));
    let profile = NativeAppProfile::new("codex", "https://cloud.example", "alice").unwrap();
    config::enable_native_app(
        &profile,
        "market-app:fixture".into(),
        "market".into(),
        "package-a".into(),
        None,
        None,
        &expected("codex"),
    )
    .unwrap();
    assert!(!profile
        .target(config::model_catalog::TARGET_ID)
        .unwrap()
        .exists());
    with_launch("codex", &profile, "market-app:fixture", "package-a", || {
        Ok(())
    })
    .unwrap();
    apply(&profile).unwrap();
    std::fs::remove_file(profile.target(config::model_catalog::TARGET_ID).unwrap()).unwrap();
    assert!(with_launch::<()>(
        "codex",
        &profile,
        "market-app:fixture",
        "package-a",
        || panic!("missing owned catalog must not launch")
    )
    .is_err());
}

#[cfg(unix)]
#[test]
fn restore_and_pending_first_apply_recovery_reject_parent_symlink_without_primary_writes() {
    let _lock = TEST_ENV_LOCK.get_or_init(Default::default).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(&temp.path().join("external"));
    let profile = NativeAppProfile::new("codex", "https://cloud.example", "alice").unwrap();
    apply(&profile).unwrap();
    let manifest = manifest::read_manifest("codex").unwrap().unwrap();
    let snapshots = config::snapshot::read_target_snapshots(&manifest.target_files).unwrap();
    config::transaction::begin_transaction("codex", &snapshots, &manifest, &BTreeMap::new())
        .unwrap();
    let original = std::fs::read(profile.target("config").unwrap()).unwrap();
    let primary = temp.path().join("primary");
    std::fs::rename(profile.home(), &primary).unwrap();
    std::os::unix::fs::symlink(&primary, profile.home()).unwrap();
    assert!(operations::status_for_unlocked("codex").is_err());
    for force in [false, true] {
        assert!(operations::restore_agent_default_unlocked("codex", force).is_err());
    }
    // First Apply can crash before its manifest exists. The journal carries its
    // own descriptor, so recovery cannot rely on an already committed manifest.
    std::fs::remove_file(config::manifest::manifest_path("codex")).unwrap();
    assert!(config::transaction::recover_pending_transaction_unlocked("codex").is_err());
    assert_eq!(
        std::fs::read(primary.join("config.toml")).unwrap(),
        original
    );
    assert!(config::transaction::transaction_journal_path("codex").exists());
}

#[test]
fn tampered_manifest_and_journal_targets_fail_closed_outside_profile() {
    let _lock = TEST_ENV_LOCK.get_or_init(Default::default).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(&temp.path().join("external"));
    let profile = NativeAppProfile::new("codex", "https://cloud.example", "alice").unwrap();
    apply(&profile).unwrap();
    let mut manifest = manifest::read_manifest("codex").unwrap().unwrap();
    let outside = temp.path().join("primary-config.toml");
    write(&outside, "unchanged");
    let snapshots = config::snapshot::read_target_snapshots(&manifest.target_files).unwrap();
    config::transaction::begin_transaction("codex", &snapshots, &manifest, &BTreeMap::new())
        .unwrap();
    manifest.target_files[0].target_path = outside.to_string_lossy().into_owned();
    config::manifest::write_manifest(&manifest).unwrap();
    assert!(operations::status_for_unlocked("codex").is_err());
    assert!(operations::restore_agent_default_unlocked("codex", true).is_err());
    let path = config::transaction::transaction_journal_path("codex");
    let mut journal: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    journal["targetFiles"][0]["targetPath"] = outside.to_string_lossy().into_owned().into();
    std::fs::write(&path, serde_json::to_vec(&journal).unwrap()).unwrap();
    assert!(config::transaction::recover_pending_transaction_unlocked("codex").is_err());
    assert_eq!(std::fs::read_to_string(outside).unwrap(), "unchanged");
}

#[test]
fn owner_check_after_waiting_for_config_lock_cancels_dispatch() {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        mpsc,
    };
    let _lock = TEST_ENV_LOCK.get_or_init(Default::default).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(&temp.path().join("external"));
    let profile = NativeAppProfile::new("codex", "https://cloud.example", "alice").unwrap();
    apply(&profile).unwrap();
    let guard = config::config_operation_guard().unwrap();
    let valid = AtomicBool::new(true);
    let (tx, rx) = mpsc::channel();
    std::thread::scope(|scope| {
        let worker = scope.spawn(|| {
            tx.send(()).unwrap();
            with_launch("codex", &profile, "market-app:fixture", "package-a", || {
                if !valid.load(Ordering::SeqCst) {
                    return Err("market_identity_changed".into());
                }
                panic!("invalidated owner must not dispatch")
            })
        });
        rx.recv().unwrap();
        valid.store(false, Ordering::SeqCst);
        drop(guard);
        assert_eq!(
            worker.join().unwrap(),
            Err::<(), _>("market_identity_changed".into())
        );
    });
}
