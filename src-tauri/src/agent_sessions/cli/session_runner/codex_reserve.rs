//! Upstream-only reserve override for a direct Codex OAuth turn.

use key_vault::key_store::{ModelKey, ModelType};

pub(super) async fn resolve_wire_model(
    key: Option<&ModelKey>,
    model: Option<&str>,
) -> Option<&'static str> {
    let key = key.filter(|key| key.is_native_oauth_for(&ModelType::Codex))?;
    if key
        .base_url
        .as_deref()
        .is_some_and(|url| !url.trim().is_empty())
    {
        return None;
    }
    let model = super::command::codex_app_server_thread_model(model)?;
    if model != key_vault::providers::codex::reserve::LUNA_MODEL {
        return None;
    }
    let account = agent_core::providers::codex_native::extract_account_id_from_id_token(
        key.env_vars
            .get(core_types::providers::CODEX_ID_TOKEN_ENV_KEY)
            .map(String::as_str)
            .unwrap_or_default(),
    );
    key_vault::providers::codex::reserve::resolve_oauth_wire_model(
        &reqwest::Client::new(),
        key.session_token.as_deref()?,
        account.as_deref(),
        &model,
    )
    .await
}

/// The capacity pool name must not become the session's model identity.
pub(super) fn usage_model<'a>(
    selected: Option<&'a str>,
    reported: Option<&'a str>,
    wire: Option<&str>,
) -> Option<&'a str> {
    if wire.is_some() {
        selected
    } else {
        reported.or(selected)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn api_key_accounts_never_probe_reserve() {
        let key = ModelKey::new(ModelType::Codex);
        assert_eq!(
            resolve_wire_model(Some(&key), Some("gpt-5.6-luna")).await,
            None
        );
        assert_eq!(resolve_wire_model(None, Some("gpt-5.6-luna")).await, None);
        let mut custom = key;
        custom.auth_method = key_vault::key_store::AuthMethod::Oauth;
        custom.session_token = Some("fixture".into());
        custom.base_url = Some("http://127.0.0.1:1".into());
        assert_eq!(
            resolve_wire_model(Some(&custom), Some("gpt-5.6-luna")).await,
            None
        );
        assert_eq!(
            usage_model(
                Some("gpt-5.6-luna-low"),
                Some("gpt-reserve"),
                Some("gpt-reserve")
            ),
            Some("gpt-5.6-luna-low")
        );
        assert_eq!(
            usage_model(Some("original"), Some("reported"), None),
            Some("reported")
        );
    }

    #[tokio::test]
    #[ignore = "live app-server canary; requires ORG2_CODEX_RESERVE_AUTH_FILE and consumes quota"]
    async fn live_luna_reserve_app_server() {
        use super::super::launch_profiles::CliPermissionMode;
        use crate::agent_sessions::cli::parsers::codex_app_server::{
            run_app_server_turn, CodexAppServerTurn,
        };
        let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
        let auth_path =
            std::path::PathBuf::from(std::env::var("ORG2_CODEX_RESERVE_AUTH_FILE").unwrap());
        let auth: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&auth_path).unwrap()).unwrap();
        let mut key = ModelKey::new(ModelType::Codex);
        key.auth_method = key_vault::key_store::AuthMethod::Oauth;
        key.session_token = auth["tokens"]["access_token"].as_str().map(str::to_owned);
        key.env_vars.insert(
            core_types::providers::CODEX_ID_TOKEN_ENV_KEY.into(),
            auth["tokens"]["id_token"]
                .as_str()
                .unwrap_or_default()
                .into(),
        );
        let model = "gpt-5.6-luna-low";
        let wire = resolve_wire_model(Some(&key), Some(model)).await;
        assert_eq!(wire, Some("gpt-reserve"));
        let workspace = tempfile::tempdir().unwrap();
        let mut child = tokio::process::Command::new(
            std::env::var("ORG2_CODEX_RESERVE_BINARY").unwrap_or_else(|_| "codex".into()),
        )
        .args(["app-server", "-c", "model_reasoning_effort=\"low\""])
        .env("CODEX_HOME", auth_path.parent().unwrap())
        .env_remove("OPENAI_API_KEY")
        .env_remove("OPENAI_BASE_URL")
        .env_remove("CODEX_API_KEY")
        .current_dir(workspace.path())
        .kill_on_drop(true)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
        let (tx, mut rx) = tokio::sync::mpsc::channel(256);
        let drain = tokio::spawn(async move {
            let mut text = String::new();
            while let Some(chunk) = rx.recv().await {
                text.push_str(&serde_json::to_string(&chunk).unwrap());
            }
            text
        });
        let result = tokio::time::timeout(std::time::Duration::from_secs(90), run_app_server_turn(
            child.stdin.take().unwrap(), child.stdout.take().unwrap(), CodexAppServerTurn {
                session_id: "reserve-live-canary".into(),
                user_input: "Reply exactly ORG2_APP_SERVER_RESERVE_OK. Do not use tools, read files or run commands.".into(),
                developer_instructions: None, working_dir: workspace.path().to_string_lossy().into_owned(),
                project_id: None, resume_thread_id: None, model: wire.map(str::to_owned),
                permission_mode: CliPermissionMode::Plan, config: None, image_paths: vec![], allow_native_context_recovery: false,
            }, tx
        )).await;
        child.kill().await.ok();
        child.wait().await.ok();
        let output = drain.await.unwrap();
        let result = result.expect("bounded canary").expect("app-server turn");
        assert_eq!(result.turn_status, "completed");
        assert!(output.contains("ORG2_APP_SERVER_RESERVE_OK"));
        assert!(!output.contains("\"action_type\":\"tool_call\""));
        let usage = result.usage.expect("token usage");
        assert!(usage.total_tokens > 0);
        println!(
            "reserve app-server canary: selected={model}, route=gpt-reserve, input={}, output={}",
            usage.input_tokens, usage.output_tokens
        );
    }
}
