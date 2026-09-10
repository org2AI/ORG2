//! Standard transport: read CLI stdout line by line through a
//! `CliAgentParser`, handling plan-approval gating and oauth/overload retry
//! signal detection.

use std::path::{Path, PathBuf};

use tokio::io::BufReader;
use tokio::process::Child;

use crate::api::websocket_handler;
use key_vault::key_store::ModelType;

use super::super::super::persistence;
use super::super::super::types::SessionStatus;
use super::super::command::create_parser;
use super::super::helpers::{
    clear_live_status, emit_chunk, flush_and_broadcast, snapshot_cli_file_edit,
};
use super::super::oauth_setup::{
    is_cli_chunk_replay_unsafe, is_cli_oauth_failure_message, is_cli_oauth_stderr_retry_candidate,
    is_retryable_cli_oauth_failure_chunk, is_retryable_overloaded_chunk,
};
use super::super::plan_approval::{
    create_plan_content_from_chunk, is_successful_mode_tool, plan_candidate_path_from_chunk,
    register_cli_plan_approval, register_synthetic_cli_plan_approval,
};

const CLI_PLAN_GATE_NATURAL_EXIT_GRACE_SECS: u64 = 45;

pub(super) struct StandardOutcome {
    pub(super) exit_code: i32,
    pub(super) timed_out: bool,
    pub(super) cli_plan_approval_gate_reached: bool,
    pub(super) cli_session_id_out: Option<String>,
    pub(super) retryable_oauth_message: Option<String>,
    pub(super) retryable_overload_message: Option<String>,
    pub(super) terminal_error_message: Option<String>,
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn run_standard_branch(
    mut child: Child,
    session_id: String,
    oauth_retry_eligible: bool,
    overload_retry_eligible: bool,
    agent: ModelType,
    mode: Option<&str>,
    account_id: Option<&str>,
    model: Option<&str>,
    session_timeout: tokio::time::Duration,
    pre_message_snapshot_id: Option<String>,
    snapshot_working_dir: String,
    mut cli_session_id_out: Option<String>,
    sequence: &mut i64,
    attempt_stderr: &mut super::CliStderrCollector,
    turn_intent_id: Option<&str>,
) -> StandardOutcome {
    let mut retryable_oauth_message: Option<String> = None;
    let mut retryable_overload_message: Option<String> = None;
    let mut terminal_error_message: Option<String> = None;
    let mut replay_unsafe_output_seen = false;

    // ── Standard agents: read stdout line by line through CliAgentParser ──
    let mut interactions =
        crate::agent_sessions::cli::interactions::InteractionRun::new(&session_id);
    let mut stdin = child.stdin.take();
    let mut parser = create_parser(&agent, &session_id);
    let stdout = child.stdout.take().expect("stdout was piped");
    let mut reader = BufReader::new(stdout);
    let mut line_buf = Vec::with_capacity(4096);
    let mut last_plan_candidate_path: Option<PathBuf> = None;
    let mut cli_plan_active = mode == Some("plan");
    let mut cli_plan_registered_this_turn = false;
    let mut cli_plan_approval_gate_triggered = false;
    let mut cli_plan_gate_announced = false;
    let mut cli_plan_drain_timed_out = false;

    let read_result = tokio::time::timeout(session_timeout, async {
        use tokio::io::AsyncBufReadExt;
        loop {
            let read_next_line = reader.read_until(b'\n', &mut line_buf);
            let read_next_line = if cli_plan_approval_gate_triggered {
                match tokio::time::timeout(
                    tokio::time::Duration::from_secs(CLI_PLAN_GATE_NATURAL_EXIT_GRACE_SECS),
                    read_next_line,
                )
                .await
                {
                    Ok(result) => result,
                    Err(_) => {
                        cli_plan_drain_timed_out = true;
                        tracing::warn!(
                            "[CodeSession] CLI plan gate reached for {}; stdout did not close within {}s",
                            session_id,
                            CLI_PLAN_GATE_NATURAL_EXIT_GRACE_SECS
                        );
                        break;
                    }
                }
            } else {
                tokio::select! {
                    result = read_next_line => result,
                    reply = interactions.receiver.recv(), if stdin.is_some() => {
                        if let Some(reply) = reply {
                            use tokio::io::AsyncWriteExt;
                            let wire = crate::agent_sessions::cli::interactions_protocol::claude_response(&reply);
                            let result = stdin.as_mut().expect("guarded stdin").write_all(format!("{wire}\n").as_bytes()).await.map_err(|e| e.to_string());
                            crate::agent_sessions::cli::interactions::finalize_reply(&session_id, &reply, result.is_ok());
                            let failed = result.is_err();
                            let _ = reply.acknowledgement.send(result);
                            if failed { break; }
                        }
                        continue;
                    }
                }
            };
            match read_next_line {
                Ok(0) => break,
                Ok(_) => {
                    let line = String::from_utf8_lossy(&line_buf).trim_end().to_string();
                    line_buf.clear();
                    if line.is_empty() {
                        continue;
                    }

                    if matches!(agent, ModelType::ClaudeCode) {
                        if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&line) {
                            if msg["type"] == "control_request" {
                                if msg["request"]["tool_name"] == "ExitPlanMode" {
                                    let content = msg["request"]["input"]["plan"].as_str().unwrap_or_default();
                                    let plan_result = if content.trim().is_empty() { Err("Claude submitted an empty plan".to_string()) }
                                        else { register_synthetic_cli_plan_approval(&session_id, content, "native-plan", *sequence).await };
                                    match plan_result {
                                        Ok(plan) => {
                                            emit_chunk(&plan, &session_id, sequence, turn_intent_id).await;
                                            cli_plan_registered_this_turn = true;
                                            cli_plan_approval_gate_triggered = true;
                                        }
                                        Err(error) => { terminal_error_message = Some(error); }
                                    }
                                    use tokio::io::AsyncWriteExt;
                                    let response = serde_json::json!({"type":"control_response","response":{"subtype":"success","request_id":msg["request_id"],"response":{"behavior":"deny","message":"The plan is awaiting review in ORG2. Stop this turn without implementing it. An approved plan will arrive in a subsequent user message."}}});
                                    if let Some(stdin) = stdin.as_mut() { let _ = stdin.write_all(format!("{response}\n").as_bytes()).await; }
                                    continue;
                                }
                                match crate::agent_sessions::cli::interactions_protocol::claude_request(&interactions, &session_id, &msg) {
                                    Ok(Some(chunk)) => emit_chunk(&chunk, &session_id, sequence, turn_intent_id).await,
                                    Ok(None) => {},
                                    Err(error) => {
                                        use tokio::io::AsyncWriteExt;
                                        let response = serde_json::json!({"type":"control_response","response":{"subtype":"error","request_id":msg["request_id"],"error":error}});
                                        if let Some(stdin) = stdin.as_mut() { let _ = stdin.write_all(format!("{response}\n").as_bytes()).await; }
                                    }
                                }
                                continue;
                            }
                            // Stream input keeps stdin open. A result completes this run.
                            if msg["type"] == "result" { stdin.take(); }
                        }
                    }
                    let chunks = parser.parse_line(&line);
                    // Bind the CLI's native conversation id as soon
                    // as the parser sees it (Claude emits it in the
                    // "system" init event) instead of only after
                    // exit: native-transcript replay, dedup, and
                    // live-status attribution all key on it, and a
                    // crash mid-turn must not orphan the transcript.
                    if cli_session_id_out.is_none() {
                        if let Some(cli_sid) = parser.cli_session_id() {
                            cli_session_id_out = Some(cli_sid.clone());
                            if let Err(err) = persistence::update_cli_session_id_for_account(
                                &session_id,
                                account_id,
                                &cli_sid,
                            ) {
                                tracing::warn!(
                                    "[CodeSession] Failed to bind early cli_session_id: {}",
                                    err
                                );
                            }
                            websocket_handler::broadcast(
                                serde_json::json!({
                                    "type": "code_session.cli_session_bound",
                                    "session_id": session_id,
                                    "cli_session_id": cli_sid,
                                })
                                .to_string(),
                            );
                        }
                    }
                    for chunk in chunks {
                        // The control request owns the actionable question. The stdout
                        // start is its transcript echo and has no response address yet.
                        // Its completed tool result still merges by the native call id.
                        if matches!(agent, ModelType::ClaudeCode) && chunk.function == "ask_user_questions" && chunk.result["status"] == "running" {
                            continue;
                        }
                        if cli_plan_approval_gate_triggered {
                            continue;
                        }

                        // Retain the structured terminal body before deciding
                        // whether this attempt is safe to retry. Intermediate
                        // attempts overwrite this outcome on the next pass;
                        // the last exhausted attempt must not lose its body.
                        super::record_terminal_cli_error(&mut terminal_error_message, &chunk);

                        if !replay_unsafe_output_seen {
                            if let Some(message) = is_retryable_cli_oauth_failure_chunk(
                                oauth_retry_eligible,
                                &chunk,
                            ) {
                                retryable_oauth_message = Some(message);
                                break;
                            }
                        }

                        if overload_retry_eligible {
                            if let Some(message) = is_retryable_overloaded_chunk(&chunk) {
                                retryable_overload_message = Some(message);
                                break;
                            }
                        }

                        if is_cli_chunk_replay_unsafe(&chunk) {
                            replay_unsafe_output_seen = true;
                        }

                        if let Some(snap_id) = &pre_message_snapshot_id {
                            snapshot_cli_file_edit(
                                &session_id,
                                snap_id,
                                &chunk,
                                &snapshot_working_dir,
                            )
                            .await;
                        }
                        if is_successful_mode_tool(&chunk, "enter_plan_mode") {
                            cli_plan_active = true;
                        }
                        // Plan registration accepts only explicit signals:
                        // a plan-shaped tool call (e.g. Cursor's plan tool),
                        // a successful write to a plan markdown file, or
                        // exit_plan_mode. The former assistant-text
                        // heuristic (keyword-sniffing normal replies into
                        // synthetic plan cards) produced false-positive
                        // cards and was removed.
                        if !matches!(agent, ModelType::ClaudeCode) && cli_plan_active && !cli_plan_registered_this_turn {
                            if let Some(plan_text) = create_plan_content_from_chunk(&chunk)
                            {
                                match register_synthetic_cli_plan_approval(
                                    &session_id,
                                    &plan_text,
                                    &chunk.chunk_id,
                                    *sequence,
                                )
                                .await
                                {
                                    Ok(plan_chunk) => {
                                        emit_chunk(
                                            &plan_chunk,
                                            &session_id,
                                            sequence,
                                            turn_intent_id,
                                        )
                                        .await;
                                        cli_plan_registered_this_turn = true;
                                        cli_plan_approval_gate_triggered = true;
                                    }
                                    Err(err) => {
                                        tracing::warn!(
                                            "[CodeSession] Failed to register synthetic CLI plan approval for {}: {}",
                                            session_id,
                                            err
                                        );
                                    }
                                }
                            }
                        }
                        if let Some(candidate_path) =
                            plan_candidate_path_from_chunk(&chunk, Path::new(&snapshot_working_dir))
                        {
                            last_plan_candidate_path = Some(candidate_path);
                            if !matches!(agent, ModelType::ClaudeCode) && cli_plan_active
                                && !cli_plan_registered_this_turn
                            {
                                match register_cli_plan_approval(
                                    &session_id,
                                    &chunk,
                                    last_plan_candidate_path.as_ref().unwrap(),
                                )
                                .await
                                {
                                    Ok(plan_chunk) => {
                                        emit_chunk(
                                            &plan_chunk,
                                            &session_id,
                                            sequence,
                                            turn_intent_id,
                                        )
                                        .await;
                                        cli_plan_registered_this_turn = true;
                                        cli_plan_approval_gate_triggered = true;
                                    }
                                    Err(err) => {
                                        tracing::warn!(
                                            "[CodeSession] Failed to register CLI plan approval for {}: {}",
                                            session_id,
                                            err
                                        );
                                    }
                                }
                            }
                        }
                        if is_successful_mode_tool(&chunk, "exit_plan_mode") {
                            if !cli_plan_registered_this_turn {
                                if let Some(plan_path) = last_plan_candidate_path.as_ref() {
                                    match register_cli_plan_approval(
                                        &session_id,
                                        &chunk,
                                        plan_path,
                                    )
                                    .await
                                    {
                                        Ok(plan_chunk) => {
                                            emit_chunk(
                                                &plan_chunk,
                                                &session_id,
                                                sequence,
                                                turn_intent_id,
                                            )
                                            .await;
                                            cli_plan_registered_this_turn = true;
                                            cli_plan_approval_gate_triggered = true;
                                        }
                                        Err(err) => {
                                            tracing::warn!(
                                                "[CodeSession] Failed to register CLI plan approval for {}: {}",
                                                session_id,
                                                err
                                            );
                                        }
                                    }
                                } else {
                                    tracing::warn!(
                                        "[CodeSession] exit_plan_mode succeeded without a plan file candidate for {}",
                                        session_id
                                    );
                                }
                            }
                            cli_plan_active = false;
                        }
                        emit_chunk(&chunk, &session_id, sequence, turn_intent_id).await;
                        if cli_plan_approval_gate_triggered && !cli_plan_gate_announced {
                            cli_plan_gate_announced = true;
                            tracing::info!(
                                "[CodeSession] CLI plan approval gate reached for {}; draining child output until natural exit",
                                session_id
                            );
                            // Terminal-at-sentinel: the plan card is the only thing
                            // awaiting the user now. Unlock the composer immediately
                            // instead of holding Stop for up to the 45s drain window
                            // while the child process winds down. The final
                            // status_changed after child exit is idempotent.
                            flush_and_broadcast(&session_id, turn_intent_id).await;
                            // The plan card supersedes any hook-derived
                            // waiting/working entry for this turn.
                            clear_live_status(
                                &agent,
                                &session_id,
                                cli_session_id_out.as_deref(),
                            );
                            if let Err(err) = persistence::update_status(
                                &session_id,
                                SessionStatus::Completed,
                            ) {
                                tracing::warn!(
                                    "[CodeSession] Failed to persist plan-gate completed status for {}: {}",
                                    session_id,
                                    err
                                );
                            }
                            websocket_handler::broadcast(
                                serde_json::json!({
                                    "type": "code_session.status_changed",
                                    "session_id": session_id,
                                    "status": SessionStatus::Completed.as_ref(),
                                    "plan_gate": true,
                                })
                                .to_string(),
                            );
                        }
                    }
                    if retryable_oauth_message.is_some()
                        || retryable_overload_message.is_some()
                    {
                        break;
                    }
                }
                Err(err) => {
                    tracing::error!("[CodeSession] stdout read error: {}", err);
                    break;
                }
            }
            if retryable_oauth_message.is_some() || retryable_overload_message.is_some() {
                break;
            }
        }
    })
    .await;
    let timed_out = read_result.is_err();
    let cli_plan_approval_gate_reached = cli_plan_approval_gate_triggered;

    let kill_for_oauth_retry = retryable_oauth_message.is_some() && !timed_out;
    let kill_for_overload_retry = retryable_overload_message.is_some() && !timed_out;
    if kill_for_oauth_retry || kill_for_overload_retry {
        if let Some(pid) = child.id() {
            super::super::lifecycle::terminate_process_tree(pid as i64, &session_id).await;
        } else if let Err(err) = child.start_kill() {
            tracing::warn!(
                "[CodeSession] Failed to start retry kill for {}: {}",
                session_id,
                err
            );
        }
    }
    let pre_exit_status = if kill_for_oauth_retry || kill_for_overload_retry {
        tokio::time::timeout(tokio::time::Duration::from_secs(2), child.wait())
            .await
            .map_err(|_| {
                std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "CLI child wait timed out after retry kill",
                )
            })
    } else if cli_plan_approval_gate_triggered && !timed_out {
        if cli_plan_drain_timed_out {
            tracing::warn!(
                "[CodeSession] CLI plan gate reached for {}; child did not exit naturally after stdout drain, killing",
                session_id
            );
            if let Some(pid) = child.id() {
                super::super::lifecycle::terminate_process_tree(pid as i64, &session_id).await;
            } else if let Err(err) = child.start_kill() {
                tracing::warn!(
                    "[CodeSession] Failed to start plan-gate kill for {}: {}",
                    session_id,
                    err
                );
            }
            tokio::time::timeout(tokio::time::Duration::from_secs(2), child.wait())
                .await
                .map_err(|_| {
                    std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        "CLI child wait timed out after plan-gate kill",
                    )
                })
        } else {
            Ok(child.wait().await)
        }
    } else {
        Ok(child.wait().await)
    };
    let exit_code = pre_exit_status
        .as_ref()
        .ok()
        .and_then(|status_result| status_result.as_ref().ok())
        .and_then(|status| status.code())
        .unwrap_or(-1);

    // The child is gone; collect the rest of its stderr before anything reads
    // it. The OAuth probe below is the whole reason the retry exists.
    attempt_stderr.drain().await;

    if retryable_oauth_message.is_none()
        && is_cli_oauth_stderr_retry_candidate(
            oauth_retry_eligible,
            exit_code,
            replay_unsafe_output_seen,
        )
    {
        let buf = attempt_stderr.lines();
        let buf = buf.lock().await;
        retryable_oauth_message = buf
            .iter()
            .find(|line| is_cli_oauth_failure_message(line))
            .cloned();
    }

    if retryable_oauth_message.is_none()
        && retryable_overload_message.is_none()
        && !cli_plan_approval_gate_triggered
    {
        let exit_chunks = parser.on_exit(exit_code);
        for chunk in &exit_chunks {
            super::record_terminal_cli_error(&mut terminal_error_message, chunk);
            if !replay_unsafe_output_seen {
                if let Some(message) =
                    is_retryable_cli_oauth_failure_chunk(oauth_retry_eligible, chunk)
                {
                    retryable_oauth_message = Some(message);
                    break;
                }
            }
            if overload_retry_eligible {
                if let Some(message) = is_retryable_overloaded_chunk(chunk) {
                    retryable_overload_message = Some(message);
                    break;
                }
            }
            if let Some(snap_id) = &pre_message_snapshot_id {
                snapshot_cli_file_edit(&session_id, snap_id, chunk, &snapshot_working_dir).await;
            }
            emit_chunk(chunk, &session_id, sequence, turn_intent_id).await;
        }
    }

    if retryable_oauth_message.is_none() && retryable_overload_message.is_none() {
        // Keep an early-bound id when a retried attempt's fresh
        // parser never saw one (don't clobber Some with None).
        if let Some(cli_sid) = parser.cli_session_id() {
            cli_session_id_out = Some(cli_sid);
        }

        if let Some(ref usage) = parser.token_usage() {
            let round_model = usage.model.as_deref().or(model);
            if let Err(err) = session_persistence::token_usage::insert_token_usage_record(
                &session_id,
                "code",
                round_model,
                account_id,
                usage.input_tokens as i64,
                usage.output_tokens as i64,
                usage.cache_read_tokens as i64,
                usage.cache_write_tokens as i64,
                usage.total_tokens as i64,
                0,
                None,
            ) {
                tracing::warn!(
                    "[CodeSession] Failed to insert per-round token usage: {}",
                    err
                );
            }
        }
    }

    StandardOutcome {
        exit_code,
        timed_out,
        cli_plan_approval_gate_reached,
        cli_session_id_out,
        retryable_oauth_message,
        retryable_overload_message,
        terminal_error_message,
    }
}
