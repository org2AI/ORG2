#[cfg(any(target_os = "macos", windows))]
use super::tests::{test_manifest, test_target, OrgiiHomeGuard, TEST_ENV_LOCK};
use super::*;
use std::collections::BTreeMap;
#[cfg(any(target_os = "macos", windows))]
use std::sync::Mutex;

#[cfg(any(target_os = "macos", windows))]
struct ExternalHome(Option<std::ffi::OsString>);
#[cfg(any(target_os = "macos", windows))]
impl ExternalHome {
    fn set(path: &std::path::Path) -> Self {
        let previous = std::env::var_os("ORGII_EXTERNAL_HISTORY_HOME");
        std::env::set_var("ORGII_EXTERNAL_HISTORY_HOME", path);
        Self(previous)
    }
}
#[cfg(any(target_os = "macos", windows))]
impl Drop for ExternalHome {
    fn drop(&mut self) {
        match self.0.take() {
            Some(value) => std::env::set_var("ORGII_EXTERNAL_HISTORY_HOME", value),
            None => std::env::remove_var("ORGII_EXTERNAL_HISTORY_HOME"),
        }
    }
}
fn connection() -> DirectConnection {
    DirectConnection {
        profile: None,
        key_id: "desktop-key".into(),
        provider: "custom_api".into(),
        model: "claude-sonnet-5".into(),
        base_url: "https://desktop.example/anthropic".into(),
        api_key: "synthetic-desktop-key".into(),
        desktop_auth_scheme: Some("x-api-key".into()),
        desktop_helper: None,
        proxy_token: None,
    }
}

#[test]
fn native_schema_preserves_other_profiles_without_enabling_unrelated_permissions() {
    let source = BTreeMap::from([
        (
            "desktop".into(),
            r#"{"mcpServers":{"keep":{}},"deploymentMode":"1p"}"#.into(),
        ),
        (
            "catalog".into(),
            r#"{"entries":[{"id":"other","name":"Personal"}],"appliedId":"other","keep":true}"#
                .into(),
        ),
    ]);
    let generated = desktop::generate(&source, &connection(), None).unwrap();
    let profile: serde_json::Value = serde_json::from_str(&generated["profile"]).unwrap();
    assert_eq!(
        profile["inferenceGatewayBaseUrl"],
        "https://desktop.example/anthropic"
    );
    assert_eq!(profile["inferenceGatewayAuthScheme"], "x-api-key");
    assert_eq!(profile["inferenceModels"][0]["name"], "claude-sonnet-5");
    assert!(profile.get("coworkEgressAllowedHosts").is_none());
    assert!(profile.get("disableDeploymentModeChooser").is_none());
    assert!(profile.get("claudeAiImport").is_none());
    let config: serde_json::Value = serde_json::from_str(&generated["desktop"]).unwrap();
    assert!(config["mcpServers"].get("keep").is_some());
    let catalog: serde_json::Value = serde_json::from_str(&generated["catalog"]).unwrap();
    assert_eq!(catalog["entries"][0]["id"], "other");
    assert_eq!(catalog["keep"], true);
}

#[cfg(any(target_os = "macos", windows))]
#[test]
fn desktop_runtime_preferences_survive_reapply_and_restore_but_mode_edits_conflict() {
    let _lock = TEST_ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
    for original in [None, Some(r#"{"deploymentMode":"1p","theme":"dark"}"#)] {
        let temp = tempfile::tempdir().unwrap();
        let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
        let _external = ExternalHome::set(temp.path());
        let targets = desktop::targets().unwrap();
        let runtime = &targets
            .iter()
            .find(|(id, _, _)| *id == "desktop")
            .unwrap()
            .2;
        assert_eq!(
            runtime,
            &app_paths::external_history_data_local_dir()
                .join("Claude-3p/claude_desktop_config.json")
        );
        std::fs::create_dir_all(runtime.parent().unwrap()).unwrap();
        if let Some(original) = original {
            std::fs::write(runtime, original).unwrap();
        }
        enable_direct(desktop::TARGET, connection(), None).unwrap();
        let mut value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(runtime).unwrap()).unwrap();
        assert_eq!(value["deploymentMode"], "3p");
        // The real Desktop process writes preferences after opening its 3P UI.
        value["nativePreference"] = serde_json::json!({"keep":true});
        std::fs::write(runtime, serde_json::to_vec(&value).unwrap()).unwrap();
        assert!(
            !operations::status_for_unlocked(desktop::TARGET)
                .unwrap()
                .conflict
        );
        enable_direct(desktop::TARGET, connection(), None).unwrap();
        value["enterpriseConfig"] = serde_json::json!({"inferenceProvider":"other"});
        std::fs::write(runtime, serde_json::to_vec(&value).unwrap()).unwrap();
        assert!(
            operations::status_for_unlocked(desktop::TARGET)
                .unwrap()
                .conflict
        );
        value.as_object_mut().unwrap().remove("enterpriseConfig");
        value["deploymentMode"] = serde_json::json!("1p");
        std::fs::write(runtime, serde_json::to_vec(&value).unwrap()).unwrap();
        assert!(
            operations::status_for_unlocked(desktop::TARGET)
                .unwrap()
                .conflict
        );
        assert!(enable_direct(desktop::TARGET, connection(), None).is_err());
        assert!(operations::restore_agent_default_unlocked(desktop::TARGET, false).is_err());
        value["deploymentMode"] = serde_json::json!("3p");
        value["anotherNativePreference"] = serde_json::json!(42);
        std::fs::write(runtime, serde_json::to_vec(&value).unwrap()).unwrap();
        // Apply prepares these copies before committing the transaction. A
        // failed apply must not replace the committed ownership evidence.
        let manifest = manifest::read_manifest(desktop::TARGET).unwrap().unwrap();
        let runtime_target = manifest
            .target_files
            .iter()
            .find(|target| target.id == "desktop")
            .unwrap();
        std::fs::write(&runtime_target.managed_profile_path, b"uncommitted-copy").unwrap();
        assert!(
            !operations::status_for_unlocked(desktop::TARGET)
                .unwrap()
                .conflict
        );
        operations::restore_agent_default_unlocked(desktop::TARGET, false).unwrap();
        let restored: serde_json::Value =
            serde_json::from_slice(&std::fs::read(runtime).unwrap()).unwrap();
        assert_eq!(restored["nativePreference"]["keep"], true);
        assert_eq!(restored["anotherNativePreference"], 42);
        if original.is_some() {
            assert_eq!(restored["deploymentMode"], "1p");
            assert_eq!(restored["theme"], "dark");
        } else {
            assert!(restored.get("deploymentMode").is_none());
        }
    }
}

#[test]
fn malformed_or_unowned_configuration_and_unsupported_models_are_rejected() {
    for (id, raw) in [
        ("desktop", "[]"),
        ("desktop", "{secret"),
        ("catalog", r#"{"entries":{}}"#),
        ("profile", "{}"),
    ] {
        let error = desktop::generate(
            &BTreeMap::from([(id.into(), raw.into())]),
            &connection(),
            None,
        )
        .unwrap_err();
        assert!(!error.contains("{secret"));
    }
    let mut value = connection();
    value.model = "custom-model".into();
    assert!(desktop::generate(&BTreeMap::new(), &value, None).is_err());
    value.model = "claude-sonnet-5".into();
    value.desktop_auth_scheme = Some("unknown".into());
    assert!(desktop::generate(&BTreeMap::new(), &value, None).is_err());
}

#[cfg(any(target_os = "macos", windows))]
#[test]
fn desktop_and_cli_apply_restore_and_manifest_ownership_are_independent() {
    let _lock = TEST_ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(temp.path());
    let targets = desktop::targets().unwrap();
    let original = r#"{"mcpServers":{"keep":{}},"deploymentMode":"1p"}"#;
    std::fs::create_dir_all(targets[0].2.parent().unwrap()).unwrap();
    std::fs::write(&targets[0].2, original).unwrap();
    let mut cli_connection = connection();
    cli_connection.desktop_auth_scheme = None;
    let cli = enable_direct("claude_code", cli_connection, None).unwrap();
    let cli_path = &cli.target_files[0].target_path;
    let cli_bytes = std::fs::read(cli_path).unwrap();
    let cli_manifest = std::fs::read(manifest::manifest_path("claude_code")).unwrap();
    let expected = operations::status_for_unlocked(desktop::TARGET)
        .unwrap()
        .target_files
        .into_iter()
        .map(|file| (file.id, file.current_hash))
        .collect();
    let applied = enable_direct(desktop::TARGET, connection(), Some(&expected)).unwrap();
    assert_eq!(applied.target_files.len(), 4);
    assert_eq!(applied.mode, CliConfigMode::Direct);
    assert_eq!(std::fs::read(cli_path).unwrap(), cli_bytes);
    assert_eq!(
        std::fs::read(manifest::manifest_path("claude_code")).unwrap(),
        cli_manifest
    );
    let desktop_bytes: Vec<_> = targets
        .iter()
        .map(|(_, _, path)| std::fs::read(path).ok())
        .collect();
    operations::restore_agent_default_unlocked("claude_code", false).unwrap();
    for (index, (_, _, path)) in targets.iter().enumerate() {
        assert_eq!(std::fs::read(path).ok(), desktop_bytes[index]);
    }
    assert!(restore_managed_configs_for_shutdown()
        .unwrap()
        .restored_agents
        .is_empty());
    assert!(enable_orgii_managed(desktop::TARGET, None, None, None, false).is_err());
    assert!(managed_proxy_protocol_for_agent(desktop::TARGET).is_none());
    enable_direct(desktop::TARGET, connection(), None).unwrap();
    operations::restore_agent_default_unlocked(desktop::TARGET, false).unwrap();
    assert_eq!(std::fs::read_to_string(&targets[0].2).unwrap(), original);
    for (_, _, path) in targets.iter().skip(1) {
        assert!(!path.exists());
    }
}

#[cfg(any(target_os = "macos", windows))]
#[test]
fn stale_catalog_and_external_edit_block_apply_and_restore_without_partial_writes() {
    let _lock = TEST_ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(temp.path());
    let status = enable_direct(desktop::TARGET, connection(), None).unwrap();
    let before: Vec<_> = status
        .target_files
        .iter()
        .map(|file| std::fs::read(&file.target_path).ok())
        .collect();
    let catalog = status
        .target_files
        .iter()
        .find(|file| file.id == "catalog")
        .unwrap();
    std::fs::write(&catalog.target_path, r#"{"entries":[],"external":true}"#).unwrap();
    assert!(enable_direct(desktop::TARGET, connection(), None).is_err());
    assert!(operations::restore_agent_default_unlocked(desktop::TARGET, false).is_err());
    for (index, file) in status.target_files.iter().enumerate() {
        if file.id != "catalog" {
            assert_eq!(std::fs::read(&file.target_path).ok(), before[index]);
        }
    }
}

#[cfg(any(target_os = "macos", windows))]
#[test]
fn proxy_backed_desktop_profile_uses_helper_and_restores_it_atomically() {
    let _lock = TEST_ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(temp.path());
    let token = "ab".repeat(32);
    let helper_path = desktop::credential_helper_path();
    let mut value = connection();
    value.api_key.clear();
    value.model = "claude-sonnet-5-org2-11111111111111111111".into();
    value.desktop_auth_scheme = Some("bearer".into());
    value.base_url = proxy::claude_desktop_proxy_base_url(&proxy::managed_proxy_url(), &token);
    value.desktop_helper = Some(desktop::CredentialHelper {
        path: helper_path.clone(),
        token: token.clone(),
        models: vec![
            super::model_catalog::PickerModel {
                id: "claude-sonnet-5-org2-22222222222222222222".into(),
                label: "Overlap · Sonnet 5".into(),
                native_metadata: None,
            },
            super::model_catalog::PickerModel {
                id: value.model.clone(),
                label: "Beginner · Sonnet 5".into(),
                native_metadata: None,
            },
        ],
    });
    value.proxy_token = Some(token.clone());

    let status = enable_direct(desktop::TARGET, value, None).unwrap();
    assert_eq!(status.mode, CliConfigMode::OrgiiManaged);
    assert_eq!(status.selected_key_id.as_deref(), Some("desktop-key"));
    let profile = std::fs::read_to_string(
        status
            .target_files
            .iter()
            .find(|file| file.id == "profile")
            .unwrap()
            .target_path
            .as_str(),
    )
    .unwrap();
    let profile: serde_json::Value = serde_json::from_str(&profile).unwrap();
    assert_eq!(profile["inferenceCredentialKind"], "helper-script");
    assert_eq!(
        profile["inferenceModels"][0]["name"],
        "claude-sonnet-5-org2-11111111111111111111"
    );
    assert_eq!(
        profile["inferenceModels"][0]["labelOverride"],
        "Beginner · Sonnet 5"
    );
    assert_eq!(
        profile["inferenceModels"][1]["name"],
        "claude-sonnet-5-org2-22222222222222222222"
    );
    assert_eq!(
        profile["inferenceModels"][1]["labelOverride"],
        "Overlap · Sonnet 5"
    );
    assert_eq!(profile["inferenceGatewayAuthScheme"], "bearer");
    assert!(profile.get("inferenceGatewayApiKey").is_none());
    assert!(std::fs::read_to_string(&helper_path)
        .unwrap()
        .contains(&token));

    operations::restore_agent_default_unlocked(desktop::TARGET, false).unwrap();
    assert!(!helper_path.exists());
}

#[cfg(any(target_os = "macos", windows))]
#[test]
fn restored_legacy_target_does_not_block_the_current_desktop_schema() {
    let _lock = TEST_ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(temp.path());
    let current = desktop::targets().unwrap();
    std::fs::create_dir_all(current[0].2.parent().unwrap()).unwrap();
    std::fs::write(&current[0].2, "{}").unwrap();

    let mut targets = manifest::agent_manifest_targets(desktop::TARGET).unwrap();
    targets.push(test_target(
        "removed-runtime-config",
        &temp.path().join("Claude-3p/claude_desktop_config.json"),
        &temp.path().join("legacy-profile"),
    ));
    let mut stale = test_manifest(desktop::TARGET, targets);
    stale.mode = CliConfigMode::Default;
    manifest::write_manifest(&stale).unwrap();

    let applied = enable_direct(desktop::TARGET, connection(), None).unwrap();
    assert_eq!(applied.target_files.len(), current.len());
    assert!(applied
        .target_files
        .iter()
        .all(|target| target.id != "removed-runtime-config"));
}

#[cfg(any(target_os = "macos", windows))]
#[test]
fn explicit_direct_replacement_accepts_only_the_current_external_edit() {
    let _lock = TEST_ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(temp.path());
    let status = enable_direct(desktop::TARGET, connection(), None).unwrap();
    let catalog = status
        .target_files
        .iter()
        .find(|file| file.id == "catalog")
        .unwrap();
    std::fs::write(&catalog.target_path, r#"{"entries":[],"external":true}"#).unwrap();
    let expected: BTreeMap<_, _> = operations::status_for_unlocked(desktop::TARGET)
        .unwrap()
        .target_files
        .into_iter()
        .map(|file| (file.id, file.current_hash))
        .collect();
    let replaced = replace_direct(desktop::TARGET, connection(), &expected).unwrap();
    assert!(!replaced.conflict);
    assert_eq!(replaced.selected_key_id.as_deref(), Some("desktop-key"));

    let stale = expected;
    std::fs::write(
        &catalog.target_path,
        r#"{"entries":[],"changed-again":true}"#,
    )
    .unwrap();
    assert!(replace_direct(desktop::TARGET, connection(), &stale).is_err());
}

#[cfg(any(target_os = "macos", windows))]
#[test]
fn disconnect_restores_matching_direct_profile_but_preserves_new_selection() {
    let _lock = TEST_ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(temp.path());
    enable_direct(desktop::TARGET, connection(), None).unwrap();
    let untouched = restore_if_selected_matching(desktop::TARGET, |_| Ok(false)).unwrap();
    assert_eq!(untouched.mode, CliConfigMode::Direct);
    let restored =
        restore_if_selected_matching(desktop::TARGET, |key| Ok(key == "desktop-key")).unwrap();
    assert_eq!(restored.mode, CliConfigMode::Default);
}

#[test]
fn desktop_dynamic_catalog_accepts_gpt_alias_without_relaxing_direct_accounts() {
    let mut value = connection();
    let gpt = "gpt-6-astra-org2-11111111111111111111";
    value.model = gpt.into();
    assert!(
        direct::generate_direct_configs(desktop::TARGET, &BTreeMap::new(), &value, None)
            .unwrap_err()
            .contains("full Claude")
    );

    let token = "ab".repeat(32);
    value.api_key.clear();
    value.desktop_auth_scheme = Some("bearer".into());
    value.base_url = proxy::claude_desktop_proxy_base_url(&proxy::managed_proxy_url(), &token);
    value.proxy_token = Some(token.clone());
    value.desktop_helper = Some(desktop::CredentialHelper {
        path: std::env::temp_dir().join("org2-test-desktop-helper"),
        token,
        models: vec![
            model_catalog::PickerModel {
                id: "claude-fable-5-1-org2-11111111111111111111".into(),
                label: "AC · Fable 5.1".into(),
                native_metadata: None,
            },
            model_catalog::PickerModel {
                id: gpt.into(),
                label: "AC · GPT 6 Astra".into(),
                native_metadata: None,
            },
        ],
    });
    let generated =
        direct::generate_direct_configs(desktop::TARGET, &BTreeMap::new(), &value, None).unwrap();
    let profile: serde_json::Value = serde_json::from_str(&generated["profile"]).unwrap();
    assert_eq!(profile["inferenceModels"][0]["name"], gpt);
    assert_eq!(
        profile["inferenceModels"][0]["labelOverride"],
        "AC · GPT 6 Astra"
    );
    assert_eq!(profile["inferenceModels"].as_array().unwrap().len(), 2);
    assert_eq!(profile["inferenceCredentialKind"], "helper-script");
    assert!(profile.get("inferenceGatewayApiKey").is_none());

    for invalid in [String::new(), "gpt-model\nextra".into(), "x".repeat(257)] {
        value.desktop_helper.as_mut().unwrap().models[0].id = invalid;
        assert_eq!(
            direct::generate_direct_configs(desktop::TARGET, &BTreeMap::new(), &value, None)
                .unwrap_err(),
            "Invalid Desktop catalog model ID"
        );
    }
    value.desktop_helper.as_mut().unwrap().models[0].id = "claude-fable-5-1".into();
    value.proxy_token = Some("cd".repeat(32));
    assert_eq!(
        direct::generate_direct_configs(desktop::TARGET, &BTreeMap::new(), &value, None)
            .unwrap_err(),
        "Invalid Desktop credential helper configuration"
    );
}
