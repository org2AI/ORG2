//! Unit tests for the codex app-server event → ActivityChunk mapping.
//!
//! Fixture payloads are verbatim (trimmed) captures from a live
//! `codex app-server` stdio session (codex-cli 0.143.0).

use serde_json::{json, Value};

use super::{
    approval_auto_accept, build_thread_launch_request, build_turn_input, thread_permission_params,
    CodexAppServerEventParser, CodexAppServerTurn,
};
use crate::agent_sessions::cli::session_runner::launch_profiles::CliPermissionMode;

const SESSION_ID: &str = "test-session";

fn parser() -> CodexAppServerEventParser {
    CodexAppServerEventParser::new(SESSION_ID)
}

fn notif(
    parser: &mut CodexAppServerEventParser,
    method: &str,
    params: Value,
) -> Vec<core_types::activity::ActivityChunk> {
    parser.handle_notification(method, &params)
}

// ─── thread lifecycle ───

#[test]
fn thread_response_captures_id_and_emits_session_start_once() {
    let mut p = parser();
    let result = json!({
        "thread": {"id": "019f6f52-4aa1-7ac2-8fe4-486e23145e36", "ephemeral": false},
        "model": "gpt-5.5",
    });
    let chunks = p.on_thread_response(&result);
    assert_eq!(p.thread_id(), Some("019f6f52-4aa1-7ac2-8fe4-486e23145e36"));
    assert_eq!(chunks.len(), 1);
    assert_eq!(chunks[0].action_type, "session_start");
    assert_eq!(
        chunks[0].thread_id.as_deref(),
        Some("019f6f52-4aa1-7ac2-8fe4-486e23145e36")
    );

    // thread/started for the same thread must not emit a duplicate.
    let dup = notif(
        &mut p,
        "thread/started",
        json!({"thread": {"id": "019f6f52-4aa1-7ac2-8fe4-486e23145e36"}}),
    );
    assert!(dup.is_empty());
}

#[test]
fn native_thread_rebind_emits_fresh_id_after_initial_session_start() {
    let mut p = parser();
    let _ = p.on_thread_response(&json!({"thread": {"id": "source-thread"}}));

    let chunks = p.on_thread_rebound(&json!({"thread": {"id": "forked-thread"}}));

    assert_eq!(p.thread_id(), Some("forked-thread"));
    assert_eq!(chunks.len(), 1);
    assert_eq!(chunks[0].action_type, "session_start");
    assert_eq!(chunks[0].thread_id.as_deref(), Some("forked-thread"));
    assert_eq!(chunks[0].result["native_rollover"], true);
}

#[test]
fn turn_started_captures_turn_id_without_chunks() {
    let mut p = parser();
    let chunks = notif(
        &mut p,
        "turn/started",
        json!({"threadId": "t", "turn": {"id": "turn-1", "status": "inProgress", "items": []}}),
    );
    assert!(chunks.is_empty());
    assert_eq!(p.turn_id(), Some("turn-1"));
}

// ─── messages / reasoning ───

#[test]
fn agent_message_delta_maps_to_broadcast_only_assistant_delta() {
    let mut p = parser();
    let chunks = notif(
        &mut p,
        "item/agentMessage/delta",
        json!({"delta": "po", "itemId": "msg_1", "threadId": "t", "turnId": "u"}),
    );
    assert_eq!(chunks.len(), 1);
    let chunk = &chunks[0];
    assert_eq!(chunk.action_type, "assistant_delta");
    assert!(chunk.broadcast_only);
    assert_eq!(chunk.result["content"], "po");
    assert_eq!(chunk.result["is_delta"], true);
}

#[test]
fn completed_agent_message_maps_to_full_assistant_chunk() {
    let mut p = parser();
    let chunks = notif(
        &mut p,
        "item/completed",
        json!({"item": {"type": "agentMessage", "id": "msg_1", "text": "pong", "phase": "final_answer"}}),
    );
    assert_eq!(chunks.len(), 1);
    let chunk = &chunks[0];
    assert_eq!(chunk.action_type, "assistant");
    assert_eq!(chunk.function, "message");
    assert!(!chunk.broadcast_only);
    assert_eq!(chunk.result["content"], "pong");
    assert_eq!(chunk.result["is_full_content"], true);
}

#[test]
fn started_agent_message_and_user_echo_are_skipped() {
    let mut p = parser();
    assert!(notif(
        &mut p,
        "item/started",
        json!({"item": {"type": "agentMessage", "id": "msg_1", "text": ""}}),
    )
    .is_empty());
    assert!(notif(
        &mut p,
        "item/completed",
        json!({"item": {"type": "userMessage", "id": "u1", "content": [{"type": "text", "text": "hi"}]}}),
    )
    .is_empty());
}

#[test]
fn reasoning_summary_delta_and_completed_summary_map_to_thinking() {
    let mut p = parser();
    let deltas = notif(
        &mut p,
        "item/reasoning/summaryTextDelta",
        json!({"delta": "thinking…", "itemId": "rs_1", "summaryIndex": 0}),
    );
    assert_eq!(deltas.len(), 1);
    assert_eq!(deltas[0].action_type, "llm_thinking_delta");
    assert!(deltas[0].broadcast_only);

    let chunks = notif(
        &mut p,
        "item/completed",
        json!({"item": {"type": "reasoning", "id": "rs_1", "summary": ["part one", "part two"], "content": []}}),
    );
    assert_eq!(chunks.len(), 1);
    assert_eq!(chunks[0].action_type, "llm_thinking");
    assert_eq!(chunks[0].result["thought"], "part one\npart two");

    // Empty summary (live capture shape) emits nothing.
    let empty = notif(
        &mut p,
        "item/completed",
        json!({"item": {"type": "reasoning", "id": "rs_2", "summary": [], "content": []}}),
    );
    assert!(empty.is_empty());
}

// ─── tool calls ───

#[test]
fn command_execution_maps_to_shell_with_call_id() {
    let mut p = parser();
    let started = notif(
        &mut p,
        "item/started",
        json!({"item": {
            "type": "commandExecution",
            "id": "call_1",
            "command": "/bin/bash -lc 'ls -la'",
            "cwd": "/repo",
            "status": "inProgress",
        }}),
    );
    assert_eq!(started.len(), 1);
    assert_eq!(started[0].function, "Shell");
    assert_eq!(started[0].chunk_id, "tool-call-call_1");
    assert_eq!(started[0].args["command"], "ls -la");
    assert_eq!(started[0].result["status"], "running");
    assert_eq!(started[0].result["call_id"], "call_1");

    let completed = notif(
        &mut p,
        "item/completed",
        json!({"item": {
            "type": "commandExecution",
            "id": "call_1",
            "command": "/bin/bash -lc 'ls -la'",
            "cwd": "/repo",
            "aggregatedOutput": "total 0",
            "exitCode": 0,
            "status": "completed",
        }}),
    );
    assert_eq!(completed.len(), 1);
    assert_eq!(completed[0].function, "Shell");
    assert_eq!(completed[0].result["success"]["exitCode"], 0);
    assert_eq!(completed[0].result["success"]["stdout"], "total 0");
    assert_eq!(completed[0].result["call_id"], "call_1");
}

#[test]
fn failed_command_execution_maps_to_error_result() {
    let mut p = parser();
    let chunks = notif(
        &mut p,
        "item/completed",
        json!({"item": {
            "type": "commandExecution",
            "id": "call_2",
            "command": "false",
            "cwd": "/repo",
            "aggregatedOutput": "boom",
            "exitCode": 1,
            "status": "failed",
        }}),
    );
    assert_eq!(chunks.len(), 1);
    assert_eq!(chunks[0].result["error"]["exitCode"], 1);
    assert_eq!(chunks[0].result["error"]["stdout"], "boom");
}

#[test]
fn file_change_maps_to_edit_chunk() {
    let mut p = parser();
    let chunks = notif(
        &mut p,
        "item/completed",
        json!({"item": {
            "type": "fileChange",
            "id": "fc_1",
            "status": "completed",
            "changes": [
                {"path": "/repo/src/a.rs", "kind": "update", "diff": "-old\n+new"},
                {"path": "/repo/src/b.rs", "kind": "add", "diff": "+created"},
            ],
        }}),
    );
    assert_eq!(chunks.len(), 1);
    assert_eq!(chunks[0].function, "Edit");
    assert_eq!(chunks[0].args["path"], "/repo/src/a.rs");
    assert_eq!(chunks[0].result["success"]["path"], "/repo/src/a.rs");
    assert_eq!(
        chunks[0].result["success"]["files"],
        json!(["/repo/src/a.rs", "/repo/src/b.rs"])
    );
    assert_eq!(chunks[0].result["call_id"], "fc_1");
}

#[test]
fn declined_file_change_maps_to_error() {
    let mut p = parser();
    let chunks = notif(
        &mut p,
        "item/completed",
        json!({"item": {
            "type": "fileChange",
            "id": "fc_2",
            "status": "declined",
            "changes": [{"path": "/repo/x.rs", "kind": "update", "diff": ""}],
        }}),
    );
    assert_eq!(chunks.len(), 1);
    assert!(chunks[0].result.get("error").is_some());
}

#[test]
fn mcp_tool_call_uses_tool_name_and_result() {
    let mut p = parser();
    let chunks = notif(
        &mut p,
        "item/completed",
        json!({"item": {
            "type": "mcpToolCall",
            "id": "mcp_1",
            "server": "docs",
            "tool": "search_docs",
            "status": "completed",
            "arguments": {"query": "tokio"},
            "result": {"content": "found"},
            "error": null,
        }}),
    );
    assert_eq!(chunks.len(), 1);
    assert_eq!(chunks[0].function, "search_docs");
    assert_eq!(chunks[0].args["query"], "tokio");
    assert_eq!(chunks[0].result["content"], "found");
}

// ─── plan / todos ───

#[test]
fn turn_plan_updated_maps_to_update_todos() {
    let mut p = parser();
    let chunks = notif(
        &mut p,
        "turn/plan/updated",
        json!({
            "threadId": "t", "turnId": "u", "explanation": null,
            "plan": [
                {"step": "Explore", "status": "completed"},
                {"step": "Implement", "status": "inProgress"},
                {"step": "Test", "status": "pending"},
            ],
        }),
    );
    assert_eq!(chunks.len(), 1);
    assert_eq!(chunks[0].function, "UpdateTodos");
    let todos = chunks[0].args["todos"].as_array().expect("todos array");
    assert_eq!(todos.len(), 3);
    assert_eq!(todos[0]["status"], "completed");
    assert_eq!(todos[1]["status"], "in_progress");
    assert_eq!(todos[2]["status"], "pending");
    assert_eq!(todos[1]["content"], "Implement");
}

// ─── usage / turn end / errors ───

#[test]
fn token_usage_updated_captures_last_breakdown() {
    let mut p = parser();
    let chunks = notif(
        &mut p,
        "thread/tokenUsage/updated",
        json!({
            "threadId": "t", "turnId": "u",
            "tokenUsage": {
                "total": {"totalTokens": 99999, "inputTokens": 90000, "cachedInputTokens": 5000, "outputTokens": 200, "reasoningOutputTokens": 50},
                "last": {"totalTokens": 12098, "inputTokens": 12076, "cachedInputTokens": 2432, "outputTokens": 22, "reasoningOutputTokens": 15},
            },
        }),
    );
    assert!(chunks.is_empty());
    let usage = p.usage().expect("usage captured");
    assert_eq!(usage.input_tokens, 12076);
    assert_eq!(usage.output_tokens, 22);
    assert_eq!(usage.cache_read_tokens, 2432);
    assert_eq!(usage.total_tokens, 12098);
}

#[test]
fn token_usage_derives_total_when_provider_omits_it() {
    let mut p = parser();
    let chunks = notif(
        &mut p,
        "thread/tokenUsage/updated",
        json!({
            "threadId": "t", "turnId": "u",
            "tokenUsage": {
                "last": {
                    "inputTokens": 91133,
                    "cachedInputTokens": 76288,
                    "outputTokens": 1876
                }
            }
        }),
    );
    assert!(chunks.is_empty());
    let usage = p.usage().expect("usage captured");
    assert_eq!(usage.total_tokens, 93009);
    assert_eq!(usage.cache_read_tokens, 76288);
}

#[test]
fn turn_completed_emits_session_end_and_records_status() {
    let mut p = parser();
    let chunks = notif(
        &mut p,
        "turn/completed",
        json!({"threadId": "t", "turn": {"id": "u", "items": [], "status": "completed", "error": null}}),
    );
    assert_eq!(chunks.len(), 1);
    assert_eq!(chunks[0].action_type, "session_end");
    assert_eq!(chunks[0].result["success"], true);
    assert_eq!(chunks[0].result["stop_reason"], "completed");
    assert_eq!(p.turn_status(), Some("completed"));
}

#[test]
fn failed_turn_emits_unsuccessful_session_end_with_error() {
    let mut p = parser();
    let chunks = notif(
        &mut p,
        "turn/completed",
        json!({"threadId": "t", "turn": {
            "id": "u", "items": [], "status": "failed",
            "error": {"message": "stream disconnected"},
        }}),
    );
    assert_eq!(chunks.len(), 1);
    assert_eq!(chunks[0].result["success"], false);
    assert_eq!(chunks[0].result["error_message"], "stream disconnected");
    assert_eq!(p.turn_status(), Some("failed"));
    assert_eq!(p.turn_error(), Some("stream disconnected"));
}

#[test]
fn context_overflow_is_recoverable_only_before_output_or_tools() {
    let overflow = json!({"threadId": "t", "turn": {
        "id": "u", "items": [], "status": "failed",
        "error": {"message": "Codex ran out of room in the model's context window."},
    }});

    let clean = parser();
    assert!(clean.should_recover_context_exhaustion(&overflow));
    assert!(!clean.should_recover_context_exhaustion(&json!({
        "turn": {
            "status": "completed",
            "error": {"message": "Codex ran out of room in the model's context window."}
        }
    })));
    assert!(!clean.should_recover_context_exhaustion(&json!({
        "turn": {
            "status": "failed",
            "error": {"message": "connection refused"}
        }
    })));

    let mut with_output = parser();
    let chunks = notif(
        &mut with_output,
        "item/agentMessage/delta",
        json!({"delta": "partial", "itemId": "msg_1"}),
    );
    assert_eq!(chunks.len(), 1);
    assert!(!with_output.should_recover_context_exhaustion(&overflow));

    let mut with_tool = parser();
    let _ = notif(
        &mut with_tool,
        "item/started",
        json!({"item": {
            "type": "commandExecution", "id": "call_1",
            "command": "touch changed", "cwd": "/repo", "status": "inProgress",
        }}),
    );
    assert!(!with_tool.should_recover_context_exhaustion(&overflow));
}

#[test]
fn turn_reset_preserves_thread_identity_and_clears_failed_attempt_state() {
    let mut p = parser();
    let _ = p.on_thread_response(&json!({"thread": {"id": "thread-1"}}));
    let _ = notif(
        &mut p,
        "turn/started",
        json!({"turn": {"id": "turn-1", "status": "inProgress"}}),
    );
    let _ = notif(
        &mut p,
        "error",
        json!({"error": {"message": "Prompt is too long"}, "willRetry": false}),
    );
    let _ = notif(
        &mut p,
        "turn/completed",
        json!({"turn": {"id": "turn-1", "status": "failed"}}),
    );
    assert_eq!(p.turn_status(), Some("failed"));

    p.reset_turn_state();

    assert_eq!(p.thread_id(), Some("thread-1"));
    assert_eq!(p.turn_id(), None);
    assert_eq!(p.turn_status(), None);
    assert_eq!(p.turn_error(), None);
    assert!(p.usage().is_none());
}

#[test]
fn failed_context_recovery_restores_error_from_preceding_notification() {
    let mut p = parser();
    let _ = notif(
        &mut p,
        "error",
        json!({
            "error": {"message": "Codex ran out of room in the model's context window."},
            "willRetry": false
        }),
    );
    let completion = json!({"turn": {"id": "turn-1", "status": "failed"}});
    let original_error = p.completed_turn_error(&completion).map(str::to_string);

    // Native recovery drives maintenance turns and resets this transient
    // parser state before it can report a failure of its own.
    p.reset_turn_state();
    p.pending_error_message = original_error;
    let chunks = notif(&mut p, "turn/completed", completion);

    assert_eq!(chunks.len(), 1);
    assert_eq!(chunks[0].result["success"], false);
    assert_eq!(
        chunks[0].result["error_message"],
        "Codex ran out of room in the model's context window."
    );
}

#[test]
fn native_compaction_notifications_emit_one_deduplicated_marker() {
    let mut p = parser();
    let item = notif(
        &mut p,
        "item/completed",
        json!({"item": {"type": "contextCompaction", "id": "compact-1"}}),
    );
    assert_eq!(item.len(), 1);
    assert_eq!(item[0].action_type, "context_compacted");
    assert_eq!(item[0].result["native"], true);
    assert_eq!(item[0].result["provider"], "codex");

    let legacy = notif(&mut p, "thread/compacted", json!({"threadId": "t"}));
    assert!(legacy.is_empty());
}

#[test]
fn interrupted_turn_records_status() {
    let mut p = parser();
    let chunks = notif(
        &mut p,
        "turn/completed",
        json!({"threadId": "t", "turn": {"id": "u", "items": [], "status": "interrupted", "error": null}}),
    );
    assert_eq!(chunks[0].result["stop_reason"], "interrupted");
    assert_eq!(p.turn_status(), Some("interrupted"));
}

#[test]
fn fatal_error_is_coalesced_into_authoritative_failed_turn() {
    let mut p = parser();
    let fatal = notif(
        &mut p,
        "error",
        json!({"threadId": "t", "turnId": "u", "error": {"message": "boom"}, "willRetry": false}),
    );
    assert!(fatal.is_empty());

    let duplicate_fatal = notif(
        &mut p,
        "error",
        json!({"threadId": "t", "turnId": "u", "error": {"message": "boom, request-id: second"}, "willRetry": false}),
    );
    assert!(duplicate_fatal.is_empty());

    let retryable = notif(
        &mut p,
        "error",
        json!({"threadId": "t", "turnId": "u", "error": {"message": "transient"}, "willRetry": true}),
    );
    assert!(retryable.is_empty());

    let terminal = notif(
        &mut p,
        "turn/completed",
        json!({"threadId": "t", "turn": {
            "id": "u", "items": [], "status": "failed",
            "error": {"message": "authoritative upstream failure"},
        }}),
    );
    assert_eq!(terminal.len(), 1);
    assert_eq!(terminal[0].action_type, "session_end");
    assert_eq!(terminal[0].result["success"], false);
    assert_eq!(
        terminal[0].result["error_message"],
        "authoritative upstream failure"
    );
    assert_eq!(p.turn_error(), Some("authoritative upstream failure"));
}

#[test]
fn failed_turn_without_a_body_falls_back_to_the_last_retry_notice() {
    let mut p = parser();
    let retryable = notif(
        &mut p,
        "error",
        json!({"threadId": "t", "turnId": "u", "error": {"message": "stream disconnected"}, "willRetry": true}),
    );
    assert!(retryable.is_empty(), "a retry is progress, not an error");

    // codex reports the failure but attaches no error object — without the
    // fallback the turn ends with no explanation at all.
    let terminal = notif(
        &mut p,
        "turn/completed",
        json!({"threadId": "t", "turn": {"id": "u", "items": [], "status": "failed"}}),
    );
    assert_eq!(terminal[0].result["success"], false);
    assert_eq!(terminal[0].result["error_message"], "stream disconnected");
    assert_eq!(p.turn_error(), Some("stream disconnected"));
}

#[test]
fn retry_notice_never_outlives_its_turn() {
    let mut p = parser();
    notif(
        &mut p,
        "error",
        json!({"threadId": "t", "turnId": "u", "error": {"message": "stream disconnected"}, "willRetry": true}),
    );

    // Codex retried and got through: the notice describes nothing.
    let ok = notif(
        &mut p,
        "turn/completed",
        json!({"threadId": "t", "turn": {"id": "u", "items": [], "status": "completed"}}),
    );
    assert_eq!(ok[0].result["success"], true);
    assert!(ok[0].result.get("error_message").is_none());

    // And it must not be waiting to attach itself to the next turn either.
    let next = notif(
        &mut p,
        "turn/completed",
        json!({"threadId": "t", "turn": {"id": "v", "items": [], "status": "failed"}}),
    );
    assert!(next[0].result.get("error_message").is_none());
    assert_eq!(p.turn_error(), None);
}

#[test]
fn interrupted_turn_does_not_borrow_a_retry_notice() {
    let mut p = parser();
    notif(
        &mut p,
        "error",
        json!({"threadId": "t", "turnId": "u", "error": {"message": "stream disconnected"}, "willRetry": true}),
    );

    // The user cancelled; "stream disconnected" is not why this turn ended.
    let interrupted = notif(
        &mut p,
        "turn/completed",
        json!({"threadId": "t", "turn": {"id": "u", "items": [], "status": "interrupted"}}),
    );
    assert_eq!(interrupted[0].result["stop_reason"], "interrupted");
    assert!(interrupted[0].result.get("error_message").is_none());
}

#[test]
fn unknown_notifications_are_ignored() {
    let mut p = parser();
    for method in [
        "thread/status/changed",
        "hook/started",
        "mcpServer/startupStatus/updated",
        "account/rateLimits/updated",
    ] {
        assert!(notif(&mut p, method, json!({})).is_empty(), "{method}");
    }
}

// ─── permission-mode mapping ───

#[test]
fn permission_mode_maps_to_exec_equivalent_thread_params() {
    assert_eq!(
        thread_permission_params(CliPermissionMode::Plan),
        ("on-request", "read-only")
    );
    assert_eq!(
        thread_permission_params(CliPermissionMode::Manual),
        ("on-request", "workspace-write")
    );
    assert_eq!(
        thread_permission_params(CliPermissionMode::AutoEdit),
        ("never", "workspace-write")
    );
    assert_eq!(
        thread_permission_params(CliPermissionMode::FullPermission),
        ("never", "danger-full-access")
    );
}

#[test]
fn only_full_permission_auto_accepts_approvals() {
    assert!(approval_auto_accept(CliPermissionMode::FullPermission));
    assert!(!approval_auto_accept(CliPermissionMode::AutoEdit));
    assert!(!approval_auto_accept(CliPermissionMode::Manual));
    assert!(!approval_auto_accept(CliPermissionMode::Plan));
}

fn native_turn(
    user_input: &str,
    developer_instructions: &str,
    resume_thread_id: Option<&str>,
) -> CodexAppServerTurn {
    CodexAppServerTurn {
        session_id: SESSION_ID.to_string(),
        user_input: user_input.to_string(),
        developer_instructions: Some(developer_instructions.to_string()),
        working_dir: "/workspace".to_string(),
        project_id: Some("desktop-project-id".to_string()),
        resume_thread_id: resume_thread_id.map(str::to_string),
        model: Some("gpt-5.6-sol".to_string()),
        permission_mode: CliPermissionMode::Manual,
        config: Some(json!({"mcp_servers": {"orgii": {"enabled": true}}})),
        image_paths: vec!["/tmp/native-image.png".to_string()],
        allow_native_context_recovery: false,
    }
}

#[test]
fn fresh_thread_keeps_agent_context_out_of_native_user_input() {
    let developer_context = concat!(
        "<orgii_cli_exec_mode_bridge>build</orgii_cli_exec_mode_bridge>\n\n",
        "<ide_context>focused file</ide_context>"
    );
    let turn = native_turn("Literal visible user text", developer_context, None);

    let (method, params) = build_thread_launch_request(&turn);
    assert_eq!(method, "thread/start");
    assert_eq!(params["projectId"], "desktop-project-id");
    assert_eq!(params["developerInstructions"], developer_context);
    assert!(params.get("baseInstructions").is_none());

    let input = build_turn_input(&turn);
    assert_eq!(
        input[0],
        json!({"type": "text", "text": "Literal visible user text"})
    );
    assert_eq!(
        input[1],
        json!({"type": "localImage", "path": "/tmp/native-image.png"})
    );
    let visible_payload = serde_json::to_string(&input).expect("serialize turn input");
    assert!(!visible_payload.contains("<orgii_"));
    assert!(!visible_payload.contains("<ide_context>"));
}

#[test]
fn resumed_thread_receives_the_updated_developer_context() {
    let first = native_turn("first", "WORKSPACE_CONTEXT_V1", None);
    let (_, first_params) = build_thread_launch_request(&first);
    assert_eq!(
        first_params["developerInstructions"],
        "WORKSPACE_CONTEXT_V1"
    );

    let resumed = native_turn(
        "second literal user turn",
        "WORKSPACE_CONTEXT_V2\n<orgii_hook_context>latest</orgii_hook_context>",
        Some("native-codex-thread"),
    );
    let (method, params) = build_thread_launch_request(&resumed);
    assert_eq!(method, "thread/resume");
    assert!(
        params.get("projectId").is_none(),
        "resume must preserve the existing project"
    );
    assert_eq!(params["threadId"], "native-codex-thread");
    assert_eq!(
        params["developerInstructions"],
        "WORKSPACE_CONTEXT_V2\n<orgii_hook_context>latest</orgii_hook_context>"
    );
    assert!(params.get("baseInstructions").is_none());
    assert_eq!(
        build_turn_input(&resumed)[0],
        json!({"type": "text", "text": "second literal user turn"})
    );
}

// ─── live smoke (opt-in) ───

/// End-to-end smoke against a real `codex app-server` process. Requires the
/// codex binary on PATH and valid auth in `~/.codex` (spends a few tokens),
/// so it is `#[ignore]`d — run manually with:
/// `cargo test -p org2 --lib codex_app_server -- --ignored`
#[tokio::test]
#[ignore = "spawns real codex app-server; needs codex auth + network"]
async fn live_smoke_trivial_turn() {
    use super::run_app_server_turn;
    use std::process::Stdio;

    let mut child = match tokio::process::Command::new("codex")
        .arg("app-server")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(err) => {
            eprintln!("SKIP: codex binary unavailable: {err}");
            return;
        }
    };
    let stdin = child.stdin.take().expect("stdin piped");
    let stdout = child.stdout.take().expect("stdout piped");
    let (chunk_tx, mut chunk_rx) = tokio::sync::mpsc::channel(256);

    let turn = CodexAppServerTurn {
        session_id: SESSION_ID.to_string(),
        user_input: "Reply with exactly: pong".to_string(),
        developer_instructions: None,
        working_dir: std::env::temp_dir().to_string_lossy().to_string(),
        project_id: None,
        resume_thread_id: None,
        model: None,
        permission_mode: CliPermissionMode::Plan,
        config: None,
        image_paths: vec![],
        allow_native_context_recovery: false,
    };

    let protocol =
        tokio::spawn(async move { run_app_server_turn(stdin, stdout, turn, chunk_tx).await });

    let mut saw_session_start_thread_id = false;
    let mut assistant_text = String::new();
    let drain = tokio::time::timeout(std::time::Duration::from_secs(120), async {
        while let Some(chunk) = chunk_rx.recv().await {
            if chunk.action_type == "session_start" && chunk.thread_id.is_some() {
                saw_session_start_thread_id = true;
            }
            if chunk.action_type == "assistant" {
                if let Some(text) = chunk.result.get("content").and_then(|v| v.as_str()) {
                    assistant_text.push_str(text);
                }
            }
        }
    })
    .await;
    assert!(drain.is_ok(), "chunk stream did not close within 120s");

    let result = protocol
        .await
        .expect("protocol task join")
        .unwrap_or_else(|err| {
            if err.contains("unauthorized")
                || err.contains("login")
                || err.contains("not authenticated")
            {
                eprintln!("SKIP: codex auth unavailable: {err}");
                std::process::exit(0);
            }
            panic!("protocol error: {err}");
        });

    let _ = child.kill().await;

    assert!(!result.thread_id.is_empty(), "thread id captured");
    assert_eq!(result.turn_status, "completed");
    assert!(
        saw_session_start_thread_id,
        "session_start carried thread_id"
    );
    assert!(
        assistant_text.to_lowercase().contains("pong"),
        "assistant replied: {assistant_text:?}"
    );
    assert!(result.usage.is_some(), "token usage captured");

    // The rollout must exist with the thread id as the file-stem suffix —
    // native transcript replay and managed-mirror dedup key on it.
    let codex_home = std::env::var("CODEX_HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| dirs::home_dir().expect("home dir").join(".codex"));
    let mut found_rollout = false;
    let mut stack = vec![codex_home.join("sessions")];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path
                .file_stem()
                .and_then(|s| s.to_str())
                .is_some_and(|stem| stem.ends_with(&result.thread_id))
            {
                found_rollout = true;
            }
        }
    }
    assert!(
        found_rollout,
        "rollout jsonl written for {}",
        result.thread_id
    );
}

/// Real native protocol + local Responses fixture; no account or network service.
/// Opt in with ORGII_NATIVE_CODEX_APP_BINARY pointing to the Desktop binary.
#[tokio::test]
#[ignore = "requires an installed Codex Desktop binary; uses isolated storage and local HTTP only"]
async fn live_native_fresh_and_resumed_turns_are_in_default_desktop_list() {
    use super::{run_app_server_turn, CodexAppServerRpcClient};
    use std::process::Stdio;
    use std::time::Duration;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let binary = std::env::var("ORGII_NATIVE_CODEX_APP_BINARY")
        .expect("set ORGII_NATIVE_CODEX_APP_BINARY to the installed Desktop Codex binary");
    let sandbox = tempfile::tempdir().expect("isolated Codex home");
    let root = sandbox.path().canonicalize().unwrap();
    let home = root.join("account");
    let native_home = root.join("desktop");
    let project = root.join("target project");
    let other_project = root.join("other project");
    let execution_worktree = root.join("execution worktree");
    for dir in [
        &home,
        &native_home,
        &project,
        &other_project,
        &execution_worktree,
    ] {
        std::fs::create_dir(dir).unwrap();
    }
    let server = MockServer::start().await;
    let message = json!({
        "id": "msg_fixture", "type": "message", "role": "assistant", "status": "completed",
        "content": [{"type": "output_text", "text": "visibility fixture reply", "annotations": []}]
    });
    let events = [
        json!({"type": "response.created", "response": {"id": "resp_fixture", "status": "in_progress", "output": []}}),
        json!({"type": "response.output_item.done", "output_index": 0, "item": message}),
        json!({"type": "response.completed", "response": {
            "id": "resp_fixture", "status": "completed", "output": [message],
            "usage": {"input_tokens": 10, "output_tokens": 3, "total_tokens": 13}
        }}),
    ];
    let body = events
        .iter()
        .map(|event| {
            format!(
                "event: {}\ndata: {event}\n\n",
                event["type"].as_str().unwrap()
            )
        })
        .collect::<String>();
    Mock::given(wiremock::matchers::method("POST"))
        .and(wiremock::matchers::path("/responses"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/event-stream")
                .set_body_string(body),
        )
        .expect(2)
        .mount(&server)
        .await;
    std::fs::write(home.join("config.toml"), format!(
        "model = \"gpt-5.4\"\nmodel_provider = \"orgii_test\"\n[model_providers.orgii_test]\nname = \"Local test\"\nbase_url = \"{}\"\nwire_api = \"responses\"\nrequires_openai_auth = false\nsupports_websockets = false\n",
        server.uri()
    )).unwrap();

    let project_id = {
        let home = native_home.clone();
        let workspace = project.clone();
        tokio::task::spawn_blocking(move || super::ensure_project(&home, &workspace))
            .await
            .unwrap()
            .expect("register Desktop project")
    };
    let reused_id = {
        let home = native_home.clone();
        let workspace = project.clone();
        tokio::task::spawn_blocking(move || super::ensure_project(&home, &workspace))
            .await
            .unwrap()
            .expect("reuse Desktop project")
    };
    assert_eq!(project_id, reused_id);
    let other_project_id = {
        let home = native_home.clone();
        let workspace = other_project.clone();
        tokio::task::spawn_blocking(move || super::ensure_project(&home, &workspace))
            .await
            .unwrap()
            .expect("register unrelated project")
    };
    let mut thread_id = None;
    for user_text in ["ORGII_VISIBLE_FRESH", "ORGII_VISIBLE_RESUME"] {
        // Execute outside the saved project root, as a managed worktree does.
        // Sidebar membership must use projectId rather than cwd equality.
        let working_dir = &execution_worktree;
        let mut child = tokio::process::Command::new(&binary)
            .arg("app-server")
            .arg("-c")
            .arg(format!(
                "sqlite_home={}",
                serde_json::to_string(&native_home).unwrap()
            ))
            .env("CODEX_HOME", &home)
            .env_remove("OPENAI_API_KEY")
            .env_remove("OPENAI_BASE_URL")
            .current_dir(working_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .expect("start real native process");
        let (tx, mut rx) = tokio::sync::mpsc::channel(256);
        let drain = tokio::spawn(async move { while rx.recv().await.is_some() {} });
        let turn = CodexAppServerTurn {
            session_id: "orgii-desktop-listability-fixture".to_string(),
            user_input: user_text.to_string(),
            developer_instructions: Some(
                "ORGII_PROVIDER_CONTEXT_MUST_NOT_BE_USER_TEXT".to_string(),
            ),
            working_dir: working_dir.to_string_lossy().to_string(),
            project_id: Some(project_id.clone()),
            resume_thread_id: thread_id.clone(),
            model: Some("gpt-5.4".to_string()),
            permission_mode: CliPermissionMode::Plan,
            config: None,
            image_paths: vec![],
            allow_native_context_recovery: false,
        };
        let outcome = tokio::time::timeout(
            Duration::from_secs(30),
            run_app_server_turn(
                child.stdin.take().unwrap(),
                child.stdout.take().unwrap(),
                turn,
                tx,
            ),
        )
        .await
        .expect("native turn timeout")
        .expect("native turn succeeds");
        assert_eq!(outcome.turn_status, "completed");
        if let Some(ref previous) = thread_id {
            assert_eq!(previous, &outcome.thread_id);
        }
        thread_id = Some(outcome.thread_id);
        child.kill().await.expect("stop completed app-server");
        child.wait().await.expect("reap app-server");
        drain.await.expect("chunk drain closes");

        // A new process must discover the thread through the exact default list
        // contract used by Desktop, without force-reading or revealing its id.
        let mut catalog =
            CodexAppServerRpcClient::launch(std::path::Path::new(&binary), &native_home, &project)
                .await
                .unwrap();
        let list = catalog
            .request(
                "thread/list",
                json!({
                    "limit": 20, "sourceKinds": [], "modelProviders": [], "archived": false,
                    "useStateDbOnly": true, "projectId": project_id
                }),
                Duration::from_secs(10),
            )
            .await
            .unwrap();
        let matches: Vec<_> = list["data"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|thread| thread["id"].as_str() == thread_id.as_deref())
            .collect();
        assert_eq!(
            matches.len(),
            1,
            "default Desktop list must contain the native thread once: {list}"
        );
        assert_ne!(matches[0]["source"], "exec");
        assert_eq!(matches[0]["projectId"], project_id);
        let projects = catalog
            .request(
                "project/list",
                json!({"limit": 20}),
                Duration::from_secs(10),
            )
            .await
            .unwrap();
        let projects = projects["data"].as_array().unwrap();
        assert_eq!(projects.len(), 2, "two Desktop projects, no duplicates");
        let target = projects
            .iter()
            .find(|entry| entry["id"] == project_id)
            .unwrap();
        assert_eq!(target["name"], "target project");
        assert_eq!(
            target["roots"][0]["path"],
            project.to_string_lossy().as_ref()
        );
        let other_members = catalog
            .request(
                "thread/list",
                json!({
                    "limit": 20, "sourceKinds": [], "modelProviders": [], "archived": false,
                    "useStateDbOnly": true, "projectId": other_project_id
                }),
                Duration::from_secs(10),
            )
            .await
            .unwrap();
        assert!(other_members["data"].as_array().unwrap().is_empty());
        assert_eq!(matches[0]["cwd"], working_dir.to_string_lossy().as_ref());
        // Directory discovery must not confuse storage/other roots with this thread.
        // Neither a different project nor the auth/index directory may claim it.
        for wrong_project in [&other_project, &home, &native_home] {
            let wrong_list = catalog
                .request(
                    "thread/list",
                    json!({
                        "limit": 20, "sourceKinds": [], "modelProviders": [], "archived": false,
                        "useStateDbOnly": true, "cwd": [wrong_project]
                    }),
                    Duration::from_secs(10),
                )
                .await
                .unwrap();
            assert!(
                wrong_list["data"].as_array().unwrap().is_empty(),
                "thread must not appear under {}: {wrong_list}",
                wrong_project.display()
            );
        }
    }
    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 2);
    for (request, expected) in requests
        .iter()
        .zip(["ORGII_VISIBLE_FRESH", "ORGII_VISIBLE_RESUME"])
    {
        let payload: serde_json::Value = request.body_json().unwrap();
        let users: Vec<_> = payload["input"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|item| item["role"] == "user")
            .collect();
        let last_user = users.last().expect("literal user message sent");
        assert_eq!(last_user["content"][0]["text"], expected);
        assert!(!last_user.to_string().contains("ORGII_PROVIDER_CONTEXT"));
    }
}

#[cfg(unix)]
#[tokio::test]
async fn native_slash_commands_drive_protocol_operations() {
    use std::process::Stdio;
    for (prompt, expected_method) in [
        ("/compact", "thread/compact/start"),
        ("/review auth", "review/start"),
        ("/fixture-skill hello", "turn/start"),
        ("/not-installed", ""),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join("requests.jsonl");
        let script = r#"
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$ORGII_SLASH_REQUESTS"
  case "$line" in
    *'"method":"initialize"'*) printf '%s\n' '{"id":1,"result":{}}' ;;
    *'"method":"thread/start"'*) printf '%s\n' '{"id":2,"result":{"thread":{"id":"fixture-thread"},"model":"fixture-model"}}' ;;
    *'"method":"skills/list"'*) printf '%s\n' '{"id":3,"result":{"data":[{"skills":[{"name":"fixture-skill","path":"/fixture/SKILL.md","enabled":true}]}]}}' ;;
    *'"method":"thread/compact/start"'*|*'"method":"review/start"'*|*'"method":"turn/start"'*)
      printf '%s\n' '{"id":4,"result":{"turn":{"id":"fixture-turn","status":"inProgress"}}}' '{"method":"turn/started","params":{"turn":{"id":"fixture-turn"}}}' '{"method":"item/completed","params":{"item":{"id":"compact-marker","type":"contextCompaction"}}}' '{"method":"turn/completed","params":{"turn":{"id":"fixture-turn","status":"completed"}}}'
      ;;
  esac
done
"#;
        let mut child = tokio::process::Command::new("sh")
            .args(["-c", script])
            .env("ORGII_SLASH_REQUESTS", &log)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let (tx, mut rx) = tokio::sync::mpsc::channel(256);
        let turn = CodexAppServerTurn {
            session_id: format!("slash-{expected_method}"),
            user_input: prompt.into(),
            developer_instructions: None,
            working_dir: dir.path().to_string_lossy().into_owned(),
            project_id: None,
            resume_thread_id: None,
            model: None,
            permission_mode: CliPermissionMode::Plan,
            config: None,
            image_paths: vec![],
            allow_native_context_recovery: false,
        };
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            super::run_app_server_turn(
                child.stdin.take().unwrap(),
                child.stdout.take().unwrap(),
                turn,
                tx,
            ),
        )
        .await
        .unwrap();
        if expected_method.is_empty() {
            assert!(result
                .err()
                .unwrap()
                .contains("does not expose /not-installed"));
        } else {
            let result = result.unwrap();
            assert_eq!(result.turn_status, "completed");
            assert_eq!(result.thread_id, "fixture-thread");
        }
        child.kill().await.unwrap();
        child.wait().await.unwrap();
        let requests = std::fs::read_to_string(&log).unwrap();
        if !expected_method.is_empty() {
            assert!(
                requests.contains(&format!("\"method\":\"{expected_method}\"")),
                "{requests}"
            );
        }
        if expected_method != "turn/start" {
            assert!(!requests.contains("\"method\":\"turn/start\""));
        }
        if prompt.starts_with("/fixture-skill") {
            assert!(requests.contains("\"type\":\"skill\""));
        }
        let mut saw_catalog = false;
        while let Ok(chunk) = rx.try_recv() {
            saw_catalog |= chunk
                .args
                .get("native_provider")
                .and_then(serde_json::Value::as_str)
                == Some("codex");
        }
        assert!(saw_catalog);
    }
}

/// Explicit live protocol acceptance. Requires an isolated CODEX_HOME with valid auth.
/// Unlike a mocked wire test, this fails if the real model cannot request or consume an answer.
#[tokio::test]
#[ignore = "requires isolated Codex auth and spends model tokens"]
async fn live_native_question_round_trip_in_plan_mode() {
    use std::process::Stdio;
    let home =
        std::env::var("ORGII_INTERACTION_TEST_CODEX_HOME").expect("set isolated test Codex home");
    let binary =
        std::env::var("ORGII_INTERACTION_TEST_CODEX_BINARY").unwrap_or_else(|_| "codex".into());
    let work = tempfile::tempdir().unwrap();
    let session = format!("cliagent-live-question-{}", uuid::Uuid::new_v4());
    let mut child = tokio::process::Command::new(binary)
        .arg("app-server")
        .env("CODEX_HOME", home)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .expect("start native Codex");
    let (tx, mut rx) = tokio::sync::mpsc::channel(256);
    let turn = CodexAppServerTurn {
        session_id: session.clone(),
        user_input: "Use request_user_input to ask me to choose Alpha or Beta. Wait for the tool answer, then reply with only the chosen label. Do not use other tools or propose a plan.".into(),
        developer_instructions: None,
        working_dir: work.path().to_string_lossy().into_owned(),
        project_id: None, resume_thread_id: None,
        model: Some("gpt-6-astra".into()),
        permission_mode: CliPermissionMode::Plan,
        config: Some(json!({"model_reasoning_effort":"medium"})),
        image_paths: vec![], allow_native_context_recovery: false,
    };
    let stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let protocol = tokio::spawn(super::run_app_server_turn(stdin, stdout, turn, tx));
    let mut answered = false;
    let mut text = String::new();
    let drain = tokio::time::timeout(std::time::Duration::from_secs(180), async {
        while let Some(chunk) = rx.recv().await {
            if chunk.function == "ask_user_questions" {
                assert!(!answered, "expected exactly one native question");
                let questions = chunk.args["questions"].as_array().unwrap();
                let answers = questions.iter().map(|_| vec!["Beta".to_string()]).collect();
                crate::agent_sessions::cli::interactions::respond(
                    &session,
                    chunk.result["native_request_id"].as_str().unwrap(),
                    Some(answers),
                    true,
                )
                .await
                .unwrap();
                answered = true;
            }
            if chunk.action_type == "assistant" {
                if let Some(content) = chunk.result["content"].as_str() {
                    text.push_str(content);
                }
            }
        }
    })
    .await;
    if drain.is_err() {
        protocol.abort();
    }
    child.kill().await.ok();
    child.wait().await.ok();
    assert!(drain.is_ok(), "native question timed out");
    let result = protocol.await.unwrap().unwrap();
    assert_eq!(result.turn_status, "completed");
    assert!(answered, "native model never requested user input: {text}");
    assert!(
        text.contains("Beta"),
        "model did not consume selected answer: {text}"
    );
}
