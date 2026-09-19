//! A Codex OAuth key imported from the Codex CLI shares the CLI's single-use
//! rotating refresh token. These tests pin the protocol that keeps the two
//! holders from invalidating each other.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::thread::{self, JoinHandle};

use base64::Engine;
use chrono::{Duration, Utc};
use core_types::providers::{CODEX_ID_TOKEN_ENV_KEY, CODEX_REFRESH_TOKEN_ENV_KEY};
use tempfile::{tempdir, TempDir};

use crate::key_store::{
    AuthMethod, HealthStatus, KeyService, ModelKey, ModelType, OAuthRefreshOutcome,
    ACCOUNT_SETUP_METHOD_AUTODETECT, ACCOUNT_SETUP_METHOD_METADATA_KEY,
};

/// Any request to this endpoint fails, so a test that must not reach the
/// network errors out if it does.
const UNREACHABLE_TOKEN_URL: &str = "http://127.0.0.1:1/token";

const REUSED_BODY: &str = r#"{"error":{"code":"refresh_token_reused","message":"Your refresh token has already been used to generate a new access token. Please try signing in again."}}"#;

fn jwt(account_id: &str, expires_in: Duration, marker: &str) -> String {
    let payload = serde_json::json!({
        "exp": (Utc::now() + expires_in).timestamp(),
        "jti": marker,
        "https://api.openai.com/auth": { "chatgpt_account_id": account_id },
    });
    let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload.to_string());
    format!("header.{encoded}.signature")
}

fn codex_oauth_key(account_id: &str, refresh_token: &str) -> ModelKey {
    let mut key = ModelKey::new(ModelType::Codex);
    key.auth_method = AuthMethod::Oauth;
    key.session_token = Some(jwt(account_id, Duration::hours(-1), "vault-expired"));
    key.env_vars.insert(
        CODEX_REFRESH_TOKEN_ENV_KEY.to_string(),
        refresh_token.to_string(),
    );
    key.env_vars.insert(
        CODEX_ID_TOKEN_ENV_KEY.to_string(),
        jwt(account_id, Duration::hours(-1), "vault-id"),
    );
    key
}

fn linked(mut key: ModelKey) -> ModelKey {
    key.account_metadata.insert(
        ACCOUNT_SETUP_METHOD_METADATA_KEY.to_string(),
        ACCOUNT_SETUP_METHOD_AUTODETECT.to_string(),
    );
    key
}

fn write_cli_auth(dir: &TempDir, access_token: &str, refresh_token: &str) -> PathBuf {
    let path = dir.path().join("auth.json");
    let body = serde_json::json!({
        "auth_mode": "chatgpt",
        "OPENAI_API_KEY": null,
        "tokens": {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "id_token": "cli-id-token",
            "account_id": "acct-a",
        },
        "last_refresh": "2026-01-01T00:00:00.000000Z",
    });
    std::fs::write(&path, serde_json::to_string_pretty(&body).unwrap()).unwrap();
    path
}

fn read_cli_auth(path: &Path) -> serde_json::Value {
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

/// One-shot token endpoint. Returns its URL and a handle yielding the request.
fn serve_token_response(status_line: &'static str, body: String) -> (String, JoinHandle<String>) {
    let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/token", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buffer = [0_u8; 8192];
        let bytes_read = stream.read(&mut buffer).unwrap();
        let request = String::from_utf8_lossy(&buffer[..bytes_read]).to_string();
        let response = format!(
            "HTTP/1.1 {status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream.write_all(response.as_bytes()).unwrap();
        request
    });
    (url, server)
}

fn service_with(key: ModelKey) -> (TempDir, KeyService, String) {
    let store_dir = tempdir().unwrap();
    let service = KeyService::new(Some(store_dir.path().to_path_buf()));
    let key_id = key.id.clone();
    service.save_key(key).unwrap();
    (store_dir, service, key_id)
}

#[tokio::test]
async fn linked_key_adopts_tokens_the_codex_cli_already_rotated() {
    let key = linked(codex_oauth_key("acct-a", "spent-refresh"));
    let rejected = key.session_token.clone().unwrap();
    let (_store_dir, service, key_id) = service_with(key);

    let cli_dir = tempdir().unwrap();
    let cli_access = jwt("acct-a", Duration::days(9), "cli-fresh");
    let cli_auth = write_cli_auth(&cli_dir, &cli_access, "cli-rotated-refresh");

    let outcome = service
        .refresh_codex_oauth_key_with(
            &key_id,
            &rejected,
            Some(&cli_auth),
            Some(UNREACHABLE_TOKEN_URL.to_string()),
        )
        .await
        .expect("the CLI's tokens replace the exchange");

    assert!(matches!(outcome, OAuthRefreshOutcome::AlreadyRotated(_)));
    let stored = service.get_key_by_id(&key_id).unwrap();
    assert_eq!(stored.session_token.as_deref(), Some(cli_access.as_str()));
    assert_eq!(
        stored
            .env_vars
            .get(CODEX_REFRESH_TOKEN_ENV_KEY)
            .map(String::as_str),
        Some("cli-rotated-refresh")
    );
    assert_eq!(
        stored
            .env_vars
            .get(CODEX_ID_TOKEN_ENV_KEY)
            .map(String::as_str),
        Some("cli-id-token")
    );
}

#[tokio::test]
async fn reused_refresh_token_recovers_from_the_codex_cli_login() {
    // Not recorded as linked and holding a different refresh token, so the
    // exchange runs — and reports the token spent.
    let key = codex_oauth_key("acct-a", "spent-refresh");
    let rejected = key.session_token.clone().unwrap();
    let (_store_dir, service, key_id) = service_with(key);

    let cli_dir = tempdir().unwrap();
    let cli_access = jwt("acct-a", Duration::days(9), "cli-fresh");
    let cli_auth = write_cli_auth(&cli_dir, &cli_access, "cli-rotated-refresh");
    let (token_url, server) = serve_token_response("401 Unauthorized", REUSED_BODY.to_string());

    let outcome = service
        .refresh_codex_oauth_key_with(&key_id, &rejected, Some(&cli_auth), Some(token_url))
        .await
        .expect("a spent refresh token recovers from the CLI login");
    assert!(server
        .join()
        .unwrap()
        .contains("refresh_token=spent-refresh"));

    assert!(matches!(outcome, OAuthRefreshOutcome::AlreadyRotated(_)));
    let stored = service.get_key_by_id(&key_id).unwrap();
    assert_eq!(stored.session_token.as_deref(), Some(cli_access.as_str()));
    assert!(stored.enabled);
    assert_eq!(stored.oauth_refresh_failure_count, 0);
    assert_ne!(stored.health_status, HealthStatus::Invalid);
    assert_eq!(
        stored
            .account_metadata
            .get(ACCOUNT_SETUP_METHOD_METADATA_KEY)
            .map(String::as_str),
        Some(ACCOUNT_SETUP_METHOD_AUTODETECT),
        "a key now living on the CLI's login is recorded as linked"
    );
}

#[tokio::test]
async fn reused_refresh_token_without_a_replacement_still_disables_the_key() {
    // The CLI file holds the very same spent token: nothing to adopt.
    let key = codex_oauth_key("acct-a", "spent-refresh");
    let rejected = key.session_token.clone().unwrap();
    let cli_dir = tempdir().unwrap();
    let cli_auth = write_cli_auth(&cli_dir, &rejected, "spent-refresh");
    let (_store_dir, service, key_id) = service_with(key);
    let (token_url, server) = serve_token_response("401 Unauthorized", REUSED_BODY.to_string());

    let error = service
        .refresh_codex_oauth_key_with(&key_id, &rejected, Some(&cli_auth), Some(token_url))
        .await
        .expect_err("no holder has a live token");
    server.join().unwrap();

    assert!(error.contains("refresh_token_reused"));
    let stored = service.get_key_by_id(&key_id).unwrap();
    assert!(!stored.enabled);
    assert_eq!(stored.health_status, HealthStatus::Invalid);
    assert_eq!(
        stored
            .account_metadata
            .get(ACCOUNT_SETUP_METHOD_METADATA_KEY)
            .map(String::as_str),
        Some(ACCOUNT_SETUP_METHOD_AUTODETECT),
        "sharing the CLI's refresh token proves a pre-marker key was scanned"
    );
    assert_eq!(
        read_cli_auth(&cli_auth)["tokens"]["refresh_token"],
        "spent-refresh"
    );
}

#[tokio::test]
async fn another_accounts_codex_cli_login_is_never_adopted() {
    let key = linked(codex_oauth_key("acct-b", "spent-refresh"));
    let rejected = key.session_token.clone().unwrap();
    let (_store_dir, service, key_id) = service_with(key);

    let cli_dir = tempdir().unwrap();
    let cli_access = jwt("acct-a", Duration::days(9), "cli-fresh");
    let cli_auth = write_cli_auth(&cli_dir, &cli_access, "cli-rotated-refresh");
    let (token_url, server) = serve_token_response("401 Unauthorized", REUSED_BODY.to_string());

    service
        .refresh_codex_oauth_key_with(&key_id, &rejected, Some(&cli_auth), Some(token_url))
        .await
        .expect_err("a different ChatGPT account is not a replacement");
    server.join().unwrap();

    let stored = service.get_key_by_id(&key_id).unwrap();
    assert_eq!(stored.session_token.as_deref(), Some(rejected.as_str()));
    assert!(!stored.enabled);
}

#[tokio::test]
async fn an_expired_codex_cli_token_is_not_adopted() {
    let key = linked(codex_oauth_key("acct-a", "shared-refresh"));
    let rejected = key.session_token.clone().unwrap();
    let (_store_dir, service, key_id) = service_with(key);

    let cli_dir = tempdir().unwrap();
    let cli_expired = jwt("acct-a", Duration::minutes(-5), "cli-expired");
    let cli_auth = write_cli_auth(&cli_dir, &cli_expired, "shared-refresh");
    let fresh_access = jwt("acct-a", Duration::days(10), "vault-fresh");
    let body = serde_json::json!({
        "access_token": fresh_access,
        "refresh_token": "vault-rotated-refresh",
        "id_token": "vault-rotated-id",
    });
    let (token_url, server) = serve_token_response("200 OK", body.to_string());

    let outcome = service
        .refresh_codex_oauth_key_with(&key_id, &rejected, Some(&cli_auth), Some(token_url))
        .await
        .unwrap();
    server.join().unwrap();

    assert!(matches!(outcome, OAuthRefreshOutcome::Refreshed(_)));
}

#[tokio::test]
async fn vault_refresh_hands_rotated_tokens_back_to_the_codex_cli() {
    let key = linked(codex_oauth_key("acct-a", "shared-refresh"));
    let rejected = key.session_token.clone().unwrap();
    let (_store_dir, service, key_id) = service_with(key);

    let cli_dir = tempdir().unwrap();
    let cli_auth = write_cli_auth(&cli_dir, &rejected, "shared-refresh");
    let fresh_access = jwt("acct-a", Duration::days(10), "vault-fresh");
    let body = serde_json::json!({
        "access_token": fresh_access,
        "refresh_token": "vault-rotated-refresh",
        "id_token": "vault-rotated-id",
    });
    let (token_url, server) = serve_token_response("200 OK", body.to_string());

    let outcome = service
        .refresh_codex_oauth_key_with(&key_id, &rejected, Some(&cli_auth), Some(token_url))
        .await
        .unwrap();
    server.join().unwrap();
    assert!(matches!(outcome, OAuthRefreshOutcome::Refreshed(_)));

    let written = read_cli_auth(&cli_auth);
    assert_eq!(written["tokens"]["access_token"], fresh_access.as_str());
    assert_eq!(written["tokens"]["refresh_token"], "vault-rotated-refresh");
    assert_eq!(written["tokens"]["id_token"], "vault-rotated-id");
    assert_eq!(written["tokens"]["account_id"], "acct-a");
    assert_eq!(written["auth_mode"], "chatgpt");
    assert!(written["OPENAI_API_KEY"].is_null());
    assert_ne!(written["last_refresh"], "2026-01-01T00:00:00.000000Z");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&cli_auth).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }
    let leftovers: Vec<_> = std::fs::read_dir(cli_dir.path())
        .unwrap()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_name() != "auth.json")
        .collect();
    assert!(leftovers.is_empty(), "no temp file is left behind");
}

#[tokio::test]
async fn a_key_with_its_own_login_never_touches_the_codex_cli_file() {
    // Signed in through the vault: a separate grant for the same account.
    let key = codex_oauth_key("acct-a", "vault-own-refresh");
    let rejected = key.session_token.clone().unwrap();
    let (_store_dir, service, key_id) = service_with(key);

    let cli_dir = tempdir().unwrap();
    let cli_access = jwt("acct-a", Duration::days(9), "cli-fresh");
    let cli_auth = write_cli_auth(&cli_dir, &cli_access, "cli-own-refresh");
    let before = std::fs::read_to_string(&cli_auth).unwrap();
    let fresh_access = jwt("acct-a", Duration::days(10), "vault-fresh");
    let body = serde_json::json!({
        "access_token": fresh_access,
        "refresh_token": "vault-rotated-refresh",
    });
    let (token_url, server) = serve_token_response("200 OK", body.to_string());

    let outcome = service
        .refresh_codex_oauth_key_with(&key_id, &rejected, Some(&cli_auth), Some(token_url))
        .await
        .unwrap();
    assert!(server
        .join()
        .unwrap()
        .contains("refresh_token=vault-own-refresh"));

    assert!(matches!(outcome, OAuthRefreshOutcome::Refreshed(_)));
    let stored = service.get_key_by_id(&key_id).unwrap();
    assert_eq!(stored.session_token.as_deref(), Some(fresh_access.as_str()));
    assert!(!stored
        .account_metadata
        .contains_key(ACCOUNT_SETUP_METHOD_METADATA_KEY));
    assert_eq!(std::fs::read_to_string(&cli_auth).unwrap(), before);
}
