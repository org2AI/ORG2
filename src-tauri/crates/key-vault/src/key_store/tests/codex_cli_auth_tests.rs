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
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "tmp"))
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

#[tokio::test]
async fn response_after_reconnect_cannot_replace_or_disable_the_new_login() {
    for status in ["200 OK", "401 Unauthorized"] {
        let key = codex_oauth_key("acct-a", "old-refresh");
        let rejected = key.session_token.clone().unwrap();
        let (_dir, service, key_id) = service_with(key);
        let service = std::sync::Arc::new(service);
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/token", listener.local_addr().unwrap());
        let server_service = service.clone();
        let server_id = key_id.clone();
        let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0; 8192];
            let received = stream.read(&mut buffer).unwrap();
            assert!(received > 0, "refresh request reached the fixture");
            let mut reconnected = server_service.get_key_by_id(&server_id).unwrap();
            reconnected.session_token = Some("new-user-access".into());
            reconnected.env_vars.insert(
                CODEX_REFRESH_TOKEN_ENV_KEY.into(),
                "new-user-refresh".into(),
            );
            server_service.save_key(reconnected).unwrap();
            let body = if status == "200 OK" {
                r#"{"access_token":"old-user-rotated","refresh_token":"old-rotated-refresh"}"#
            } else {
                REUSED_BODY
            };
            write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
        });
        let _ = service
            .refresh_codex_oauth_key_with(&key_id, &rejected, None, Some(url))
            .await;
        server.join().unwrap();
        let stored = service.get_key_by_id(&key_id).unwrap();
        assert_eq!(stored.session_token.as_deref(), Some("new-user-access"));
        assert_eq!(
            stored.env_vars[CODEX_REFRESH_TOKEN_ENV_KEY],
            "new-user-refresh"
        );
        assert!(stored.enabled);
        assert_eq!(stored.oauth_refresh_failure_count, 0);
        assert_eq!(stored.credential_generation, 1);
    }
}

#[test]
fn managed_codex_rotation_reaches_the_bound_source_and_preserves_a_new_local_login() {
    use crate::key_store::CliOAuthTokenSync;
    for source_changed in [false, true] {
        let cli_dir = tempdir().unwrap();
        let mut key = linked(codex_oauth_key("acct-a", "shared-refresh"));
        let launched = key.session_token.clone().unwrap();
        let path = write_cli_auth(&cli_dir, &launched, "shared-refresh");
        key.codex_cli_auth_path = Some(path.clone());
        let (_store, service, id) = service_with(key);
        if source_changed {
            write_cli_auth(&cli_dir, "local-new-login", "local-new-refresh");
        }
        let before = read_cli_auth(&path);
        service
            .sync_cli_oauth_tokens_for_generation(
                &id,
                ModelType::Codex,
                0,
                Some(&launched),
                CliOAuthTokenSync {
                    access_token: Some(jwt("acct-a", Duration::days(10), "managed")),
                    refresh_token: Some("managed-refresh".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(
            service.get_key_by_id(&id).unwrap().env_vars[CODEX_REFRESH_TOKEN_ENV_KEY],
            "managed-refresh"
        );
        if source_changed {
            assert_eq!(read_cli_auth(&path), before);
        } else {
            assert_eq!(
                read_cli_auth(&path)["tokens"]["refresh_token"],
                "managed-refresh"
            );
        }
        assert_eq!(
            service.get_key_by_id(&id).unwrap().codex_cli_auth_path,
            Some(path)
        );
    }
}

#[tokio::test]
async fn failed_source_writeback_is_retried_on_next_use_without_another_exchange() {
    let store = tempdir().unwrap();
    let service = KeyService::new(Some(store.path().into()));
    let source = tempdir().unwrap();
    let mut key = linked(codex_oauth_key("acct-a", "r0"));
    let auth_path = write_cli_auth(&source, key.session_token.as_deref().unwrap(), "r0");
    key.codex_cli_auth_path = Some(auth_path.clone());
    let key = service.save_key(key).unwrap();
    let lock = std::fs::File::create(auth_path.with_extension("orgii.lock")).unwrap();
    fs2::FileExt::try_lock_exclusive(&lock).unwrap();
    let fresh = jwt("acct-a", Duration::hours(4), "rotated");
    let (url, server) = serve_token_response(
        "200 OK",
        serde_json::json!({
            "access_token": fresh, "refresh_token": "r1"
        })
        .to_string(),
    );
    service
        .refresh_codex_oauth_key_with(
            &key.id,
            key.session_token.as_deref().unwrap(),
            Some(&auth_path),
            Some(url),
        )
        .await
        .unwrap();
    server.join().unwrap();
    assert_eq!(read_cli_auth(&auth_path)["tokens"]["refresh_token"], "r0");
    let saved = service.get_key_by_id(&key.id).unwrap();
    assert!(saved.codex_pending_source_token_hash.is_some());
    assert_eq!(saved.env_vars[CODEX_REFRESH_TOKEN_ENV_KEY], "r1");
    drop(lock);
    // Valid Vault token: ensure only retries the pending file write.
    service.ensure_codex_oauth_key_fresh(&key.id).await.unwrap();
    assert_eq!(read_cli_auth(&auth_path)["tokens"]["refresh_token"], "r1");
    assert!(service
        .get_key_by_id(&key.id)
        .unwrap()
        .codex_pending_source_token_hash
        .is_none());
}

#[tokio::test]
async fn duplicate_imports_share_one_refresh_exchange_and_adopt_the_writeback() {
    let store = tempdir().unwrap();
    let service = KeyService::new(Some(store.path().into()));
    let source = tempdir().unwrap();
    let mut first = linked(codex_oauth_key("acct-a", "r0"));
    let path = write_cli_auth(&source, first.session_token.as_deref().unwrap(), "r0");
    first.codex_cli_auth_path = Some(path.clone());
    let first = service.save_key(first).unwrap();
    let mut second = first.clone();
    second.id = uuid::Uuid::new_v4().to_string();
    let second = service.save_key(second).unwrap();
    let (url, server) = serve_token_response(
        "200 OK",
        serde_json::json!({
            "access_token": jwt("acct-a", Duration::hours(4), "rotated"), "refresh_token": "r1"
        })
        .to_string(),
    );
    let (a, b) = tokio::join!(
        service.refresh_codex_oauth_key_with(
            &first.id,
            first.session_token.as_deref().unwrap(),
            Some(&path),
            Some(url.clone())
        ),
        service.refresh_codex_oauth_key_with(
            &second.id,
            second.session_token.as_deref().unwrap(),
            Some(&path),
            Some(url)
        )
    );
    a.unwrap();
    b.unwrap();
    server.join().unwrap();
    for id in [&first.id, &second.id] {
        assert_eq!(
            service.get_key_by_id(id).unwrap().env_vars[CODEX_REFRESH_TOKEN_ENV_KEY],
            "r1"
        );
    }
}

#[tokio::test]
async fn mixed_native_account_id_and_token_identity_is_not_adopted() {
    let store = tempdir().unwrap();
    let service = KeyService::new(Some(store.path().into()));
    let source = tempdir().unwrap();
    let key = service
        .save_key(linked(codex_oauth_key("acct-a", "vault-refresh")))
        .unwrap();
    // Reproduces a native in-flight refresh completing after an account switch:
    // file account_id says A, access token belongs to B.
    let path = write_cli_auth(
        &source,
        &jwt("acct-b", Duration::hours(5), "other"),
        "other-refresh",
    );
    let before = service.get_key_by_id(&key.id).unwrap();
    let result = service
        .refresh_codex_oauth_key_with(
            &key.id,
            key.session_token.as_deref().unwrap(),
            Some(&path),
            Some(UNREACHABLE_TOKEN_URL.into()),
        )
        .await;
    assert!(result.is_err());
    assert_eq!(
        service.get_key_by_id(&key.id).unwrap().session_token,
        before.session_token
    );
}
