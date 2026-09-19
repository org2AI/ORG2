//! Read-back, sync-back and seed precedence for own-key Kiro profiles.
//!
//! Everything runs against temp dirs and a temp-dir `KeyService`; the fake
//! "kiro-cli rotation" is a direct rewrite of the profile's token record.

use std::collections::HashMap;
use std::path::Path;

use key_vault::key_store::{AuthMethod, CliOAuthTokenSyncOutcome, KeyService, ModelKey, ModelType};
use rusqlite::params;

use super::super::proxy_auth::{kiro_sqlite_relative_path, setup_own_key_home, KIRO_TOKEN_KEY};
use super::*;

fn vault_service() -> (tempfile::TempDir, KeyService) {
    let temp_dir = tempfile::tempdir().unwrap();
    let service = KeyService::new(Some(temp_dir.path().to_path_buf()));
    (temp_dir, service)
}

fn save_scanned_kiro_key(service: &KeyService, access_token: &str, refresh_token: &str) -> String {
    let mut key = ModelKey::new(ModelType::Kiro);
    key.auth_method = AuthMethod::Oauth;
    key.session_token = Some(
        serde_json::json!({
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_at": "2030-01-01T00:00:00Z",
            "region": "us-west-2",
            "start_url": "https://d-test.awsapps.com/start",
            "client_id": "client-test",
            "client_secret": "secret-test"
        })
        .to_string(),
    );
    let key_id = key.id.clone();
    service.save_key(key).unwrap();
    key_id
}

fn launch_env(service: &KeyService, key_id: &str) -> HashMap<String, String> {
    service.get_env_for_agent(&ModelType::Kiro, Some(key_id))
}

fn oauth_env(access_token: &str, refresh_token: &str) -> HashMap<String, String> {
    HashMap::from([
        ("KIRO_ACCESS_TOKEN".to_string(), access_token.to_string()),
        ("KIRO_REFRESH_TOKEN".to_string(), refresh_token.to_string()),
        (
            "KIRO_EXPIRES_AT".to_string(),
            "2030-01-01T00:00:00Z".to_string(),
        ),
    ])
}

fn write_profile_token_record(profile_home: &Path, value: &str) {
    let conn = rusqlite::Connection::open(profile_home.join(kiro_sqlite_relative_path())).unwrap();
    conn.execute(
        "INSERT OR REPLACE INTO auth_kv (key, value) VALUES (?1, ?2)",
        params![KIRO_TOKEN_KEY, value],
    )
    .unwrap();
}

/// What `kiro-cli` does on refresh: replace the token record in its own store.
fn kiro_cli_rotates(profile_home: &Path, access_token: &str, refresh_token: &str) {
    write_profile_token_record(
        profile_home,
        &serde_json::json!({
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_at": "2030-01-01T01:00:00Z",
            "region": "us-west-2",
            "start_url": "https://d-test.awsapps.com/start",
            "oauth_flow": "DeviceCode"
        })
        .to_string(),
    );
}

fn profile_pair(profile_home: &Path) -> (String, Option<String>) {
    let tokens = read_profile_tokens(profile_home).expect("profile tokens");
    (tokens.access_token, tokens.refresh_token)
}

fn pair(access_token: &str, refresh_token: &str) -> (String, Option<String>) {
    (access_token.to_string(), Some(refresh_token.to_string()))
}

#[test]
fn read_back_is_a_silent_none_without_a_database_or_token_row() {
    let profile = tempfile::tempdir().unwrap();
    assert!(read_profile_tokens(profile.path()).is_none());

    setup_own_key_home(profile.path(), &oauth_env("aoa-1", "aor-1")).unwrap();
    let conn =
        rusqlite::Connection::open(profile.path().join(kiro_sqlite_relative_path())).unwrap();
    conn.execute(
        "DELETE FROM auth_kv WHERE key = ?1",
        params![KIRO_TOKEN_KEY],
    )
    .unwrap();
    drop(conn);
    assert!(read_profile_tokens(profile.path()).is_none());
}

#[test]
fn read_back_ignores_a_malformed_token_record() {
    let profile = tempfile::tempdir().unwrap();
    setup_own_key_home(profile.path(), &oauth_env("aoa-1", "aor-1")).unwrap();

    write_profile_token_record(profile.path(), "{not json");
    assert!(read_profile_tokens(profile.path()).is_none());

    write_profile_token_record(profile.path(), r#"{"refresh_token":"aor-only"}"#);
    assert!(read_profile_tokens(profile.path()).is_none());
}

#[test]
fn read_back_maps_seed_placeholders_to_absent() {
    let profile = tempfile::tempdir().unwrap();
    let env = HashMap::from([("KIRO_ACCESS_TOKEN".to_string(), "aoa-only".to_string())]);
    setup_own_key_home(profile.path(), &env).unwrap();

    let tokens = read_profile_tokens(profile.path()).unwrap();
    assert_eq!(tokens.access_token, "aoa-only");
    assert_eq!(tokens.refresh_token, None);
    assert_eq!(tokens.expires_at, None);
}

#[test]
fn seed_keeps_tokens_kiro_cli_rotated_while_the_vault_is_unchanged() {
    // A run that died before its sync-back: the vault still holds the spent
    // pair, the profile holds the live one.
    let profile = tempfile::tempdir().unwrap();
    let vault_env = oauth_env("aoa-1", "aor-1");
    setup_own_key_home(profile.path(), &vault_env).unwrap();
    kiro_cli_rotates(profile.path(), "aoa-2", "aor-2");

    setup_own_key_home(profile.path(), &vault_env).unwrap();

    assert_eq!(profile_pair(profile.path()), pair("aoa-2", "aor-2"));
}

#[test]
fn seed_overwrites_the_profile_once_the_vault_changes() {
    // Re-scan / re-sign-in: the vault is the newer side even though the
    // profile also moved since the last seed.
    let profile = tempfile::tempdir().unwrap();
    setup_own_key_home(profile.path(), &oauth_env("aoa-1", "aor-1")).unwrap();
    kiro_cli_rotates(profile.path(), "aoa-2", "aor-2");

    setup_own_key_home(profile.path(), &oauth_env("aoa-relogin", "aor-relogin")).unwrap();

    assert_eq!(
        profile_pair(profile.path()),
        pair("aoa-relogin", "aor-relogin")
    );
}

#[test]
fn seed_without_an_agreement_marker_falls_back_to_the_vault() {
    // Profiles seeded before the marker existed keep the old behaviour.
    let profile = tempfile::tempdir().unwrap();
    let vault_env = oauth_env("aoa-1", "aor-1");
    setup_own_key_home(profile.path(), &vault_env).unwrap();
    std::fs::remove_file(profile.path().join(VAULT_AGREEMENT_MARKER_FILE)).unwrap();
    kiro_cli_rotates(profile.path(), "aoa-2", "aor-2");

    setup_own_key_home(profile.path(), &vault_env).unwrap();

    assert_eq!(profile_pair(profile.path()), pair("aoa-1", "aor-1"));
}

#[test]
fn agreement_marker_never_contains_a_token() {
    let profile = tempfile::tempdir().unwrap();
    setup_own_key_home(profile.path(), &oauth_env("aoa-secret", "aor-secret")).unwrap();

    let marker = std::fs::read_to_string(profile.path().join(VAULT_AGREEMENT_MARKER_FILE)).unwrap();
    assert_eq!(marker.len(), 64);
    assert!(marker.chars().all(|c| c.is_ascii_hexdigit()));
    assert!(!marker.contains("secret"));
}

#[test]
fn sync_back_stores_rotated_tokens_so_the_next_launch_seeds_live_ones() {
    let (_vault_dir, service) = vault_service();
    let key_id = save_scanned_kiro_key(&service, "aoa-1", "aor-1");
    let profile = tempfile::tempdir().unwrap();

    let launched = launch_env(&service, &key_id);
    setup_own_key_home(profile.path(), &launched).unwrap();
    kiro_cli_rotates(profile.path(), "aoa-2", "aor-2");

    let outcome = sync_profile_tokens_to_key_vault(
        &service,
        profile.path(),
        &key_id,
        launched.get("KIRO_ACCESS_TOKEN").map(String::as_str),
    )
    .unwrap();
    assert!(matches!(
        outcome,
        Some(CliOAuthTokenSyncOutcome::Updated(_))
    ));

    let next_launch = launch_env(&service, &key_id);
    assert_eq!(next_launch["KIRO_ACCESS_TOKEN"], "aoa-2");
    assert_eq!(next_launch["KIRO_REFRESH_TOKEN"], "aor-2");
    assert_eq!(next_launch["KIRO_EXPIRES_AT"], "2030-01-01T01:00:00Z");
    assert_eq!(next_launch["KIRO_CLIENT_ID"], "client-test");
    assert_eq!(next_launch["KIRO_CLIENT_SECRET"], "secret-test");

    setup_own_key_home(profile.path(), &next_launch).unwrap();
    assert_eq!(profile_pair(profile.path()), pair("aoa-2", "aor-2"));
}

#[test]
fn sync_back_skipped_behind_a_sibling_session_is_healed_by_the_next_launch() {
    // Two sessions share the account profile. The first to finish syncs; the
    // second is refused by the launched-token guard even though the profile
    // has rotated again. The next launch must keep the profile and sync it.
    let (_vault_dir, service) = vault_service();
    let key_id = save_scanned_kiro_key(&service, "aoa-1", "aor-1");
    let profile = tempfile::tempdir().unwrap();
    let launched = launch_env(&service, &key_id);
    setup_own_key_home(profile.path(), &launched).unwrap();

    kiro_cli_rotates(profile.path(), "aoa-2", "aor-2");
    sync_profile_tokens_to_key_vault(&service, profile.path(), &key_id, Some("aoa-1")).unwrap();
    kiro_cli_rotates(profile.path(), "aoa-3", "aor-3");
    let second =
        sync_profile_tokens_to_key_vault(&service, profile.path(), &key_id, Some("aoa-1")).unwrap();
    assert!(matches!(
        second,
        Some(CliOAuthTokenSyncOutcome::SkippedNewerKeyVaultToken)
    ));
    assert_eq!(launch_env(&service, &key_id)["KIRO_REFRESH_TOKEN"], "aor-2");

    let next_launch = launch_env(&service, &key_id);
    setup_own_key_home(profile.path(), &next_launch).unwrap();
    assert_eq!(profile_pair(profile.path()), pair("aoa-3", "aor-3"));

    sync_profile_tokens_to_key_vault(
        &service,
        profile.path(),
        &key_id,
        next_launch.get("KIRO_ACCESS_TOKEN").map(String::as_str),
    )
    .unwrap();
    assert_eq!(launch_env(&service, &key_id)["KIRO_REFRESH_TOKEN"], "aor-3");
}

#[test]
fn sync_back_yields_to_a_vault_token_changed_during_the_run() {
    let (_vault_dir, service) = vault_service();
    let key_id = save_scanned_kiro_key(&service, "aoa-1", "aor-1");
    let profile = tempfile::tempdir().unwrap();
    setup_own_key_home(profile.path(), &launch_env(&service, &key_id)).unwrap();
    kiro_cli_rotates(profile.path(), "aoa-2", "aor-2");

    // The user signs in again while the CLI is still running.
    let mut relogin = service.get_key_by_id(&key_id).unwrap();
    relogin.session_token = Some(
        serde_json::json!({"access_token": "aoa-relogin", "refresh_token": "aor-relogin"})
            .to_string(),
    );
    service.save_key(relogin).unwrap();

    let outcome =
        sync_profile_tokens_to_key_vault(&service, profile.path(), &key_id, Some("aoa-1")).unwrap();
    assert!(matches!(
        outcome,
        Some(CliOAuthTokenSyncOutcome::SkippedNewerKeyVaultToken)
    ));

    let next_launch = launch_env(&service, &key_id);
    assert_eq!(next_launch["KIRO_REFRESH_TOKEN"], "aor-relogin");
    setup_own_key_home(profile.path(), &next_launch).unwrap();
    assert_eq!(
        profile_pair(profile.path()),
        pair("aoa-relogin", "aor-relogin")
    );
}

#[test]
fn sync_back_without_a_profile_store_is_a_silent_no_op() {
    let (_vault_dir, service) = vault_service();
    let key_id = save_scanned_kiro_key(&service, "aoa-1", "aor-1");
    let profile = tempfile::tempdir().unwrap();
    let before = service.get_key_by_id(&key_id).unwrap();

    let outcome =
        sync_profile_tokens_to_key_vault(&service, profile.path(), &key_id, Some("aoa-1")).unwrap();

    assert!(outcome.is_none());
    let after = service.get_key_by_id(&key_id).unwrap();
    assert_eq!(after.session_token, before.session_token);
    assert_eq!(after.updated_at, before.updated_at);
}

#[test]
fn sync_back_never_writes_seed_placeholders_into_the_vault() {
    let (_vault_dir, service) = vault_service();
    let mut key = ModelKey::new(ModelType::Kiro);
    key.auth_method = AuthMethod::Oauth;
    key.session_token = Some("aoa-only".to_string());
    let key_id = key.id.clone();
    service.save_key(key).unwrap();
    let profile = tempfile::tempdir().unwrap();
    let launched = launch_env(&service, &key_id);
    setup_own_key_home(profile.path(), &launched).unwrap();

    sync_profile_tokens_to_key_vault(&service, profile.path(), &key_id, Some("aoa-only")).unwrap();

    let stored = service.get_key_by_id(&key_id).unwrap();
    assert_eq!(stored.session_token.as_deref(), Some("aoa-only"));
    assert!(!stored.env_vars.contains_key("KIRO_REFRESH_TOKEN"));
    assert!(!stored.env_vars.contains_key("KIRO_EXPIRES_AT"));
}
