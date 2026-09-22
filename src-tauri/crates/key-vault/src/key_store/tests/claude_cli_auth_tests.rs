//! A Claude Code OAuth account copied from the Claude Code CLI shares the
//! CLI's single-use rotating refresh token. These tests pin how the vault
//! recovers from the CLI's login — and when it must leave that login alone.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

use chrono::{Duration, Utc};
use tempfile::{tempdir, TempDir};

use crate::auto_detect::LocalClaudeCodeLogin;
use crate::key_store::service::ClaudeCliLoginSource;
use crate::key_store::{
    AuthMethod, HealthStatus, KeyService, ModelKey, ModelType, OAuthRefreshOutcome,
    ACCOUNT_SETUP_METHOD_AUTODETECT, ACCOUNT_SETUP_METHOD_METADATA_KEY,
};

const REFRESH_TOKEN_ENV: &str = "CLAUDE_CODE_REFRESH_TOKEN";
const EXPIRES_AT_ENV: &str = "CLAUDE_CODE_EXPIRES_AT";

/// Any request to this endpoint fails, so a test that must not reach the
/// network errors out if it does.
const UNREACHABLE_URL: &str = "http://127.0.0.1:1/unreachable";

const INVALID_GRANT_BODY: &str =
    r#"{"error":"invalid_grant","error_description":"Refresh token not found or invalid"}"#;

fn claude_oauth_key(setup_method: Option<&str>) -> ModelKey {
    let mut key = ModelKey::new(ModelType::ClaudeCode);
    key.auth_method = AuthMethod::Oauth;
    key.session_token = Some("vault-expired-access".to_string());
    key.env_vars
        .insert(REFRESH_TOKEN_ENV.to_string(), "spent-refresh".to_string());
    key.env_vars.insert(
        EXPIRES_AT_ENV.to_string(),
        (Utc::now() - Duration::hours(1))
            .timestamp_millis()
            .to_string(),
    );
    key.account_metadata
        .insert("organization_uuid".to_string(), "org-a".to_string());
    key.account_metadata
        .insert("email".to_string(), "user@example.invalid".to_string());
    if let Some(method) = setup_method {
        key.account_metadata.insert(
            ACCOUNT_SETUP_METHOD_METADATA_KEY.to_string(),
            method.to_string(),
        );
    }
    key
}

fn cli_login(expires_in: Duration) -> LocalClaudeCodeLogin {
    LocalClaudeCodeLogin {
        access_token: "cli-fresh-access".to_string(),
        refresh_token: Some("cli-rotated-refresh".to_string()),
        expires_at_millis: Some((Utc::now() + expires_in).timestamp_millis()),
    }
}

fn profile_body(organization_uuid: &str) -> String {
    serde_json::json!({
        "account": { "email": "user@example.invalid" },
        "organization": { "uuid": organization_uuid, "name": "Org" },
    })
    .to_string()
}

/// One-shot HTTP endpoint. Returns its URL and a handle yielding the request.
fn serve_once(status_line: &'static str, body: String) -> (String, JoinHandle<String>) {
    let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/endpoint", listener.local_addr().unwrap());
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

/// A CLI login source that counts how often the credential store is read.
fn counting_source(
    login: Option<LocalClaudeCodeLogin>,
    profile_url: String,
) -> (ClaudeCliLoginSource, Arc<AtomicUsize>) {
    let reads = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&reads);
    let source = ClaudeCliLoginSource::new(
        move || {
            counter.fetch_add(1, Ordering::SeqCst);
            let login = login.clone();
            async move { login }
        },
        profile_url,
    );
    (source, reads)
}

fn service_with(key: ModelKey) -> (TempDir, KeyService, String) {
    let store_dir = tempdir().unwrap();
    let service = KeyService::new(Some(store_dir.path().to_path_buf()));
    let key_id = key.id.clone();
    service.save_key(key).unwrap();
    (store_dir, service, key_id)
}

#[tokio::test]
async fn linked_account_adopts_the_login_the_claude_cli_already_rotated() {
    let (_store_dir, service, key_id) =
        service_with(claude_oauth_key(Some(ACCOUNT_SETUP_METHOD_AUTODETECT)));
    let (profile_url, profile_server) = serve_once("200 OK", profile_body("org-a"));
    let login = cli_login(Duration::hours(7));
    let expected_expiry = login.expires_at_millis.unwrap().to_string();
    let (source, reads) = counting_source(Some(login), profile_url);

    let outcome = service
        .refresh_claude_code_oauth_key_with(
            &key_id,
            "vault-expired-access",
            Some(&source),
            Some(UNREACHABLE_URL.to_string()),
        )
        .await
        .expect("the CLI's login replaces the exchange");
    assert!(profile_server
        .join()
        .unwrap()
        .to_lowercase()
        .contains("authorization: bearer cli-fresh-access"));

    assert!(matches!(outcome, OAuthRefreshOutcome::AlreadyRotated(_)));
    assert_eq!(reads.load(Ordering::SeqCst), 1);
    let stored = service.get_key_by_id(&key_id).unwrap();
    assert_eq!(stored.session_token.as_deref(), Some("cli-fresh-access"));
    assert_eq!(
        stored.env_vars.get(REFRESH_TOKEN_ENV).map(String::as_str),
        Some("cli-rotated-refresh")
    );
    assert_eq!(stored.env_vars.get(EXPIRES_AT_ENV), Some(&expected_expiry));
}

#[tokio::test]
async fn spent_refresh_token_recovers_an_account_saved_before_the_method_was_recorded() {
    let (_store_dir, service, key_id) = service_with(claude_oauth_key(None));
    let (token_url, token_server) = serve_once("400 Bad Request", INVALID_GRANT_BODY.to_string());
    let (profile_url, profile_server) = serve_once("200 OK", profile_body("org-a"));
    let (source, reads) = counting_source(Some(cli_login(Duration::hours(7))), profile_url);

    let outcome = service
        .refresh_claude_code_oauth_key_with(
            &key_id,
            "vault-expired-access",
            Some(&source),
            Some(token_url),
        )
        .await
        .expect("a spent refresh token recovers from the CLI login");
    assert!(token_server.join().unwrap().contains("spent-refresh"));
    profile_server.join().unwrap();

    assert!(matches!(outcome, OAuthRefreshOutcome::AlreadyRotated(_)));
    assert_eq!(
        reads.load(Ordering::SeqCst),
        1,
        "an unmarked account is not reloaded before the exchange, only recovered after it fails"
    );
    let stored = service.get_key_by_id(&key_id).unwrap();
    assert_eq!(stored.session_token.as_deref(), Some("cli-fresh-access"));
    assert!(stored.enabled);
    assert_eq!(stored.oauth_refresh_failure_count, 0);
    assert_eq!(
        stored
            .account_metadata
            .get(ACCOUNT_SETUP_METHOD_METADATA_KEY)
            .map(String::as_str),
        Some(ACCOUNT_SETUP_METHOD_AUTODETECT)
    );
    assert_eq!(
        stored
            .account_metadata
            .get("organization_uuid")
            .map(String::as_str),
        Some("org-a"),
        "identity metadata survives adoption"
    );
}

#[tokio::test]
async fn an_account_signed_in_through_the_vault_never_reads_the_cli_login() {
    let (_store_dir, service, key_id) = service_with(claude_oauth_key(Some("signin")));
    let (token_url, token_server) = serve_once("400 Bad Request", INVALID_GRANT_BODY.to_string());
    let (source, reads) = counting_source(
        Some(cli_login(Duration::hours(7))),
        UNREACHABLE_URL.to_string(),
    );

    service
        .refresh_claude_code_oauth_key_with(
            &key_id,
            "vault-expired-access",
            Some(&source),
            Some(token_url),
        )
        .await
        .expect_err("its own grant is dead and the credential store is off limits");
    token_server.join().unwrap();

    assert_eq!(reads.load(Ordering::SeqCst), 0);
    let stored = service.get_key_by_id(&key_id).unwrap();
    assert!(!stored.enabled);
    assert_eq!(stored.health_status, HealthStatus::Invalid);
}

#[tokio::test]
async fn another_accounts_claude_cli_login_is_never_adopted() {
    let (_store_dir, service, key_id) =
        service_with(claude_oauth_key(Some(ACCOUNT_SETUP_METHOD_AUTODETECT)));
    let (token_url, token_server) = serve_once("400 Bad Request", INVALID_GRANT_BODY.to_string());
    // The reload before the exchange asks the profile endpoint; the recovery
    // attempt after it finds the one-shot endpoint gone and fails closed too.
    let (first_profile_url, first_profile) = serve_once("200 OK", profile_body("org-b"));
    let (source, _reads) = counting_source(Some(cli_login(Duration::hours(7))), first_profile_url);

    service
        .refresh_claude_code_oauth_key_with(
            &key_id,
            "vault-expired-access",
            Some(&source),
            Some(token_url),
        )
        .await
        .expect_err("a different organization is not a replacement");
    first_profile.join().unwrap();
    token_server.join().unwrap();

    let stored = service.get_key_by_id(&key_id).unwrap();
    assert_eq!(
        stored.session_token.as_deref(),
        Some("vault-expired-access")
    );
    assert!(!stored.enabled);
}

#[tokio::test]
async fn an_account_without_stored_identity_is_never_recovered() {
    let mut key = claude_oauth_key(None);
    key.account_metadata.clear();
    let (_store_dir, service, key_id) = service_with(key);
    let (token_url, token_server) = serve_once("400 Bad Request", INVALID_GRANT_BODY.to_string());
    let (profile_url, profile_server) = serve_once("200 OK", profile_body("org-a"));
    let (source, _reads) = counting_source(Some(cli_login(Duration::hours(7))), profile_url);

    service
        .refresh_claude_code_oauth_key_with(
            &key_id,
            "vault-expired-access",
            Some(&source),
            Some(token_url),
        )
        .await
        .expect_err("nothing proves the CLI login is this account");
    token_server.join().unwrap();
    profile_server.join().unwrap();

    let stored = service.get_key_by_id(&key_id).unwrap();
    assert_eq!(
        stored.session_token.as_deref(),
        Some("vault-expired-access")
    );
}

#[tokio::test]
async fn an_expired_claude_cli_login_is_not_adopted() {
    let (_store_dir, service, key_id) =
        service_with(claude_oauth_key(Some(ACCOUNT_SETUP_METHOD_AUTODETECT)));
    let (token_url, token_server) = serve_once("400 Bad Request", INVALID_GRANT_BODY.to_string());
    let (source, reads) = counting_source(
        Some(cli_login(Duration::minutes(-5))),
        UNREACHABLE_URL.to_string(),
    );

    service
        .refresh_claude_code_oauth_key_with(
            &key_id,
            "vault-expired-access",
            Some(&source),
            Some(token_url),
        )
        .await
        .expect_err("neither holder has a live token");
    token_server.join().unwrap();

    assert_eq!(reads.load(Ordering::SeqCst), 2);
    assert!(!service.get_key_by_id(&key_id).unwrap().enabled);
}

#[tokio::test]
async fn reconnect_during_local_read_must_not_be_overwritten() {
    let (_dir, service, key_id) =
        service_with(claude_oauth_key(Some(ACCOUNT_SETUP_METHOD_AUTODETECT)));
    let service = Arc::new(service);
    let writer = Arc::clone(&service);
    let writer_id = key_id.clone();
    let (profile_url, server) = serve_once("200 OK", profile_body("org-a"));
    let source = ClaudeCliLoginSource::new(
        move || {
            let mut reconnected = writer.get_key_by_id(&writer_id).unwrap();
            reconnected.session_token = Some("new-user-login".into());
            reconnected
                .env_vars
                .insert(REFRESH_TOKEN_ENV.into(), "new-user-refresh".into());
            reconnected
                .account_metadata
                .insert("email".into(), "new-user@example.invalid".into());
            reconnected
                .account_metadata
                .insert(ACCOUNT_SETUP_METHOD_METADATA_KEY.into(), "signin".into());
            writer.save_key(reconnected).unwrap();
            async { Some(cli_login(Duration::hours(7))) }
        },
        profile_url,
    );
    service
        .refresh_claude_code_oauth_key_with(
            &key_id,
            "vault-expired-access",
            Some(&source),
            Some(UNREACHABLE_URL.into()),
        )
        .await
        .unwrap();
    server.join().unwrap();
    let saved = service.get_key_by_id(&key_id).unwrap();
    assert_eq!(
        saved.session_token.as_deref(),
        Some("new-user-login"),
        "stale recovery overwrote a reconnect"
    );
}

#[tokio::test]
async fn organization_alone_must_not_identify_a_user() {
    let mut key = claude_oauth_key(Some(ACCOUNT_SETUP_METHOD_AUTODETECT));
    key.account_metadata.remove("email");
    let (_dir, service, key_id) = service_with(key);
    let (profile_url, server) = serve_once(
        "200 OK",
        serde_json::json!({
            "account": { "email": "another-user@example.invalid" },
            "organization": { "uuid": "org-a" }
        })
        .to_string(),
    );
    let (source, _) = counting_source(Some(cli_login(Duration::hours(7))), profile_url);
    let outcome = service
        .refresh_claude_code_oauth_key_with(
            &key_id,
            "vault-expired-access",
            Some(&source),
            Some(UNREACHABLE_URL.into()),
        )
        .await;
    server.join().unwrap();
    assert!(
        !matches!(outcome, Ok(OAuthRefreshOutcome::AlreadyRotated(_))),
        "another user in the same org was adopted"
    );
}
