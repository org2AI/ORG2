use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;

use core_types::activity::ActivityChunk;
use rusqlite::Connection;
use serde_json::{json, Value};

use crate::sources::imported_history::{self, ImportedToolCall};

use super::discovery::{claude_file_stem_from_session_id, resolve_claude_session_path};
use super::tools::{apply_claude_edit_diff, apply_claude_question_result, claude_tool_call_from_item};
use super::types::{is_claude_compact_summary, is_harness_injected_user_line, ClaudeJsonlLine};
use super::CLAUDE_CODE_PROVIDER_SLUG;

pub fn load_claude_code_history_for_session(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<ActivityChunk>, String> {
    let file_stem = claude_file_stem_from_session_id(session_id)?;
    let path = resolve_claude_session_path(conn, file_stem)?;
    load_claude_code_history_from_path(session_id, &path)
}

pub fn load_claude_code_history_from_path(
    session_id: &str,
    path: &Path,
) -> Result<Vec<ActivityChunk>, String> {
    let file = fs::File::open(path)
        .map_err(|err| format!("Failed to open Claude history {}: {err}", path.display()))?;
    load_claude_code_history_from_reader(session_id, BufReader::new(file), 0, None)
}

pub(super) fn load_claude_code_history_from_reader<R: BufRead>(
    session_id: &str,
    reader: R,
    start_sequence: usize,
    forced_first_user_id: Option<&str>,
) -> Result<Vec<ActivityChunk>, String> {
    let mut output = Vec::new();
    visit_claude_code_history_from_reader(
        session_id,
        reader,
        start_sequence,
        forced_first_user_id,
        &mut |chunks| {
            output.extend(chunks);
            Ok(())
        },
    )?;
    Ok(output)
}

/// Visit canonical turns with only the current turn and pending calls resident.
pub fn visit_claude_code_history_from_path(
    session_id: &str,
    path: &Path,
    visit: &mut dyn FnMut(Vec<ActivityChunk>) -> Result<(), String>,
) -> Result<(), String> {
    let file = fs::File::open(path)
        .map_err(|err| format!("Failed to open Claude history {}: {err}", path.display()))?;
    visit_claude_code_history_from_reader(session_id, BufReader::new(file), 0, None, visit)
}

fn visit_claude_code_history_from_reader<R: BufRead>(
    session_id: &str,
    reader: R,
    start_sequence: usize,
    forced_first_user_id: Option<&str>,
    visit: &mut dyn FnMut(Vec<ActivityChunk>) -> Result<(), String>,
) -> Result<(), String> {
    let mut chunks = Vec::new();
    let mut pending_tool_calls: imported_history::PendingCallMap<ImportedToolCall> =
        imported_history::PendingCallMap::new();
    let mut sequence = start_sequence;
    let mut forced_first_user_id = forced_first_user_id;
    let mut pending_compact_boundary: Option<(String, String)> = None;
    let mut awaiting_local_command_output = false;

    for line in reader.lines() {
        let line = line.map_err(|err| format!("Failed to read Claude history line: {err}"))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed: ClaudeJsonlLine = match serde_json::from_str(trimmed) {
            Ok(parsed) => parsed,
            Err(_) => continue,
        };
        let created_at = parsed
            .timestamp
            .as_deref()
            .map(imported_history::normalize_created_at)
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
        // SDK compaction writes stdout as a user row, while other local
        // controls use system/local_command. Only claim the user envelope
        // immediately following a recognized provider command, never arbitrary
        // user prose that happens to contain these tags.
        let user_command_output = if awaiting_local_command_output && parsed.r#type == "user" {
            parsed
                .message
                .as_ref()
                .and_then(|message| claude_content_text(&message.content))
                .and_then(|text| {
                    claude_local_command_output(&text)
                        .map(|(output, success)| (output.to_string(), success))
                })
        } else {
            None
        };
        if (parsed.r#type == "system" && parsed.subtype == "local_command")
            || user_command_output.is_some()
        {
            if let Some((output, success)) = user_command_output.or_else(|| {
                parsed.content.as_deref().map(|content| {
                    let (output, success) =
                        claude_local_command_output(content).unwrap_or((content, true));
                    (output.to_string(), success && parsed.level != "error")
                })
            }) {
                awaiting_local_command_output = false;
                let mut chunk =
                    imported_history::native_command_output_chunk(session_id, &output, success);
                chunk.chunk_id = format!("claudecode-command-{}-{sequence}", parsed.uuid);
                chunk.created_at = created_at.clone();
                chunks.push(chunk);
                sequence += 1;
                chunks.push(imported_history::task_lifecycle_chunk(
                    session_id,
                    CLAUDE_CODE_PROVIDER_SLUG,
                    sequence,
                    &created_at,
                    "task_completed",
                    &parsed.uuid,
                ));
                sequence += 1;
            }
            continue;
        }
        if parsed.r#type == "system" && parsed.subtype == "compact_boundary" {
            if let Some((boundary_id, boundary_created_at)) = pending_compact_boundary.take() {
                chunks.push(claude_context_compacted_chunk(
                    session_id,
                    sequence,
                    &boundary_id,
                    &boundary_created_at,
                    None,
                ));
                sequence += 1;
            }
            let boundary_id = if parsed.uuid.trim().is_empty() {
                format!("boundary-{sequence}")
            } else {
                parsed.uuid.clone()
            };
            pending_compact_boundary = Some((boundary_id, created_at));
            continue;
        }
        if is_claude_compact_summary(&parsed) {
            let summary = parsed
                .message
                .as_ref()
                .and_then(|message| claude_content_text(&message.content));
            let (boundary_id, boundary_created_at) =
                pending_compact_boundary.take().unwrap_or_else(|| {
                    let id = if parsed.uuid.trim().is_empty() {
                        format!("summary-{sequence}")
                    } else {
                        parsed.uuid.clone()
                    };
                    (id, created_at.clone())
                });
            chunks.push(claude_context_compacted_chunk(
                session_id,
                sequence,
                &boundary_id,
                &boundary_created_at,
                summary.as_deref(),
            ));
            sequence += 1;
            continue;
        }
        if parsed.message.is_some() {
            if let Some((boundary_id, boundary_created_at)) = pending_compact_boundary.take() {
                chunks.push(claude_context_compacted_chunk(
                    session_id,
                    sequence,
                    &boundary_id,
                    &boundary_created_at,
                    None,
                ));
                sequence += 1;
            }
        }
        let harness_injected = is_harness_injected_user_line(&parsed);
        let Some(message) = parsed.message else {
            continue;
        };

        if parsed.r#type == "assistant" {
            awaiting_local_command_output = false;
        }
        match parsed.r#type.as_str() {
            "user" => {
                if let Some(tool_result_output) = claude_tool_result_text(&message.content) {
                    if let Some((call_id, output, is_error)) = tool_result_output {
                        if let Some(call) = pending_tool_calls.remove(&call_id) {
                            let mut chunk = imported_history::tool_call_chunk(
                                session_id,
                                CLAUDE_CODE_PROVIDER_SLUG,
                                sequence,
                                &call,
                                &output,
                            );
                            if is_error {
                                chunk.result["success"] = Value::Bool(false);
                                chunk.result["status"] = Value::String("failed".to_string());
                                chunk.result["is_error"] = Value::Bool(true);
                            }
                            // Edit/MultiEdit/Write results carry a
                            // `structuredPatch`; attach it as the exact diff so
                            // the edit card renders the real change.
                            apply_claude_edit_diff(&mut chunk, parsed.tool_use_result.as_ref());
                            apply_claude_question_result(&mut chunk, parsed.tool_use_result.as_ref(), is_error);
                            chunks.push(chunk);
                            sequence += 1;
                        }
                    }
                } else {
                    // Strip the GUI exec-mode briefing; a bridge-only message
                    // carries no user-authored text, so emit no bubble.
                    let text = claude_content_text(&message.content)
                        .map(|text| {
                            let command = claude_local_command_input(
                                imported_history::strip_orgii_exec_mode_bridge(&text),
                            );
                            if !harness_injected {
                                awaiting_local_command_output = command.is_some();
                            }
                            command.unwrap_or_else(|| {
                                imported_history::strip_orgii_exec_mode_bridge(&text).to_string()
                            })
                        })
                        .unwrap_or_default();
                    let images = claude_content_image_data_urls(&message.content);
                    if !harness_injected && (!text.trim().is_empty() || !images.is_empty()) {
                        if !chunks.is_empty() {
                            visit(std::mem::take(&mut chunks))?;
                        }
                        let mut chunk = imported_history::user_message_chunk(
                            session_id,
                            CLAUDE_CODE_PROVIDER_SLUG,
                            sequence,
                            &created_at,
                            &text,
                        );
                        if let Some(turn_id) = forced_first_user_id.take() {
                            chunk.chunk_id = turn_id.to_string();
                        }
                        if !images.is_empty() {
                            chunk.result["images"] = json!(images);
                        }
                        chunks.push(chunk);
                        sequence += 1;
                    }
                }
            }
            "assistant" => {
                for item in claude_content_items(&message.content) {
                    let item_type = item.get("type").and_then(Value::as_str).unwrap_or_default();
                    match item_type {
                        "text" => {
                            if let Some(text) = item.get("text").and_then(Value::as_str) {
                                chunks.push(imported_history::assistant_message_chunk(
                                    session_id,
                                    CLAUDE_CODE_PROVIDER_SLUG,
                                    sequence,
                                    &created_at,
                                    text,
                                ));
                                sequence += 1;
                            }
                        }
                        "thinking" => {
                            if let Some(text) = item.get("thinking").and_then(Value::as_str) {
                                chunks.push(imported_history::thinking_chunk(
                                    session_id,
                                    CLAUDE_CODE_PROVIDER_SLUG,
                                    sequence,
                                    &created_at,
                                    text,
                                ));
                                sequence += 1;
                            }
                        }
                        "tool_use" => {
                            if let Some(call) = claude_tool_call_from_item(item, &created_at) {
                                pending_tool_calls.insert(call.call_id.clone(), call);
                            }
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }

    if let Some((boundary_id, boundary_created_at)) = pending_compact_boundary.take() {
        chunks.push(claude_context_compacted_chunk(
            session_id,
            sequence,
            &boundary_id,
            &boundary_created_at,
            None,
        ));
    }

    for call in pending_tool_calls.drain_in_file_order() {
        chunks.push(imported_history::unresolved_tool_call_chunk(
            session_id,
            CLAUDE_CODE_PROVIDER_SLUG,
            sequence,
            &call,
        ));
        sequence += 1;
    }

    if !chunks.is_empty() {
        visit(chunks)?;
    }
    Ok(())
}

// SDK local commands serialize their input as an exact three-tag envelope.
// Normalize only that envelope so queue reconciliation sees the literal command
// the user submitted; arbitrary prose containing tags remains unchanged.
pub(super) fn claude_local_command_output(text: &str) -> Option<(&str, bool)> {
    for (tag, success) in [
        ("local-command-stdout", true),
        ("local-command-stderr", false),
    ] {
        if let Some(output) = text
            .strip_prefix(&format!("<{tag}>"))
            .and_then(|text| text.strip_suffix(&format!("</{tag}>")))
        {
            return Some((output, success));
        }
    }
    None
}

pub(super) fn claude_local_command_input(text: &str) -> Option<String> {
    fn field<'a>(text: &'a str, tag: &str) -> Option<(&'a str, &'a str)> {
        text.trim()
            .strip_prefix(&format!("<{tag}>"))?
            .split_once(&format!("</{tag}>"))
    }
    // Built-ins and custom skills use opposite field order in native history.
    let (name, message, rest) = if let Some((name, rest)) = field(text, "command-name") {
        let (message, rest) = field(rest, "command-message")?;
        (name, message, rest)
    } else {
        let (message, rest) = field(text, "command-message")?;
        let (name, rest) = field(rest, "command-name")?;
        (name, message, rest)
    };
    let token = name.strip_prefix('/')?;
    if token.is_empty()
        || !token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | ':'))
    {
        return None;
    }
    if message != token {
        return None;
    }
    let args = rest
        .trim()
        .strip_prefix("<command-args>")?
        .strip_suffix("</command-args>")?
        .trim();
    Some(if args.is_empty() {
        name.to_string()
    } else {
        format!("{name} {args}")
    })
}

fn claude_context_compacted_chunk(
    session_id: &str,
    sequence: usize,
    boundary_id: &str,
    created_at: &str,
    summary: Option<&str>,
) -> ActivityChunk {
    let mut chunk = ActivityChunk::new(session_id, "context_compacted", "context_compacted");
    chunk.chunk_id = format!("claude-context-compacted-{boundary_id}-{sequence}");
    chunk.created_at = created_at.to_string();
    chunk.result = json!({
        "success": true,
        "native": true,
        "provider": "claude_code",
        "header": "Context compacted",
        "observation": summary.unwrap_or(""),
    });
    chunk
}

pub(super) fn claude_content_items(content: &Value) -> Vec<&Value> {
    match content {
        Value::Array(items) => items.iter().collect(),
        _ => Vec::new(),
    }
}

pub(super) fn claude_content_text(content: &Value) -> Option<String> {
    match content {
        Value::String(text) => Some(text.clone()),
        Value::Array(items) => {
            let parts = items
                .iter()
                .filter_map(|item| item.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>();
            if parts.is_empty() {
                None
            } else {
                Some(parts.join("\n"))
            }
        }
        _ => None,
    }
}

fn claude_content_image_data_urls(content: &Value) -> Vec<String> {
    let Value::Array(items) = content else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            if item.get("type").and_then(Value::as_str) != Some("image") {
                return None;
            }
            let source = item.get("source")?;
            if source.get("type").and_then(Value::as_str) != Some("base64") {
                return None;
            }
            let media_type = source
                .get("media_type")
                .and_then(Value::as_str)
                .unwrap_or("image/png");
            let data = source.get("data").and_then(Value::as_str)?;
            if data.is_empty() {
                return None;
            }
            Some(format!("data:{media_type};base64,{data}"))
        })
        .collect()
}

pub(super) fn claude_tool_result_text(content: &Value) -> Option<Option<(String, String, bool)>> {
    let Value::Array(items) = content else {
        return None;
    };
    let result_item = items
        .iter()
        .find(|item| item.get("type").and_then(Value::as_str) == Some("tool_result"))?;
    let call_id = result_item.get("tool_use_id")?.as_str()?.to_string();
    let output = match result_item.get("content") {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        Some(other) => other.to_string(),
        None => String::new(),
    };
    let is_error = result_item
        .get("is_error")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    Some(Some((call_id, output, is_error)))
}

#[cfg(test)]
mod local_command_tests {
    use super::claude_local_command_input;
    #[test]
    fn only_exact_provider_envelopes_become_commands() {
        assert_eq!(claude_local_command_input("<command-name>/compact</command-name> <command-message>compact</command-message> <command-args>keep APIs\nverbatim</command-args>"), Some("/compact keep APIs\nverbatim".into()));
        assert_eq!(claude_local_command_input("<command-message>org2-native-fixture</command-message>\n<command-name>/org2-native-fixture</command-name>\n<command-args>APP_OK</command-args>"), Some("/org2-native-fixture APP_OK".into()));
        for text in ["explain <command-name>/compact</command-name>", "<command-name>/a</command-name><command-message>b</command-message><command-args></command-args>", "<command-name>/tmp/a</command-name><command-message>tmp/a</command-message><command-args></command-args>"] {
            assert!(claude_local_command_input(text).is_none());
        }
    }
}
