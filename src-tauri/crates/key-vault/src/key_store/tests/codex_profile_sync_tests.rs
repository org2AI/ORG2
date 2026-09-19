//! Sync-back of tokens the Codex CLI rotated inside its ORGII-managed profile,
//! for the cases the "vault unchanged since launch" guard cannot see: sessions
//! sharing a profile, and a run that died before its sync-back.

use base64::Engine;
use chrono::{Duration, Utc};
use core_types::providers::CODEX_REFRESH_TOKEN_ENV_KEY;
use tempfile::{tempdir, TempDir};

use crate::key_store::{
    AuthMethod, CliOAuthTokenSync, CliOAuthTokenSyncOutcome, KeyService, ModelKey, ModelType,
};

fn access_token(account_id: &str, expires_in: Duration) -> String {
    let payload = serde_json::json!({
        "exp": (Utc::now() + expires_in).timestamp(),
        "https://api.openai.com/auth": { "chatgpt_account_id": account_id },
    });
    let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload.to_string());
    format!("header.{encoded}.signature")
}

fn vault_holding(access_token: &str) -> (TempDir, KeyService, String) {
    let store_dir = tempdir().unwrap();
    let service = KeyService::new(Some(store_dir.path().to_path_buf()));
    let mut key = ModelKey::new(ModelType::Codex);
    key.auth_method = AuthMethod::Oauth;
    key.session_token = Some(access_token.to_string());
    key.env_vars.insert(
        CODEX_REFRESH_TOKEN_ENV_KEY.to_string(),
        "vault-refresh".to_string(),
    );
    let key_id = key.id.clone();
    service.save_key(key).unwrap();
    (store_dir, service, key_id)
}

fn cli_tokens(access_token: &str) -> CliOAuthTokenSync {
    CliOAuthTokenSync {
        access_token: Some(access_token.to_string()),
        refresh_token: Some("cli-refresh".to_string()),
        id_token: None,
        expires_at: None,
    }
}

fn stored_refresh_token(service: &KeyService, key_id: &str) -> Option<String> {
    service
        .get_key_by_id(key_id)
        .unwrap()
        .env_vars
        .get(CODEX_REFRESH_TOKEN_ENV_KEY)
        .cloned()
}

#[test]
fn a_sibling_sessions_later_rotation_reaches_the_vault() {
    // Session 1 already synced its rotation, so the vault no longer holds the
    // token session 2 launched with — but session 2 rotated again after that.
    let synced_by_session_one = access_token("acct-a", Duration::days(5));
    let (_store_dir, service, key_id) = vault_holding(&synced_by_session_one);
    let launched = access_token("acct-a", Duration::days(1));
    let rotated_by_session_two = access_token("acct-a", Duration::days(9));

    let outcome = service
        .sync_cli_oauth_tokens_if_current(
            &key_id,
            ModelType::Codex,
            Some(&launched),
            cli_tokens(&rotated_by_session_two),
        )
        .unwrap();

    assert!(matches!(outcome, CliOAuthTokenSyncOutcome::Updated(_)));
    assert_eq!(
        service
            .get_key_by_id(&key_id)
            .unwrap()
            .session_token
            .as_deref(),
        Some(rotated_by_session_two.as_str())
    );
    assert_eq!(
        stored_refresh_token(&service, &key_id).as_deref(),
        Some("cli-refresh")
    );
}

#[test]
fn a_vault_that_moved_ahead_of_the_cli_is_still_not_overwritten() {
    let refreshed_by_vault = access_token("acct-a", Duration::days(9));
    let (_store_dir, service, key_id) = vault_holding(&refreshed_by_vault);
    let launched = access_token("acct-a", Duration::days(1));

    let outcome = service
        .sync_cli_oauth_tokens_if_current(
            &key_id,
            ModelType::Codex,
            Some(&launched),
            cli_tokens(&launched),
        )
        .unwrap();

    assert!(matches!(
        outcome,
        CliOAuthTokenSyncOutcome::SkippedNewerKeyVaultToken
    ));
    assert_eq!(
        stored_refresh_token(&service, &key_id).as_deref(),
        Some("vault-refresh")
    );
}

#[test]
fn a_newer_token_of_another_account_never_replaces_the_vaults() {
    // The key was reconnected to another ChatGPT account mid-run.
    let reconnected = access_token("acct-b", Duration::days(5));
    let (_store_dir, service, key_id) = vault_holding(&reconnected);
    let launched = access_token("acct-a", Duration::days(1));

    let outcome = service
        .sync_cli_oauth_tokens_if_current(
            &key_id,
            ModelType::Codex,
            Some(&launched),
            cli_tokens(&access_token("acct-a", Duration::days(9))),
        )
        .unwrap();

    assert!(matches!(
        outcome,
        CliOAuthTokenSyncOutcome::SkippedNewerKeyVaultToken
    ));
    assert_eq!(
        service
            .get_key_by_id(&key_id)
            .unwrap()
            .session_token
            .as_deref(),
        Some(reconnected.as_str())
    );
}

#[test]
fn tokens_that_cannot_prove_their_age_fail_closed() {
    let (_store_dir, service, key_id) = vault_holding("opaque-vault-access");

    let outcome = service
        .sync_cli_oauth_tokens_if_current(
            &key_id,
            ModelType::Codex,
            Some("opaque-launched-access"),
            cli_tokens(&access_token("acct-a", Duration::days(9))),
        )
        .unwrap();

    assert!(matches!(
        outcome,
        CliOAuthTokenSyncOutcome::SkippedNewerKeyVaultToken
    ));
}

#[test]
fn pre_launch_reconcile_only_accepts_a_strictly_newer_profile() {
    let vault_access = access_token("acct-a", Duration::days(5));
    let (_store_dir, service, key_id) = vault_holding(&vault_access);

    // The profile still holds exactly what the vault seeded: nothing to take.
    let same = service
        .sync_cli_oauth_tokens_if_newer(&key_id, ModelType::Codex, cli_tokens(&vault_access))
        .unwrap();
    assert!(matches!(
        same,
        CliOAuthTokenSyncOutcome::SkippedNewerKeyVaultToken
    ));
    assert_eq!(
        stored_refresh_token(&service, &key_id).as_deref(),
        Some("vault-refresh"),
        "an unconditional pre-launch sync would have clobbered the vault here"
    );

    // A run died before its sync-back: the profile is ahead.
    let left_by_dead_run = access_token("acct-a", Duration::days(9));
    let newer = service
        .sync_cli_oauth_tokens_if_newer(&key_id, ModelType::Codex, cli_tokens(&left_by_dead_run))
        .unwrap();
    assert!(matches!(newer, CliOAuthTokenSyncOutcome::Updated(_)));
    assert_eq!(
        stored_refresh_token(&service, &key_id).as_deref(),
        Some("cli-refresh")
    );
}

#[test]
fn opaque_kiro_tokens_never_qualify_as_provably_newer() {
    let store_dir = tempdir().unwrap();
    let service = KeyService::new(Some(store_dir.path().to_path_buf()));
    let mut key = ModelKey::new(ModelType::Kiro);
    key.auth_method = AuthMethod::Oauth;
    key.session_token = Some("kiro-vault-access".to_string());
    let key_id = key.id.clone();
    service.save_key(key).unwrap();

    let outcome = service
        .sync_cli_oauth_tokens_if_newer(
            &key_id,
            ModelType::Kiro,
            CliOAuthTokenSync {
                access_token: Some("kiro-cli-access".to_string()),
                refresh_token: Some("kiro-cli-refresh".to_string()),
                id_token: None,
                expires_at: Some("2099-01-01T00:00:00Z".to_string()),
            },
        )
        .unwrap();

    assert!(matches!(
        outcome,
        CliOAuthTokenSyncOutcome::SkippedNewerKeyVaultToken
    ));
}
