use crate::key_store::{
    AuthMethod, CliOAuthTokenSync, CliOAuthTokenSyncOutcome, KeyService, ModelKey, ModelType,
};
use core_types::providers::CODEX_REFRESH_TOKEN_ENV_KEY;

#[test]
fn generation_changes_on_reconnect_but_not_rotation_or_metadata() {
    let dir = tempfile::tempdir().unwrap();
    let service = KeyService::new(Some(dir.path().into()));
    let mut key = ModelKey::new(ModelType::Codex);
    key.auth_method = AuthMethod::Oauth;
    key.session_token = Some("initial-access".into());
    key.env_vars
        .insert(CODEX_REFRESH_TOKEN_ENV_KEY.into(), "initial-refresh".into());
    let key = service.save_key(key).unwrap();
    let mut renamed = key.clone();
    renamed.name = Some("Renamed".into());
    assert_eq!(service.save_key(renamed).unwrap().credential_generation, 0);
    service
        .sync_cli_oauth_tokens_for_generation(
            &key.id,
            ModelType::Codex,
            0,
            Some("initial-access"),
            CliOAuthTokenSync {
                access_token: Some("rotated-access".into()),
                refresh_token: Some("rotated-refresh".into()),
                ..Default::default()
            },
        )
        .unwrap();
    let mut current = service.get_key_by_id(&key.id).unwrap();
    assert_eq!(current.credential_generation, 0);
    current.session_token = Some("reconnected-access".into());
    let reconnected = service.save_key(current).unwrap();
    assert_eq!(reconnected.credential_generation, 1);
    assert!(matches!(
        service
            .sync_cli_oauth_tokens_for_generation(
                &key.id,
                ModelType::Codex,
                0,
                None,
                CliOAuthTokenSync {
                    access_token: Some("stale-access".into()),
                    ..Default::default()
                }
            )
            .unwrap(),
        CliOAuthTokenSyncOutcome::SkippedNewerKeyVaultToken
    ));
    service
        .record_oauth_refresh_failure_if_current(&key, "invalid_grant")
        .unwrap();
    let stored = service.get_key_by_id(&key.id).unwrap();
    assert_eq!(stored.session_token, reconnected.session_token);
    assert_eq!(stored.oauth_refresh_failure_count, 0);
}

#[test]
fn recovery_only_reenables_accounts_disabled_by_refresh_failure() {
    for manually_disabled in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let service = KeyService::new(Some(dir.path().into()));
        let mut key = ModelKey::new(ModelType::Codex);
        key.auth_method = AuthMethod::Oauth;
        key.session_token = Some("access".into());
        key.enabled = !manually_disabled;
        let key = service.save_key(key).unwrap();
        service
            .record_oauth_refresh_failure_if_current(&key, "invalid_grant")
            .unwrap();
        let failed = service.get_key_by_id(&key.id).unwrap();
        assert!(!failed.enabled);
        assert_eq!(failed.oauth_auto_disabled, !manually_disabled);
        service
            .sync_cli_oauth_tokens_for_generation(
                &key.id,
                ModelType::Codex,
                0,
                Some("access"),
                CliOAuthTokenSync {
                    access_token: Some("fresh".into()),
                    refresh_token: Some("fresh-refresh".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        let recovered = service.get_key_by_id(&key.id).unwrap();
        assert_eq!(recovered.enabled, !manually_disabled);
        assert!(!recovered.oauth_auto_disabled);
    }
}

#[test]
fn launch_environment_is_derived_from_the_selected_credential_snapshot() {
    let dir = tempfile::tempdir().unwrap();
    let service = KeyService::new(Some(dir.path().into()));
    let mut key = ModelKey::new(ModelType::Kiro);
    key.auth_method = AuthMethod::Oauth;
    key.session_token = Some("old-access".into());
    let snapshot = service.save_key(key).unwrap();
    let mut new_login = snapshot.clone();
    new_login.session_token = Some("new-access".into());
    let current = service.save_key(new_login).unwrap();
    assert_eq!(
        KeyService::env_for_key(&ModelType::Kiro, &snapshot)["KIRO_ACCESS_TOKEN"],
        "old-access"
    );
    assert_eq!(
        service.get_env_for_agent(&ModelType::Kiro, Some(&snapshot.id))["KIRO_ACCESS_TOKEN"],
        "new-access"
    );
    assert!(!current.matches_oauth_snapshot(&snapshot));
}
