use crate::providers::codex::app_server::{
    cleanup_temporary_codex_home, read_temporary_codex_auth, write_temporary_codex_home,
};
use crate::providers::codex::{is_oauth_auth_error, CodexValidator};

#[tokio::test]
async fn temporary_codex_home_never_receives_refresh_token() {
    let codex_home =
        write_temporary_codex_home("current-access-token", Some("eyJ.test-id-token.payload"))
            .await
            .unwrap();

    let auth = read_temporary_codex_auth(&codex_home).await.unwrap();
    assert_eq!(
        auth.pointer("/tokens/access_token")
            .and_then(|value| value.as_str()),
        Some("current-access-token")
    );
    assert_eq!(
        auth.pointer("/tokens/refresh_token")
            .and_then(|value| value.as_str()),
        Some("")
    );

    cleanup_temporary_codex_home(&codex_home, "test").await;
}

#[tokio::test]
#[ignore = "requires an installed Codex CLI; uses only synthetic credentials"]
async fn temporary_codex_home_is_readable_by_codex_cli() {
    use base64::Engine;

    let claims = serde_json::json!({
        "email": "codex-auth-test@example.invalid",
        "https://api.openai.com/auth": {
            "chatgpt_account_id": "synthetic-account",
            "chatgpt_plan_type": "plus",
        },
    });
    let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(claims.to_string());
    let token = format!("e30.{payload}.synthetic-signature");
    let codex_home = write_temporary_codex_home(&token, Some(&token))
        .await
        .unwrap();

    // `login status` exercises Codex's real auth deserializer without a
    // provider request. Keep the developer's home and API credentials out of
    // this process, and bound the lifetime if a CLI version stops responding.
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        tokio::process::Command::new("codex")
            .args(["login", "status"])
            .env("CODEX_HOME", &codex_home)
            .env_remove("OPENAI_API_KEY")
            .env_remove("CODEX_API_KEY")
            .kill_on_drop(true)
            .output(),
    )
    .await;
    cleanup_temporary_codex_home(&codex_home, "CLI auth test").await;

    let output = output
        .expect("Codex login status timed out")
        .expect("start Codex CLI");
    assert!(
        output.status.success(),
        "Codex rejected the temporary auth file: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stderr).contains("Logged in using ChatGPT"));
}

#[test]
fn oauth_auth_errors_bypass_the_disposable_app_server_fallback() {
    assert!(is_oauth_auth_error(
        "Codex usage API unauthorized: HTTP 401"
    ));
    assert!(is_oauth_auth_error("Codex usage API forbidden: HTTP 403"));
    assert!(!is_oauth_auth_error(
        "Codex usage API response did not include quota windows"
    ));
}

#[test]
fn test_validate_format_jwt() {
    let validator = CodexValidator::new();
    let (valid, _) = validator.validate_format("eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test");
    assert!(valid);
}

#[test]
fn test_validate_format_api_key() {
    let validator = CodexValidator::new();
    let (valid, _) = validator.validate_format("sk-proj-abc123");
    assert!(valid);
}

#[test]
fn test_validate_format_empty() {
    let validator = CodexValidator::new();
    let (valid, _) = validator.validate_format("");
    assert!(!valid);
}
