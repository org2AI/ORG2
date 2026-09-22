//! Concurrent execution of read-only tool call groups.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;

use serde_json::Value;
use tracing::info;

use crate::core::tools::traits::ToolExecuteResult;
use crate::providers::traits::ToolCallRequest;
use crate::specialization::policies::activation::SessionScopedContextActivator;
use crate::tools::policy::ResolvedToolPolicy;
use crate::tools::registry::ToolRegistry;

use super::super::file_tracker::{extract_file_paths, FileTimeTracker, FILE_READ_TOOLS};
use super::super::helpers::{
    add_tool_result, add_tool_result_rich_with_timestamp, add_tool_result_with_timestamp,
    check_permission, truncate_output,
};
use super::super::types::{PermissionProvider, TurnEventHandler};
use super::super::usage_telemetry::{serialized_value_bytes, string_bytes, ToolExecutionUsage};

use super::detect_stream_parse_error;
use super::is_cancelled;
use super::is_error_text;
use super::normalize_tool_use_concurrency;
use super::ToolBatchOutcome;
use super::ToolResultAggregateBudget;

pub(super) enum ParallelResult {
    Continue(usize, Vec<ToolExecutionUsage>),
    EarlyExit(usize, Vec<ToolExecutionUsage>, ToolBatchOutcome),
}

/// Execute a group of read-only tool calls concurrently.
///
/// Pre-execution hooks and post-execution processing happen sequentially,
/// but the actual tool calls run in parallel via `join_all`.
#[allow(clippy::too_many_arguments)]
pub(super) async fn execute_parallel_group(
    messages: &mut Vec<Value>,
    calls: &[&ToolCallRequest],
    tools: &ToolRegistry,
    policy: &ResolvedToolPolicy,
    session_id: &str,
    turn_intent_id: &str,
    projected_inbox_ids: &[i64],
    turn_process_control: Option<&crate::tools::call_context::TurnProcessControl>,
    handler: &dyn TurnEventHandler,
    permission_provider: Option<&dyn PermissionProvider>,
    cancel_flag: Option<&Arc<AtomicBool>>,
    file_tracker: &mut FileTimeTracker,
    consecutive_errors: &mut u32,
    policy_context_activator: Option<&SessionScopedContextActivator>,
    max_tool_use_concurrency: usize,
    aggregate_budget: &mut ToolResultAggregateBudget,
) -> ParallelResult {
    info!(
        "[agent-core] Executing {} concurrency-safe tools concurrently",
        calls.len()
    );

    struct PreparedCall {
        index: usize,
        effective_args: Value,
        display_name: String,
        was_blocked: bool,
        blocked_result: String,
    }

    let mut prepared: Vec<PreparedCall> = Vec::with_capacity(calls.len());
    let mut denied_count: usize = 0;

    for (idx, call) in calls.iter().enumerate() {
        let args_preview: String =
            crate::utils::safe_truncate_chars_to_string(&call.arguments.to_string(), 200);
        info!("[agent-core] Tool call: {}({})", call.name, args_preview);

        if is_cancelled(cancel_flag) {
            return ParallelResult::EarlyExit(
                denied_count,
                Vec::new(),
                ToolBatchOutcome::Cancelled,
            );
        }

        let display_name = match call
            .arguments
            .get("action")
            .and_then(|v: &Value| v.as_str())
        {
            Some(action) => format!("{}_{}", call.name, action),
            None => call.name.clone(),
        };

        handler.on_tool_call(
            session_id,
            &call.id,
            &call.name,
            &display_name,
            &call.arguments,
        );

        let intervention = handler
            .before_tool_execute(session_id, &call.name, &call.arguments)
            .await;

        let (blocked_result, was_blocked) = if let Some(ref hook) = intervention {
            if hook.block {
                let reason = hook.block_reason.as_deref().unwrap_or("Blocked by plugin");
                info!(
                    "[agent-core] Tool {} blocked by plugin: {}",
                    call.name, reason
                );
                (format!("Error: {}", reason), true)
            } else {
                (String::new(), false)
            }
        } else {
            (String::new(), false)
        };

        if was_blocked {
            prepared.push(PreparedCall {
                index: idx,
                effective_args: call.arguments.clone(),
                display_name,
                was_blocked: true,
                blocked_result,
            });
            continue;
        }

        let effective_args = intervention
            .and_then(|h| h.modified_params)
            .unwrap_or_else(|| call.arguments.clone());

        // Same streaming parse-error short-circuit as `single.rs`. We
        // short-circuit here *before* permission/execution so the
        // model sees a clear "retry tool call" error message instead
        // of a confusing schema-validation failure from the tool
        // itself. See `detect_stream_parse_error` for the rationale.
        if let Some(err_msg) = detect_stream_parse_error(&effective_args) {
            tracing::warn!(
                "[agent-core] Short-circuiting parallel tool '{}' due to stream parse error",
                call.name
            );
            handler.on_tool_result(session_id, &call.id, &call.name, &display_name, &err_msg);
            add_tool_result(messages, &call.id, &call.name, &err_msg, true);
            *consecutive_errors += 1;
            denied_count += 1;
            continue;
        }

        if let Some(denied_msg) = check_permission(
            policy,
            permission_provider,
            session_id,
            &call.name,
            &call.id,
            &effective_args,
            cancel_flag,
        )
        .await
        {
            if is_cancelled(cancel_flag) {
                return ParallelResult::EarlyExit(
                    denied_count,
                    Vec::new(),
                    ToolBatchOutcome::Cancelled,
                );
            }
            handler.on_tool_result(session_id, &call.id, &call.name, &display_name, &denied_msg);
            add_tool_result(messages, &call.id, &call.name, &denied_msg, true);
            denied_count += 1;
            continue;
        }

        prepared.push(PreparedCall {
            index: idx,
            effective_args,
            display_name,
            was_blocked: false,
            blocked_result: String::new(),
        });
    }

    struct ExecResult {
        index: usize,
        /// Full structured result from `Tool::execute`. The MCP bridge
        /// populates `content_blocks` / `mcp_meta`; native tools leave
        /// them empty. On policy-deny or internal error, this is
        /// `Err(msg)` and carries only the error string.
        raw_result: Result<ToolExecuteResult, String>,
        duration_ms: u64,
        effective_args: Value,
        display_name: String,
    }

    let mut blocked_results: Vec<(usize, String, String)> = Vec::new();
    let mut futures_to_run: Vec<(usize, Value, String)> = Vec::new();

    for prep in prepared {
        if prep.was_blocked {
            blocked_results.push((prep.index, prep.display_name, prep.blocked_result));
            continue;
        }

        if is_cancelled(cancel_flag) {
            return ParallelResult::EarlyExit(
                denied_count,
                Vec::new(),
                ToolBatchOutcome::Cancelled,
            );
        }
        let call = calls[prep.index];
        handler.on_tool_execute_start(session_id, &call.id, &call.name, &prep.effective_args);
        futures_to_run.push((prep.index, prep.effective_args, prep.display_name));
    }

    let concurrency_limit = normalize_tool_use_concurrency(max_tool_use_concurrency);
    let mut exec_outputs = Vec::with_capacity(futures_to_run.len());

    for chunk in futures_to_run.chunks(concurrency_limit) {
        let exec_futures: Vec<_> = chunk
            .iter()
            .map(|(idx, effective_args, _display_name)| {
                let tool_name = &calls[*idx].name;
                let call_id = &calls[*idx].id;
                let ctx = crate::tools::call_context::CallContext::for_runtime_turn(
                    call_id,
                    session_id,
                    turn_intent_id,
                    projected_inbox_ids.to_vec(),
                    turn_process_control.cloned(),
                )
                .with_authority(policy.call_authority());
                let args = effective_args.clone();
                async move {
                    let start = Instant::now();
                    let raw_result = tools
                        .execute_with_policy(tool_name, args, policy, &ctx)
                        .await;
                    let duration_ms = start.elapsed().as_millis() as u64;
                    (*idx, raw_result, duration_ms)
                }
            })
            .collect();

        exec_outputs.extend(futures::future::join_all(exec_futures).await);
    }

    let mut results_by_index: std::collections::BTreeMap<usize, ExecResult> =
        std::collections::BTreeMap::new();
    for ((idx, raw_result, duration_ms), (_, effective_args, display_name)) in
        exec_outputs.into_iter().zip(futures_to_run)
    {
        results_by_index.insert(
            idx,
            ExecResult {
                index: idx,
                raw_result,
                duration_ms,
                effective_args,
                display_name,
            },
        );
    }

    let mut executed_count = 0;
    let mut execution_usage = Vec::new();

    for (idx, display_name, result) in &blocked_results {
        let call = calls[*idx];
        let is_err = is_error_text(result);
        handler.on_tool_result(session_id, &call.id, &call.name, display_name, result);
        add_tool_result_with_timestamp(messages, &call.id, &call.name, result, is_err);
        executed_count += 1;
        execution_usage.push(ToolExecutionUsage {
            tool_call_id: call.id.clone(),
            tool_name: call.name.clone(),
            input_bytes: serialized_value_bytes(&call.arguments),
            output_bytes: string_bytes(result),
        });

        if is_err {
            *consecutive_errors += 1;
        } else {
            *consecutive_errors = 0;
        }
    }

    // join_all has already executed this batch. A turn directive may stop the
    // next group, but must not discard the remaining completed outputs: the
    // event handler persists them as the authoritative tool history.
    let mut early_exit = None;
    for (_idx, exec_result) in results_by_index {
        let call = calls[exec_result.index];

        // Split the exec outcome into:
        //   - `raw_text`: the LLM-facing string (always present; error
        //     messages on the Err path, tool text on the Ok path).
        //   - `rich`: the full structured result on the Ok path, used by
        //     the Anthropic-native wire to attach image/audio/resource
        //     blocks + `_meta` to the outgoing tool message. `None` on
        //     the Err path.
        let (raw_text, rich): (String, Option<ToolExecuteResult>) = match exec_result.raw_result {
            Ok(result) => (result.text.clone(), Some(result)),
            Err(msg) => (msg, None),
        };
        let is_error = rich.is_none() || is_error_text(&raw_text);

        // Single entry point keeps read/write bookkeeping identical to the
        // sequential path in `single.rs` (no drift).
        file_tracker.record_tool_file_effects(&call.name, &exec_result.effective_args, is_error);

        let tool_ref = tools.get(&call.name);
        let budget = tool_ref.map(|t| t.output_budget());
        let allow_persist = tool_ref.map(|t| t.allow_persisted_output()).unwrap_or(true);
        let mut truncated = aggregate_budget.inline_result(
            &raw_text,
            budget,
            allow_persist,
            session_id,
            &call.name,
        );

        if truncated.trim().is_empty() {
            truncated = "[No output]".to_string();
        }

        // Hook/policy appends happen after budget accounting, so cap them —
        // an uncapped hook would bypass both the per-tool and aggregate
        // budgets. Mirrors the sequential path in `single.rs`.
        // Completed results must still be persisted after cancellation, but
        // optional enrichment and user-hook dispatch must not start new work.
        if !is_cancelled(cancel_flag) {
            if let Some(extra) = handler
                .post_tool_hook(&call.name, &exec_result.effective_args, &truncated)
                .await
            {
                truncated.push_str(&truncate_output(&extra, Some(super::HOOK_APPEND_MAX_CHARS)));
            }
        }

        if FILE_READ_TOOLS.contains(&call.name.as_str()) && !is_error {
            let paths = extract_file_paths(&call.name, &exec_result.effective_args);
            if let Some(extra) = policy_context_activator
                .and_then(|activator| activator.augment_for_read_paths(&paths))
            {
                truncated.push_str(&truncate_output(&extra, Some(super::HOOK_APPEND_MAX_CHARS)));
            }
        }

        let error_str = if is_error {
            Some(raw_text.as_str())
        } else {
            None
        };
        // A cancellation may arrive while the preceding hook is running.
        if !is_cancelled(cancel_flag) {
            handler
                .after_tool_execute(
                    session_id,
                    &call.id,
                    &call.name,
                    &exec_result.effective_args,
                    &truncated,
                    error_str,
                    exec_result.duration_ms,
                )
                .await;
        }

        let ui_metadata = tools
            .get(&call.name)
            .and_then(|tool| tool.ui_metadata(&exec_result.effective_args, &truncated));

        handler.on_tool_result_with_metadata(
            session_id,
            &call.id,
            &call.name,
            &exec_result.display_name,
            &truncated,
            ui_metadata.as_ref(),
        );
        // Carry the in-block `is_error` decision through to the wire
        // emitter. We want the post-truncation/persistence flag, so
        // re-evaluate against the final string the LLM will see; this
        // also catches the rare case where `truncate_output` collapses
        // a non-error into an empty `[No output]` (still success).
        let truncated_is_error = is_error || is_error_text(&truncated);
        match rich.as_ref() {
            Some(rich_result) if rich_result.has_structured_payload() => {
                // Carry structured content_blocks / mcp_meta in the
                // `_orgii_structured` sidecar so Anthropic-native
                // provider can promote them to top-level user.content[].
                add_tool_result_rich_with_timestamp(
                    messages,
                    &call.id,
                    &call.name,
                    &truncated,
                    rich_result,
                    truncated_is_error,
                );
            }
            _ => {
                add_tool_result_with_timestamp(
                    messages,
                    &call.id,
                    &call.name,
                    &truncated,
                    truncated_is_error,
                );
            }
        }
        executed_count += 1;
        execution_usage.push(ToolExecutionUsage {
            tool_call_id: call.id.clone(),
            tool_name: call.name.clone(),
            input_bytes: serialized_value_bytes(&exec_result.effective_args),
            output_bytes: string_bytes(&truncated),
        });

        if matches!(
            rich.as_ref().and_then(|result| result.turn_directive),
            Some(crate::tools::result::ToolTurnDirective::EndTurn)
        ) {
            early_exit.get_or_insert_with(|| ToolBatchOutcome::EndTurn(String::new()));
        }

        if is_cancelled(cancel_flag) {
            early_exit.get_or_insert(ToolBatchOutcome::Cancelled);
        }

        if is_error_text(&truncated) {
            *consecutive_errors += 1;
            if *consecutive_errors >= super::super::MAX_CONSECUTIVE_ERRORS {
                let mut end = truncated.len().min(300);
                while !truncated.is_char_boundary(end) && end > 0 {
                    end -= 1;
                }
                early_exit.get_or_insert_with(|| {
                    ToolBatchOutcome::ErrorLoop(format!(
                        "I encountered {} consecutive tool errors and stopped to avoid wasting resources. \
                         The last error was: {}",
                        *consecutive_errors,
                        &truncated[..end]
                    ))
                });
            }
        } else {
            *consecutive_errors = 0;
        }
    }

    match early_exit {
        Some(outcome) => {
            ParallelResult::EarlyExit(executed_count + denied_count, execution_usage, outcome)
        }
        None => ParallelResult::Continue(executed_count + denied_count, execution_usage),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::turn::event_handler::{EventHandlerConfig, UnifiedEventHandler};
    use crate::tools::traits::{CallContext, Tool, ToolError};
    use async_trait::async_trait;

    struct CompletedBatchTool {
        first_is_error: bool,
    }

    #[async_trait]
    impl Tool for CompletedBatchTool {
        fn name(&self) -> &str {
            "read_fixture"
        }
        fn description(&self) -> &str {
            "Read a synthetic fixture"
        }
        fn parameters(&self) -> Value {
            serde_json::json!({"type":"object"})
        }
        fn is_concurrency_safe(&self) -> bool {
            true
        }
        async fn execute(
            &self,
            args: Value,
            _: &CallContext,
        ) -> Result<ToolExecuteResult, ToolError> {
            let index = args["index"].as_u64().unwrap();
            if index == 0 {
                Ok(if self.first_is_error {
                    ToolExecuteResult::text("Error: fixture failure")
                } else {
                    ToolExecuteResult::end_turn("A newer Team event arrived")
                })
            } else {
                Ok(ToolExecuteResult::text(format!("durable result {index}")))
            }
        }
    }

    async fn assert_completed_batch_survives_early_exit(first_is_error: bool) {
        let _sandbox = test_helpers::test_env::sandbox();
        let sid = "parallel-history-regression";
        let conn = database::db::get_connection().unwrap();
        crate::persistence::test_schema::ensure_agent_sessions_schema(&conn);
        crate::persistence::session_snapshots::ensure_tables().unwrap();
        conn.execute(
            "INSERT INTO agent_sessions (session_id,name,session_type,status,created_at,updated_at)
             VALUES (?1,'Parallel history test','agent','running',datetime('now'),datetime('now'))",
            [sid],
        )
        .unwrap();
        let handler = UnifiedEventHandler::new(EventHandlerConfig::default());
        let mut tools = ToolRegistry::new();
        tools.register(Box::new(CompletedBatchTool { first_is_error }));
        let mut calls: Vec<_> = (0..4)
            .map(|index| ToolCallRequest {
                id: format!("call-{index}"),
                name: "read_fixture".into(),
                arguments: serde_json::json!({"index":index}),
                thought_signature: None,
            })
            .collect();
        // This next sequential group must never be admitted after EndTurn or
        // the error limit, even though the completed parallel group is drained.
        calls.push(ToolCallRequest {
            id: "must-not-start".into(),
            name: "write_fixture".into(),
            arguments: serde_json::json!({}),
            thought_signature: None,
        });
        let mut messages = Vec::new();
        let mut errors = if first_is_error {
            super::super::super::MAX_CONSECUTIVE_ERRORS - 1
        } else {
            0
        };
        let (count, usage, outcome) = super::super::execute_tool_calls(
            &mut messages,
            &calls,
            &tools,
            &ResolvedToolPolicy::permissive(),
            sid,
            "turn",
            &[],
            None,
            &handler,
            None,
            None,
            &mut FileTimeTracker::new(),
            &mut errors,
            None,
            4,
        )
        .await;
        assert_eq!(count, 4);
        assert_eq!(usage.len(), 4);
        assert_eq!(
            matches!(outcome, ToolBatchOutcome::ErrorLoop(_)),
            first_is_error
        );
        if !first_is_error {
            assert!(matches!(outcome, ToolBatchOutcome::EndTurn(_)));
        }
        let rows = crate::session::persistence::load_messages(sid).unwrap();
        assert_eq!(
            rows.len(),
            8,
            "each admitted call must retain its actual durable result"
        );
        assert_eq!(messages.len(), 4);
        for (index, message) in messages.iter().enumerate() {
            let id = format!("call-{index}");
            let result = rows
                .iter()
                .find(|row| row.role == "tool_result" && row.tool_call_id.as_deref() == Some(&id))
                .unwrap();
            assert_eq!(message["content"].as_str(), result.tool_output.as_deref());
            if index > 0 {
                assert_eq!(
                    result.tool_output.as_deref(),
                    Some(format!("durable result {index}").as_str())
                );
            }
        }
        assert!(rows
            .iter()
            .all(|row| row.tool_call_id.as_deref() != Some("must-not-start")));
    }

    #[tokio::test]
    async fn end_turn_persists_all_already_executed_parallel_results() {
        assert_completed_batch_survives_early_exit(false).await;
    }

    #[tokio::test]
    async fn error_limit_persists_all_already_executed_parallel_results() {
        assert_completed_batch_survives_early_exit(true).await;
    }
}
