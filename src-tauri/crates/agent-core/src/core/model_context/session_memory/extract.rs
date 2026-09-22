//! Session memory extraction:
//!
//! - [`should_extract`] — pure trigger heuristic
//! - [`extract_session_memory`] — runs a single side-call to (re)build SM markdown
//! - [`find_last_safe_boundary`] — picks the highest message index safe to mark
//!   as the SM boundary (avoids splitting a tool_use → tool_result pair)

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use serde_json::Value;
use tokio::sync::Mutex;
use tracing::{info, warn};

use super::config::SessionMemoryConfig;
use super::sections::{analyze_section_sizes, generate_section_reminders};
use super::state::{ExtractionFailure, SessionMemoryState};
use crate::core::side_query::{self, SideQueryConfig, SideQueryError, StructuredOutput};
use crate::providers::traits::{LLMProvider, ProviderError};

/// Resolve a sequence anchor to "index of the last summarized message" in the
/// frame described by `start_seqs`. `None` when nothing in the frame is at or
/// below the anchor (or no anchor exists) — callers then treat the whole
/// frame as unsummarized.
pub fn resolve_summarized_boundary_idx(
    anchor_seq: Option<i64>,
    start_seqs: &[i64],
) -> Option<usize> {
    let seq = anchor_seq?;
    start_seqs.partition_point(|s| *s <= seq).checked_sub(1)
}

/// SM extraction system prompt — 9-section template.
const SM_EXTRACTION_SYSTEM_PROMPT: &str = r#"You are a session memory extractor. Your job is to maintain a structured summary of an ongoing conversation between a user and an AI coding assistant.

## Instructions

Read the conversation and update the session memory document below. Each section has a specific purpose — update only sections with new information, preserve existing content that is still relevant, and remove content that is outdated or superseded.

Keep each section concise (~200 words max). Use bullet points. Preserve exact file paths, variable names, error messages, and config values.
Keep each section under ~2000 tokens — if a section is approaching this limit, condense it by cycling out less important details while preserving the most critical information.
Focus on actionable, specific information that would help someone understand or recreate the work discussed in the conversation.
IMPORTANT: Always update "Current State" to reflect the most recent work — this is critical for continuity after compaction.

## Sections

### Session Title
One-line title describing the overall task.

### Current State
What is happening right now? What was the last action taken? This section must ALWAYS be updated.

### Task Specification
What is the user trying to accomplish? Requirements, constraints, preferences stated.

### Files and Functions
Key files created, edited, or referenced. Include paths and brief descriptions of changes.

### Workflow
Steps taken so far, in order. Include both successful and failed attempts.

### Errors and Corrections
Errors encountered, their causes, and how they were resolved. Include exact error messages.

### Codebase and System Documentation
Architecture patterns, conventions, or system details discovered during the session.

### Learnings
Key decisions made and their rationale. User preferences or style choices.

### Key Results
Concrete outputs: files created, tests passing, features completed.

## Output Format

Return the COMPLETE updated session memory document in markdown, with all section headers preserved.
Do NOT include any text outside the document.
Do NOT wrap in code fences."#;

/// Check whether session memory extraction should run.
pub fn should_extract(
    state: &SessionMemoryState,
    config: &SessionMemoryConfig,
    current_tokens: usize,
    last_turn_has_tool_calls: bool,
) -> bool {
    if !config.enabled || state.extraction_in_progress {
        return false;
    }

    if !state.initialized && current_tokens < config.min_tokens_to_init {
        return false;
    }

    // Restored/compacted summaries establish a durable baseline before gating.
    if state.initialized && state.tokens_at_last_extraction.is_none() {
        return false;
    }
    let token_growth = current_tokens.saturating_sub(state.tokens_at_last_extraction.unwrap_or(0));
    if token_growth < config.min_tokens_between_update {
        return false;
    }

    let tool_threshold_met = state.tool_calls_since_extraction >= config.tool_calls_between_updates;
    let natural_break = !last_turn_has_tool_calls;

    tool_threshold_met || natural_break
}

/// Uncommitted output. The owning session must persist it before publishing it.
pub struct SessionMemoryExtraction {
    pub content: String,
    pub last_seq: Option<i64>,
    pub expected_content: Option<String>,
    pub expected_seq: Option<i64>,
    pub current_tokens: usize,
    pub consumed_tool_calls: usize,
}

/// Extract or update session memory from the conversation.
///
/// Makes a single LLM side-call with the SM system prompt, current SM
/// content, and recent messages. Returns an uncommitted candidate, or `None` while
/// this account/model route is cooling down or has no usable low-cost model.
/// Only other low-cost candidates are retried; the parent is never a fallback.
#[allow(clippy::too_many_arguments)]
pub async fn extract_session_memory(
    messages: &[Value],
    start_seqs: &[i64],
    sm_state: Arc<Mutex<SessionMemoryState>>,
    config: &SessionMemoryConfig,
    provider: &dyn LLMProvider,
    model: &str,
    current_tokens: usize,
    generation: u64,
    cancel_flag: Option<&Arc<AtomicBool>>,
) -> Result<Option<SessionMemoryExtraction>, String> {
    use crate::core::model_context::summarization;

    let selection = provider.auxiliary_model(model);

    // ── Prepare: brief lock to snapshot the read-side state. The owning
    // lease tracks the active generation. The mutex is NOT held across the LLM call
    // below — otherwise the next turn's brief `sm_state` reads (pre-turn
    // compaction, the gate pre-check) would block for the whole extraction.
    let (start_idx, existing_content, expected_seq, consumed_tool_calls, selected_model) = {
        let mut state = sm_state.lock().await;
        if state.extraction_generation != generation {
            return Ok(None);
        }
        let Some(selected_model) =
            state
                .auxiliary_retry
                .select(selection.clone(), model, Instant::now())
        else {
            return Ok(None);
        };
        let start_idx = state
            .last_summarized_seq
            .map(|seq| start_seqs.partition_point(|s| *s <= seq))
            .unwrap_or(0);
        (
            start_idx,
            state.content.clone(),
            state.last_summarized_seq,
            state.tool_calls_since_extraction,
            selected_model,
        )
    };

    let new_messages = if start_idx < messages.len() {
        &messages[start_idx..]
    } else {
        messages
    };

    let mut user_content = String::new();

    let section_reminders = if let Some(ref existing) = existing_content {
        user_content.push_str("<current_session_memory>\n");
        user_content.push_str(existing);
        user_content.push_str("\n</current_session_memory>\n\n");

        let sections = analyze_section_sizes(existing);
        // Use the same rough estimate the sections module uses internally.
        let total_tokens = existing.len() / 4;
        generate_section_reminders(
            &sections,
            total_tokens,
            config.max_section_tokens,
            config.max_total_tokens,
        )
    } else {
        String::new()
    };

    user_content.push_str("<new_messages>\n");
    for msg in new_messages {
        let role = msg
            .get("role")
            .and_then(|val| val.as_str())
            .unwrap_or("unknown");
        let content = msg
            .get("content")
            .and_then(|val| val.as_str())
            .unwrap_or("");
        let truncated = summarization::truncate_for_summary(content, 500);

        match role {
            "user" => {
                user_content.push_str(&format!("**User:** {}\n\n", truncated));
            }
            "assistant" => {
                let tool_calls = summarization::format_tool_calls(msg);
                if content.is_empty() && !tool_calls.is_empty() {
                    user_content.push_str(&format!("**Assistant:**\n{}\n\n", tool_calls));
                } else if !content.is_empty() {
                    user_content.push_str(&format!("**Assistant:** {}\n\n", truncated));
                    if !tool_calls.is_empty() {
                        user_content.push_str(&format!("{}\n\n", tool_calls));
                    }
                }
            }
            "tool" => {
                let name = msg
                    .get("name")
                    .and_then(|val| val.as_str())
                    .unwrap_or("tool");
                user_content.push_str(&format!(
                    "**Tool ({}):** {}\n\n",
                    name,
                    summarization::truncate_for_summary(content, 300)
                ));
            }
            _ => {}
        }
    }
    user_content.push_str("</new_messages>");

    if !section_reminders.is_empty() {
        user_content.push_str(&section_reminders);
    }

    let mut sq_config = SideQueryConfig {
        model: Some(selected_model.clone()),
        max_tokens: config.extraction_max_tokens,
        temperature: 0.0,
        system_prompt: Some(SM_EXTRACTION_SYSTEM_PROMPT.to_string()),
        structured: Some(StructuredOutput {
            tool_name: "emit_session_memory".to_string(),
            schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "content": {
                        "type": "string",
                        "description": "The structured session memory document"
                    }
                },
                "required": ["content"]
            }),
        }),
        ..Default::default()
    };

    let user_messages = vec![serde_json::json!({
        "role": "user",
        "content": user_content,
    })];

    let mut active_model = selected_model;
    let result = loop {
        sq_config.model = Some(active_model.clone());
        let result = side_query::side_query_typed_with_options(
            provider,
            &user_messages,
            &sq_config,
            model,
            cancel_flag,
        )
        .await;
        if !matches!(
            &result,
            Err(SideQueryError::Provider(ProviderError::ModelNotFound(_)))
        ) {
            break result;
        }
        if cancel_flag.is_some_and(|flag| flag.load(Ordering::SeqCst)) {
            break Err(SideQueryError::Provider(ProviderError::Cancelled));
        }
        let mut state = sm_state.lock().await;
        if state.extraction_generation != generation {
            return Ok(None);
        }
        state.auxiliary_retry.reject_candidate(&active_model);
        if let Some(next) = state
            .auxiliary_retry
            .select(selection.clone(), model, Instant::now())
        {
            active_model = next;
        } else {
            // All bounded low-cost candidates were rejected. Keep the old
            // memory and skip quietly; never send the parent as a fallback.
            state
                .auxiliary_retry
                .failed(ExtractionFailure::UnsupportedModel, Instant::now());
            info!("[session_memory] Low-cost models unavailable; extraction skipped");
            return Ok(None);
        }
    };

    // Only retry bookkeeping changes here; summary state is published by the
    // owning session after the durable commit succeeds.
    let mut state = sm_state.lock().await;
    if state.extraction_generation != generation {
        return Ok(None);
    }

    match result {
        Ok(sq_result) => {
            // Extract from structured output (forced tool call) if available,
            // fall back to text content for providers that don't support tool_choice.
            let sm_content = if let Some(structured) = sq_result.structured {
                structured
                    .get("content")
                    .and_then(|s| s.as_str())
                    .unwrap_or("")
                    .to_string()
            } else {
                sq_result.content
            };
            let last_seq = find_last_safe_boundary(messages)
                .and_then(|idx| start_seqs.get(idx).copied())
                .or(expected_seq);
            Ok(Some(SessionMemoryExtraction {
                content: sm_content,
                last_seq,
                expected_content: existing_content,
                expected_seq,
                current_tokens,
                consumed_tool_calls,
            }))
        }
        Err(err) => {
            warn!("[session_memory] Extraction failed: {}", err);
            let failure = match &err {
                SideQueryError::Provider(error) => ExtractionFailure::from(error),
                _ => ExtractionFailure::Other,
            };
            state.auxiliary_retry.failed(failure, Instant::now());
            Err(err.to_string())
        }
    }
}

/// Find the last message index that is safe to use as an SM boundary.
///
/// We avoid setting the boundary at an assistant message with tool_calls
/// because that would orphan the tool_result messages that follow it
/// during SM-compact.
fn find_last_safe_boundary(messages: &[Value]) -> Option<usize> {
    for idx in (0..messages.len()).rev() {
        let role = messages[idx]
            .get("role")
            .and_then(|val| val.as_str())
            .unwrap_or("");

        if role == "assistant" {
            let has_tool_calls = messages[idx]
                .get("tool_calls")
                .and_then(|tc| tc.as_array())
                .map(|arr| !arr.is_empty())
                .unwrap_or(false);

            if has_tool_calls {
                continue;
            }
            return Some(idx);
        }

        if role == "user" {
            return Some(idx);
        }
    }
    None
}
