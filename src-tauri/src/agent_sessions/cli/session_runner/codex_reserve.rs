//! Explicit reserve live canary.
#[tokio::test]
#[ignore = "live app-server canary; requires ORG2_CODEX_RESERVE_AUTH_FILE and consumes quota"]
async fn live_luna_reserve_app_server() {
    use super::launch_profiles::CliPermissionMode;
    use crate::agent_sessions::cli::parsers::codex_app_server::{
        run_app_server_turn, CodexAppServerTurn,
    };
    let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
    let auth_path =
        std::path::PathBuf::from(std::env::var("ORG2_CODEX_RESERVE_AUTH_FILE").unwrap());
    let model = "gpt-reserve-low";
    let wire = super::command::codex_app_server_thread_model(Some(model));
    assert_eq!(wire.as_deref(), Some("gpt-reserve"));
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
                project_id: None, resume_thread_id: None, model: wire,
                turn_intent_id: None,
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
