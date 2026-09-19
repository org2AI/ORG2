//! Guarded write-back of tokens a spawned `kiro-cli` rotated inside its
//! ORGII-managed profile. Every assertion on the stored shape is paired with
//! `get_env_for_agent`, because that is what seeds the next launch.

use crate::key_store::{
    AuthMethod, CliOAuthTokenSync, CliOAuthTokenSyncOutcome, HealthStatus, KeyService, ModelKey,
    ModelType,
};
use tempfile::tempdir;

fn service() -> (tempfile::TempDir, KeyService) {
    let temp_dir = tempdir().unwrap();
    let service = KeyService::new(Some(temp_dir.path().to_path_buf()));
    (temp_dir, service)
}

fn scanned_kiro_key() -> ModelKey {
    let mut key = ModelKey::new(ModelType::Kiro);
    key.auth_method = AuthMethod::Oauth;
    key.session_token = Some(
        serde_json::json!({
            "access_token": "aoa-launched",
            "refresh_token": "aor-launched",
            "expires_at": "2030-01-01T00:00:00Z",
            "region": "us-west-2",
            "start_url": "https://d-json.awsapps.com/start",
            "oauth_flow": "DeviceCode",
            "scopes": ["codewhisperer:completions"],
            "client_id": "client-json",
            "client_secret": "secret-json",
            "profile_arn": "arn:aws:unknown-field"
        })
        .to_string(),
    );
    key
}

fn rotated_tokens() -> CliOAuthTokenSync {
    CliOAuthTokenSync {
        access_token: Some("aoa-rotated".to_string()),
        refresh_token: Some("aor-rotated".to_string()),
        id_token: None,
        expires_at: Some("2030-01-01T01:00:00Z".to_string()),
    }
}

fn stored_token_json(service: &KeyService, key_id: &str) -> serde_json::Value {
    let stored = service.get_key_by_id(key_id).unwrap();
    serde_json::from_str(stored.session_token.as_deref().unwrap()).unwrap()
}

#[test]
fn kiro_sync_rotates_token_json_fields_and_preserves_the_rest() {
    let (_temp_dir, service) = service();
    let key = scanned_kiro_key();
    let key_id = key.id.clone();
    service.save_key(key).unwrap();

    let outcome = service
        .sync_cli_oauth_tokens_if_current(
            &key_id,
            ModelType::Kiro,
            Some("aoa-launched"),
            rotated_tokens(),
        )
        .unwrap();
    assert!(matches!(outcome, CliOAuthTokenSyncOutcome::Updated(_)));

    let token = stored_token_json(&service, &key_id);
    assert_eq!(token["access_token"], "aoa-rotated");
    assert_eq!(token["refresh_token"], "aor-rotated");
    assert_eq!(token["expires_at"], "2030-01-01T01:00:00Z");
    assert_eq!(token["region"], "us-west-2");
    assert_eq!(token["start_url"], "https://d-json.awsapps.com/start");
    assert_eq!(token["oauth_flow"], "DeviceCode");
    assert_eq!(token["scopes"][0], "codewhisperer:completions");
    assert_eq!(token["client_id"], "client-json");
    assert_eq!(token["client_secret"], "secret-json");
    assert_eq!(token["profile_arn"], "arn:aws:unknown-field");

    // The next launch must be seeded with the rotated pair, never the spent one.
    let env = service.get_env_for_agent(&ModelType::Kiro, Some(&key_id));
    assert_eq!(
        env.get("KIRO_ACCESS_TOKEN").map(String::as_str),
        Some("aoa-rotated")
    );
    assert_eq!(
        env.get("KIRO_REFRESH_TOKEN").map(String::as_str),
        Some("aor-rotated")
    );
    assert_eq!(
        env.get("KIRO_EXPIRES_AT").map(String::as_str),
        Some("2030-01-01T01:00:00Z")
    );
    assert_eq!(
        env.get("KIRO_CLIENT_ID").map(String::as_str),
        Some("client-json")
    );
    assert_eq!(
        env.get("KIRO_CLIENT_SECRET").map(String::as_str),
        Some("secret-json")
    );
}

#[test]
fn kiro_sync_does_not_overwrite_a_key_vault_token_changed_since_launch() {
    let (_temp_dir, service) = service();
    let key = scanned_kiro_key();
    let key_id = key.id.clone();
    service.save_key(key).unwrap();
    let before = service.get_key_by_id(&key_id).unwrap();

    // The vault was re-scanned / re-signed-in while the CLI was running, so
    // the launch held "aoa-older", not the "aoa-launched" now stored.
    let outcome = service
        .sync_cli_oauth_tokens_if_current(
            &key_id,
            ModelType::Kiro,
            Some("aoa-older"),
            rotated_tokens(),
        )
        .unwrap();

    assert!(matches!(
        outcome,
        CliOAuthTokenSyncOutcome::SkippedNewerKeyVaultToken
    ));
    let after = service.get_key_by_id(&key_id).unwrap();
    assert_eq!(after.session_token, before.session_token);
    assert_eq!(after.updated_at, before.updated_at);
}

#[test]
fn kiro_sync_rotates_the_sign_in_wizard_shape() {
    let (_temp_dir, service) = service();
    let mut key = ModelKey::new(ModelType::Kiro);
    key.auth_method = AuthMethod::Oauth;
    key.session_token = Some("aoa-launched".to_string());
    for (name, value) in [
        ("KIRO_ACCESS_TOKEN", "aoa-launched"),
        ("KIRO_REFRESH_TOKEN", "aor-launched"),
        ("KIRO_CLIENT_ID", "client-wizard"),
        ("KIRO_CLIENT_SECRET", "secret-wizard"),
        ("KIRO_REGION", "eu-west-1"),
    ] {
        key.env_vars.insert(name.to_string(), value.to_string());
    }
    let key_id = key.id.clone();
    service.save_key(key).unwrap();

    let outcome = service
        .sync_cli_oauth_tokens_if_current(
            &key_id,
            ModelType::Kiro,
            Some("aoa-launched"),
            rotated_tokens(),
        )
        .unwrap();
    assert!(matches!(outcome, CliOAuthTokenSyncOutcome::Updated(_)));

    let stored = service.get_key_by_id(&key_id).unwrap();
    assert_eq!(stored.session_token.as_deref(), Some("aoa-rotated"));
    assert_eq!(
        stored.env_vars.get("KIRO_ACCESS_TOKEN").map(String::as_str),
        Some("aoa-rotated")
    );
    assert_eq!(
        stored
            .env_vars
            .get("KIRO_CLIENT_SECRET")
            .map(String::as_str),
        Some("secret-wizard")
    );

    let env = service.get_env_for_agent(&ModelType::Kiro, Some(&key_id));
    assert_eq!(
        env.get("KIRO_ACCESS_TOKEN").map(String::as_str),
        Some("aoa-rotated")
    );
    assert_eq!(
        env.get("KIRO_REFRESH_TOKEN").map(String::as_str),
        Some("aor-rotated")
    );
    assert_eq!(
        env.get("KIRO_EXPIRES_AT").map(String::as_str),
        Some("2030-01-01T01:00:00Z")
    );
    assert_eq!(
        env.get("KIRO_REGION").map(String::as_str),
        Some("eu-west-1")
    );
}

#[test]
fn kiro_sync_guards_and_rotates_an_env_vars_only_key() {
    let (_temp_dir, service) = service();
    let mut key = ModelKey::new(ModelType::Kiro);
    key.auth_method = AuthMethod::Oauth;
    key.session_token = None;
    key.env_vars
        .insert("KIRO_ACCESS_TOKEN".to_string(), "aoa-launched".to_string());
    key.env_vars
        .insert("KIRO_REFRESH_TOKEN".to_string(), "aor-launched".to_string());
    let key_id = key.id.clone();
    service.save_key(key).unwrap();

    // The guard reads the access token from the env_vars mirror too.
    let skipped = service
        .sync_cli_oauth_tokens_if_current(
            &key_id,
            ModelType::Kiro,
            Some("aoa-older"),
            rotated_tokens(),
        )
        .unwrap();
    assert!(matches!(
        skipped,
        CliOAuthTokenSyncOutcome::SkippedNewerKeyVaultToken
    ));

    service
        .sync_cli_oauth_tokens_if_current(
            &key_id,
            ModelType::Kiro,
            Some("aoa-launched"),
            rotated_tokens(),
        )
        .unwrap();
    let stored = service.get_key_by_id(&key_id).unwrap();
    assert_eq!(stored.session_token, None, "stored shape must not change");
    let env = service.get_env_for_agent(&ModelType::Kiro, Some(&key_id));
    assert_eq!(
        env.get("KIRO_ACCESS_TOKEN").map(String::as_str),
        Some("aoa-rotated")
    );
    assert_eq!(
        env.get("KIRO_REFRESH_TOKEN").map(String::as_str),
        Some("aor-rotated")
    );
}

#[test]
fn kiro_sync_rotates_a_legacy_refresh_token_held_in_api_key() {
    // `agent_env_builder` lets an OAuth key's `api_key` override
    // KIRO_REFRESH_TOKEN, so leaving it behind would re-seed the spent token.
    let (_temp_dir, service) = service();
    let mut key = scanned_kiro_key();
    key.api_key = Some("aor-launched".to_string());
    let key_id = key.id.clone();
    service.save_key(key).unwrap();

    service
        .sync_cli_oauth_tokens_if_current(
            &key_id,
            ModelType::Kiro,
            Some("aoa-launched"),
            rotated_tokens(),
        )
        .unwrap();

    let env = service.get_env_for_agent(&ModelType::Kiro, Some(&key_id));
    assert_eq!(
        env.get("KIRO_REFRESH_TOKEN").map(String::as_str),
        Some("aor-rotated")
    );
}

#[test]
fn kiro_sync_with_unchanged_tokens_is_a_no_op() {
    let (_temp_dir, service) = service();
    let key = scanned_kiro_key();
    let key_id = key.id.clone();
    service.save_key(key).unwrap();
    let before = service.get_key_by_id(&key_id).unwrap();

    let outcome = service
        .sync_cli_oauth_tokens_if_current(
            &key_id,
            ModelType::Kiro,
            Some("aoa-launched"),
            CliOAuthTokenSync {
                access_token: Some("aoa-launched".to_string()),
                refresh_token: Some("aor-launched".to_string()),
                id_token: None,
                expires_at: None,
            },
        )
        .unwrap();

    assert!(matches!(outcome, CliOAuthTokenSyncOutcome::Updated(_)));
    let after = service.get_key_by_id(&key_id).unwrap();
    assert_eq!(after.session_token, before.session_token);
    assert_eq!(after.updated_at, before.updated_at);
}

#[test]
fn kiro_sync_is_not_applicable_to_api_key_accounts() {
    let (_temp_dir, service) = service();
    let mut key = ModelKey::new(ModelType::Kiro);
    key.api_key = Some("kiro-api-key".to_string());
    let key_id = key.id.clone();
    service.save_key(key).unwrap();

    let outcome = service
        .sync_cli_oauth_tokens_if_current(&key_id, ModelType::Kiro, None, rotated_tokens())
        .unwrap();

    assert!(matches!(outcome, CliOAuthTokenSyncOutcome::NotApplicable));
    let stored = service.get_key_by_id(&key_id).unwrap();
    assert_eq!(stored.api_key.as_deref(), Some("kiro-api-key"));
    assert_eq!(stored.session_token, None);
    assert!(stored.env_vars.is_empty());
}

#[test]
fn kiro_sync_refuses_a_malformed_token_json_without_mutating_it() {
    let (_temp_dir, service) = service();
    let mut key = ModelKey::new(ModelType::Kiro);
    key.auth_method = AuthMethod::Oauth;
    key.session_token = Some("{not json".to_string());
    let key_id = key.id.clone();
    service.save_key(key).unwrap();

    let error = service
        .sync_cli_oauth_tokens_if_current(&key_id, ModelType::Kiro, None, rotated_tokens())
        .unwrap_err();

    assert!(!error.contains("aoa-rotated") && !error.contains("aor-rotated"));
    let stored = service.get_key_by_id(&key_id).unwrap();
    assert_eq!(stored.session_token.as_deref(), Some("{not json"));
}

#[test]
fn kiro_sync_does_not_undo_a_manual_disable() {
    // Kiro never enters the refresh-failure auto-disable path, so a disabled
    // Kiro key is always the user's choice.
    let (_temp_dir, service) = service();
    let mut key = scanned_kiro_key();
    key.enabled = false;
    let key_id = key.id.clone();
    service.save_key(key).unwrap();

    service
        .sync_cli_oauth_tokens_if_current(
            &key_id,
            ModelType::Kiro,
            Some("aoa-launched"),
            rotated_tokens(),
        )
        .unwrap();

    let stored = service.get_key_by_id(&key_id).unwrap();
    assert!(!stored.enabled);
    assert_eq!(
        stored_token_json(&service, &key_id)["refresh_token"],
        "aor-rotated"
    );
}

#[test]
fn codex_sync_still_clears_refresh_failure_state_and_re_enables() {
    use core_types::providers::{CODEX_ID_TOKEN_ENV_KEY, CODEX_REFRESH_TOKEN_ENV_KEY};

    let (_temp_dir, service) = service();
    let mut key = ModelKey::new(ModelType::Codex);
    key.auth_method = AuthMethod::Oauth;
    key.session_token = Some("launched-access".to_string());
    key.env_vars.insert(
        CODEX_REFRESH_TOKEN_ENV_KEY.to_string(),
        "launched-refresh".to_string(),
    );
    let key_id = key.id.clone();
    service.save_key(key).unwrap();
    for _ in 0..8 {
        service
            .record_oauth_refresh_failure(&key_id, "invalid_grant: refresh token already used")
            .unwrap();
    }
    let failed = service.get_key_by_id(&key_id).unwrap();
    assert!(!failed.enabled);
    assert_eq!(failed.health_status, HealthStatus::Invalid);

    let outcome = service
        .sync_cli_oauth_tokens_if_current(
            &key_id,
            ModelType::Codex,
            Some("launched-access"),
            CliOAuthTokenSync {
                access_token: Some("cli-access".to_string()),
                refresh_token: Some("cli-refresh".to_string()),
                id_token: Some("cli-id".to_string()),
                expires_at: Some("2030-01-01T01:00:00Z".to_string()),
            },
        )
        .unwrap();
    assert!(matches!(outcome, CliOAuthTokenSyncOutcome::Updated(_)));

    let stored = service.get_key_by_id(&key_id).unwrap();
    assert_eq!(stored.session_token.as_deref(), Some("cli-access"));
    assert_eq!(
        stored
            .env_vars
            .get(CODEX_REFRESH_TOKEN_ENV_KEY)
            .map(String::as_str),
        Some("cli-refresh")
    );
    assert_eq!(
        stored
            .env_vars
            .get(CODEX_ID_TOKEN_ENV_KEY)
            .map(String::as_str),
        Some("cli-id")
    );
    assert!(stored.enabled);
    assert_eq!(stored.oauth_refresh_failure_count, 0);
    assert_eq!(stored.health_status, HealthStatus::Unknown);
    assert!(stored.temporary_unavailable_until.is_none());
    assert!(
        !stored.env_vars.contains_key("KIRO_EXPIRES_AT"),
        "expiry is a Kiro-only slot"
    );
}

#[test]
fn sync_not_applicable_leaves_the_key_untouched() {
    // A provider with no refresh-token slot used to get its session token
    // overwritten before the sync reported NotApplicable.
    let (_temp_dir, service) = service();
    let mut key = ModelKey::new(ModelType::ClaudeCode);
    key.auth_method = AuthMethod::Oauth;
    key.session_token = Some("launched-access".to_string());
    let key_id = key.id.clone();
    service.save_key(key).unwrap();

    let outcome = service
        .sync_cli_oauth_tokens_if_current(
            &key_id,
            ModelType::ClaudeCode,
            Some("launched-access"),
            rotated_tokens(),
        )
        .unwrap();

    assert!(matches!(outcome, CliOAuthTokenSyncOutcome::NotApplicable));
    let stored = service.get_key_by_id(&key_id).unwrap();
    assert_eq!(stored.session_token.as_deref(), Some("launched-access"));
}
