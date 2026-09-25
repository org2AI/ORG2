//! Explicit resources from user messages, visible assistant replies and successful tools.
//!
//! Lines are streamed under a read ceiling; only compact resource projections
//! and a bounded pending-call window survive each line. User images become
//! transcript refs keyed by the line's byte offset —
//! the same turn id the catalog uses — so `load_codex_image_from_path` can
//! read the embedded bytes back when a thumbnail asks for them.

use std::collections::{HashMap, VecDeque};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

use memchr::memchr;
use serde_json::Value;

use crate::sources::imported_history::user_sources::{
    transcript_image_ref, SourceMessageRole, ToolActivityStatus, UserSourceMessage,
};

use super::super::CodexJsonlLine;
use super::catalog::codex_lazy_turn_id;
use super::messages::user_message_from_line;

/// Stand-in for an image a UI row embeds as a data URL (no file path), so its
/// transcript ref stays small; `load_codex_image_from_path` maps it back to
/// the row's image at that position.
pub(super) const INLINE_IMAGE_REF_PREFIX: &str = "codex-inline-image:";
/// Same ceiling the image resolver reads a user line with.
const MAX_USER_LINE_BYTES: usize = 16 * 1024 * 1024;
const READ_BUFFER_BYTES: usize = 1024 * 1024;

pub fn load_codex_user_source_messages_from_path(
    session_id: &str,
    path: &Path,
) -> Result<Vec<UserSourceMessage>, String> {
    let file = File::open(path)
        .map_err(|err| format!("Failed to open Codex history {}: {err}", path.display()))?;
    let mut reader = BufReader::with_capacity(READ_BUFFER_BYTES, file);
    let mut messages = Vec::new();
    let mut calls: VecDeque<(String, String, Value)> = VecDeque::new();
    visit_bounded_lines(&mut reader, MAX_USER_LINE_BYTES, |offset, line| {
        let Ok(parsed) = serde_json::from_slice::<CodexJsonlLine>(line) else {
            return;
        };
        let id = codex_lazy_turn_id(offset);
        collect_codex_conversation_sources(&parsed.payload, &id, &mut calls, &mut messages);
        let Some(message) = user_message_from_line(&parsed) else {
            return;
        };
        let turn_id = codex_lazy_turn_id(offset);
        let images: Vec<String> = message
            .image_refs
            .iter()
            .enumerate()
            .map(|(position, original)| {
                if original.starts_with("data:") {
                    let inline = format!("{INLINE_IMAGE_REF_PREFIX}{position}");
                    transcript_image_ref(session_id, &turn_id, &inline)
                } else {
                    transcript_image_ref(session_id, &turn_id, original)
                }
            })
            .collect();
        messages.extend(UserSourceMessage::new(turn_id, &message.text, images));
    })
    .map_err(|err| format!("Failed to read Codex history {}: {err}", path.display()))?;
    Ok(deduplicate_tool_sources(messages))
}

// The model-facing output and UI completion may both describe one call.
// This transient index is bounded by the returned activity rows, not retained
// between reads. Preserve resource text from either projection.
fn deduplicate_tool_sources(messages: Vec<UserSourceMessage>) -> Vec<UserSourceMessage> {
    let mut indexes: HashMap<String, usize> = HashMap::new();
    let mut result: Vec<UserSourceMessage> = Vec::new();
    for message in messages {
        if message.role == SourceMessageRole::Tool {
            if let Some(index) = indexes.get(&message.id).copied() {
                let previous = &mut result[index];
                for line in message.text.lines() {
                    if !previous.text.lines().any(|existing| existing == line) {
                        if !previous.text.is_empty() {
                            previous.text.push('\n');
                        }
                        previous.text.push_str(line);
                    }
                }
                if let Some(activity) = message.tool_activity {
                    let replace = previous.tool_activity.as_ref().is_none_or(|old| {
                        (old.error.is_none() && activity.error.is_some())
                            || (old.status == ToolActivityStatus::Success
                                && activity.status == ToolActivityStatus::Error)
                            || activity.actions.len() > old.actions.len()
                    });
                    if replace {
                        previous.tool_activity = Some(activity);
                    }
                }
                continue;
            }
            indexes.insert(message.id.clone(), result.len());
        }
        result.push(message);
    }
    result
}

fn qualified_tool_name(namespace: Option<&str>, name: &str) -> String {
    if name.contains('.') || name.starts_with("mcp__") {
        return name.to_owned();
    }
    match namespace {
        Some(namespace) if !namespace.is_empty() => format!("{namespace}.{name}"),
        _ => name.to_owned(),
    }
}

// Pair only a bounded window of pending calls. Keep structured arguments, never
// shell/log output; unknown or evicted calls cannot fabricate accessed resources.
const MAX_PENDING_SOURCE_CALLS: usize = 256;
const MAX_SOURCE_CALL_BYTES: usize = 64 * 1024;

fn source_text(content: &Value) -> String {
    if let Some(text) = content.as_str() {
        return text.to_owned();
    }
    content
        .as_array()
        .into_iter()
        .flatten()
        .filter(|part| {
            matches!(
                part.get("type").and_then(Value::as_str),
                Some("text" | "output_text")
            )
        })
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n")
}

fn collect_codex_conversation_sources(
    payload: &Value,
    id: &str,
    calls: &mut VecDeque<(String, String, Value)>,
    messages: &mut Vec<UserSourceMessage>,
) {
    let kind = payload
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let assistant = match kind {
        "message"
            if payload.get("role").and_then(Value::as_str) == Some("assistant")
                && payload.get("channel").and_then(Value::as_str) != Some("analysis") =>
        {
            Some(source_text(&payload["content"]))
        }
        "agent_message" if payload.get("message").is_some() => payload
            .get("message")
            .and_then(Value::as_str)
            .map(str::to_owned),
        "item_completed"
            if payload.pointer("/item/type").and_then(Value::as_str) == Some("AgentMessage") =>
        {
            Some(source_text(&payload["item"]["content"]))
        }
        _ => None,
    };
    if let Some(text) = assistant {
        messages.extend(UserSourceMessage::with_role(
            id,
            &text,
            Vec::new(),
            SourceMessageRole::Assistant,
        ));
    }
    if kind == "item_completed" {
        let item = &payload["item"];
        let status = item
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let completed = matches!(status, "completed" | "failed" | "error" | "cancelled");
        let successful = status == "completed";
        let call_id = item.get("id").and_then(Value::as_str).unwrap_or(id);
        let source_id = format!("codex-call:{call_id}");
        match item.get("type").and_then(Value::as_str) {
            Some("McpToolCall" | "DynamicToolCall") if completed => {
                if let Some(name) = item
                    .get("tool")
                    .or_else(|| item.get("name"))
                    .and_then(Value::as_str)
                {
                    let server = item.get("server").and_then(Value::as_str).map(|server| {
                        if server.starts_with("mcp__") {
                            server.to_owned()
                        } else {
                            format!("mcp__{server}")
                        }
                    });
                    let name = qualified_tool_name(server.as_deref(), name);
                    let mut result = item["result"].clone();
                    if result.is_null() {
                        result = serde_json::json!({"error": item.get("error")});
                    }
                    messages.extend(UserSourceMessage::from_tool(
                        source_id,
                        &name,
                        &item["arguments"],
                        &result,
                        successful,
                    ));
                }
            }
            Some("Extension") if item.get("kind").and_then(Value::as_str) == Some("web.search") => {
                // Nested web.run calls publish typed UI metadata even when the
                // model-facing call is a functions.exec wrapper. Never parse scripts.
                let action = &item["action"];
                let arguments = match action.get("type").and_then(Value::as_str) {
                    Some("search") => {
                        let queries: Vec<Value> = action
                            .get("queries")
                            .and_then(Value::as_array)
                            .into_iter()
                            .flatten()
                            .filter_map(Value::as_str)
                            .take(32)
                            .map(|query| serde_json::json!({"q": query}))
                            .collect();
                        if queries.is_empty() {
                            serde_json::json!({"search_query":[{"q":action.get("query").and_then(Value::as_str).or_else(|| item.get("query").and_then(Value::as_str)).unwrap_or_default()}]})
                        } else {
                            serde_json::json!({"search_query":queries})
                        }
                    }
                    Some("openPage") => {
                        serde_json::json!({"open":[{"ref_id": action.get("url").and_then(Value::as_str).unwrap_or_default()}]})
                    }
                    _ => Value::Null,
                };
                if !arguments.is_null() {
                    messages.extend(UserSourceMessage::from_tool(
                        source_id,
                        "web.run",
                        &arguments,
                        &Value::Null,
                        true,
                    ));
                }
            }
            Some("FileChange") if completed => {
                // A change receipt is activity, not a resource supplied to the conversation.
                // Explicit assistant references and attached artifacts are projected separately.
                let result = serde_json::json!({"error": if successful { Value::Null } else { item["stderr"].clone() }});
                messages.extend(UserSourceMessage::from_tool(
                    source_id,
                    "apply_patch",
                    &Value::Null,
                    &result,
                    successful,
                ));
            }
            _ => {}
        }
    }
    if matches!(kind, "function_call" | "custom_tool_call") {
        let (Some(call_id), Some(name)) = (
            payload.get("call_id").and_then(Value::as_str),
            payload.get("name").and_then(Value::as_str),
        ) else {
            return;
        };
        if payload.get("namespace").and_then(Value::as_str) == Some("collaboration")
            || name.starts_with("collaboration.")
        {
            return;
        }
        if call_id.len() > 512 || name.len() > 256 {
            return;
        }
        let input = payload
            .get("arguments")
            .or_else(|| payload.get("input"))
            .unwrap_or(&Value::Null);
        if input.to_string().len() > MAX_SOURCE_CALL_BYTES {
            return;
        }
        let arguments = input
            .as_str()
            .and_then(|text| serde_json::from_str(text).ok())
            .unwrap_or_else(|| input.clone());
        calls.retain(|(key, _, _)| key != call_id);
        if calls.len() == MAX_PENDING_SOURCE_CALLS {
            calls.pop_front();
        }
        calls.push_back((
            call_id.to_owned(),
            qualified_tool_name(payload.get("namespace").and_then(Value::as_str), name),
            arguments,
        ));
    } else if matches!(kind, "function_call_output" | "custom_tool_call_output") {
        let Some(call_id) = payload.get("call_id").and_then(Value::as_str) else {
            return;
        };
        let Some(index) = calls.iter().position(|(key, _, _)| key == call_id) else {
            return;
        };
        let Some((_, name, arguments)) = calls.remove(index) else {
            return;
        };
        let raw = &payload["output"];
        let result = raw
            .as_str()
            .and_then(|text| serde_json::from_str(text).ok())
            .unwrap_or_else(|| raw.clone());
        // A terminal output is successful unless the provider explicitly marks failure.
        let success = !raw
            .as_str()
            .is_some_and(|text| text.trim_start().starts_with("Error:"))
            && !matches!(
                payload.get("status").and_then(Value::as_str),
                Some("failed" | "cancelled" | "error")
            )
            && !result
                .get("isError")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            && !result
                .get("is_error")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            && result.get("error").is_none_or(Value::is_null)
            && result
                .get("exit_code")
                .and_then(Value::as_i64)
                .is_none_or(|code| code == 0);
        messages.extend(UserSourceMessage::from_tool(
            format!("codex-call:{call_id}"),
            &name,
            &arguments,
            &result,
            success,
        ));
    }
}

/// Visit each complete line with its starting byte offset. A line longer than
/// `max_line_bytes` is skipped without being buffered.
fn visit_bounded_lines(
    reader: &mut impl BufRead,
    max_line_bytes: usize,
    mut visit: impl FnMut(u64, &[u8]),
) -> std::io::Result<()> {
    let mut line = Vec::new();
    let mut offset = 0u64;
    let mut line_start = 0u64;
    let mut oversized = false;
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            if !oversized && !line.is_empty() {
                visit(line_start, &line);
            }
            return Ok(());
        }
        let (consumed, complete) = match memchr(b'\n', available) {
            Some(index) => (index + 1, true),
            None => (available.len(), false),
        };
        if !oversized {
            if line.len() + consumed > max_line_bytes {
                oversized = true;
                line = Vec::new();
            } else {
                line.extend_from_slice(&available[..consumed]);
            }
        }
        reader.consume(consumed);
        offset += consumed as u64;
        if complete {
            if !oversized {
                visit(line_start, &line);
            }
            line.clear();
            oversized = false;
            line_start = offset;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_rollout(name: &str, lines: &[String]) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("orgii-codex-sources-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("rollout.jsonl");
        std::fs::write(&path, lines.join("\n") + "\n").unwrap();
        path
    }

    #[test]
    fn lists_every_user_message_with_lazy_image_refs() {
        let image_record = r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_image","image_url":"data:image/png;base64,AAA"}]}}"#.to_string();
        let ui_record = r#"{"type":"event_msg","payload":{"type":"item_completed","item":{"type":"UserMessage","content":[{"type":"text","text":"see https://example.com/a\nthanks"},{"type":"local_image","path":"/tmp/shot.png"}]}}}"#.to_string();
        let legacy =
            r#"{"type":"event_msg","payload":{"type":"user_message","message":"no links"}}"#
                .to_string();
        let assistant = r#"{"type":"event_msg","payload":{"type":"agent_message","message":"https://example.com/b"}}"#.to_string();
        let path = write_rollout(
            "list",
            &[image_record.clone(), ui_record, legacy, assistant],
        );

        let messages = load_codex_user_source_messages_from_path("codexapp-x", &path).unwrap();
        let turn_id = codex_lazy_turn_id(image_record.len() as u64 + 1);
        assert_eq!(
            messages
                .iter()
                .filter(|message| message.role == SourceMessageRole::User)
                .cloned()
                .collect::<Vec<_>>(),
            vec![UserSourceMessage {
                role: SourceMessageRole::User,
                tool_name: None,
                tool_activity: None,
                id: turn_id.clone(),
                text: "see https://example.com/a".to_string(),
                images: vec![transcript_image_ref(
                    "codexapp-x",
                    &turn_id,
                    "/tmp/shot.png"
                )],
            }]
        );
        // The ref resolves back to the embedded bytes.
        assert_eq!(
            super::super::load_codex_image_from_path(&path, &turn_id, "/tmp/shot.png").unwrap(),
            Some("data:image/png;base64,AAA".to_string())
        );
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn keeps_path_less_inline_ui_images_as_small_stand_ins() {
        // Codex Desktop embeds the bytes (`image` + data URL) when the pasted
        // file has no usable path; the image is still a source.
        let ui_record = r#"{"type":"event_msg","payload":{"type":"item_completed","item":{"type":"UserMessage","content":[{"type":"text","text":"preview these"},{"type":"image","image_url":"data:image/png;base64,INLINE"}]}}}"#.to_string();
        let path = write_rollout("inline", &[ui_record]);

        let messages = load_codex_user_source_messages_from_path("codexapp-x", &path).unwrap();
        let turn_id = codex_lazy_turn_id(0);
        let inline = format!("{INLINE_IMAGE_REF_PREFIX}0");
        assert_eq!(
            messages,
            vec![UserSourceMessage {
                role: SourceMessageRole::User,
                tool_name: None,
                tool_activity: None,
                id: turn_id.clone(),
                text: String::new(),
                images: vec![transcript_image_ref("codexapp-x", &turn_id, &inline)],
            }]
        );
        assert_eq!(
            super::super::load_codex_image_from_path(&path, &turn_id, &inline).unwrap(),
            Some("data:image/png;base64,INLINE".to_string())
        );
        assert_eq!(
            super::super::load_codex_image_from_path(
                &path,
                &turn_id,
                &format!("{INLINE_IMAGE_REF_PREFIX}1")
            )
            .unwrap(),
            None
        );
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn includes_visible_assistant_and_successful_structured_tool_resources_only() {
        use serde_json::json;
        let records = vec![
            json!({"type":"response_item","payload":{"type":"message","role":"assistant","channel":"analysis","content":[{"type":"output_text","text":"https://hidden.example"}]}}),
            json!({"type":"response_item","payload":{"type":"agent_message","author":"/root","recipient":"/root/worker","content":[{"type":"text","text":"https://internal.example"}]}}),
            json!({"type":"response_item","payload":{"type":"message","role":"assistant","channel":"final","content":[{"type":"output_text","text":"[Report](/repo/report.md) https://public.example"}]}}),
            json!({"type":"event_msg","payload":{"type":"item_completed","item":{"type":"AgentMessage","content":[{"type":"text","text":"[Report](/repo/report.md) https://public.example"}]}}}),
            json!({"type":"response_item","payload":{"type":"function_call","call_id":"r1","name":"read_file","arguments":"{\"path\":\"/repo/input.ts\"}"}}),
            json!({"type":"response_item","payload":{"type":"function_call_output","call_id":"r1","output":"file body with https://untrusted.example/log"}}),
            json!({"type":"response_item","payload":{"type":"function_call","call_id":"r2","name":"read_file","arguments":{"path":"/missing.ts"}}}),
            json!({"type":"response_item","payload":{"type":"function_call_output","call_id":"r2","output":{"isError":true}}}),
            json!({"type":"event_msg","payload":{"type":"item_completed","item":{"type":"McpToolCall","status":"completed","tool":"create_report","arguments":{},"result":{"content":[{"type":"resource_link","uri":"https://reports.example/result"},{"type":"text","text":"https://untrusted.example/tool-text"}]}}}}),
            json!({"type":"event_msg","payload":{"type":"item_completed","item":{"type":"FileChange","status":"completed","changes":{"/repo/output.md":{"type":"add"},"/repo/deleted.md":{"type":"delete"}}}}}),
        ];
        let lines: Vec<String> = records.iter().map(Value::to_string).collect();
        let path = write_rollout("conversation", &lines);
        let messages = load_codex_user_source_messages_from_path("codexapp-x", &path).unwrap();
        let text = messages
            .iter()
            .map(|message| message.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        for reference in [
            "/repo/report.md",
            "https://public.example",
            "/repo/input.ts",
            "https://reports.example/result",
        ] {
            assert!(text.contains(reference), "missing {reference}: {text}");
        }
        for excluded in [
            "hidden.example",
            "internal.example",
            "untrusted.example",
            "/missing.ts",
            "/repo/deleted.md",
            "/repo/output.md",
        ] {
            assert!(!text.contains(excluded), "unexpected {excluded}: {text}");
        }
        assert_eq!(
            messages
                .iter()
                .filter(|message| message.role == SourceMessageRole::Assistant)
                .count(),
            2
        );
        assert!(messages
            .iter()
            .any(|message| message.tool_name.as_deref() == Some("read_file")));
        let patch = messages
            .iter()
            .find(|message| message.tool_name.as_deref() == Some("apply_patch"))
            .unwrap();
        assert!(patch.text.is_empty());
        assert!(patch.tool_activity.is_some());
        // Modern/legacy duplicate visible messages remain compact projections;
        // the frontend's source-key projection deduplicates the same resource.
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        writeln!(file, "{}", json!({"type":"event_msg","payload":{"type":"agent_message","message":"https://appended.example/new"}})).unwrap();
        let reread = load_codex_user_source_messages_from_path("codexapp-x", &path).unwrap();
        assert_eq!(reread.len(), messages.len() + 1);
        assert!(reread
            .last()
            .unwrap()
            .text
            .contains("https://appended.example/new"));
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn counts_failed_app_calls_and_typed_web_actions_once_across_provider_projections() {
        use crate::sources::imported_history::user_sources::{
            ToolActivityKind, ToolActivityStatus,
        };
        use serde_json::json;
        let terminal_error = "No app terminal session is attached to this thread yet.";
        let records = vec![
            json!({"type":"response_item","payload":{"type":"function_call","namespace":"mcp__codex_app","name":"read_thread_terminal","call_id":"terminal-1","arguments":"{}"}}),
            json!({"type":"event_msg","payload":{"type":"item_completed","item":{"type":"McpToolCall","id":"terminal-1","server":"codex_app","tool":"read_thread_terminal","arguments":{},"status":"failed","result":{"content":[{"type":"text","text":terminal_error}],"isError":true}}}}),
            json!({"type":"response_item","payload":{"type":"function_call_output","call_id":"terminal-1","output":{"isError":true,"content":[{"type":"text","text":terminal_error}]}}}),
            json!({"type":"response_item","payload":{"type":"function_call","namespace":"web","name":"run","call_id":"web-1","arguments":{"search_query":[{"q":"explicit query"}],"open":[{"ref_id":"https://docs.example/page"}]}}}),
            json!({"type":"response_item","payload":{"type":"function_call_output","call_id":"web-1","output":{"content":[{"type":"resource_link","uri":"https://resource.example/report"}]}}}),
            json!({"type":"event_msg","payload":{"type":"item_completed","item":{"type":"DynamicToolCall","id":"web-1","name":"web.run","arguments":{"search_query":[{"q":"explicit query"}],"open":[{"ref_id":"https://docs.example/page"}]},"status":"completed","result":{}}}}),
            json!({"type":"event_msg","payload":{"type":"item_completed","item":{"type":"Extension","kind":"web.search","id":"nested-search","query":"shortened...","action":{"type":"search","query":null,"queries":["first full query","second full query"]},"results":[]}}}),
            json!({"type":"event_msg","payload":{"type":"item_completed","item":{"type":"Extension","kind":"web.search","id":"nested-open","query":"https://learn.example/docs","action":{"type":"openPage","url":"https://learn.example/docs"},"results":[]}}}),
            json!({"type":"response_item","payload":{"type":"function_call","namespace":"collaboration","name":"send_message","call_id":"internal","arguments":{}}}),
            json!({"type":"response_item","payload":{"type":"function_call_output","call_id":"internal","output":{}}}),
        ];
        let path = write_rollout(
            "activities",
            &records.iter().map(Value::to_string).collect::<Vec<_>>(),
        );
        let messages = load_codex_user_source_messages_from_path("codexapp-x", &path).unwrap();
        let activities: Vec<_> = messages
            .iter()
            .filter_map(|message| message.tool_activity.as_ref())
            .collect();
        assert_eq!(activities.len(), 4);
        assert!(messages
            .iter()
            .any(|message| message.text.contains("https://resource.example/report")));
        let terminal = activities
            .iter()
            .find(|activity| activity.group == "codex-app")
            .unwrap();
        assert_eq!(terminal.call_id, "codex-call:terminal-1");
        assert_eq!(terminal.status, ToolActivityStatus::Error);
        assert_eq!(terminal.error.as_deref(), Some(terminal_error));
        assert_eq!(terminal.actions[0].kind, ToolActivityKind::ReadTerminal);
        let web = activities
            .iter()
            .find(|activity| activity.call_id == "codex-call:web-1")
            .unwrap();
        assert_eq!(web.group, "web");
        assert_eq!(web.actions[0].query.as_deref(), Some("explicit query"));
        assert_eq!(
            web.actions[1].url.as_deref(),
            Some("https://docs.example/page")
        );
        let nested = activities
            .iter()
            .find(|activity| activity.call_id == "codex-call:nested-search")
            .unwrap();
        assert_eq!(nested.actions.len(), 2);
        assert_eq!(nested.actions[0].query.as_deref(), Some("first full query"));
        assert_eq!(
            activities
                .iter()
                .find(|activity| activity.call_id == "codex-call:nested-open")
                .unwrap()
                .actions[0]
                .url
                .as_deref(),
            Some("https://learn.example/docs")
        );
        assert_eq!(
            load_codex_user_source_messages_from_path("codexapp-x", &path).unwrap(),
            messages
        );
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn bounds_pending_tool_calls_and_keeps_failed_activity_without_resources() {
        use serde_json::json;
        let mut calls = VecDeque::new();
        let mut messages = Vec::new();
        for index in 0..=MAX_PENDING_SOURCE_CALLS {
            collect_codex_conversation_sources(
                &json!({"type":"function_call","call_id":index.to_string(),"name":"read_file","arguments":{"path":"/repo/file.ts"}}),
                "call",
                &mut calls,
                &mut messages,
            );
        }
        assert_eq!(calls.len(), MAX_PENDING_SOURCE_CALLS);
        collect_codex_conversation_sources(
            &json!({"type":"function_call_output","call_id":"0","output":{}}),
            "evicted",
            &mut calls,
            &mut messages,
        );
        collect_codex_conversation_sources(
            &json!({"type":"function_call_output","call_id":"1","output":"Error: file not found"}),
            "failed",
            &mut calls,
            &mut messages,
        );
        assert_eq!(messages.len(), 1);
        assert!(messages[0].text.is_empty());
        collect_codex_conversation_sources(
            &json!({"type":"function_call_output","call_id":"2","output":{}}),
            "ok",
            &mut calls,
            &mut messages,
        );
        assert_eq!(messages.len(), 2);
    }

    #[test]
    fn skips_oversized_lines_without_losing_offsets() {
        let mut reader = std::io::Cursor::new(format!("{}\nab\ncd", "x".repeat(40)));
        let mut seen = Vec::new();
        visit_bounded_lines(&mut reader, 8, |offset, line| {
            seen.push((offset, String::from_utf8_lossy(line).to_string()))
        })
        .unwrap();
        assert_eq!(seen, vec![(41, "ab\n".to_string()), (44, "cd".to_string())]);
    }
}
