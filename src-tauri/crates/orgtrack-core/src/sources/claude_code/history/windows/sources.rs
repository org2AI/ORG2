//! Claude Code conversation resource sources, and on-demand reads of the images they
//! reference.
//!
//! Claude stores pasted images inline as base64 in the user row. Sources
//! never carry those bytes: an inline image becomes a positional stand-in
//! inside a transcript ref keyed by the row's byte offset (the window turn
//! id), and `load_claude_code_image_from_path` re-reads that one row when a
//! thumbnail or the image viewer asks for it.

use std::collections::{HashSet, VecDeque};
use std::fs::File;

use memchr::memchr;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::Path;

use serde_json::Value;

use crate::sources::imported_history::user_sources::{
    transcript_image_ref, SourceMessageRole, UserSourceMessage,
};

use super::super::replay::{
    claude_image_sources, claude_local_command_input, claude_local_command_output,
};
use super::super::types::{
    is_claude_compact_summary, is_harness_injected_user_line, ClaudeControlEnvelope,
    ClaudeJsonlLine,
};
use super::index::{claude_window_turn_id, claude_window_turn_offset};

const INLINE_IMAGE_REF_PREFIX: &str = "claude-inline-image:";
const MAX_USER_ROW_BYTES: u64 = 16 * 1024 * 1024;

pub fn load_claude_code_user_source_messages_from_path(
    session_id: &str,
    path: &Path,
) -> Result<Vec<UserSourceMessage>, String> {
    let mut reader = BufReader::with_capacity(1024 * 1024, open_history(path)?);
    let mut messages = Vec::new();
    let mut calls: VecDeque<(String, String, Value)> = VecDeque::new();
    let mut control = ClaudeControlEnvelope::default();
    visit_bounded_lines(&mut reader, MAX_USER_ROW_BYTES as usize, |offset, line| {
        let Ok(parsed) = serde_json::from_slice::<ClaudeJsonlLine>(line) else {
            return;
        };
        if control.observe(&parsed)
            || is_harness_injected_user_line(&parsed)
            || is_claude_compact_summary(&parsed)
            || parsed.is_api_error_message
        {
            return;
        }
        if !matches!(parsed.r#type.as_str(), "user" | "assistant") {
            return;
        }
        let Some(message) = &parsed.message else {
            return;
        };
        let id = claude_window_turn_id(offset);
        let content = &message.content;
        let text = if let Some(text) = content.as_str() {
            text.to_owned()
        } else {
            content
                .as_array()
                .into_iter()
                .flatten()
                .filter(|part| part.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|part| part.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n")
        };
        // Harness command stdout is presented as provider output, not as a
        // human attachment; preserve the existing user-turn normalization.
        let text = if parsed.r#type == "user" {
            let stripped = crate::sources::imported_history::strip_orgii_exec_mode_bridge(&text);
            if claude_local_command_output(stripped).is_some() {
                return;
            }
            claude_local_command_input(stripped).unwrap_or_else(|| stripped.to_owned())
        } else {
            text
        };
        if parsed.r#type == "assistant" {
            messages.extend(UserSourceMessage::with_role(
                &id,
                &text,
                Vec::new(),
                SourceMessageRole::Assistant,
            ));
        } else {
            let images =
                claude_image_sources(content)
                    .enumerate()
                    .filter_map(|(position, source)| {
                        match source.get("type").and_then(Value::as_str) {
                            Some("url") => {
                                source.get("url").and_then(Value::as_str).map(str::to_owned)
                            }
                            Some("base64") => Some(transcript_image_ref(
                                session_id,
                                &id,
                                &format!("{INLINE_IMAGE_REF_PREFIX}{position}"),
                            )),
                            _ => None,
                        }
                    });
            messages.extend(UserSourceMessage::new(&id, &text, images));
        }
        for part in content.as_array().into_iter().flatten() {
            match part.get("type").and_then(Value::as_str) {
                Some("tool_use") if parsed.r#type == "assistant" => {
                    let (Some(call_id), Some(name)) = (
                        part.get("id").and_then(Value::as_str),
                        part.get("name").and_then(Value::as_str),
                    ) else {
                        continue;
                    };
                    let arguments = &part["input"];
                    if call_id.len() > 512
                        || name.len() > 256
                        || arguments.to_string().len() > 64 * 1024
                    {
                        continue;
                    }
                    calls.retain(|(key, _, _)| key != call_id);
                    if calls.len() == 256 {
                        calls.pop_front();
                    }
                    calls.push_back((call_id.to_owned(), name.to_owned(), arguments.clone()));
                }
                Some("tool_result") if parsed.r#type == "user" => {
                    let Some(call_id) = part.get("tool_use_id").and_then(Value::as_str) else {
                        continue;
                    };
                    let Some(index) = calls.iter().position(|(key, _, _)| key == call_id) else {
                        continue;
                    };
                    let Some((_, name, arguments)) = calls.remove(index) else {
                        continue;
                    };
                    let success = !part
                        .get("is_error")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    // Sidecar resources belong to this same logical call, not
                    // another activity. Never attach a sidecar to ambiguous multi-results.
                    let mut result = part.clone();
                    if let Some(sidecar) = parsed.tool_use_result.as_ref().filter(|_| {
                        content
                            .as_array()
                            .into_iter()
                            .flatten()
                            .filter(|part| {
                                part.get("type").and_then(Value::as_str) == Some("tool_result")
                            })
                            .count()
                            == 1
                    }) {
                        result["structuredContent"] = sidecar.clone();
                    }
                    messages.extend(UserSourceMessage::from_tool(
                        format!("claude-call:{call_id}"),
                        &name,
                        &arguments,
                        &result,
                        success,
                    ));
                }
                _ => {}
            }
        }
    })
    .map_err(|err| format!("Failed to read Claude sources: {err}"))?;
    let mut seen_calls = HashSet::new();
    messages.retain(|message| {
        message.role != SourceMessageRole::Tool || seen_calls.insert(message.id.clone())
    });
    Ok(messages)
}

/// Resolve one image of a user row. `original_ref` is a web URL or an inline
/// stand-in produced above; anything else resolves to nothing.
pub fn load_claude_code_image_from_path(
    path: &Path,
    turn_id: &str,
    original_ref: &str,
) -> Result<Option<String>, String> {
    let offset = claude_window_turn_offset(turn_id)
        .ok_or_else(|| "Invalid Claude image turn id".to_string())?;
    let mut file = open_history(path)?;
    let message = read_user_row(&mut file, offset)?
        .and_then(|row| row.message)
        .ok_or_else(|| "Claude image turn no longer points to a user message".to_string())?;
    let inline_index = original_ref
        .strip_prefix(INLINE_IMAGE_REF_PREFIX)
        .and_then(|index| index.parse::<usize>().ok());
    for (position, source) in claude_image_sources(&message.content).enumerate() {
        match source.get("type").and_then(Value::as_str) {
            Some("url") => {
                let url = source.get("url").and_then(Value::as_str);
                if url == Some(original_ref) {
                    return Ok(url.map(str::to_string));
                }
            }
            Some("base64") if inline_index == Some(position) => {
                let media_type = source
                    .get("media_type")
                    .and_then(Value::as_str)
                    .filter(|media_type| media_type.starts_with("image/"))
                    .unwrap_or("image/png");
                let data = source.get("data").and_then(Value::as_str);
                return Ok(data.map(|data| format!("data:{media_type};base64,{data}")));
            }
            _ => {}
        }
    }
    Ok(None)
}

fn open_history(path: &Path) -> Result<File, String> {
    File::open(path)
        .map_err(|err| format!("Failed to open Claude history {}: {err}", path.display()))
}

fn read_user_row(file: &mut File, offset: u64) -> Result<Option<ClaudeJsonlLine>, String> {
    file.seek(SeekFrom::Start(offset))
        .map_err(|err| format!("Failed to seek Claude history: {err}"))?;
    let mut line = Vec::new();
    BufReader::new((&*file).take(MAX_USER_ROW_BYTES + 1))
        .read_until(b'\n', &mut line)
        .map_err(|err| format!("Failed to read Claude history row: {err}"))?;
    if line.len() as u64 > MAX_USER_ROW_BYTES {
        return Err("Claude image record exceeds read limit".to_string());
    }
    Ok(serde_json::from_slice::<ClaudeJsonlLine>(&line)
        .ok()
        .filter(|row| row.r#type == "user"))
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

    #[test]
    fn lists_user_sources_and_reads_inline_images_on_demand() {
        let dir = std::env::temp_dir().join(format!("orgii-claude-sources-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("session.jsonl");
        let assistant = r#"{"type":"assistant","timestamp":"2026-09-16T10:00:00Z","message":{"role":"assistant","content":[{"type":"text","text":"https://b.dev/reply"}]}}"#;
        let user = r#"{"type":"user","timestamp":"2026-09-16T10:00:01Z","message":{"role":"user","content":[{"type":"text","text":"look at https://a.dev/page"},{"type":"image","source":{"type":"base64","media_type":"image/png","data":"AAA"}},{"type":"image","source":{"type":"url","url":"https://a.dev/pic.png"}}]}}"#;
        let plain = r#"{"type":"user","timestamp":"2026-09-16T10:00:02Z","message":{"role":"user","content":"no links"}}"#;
        std::fs::write(&path, format!("{assistant}\n{user}\n{plain}\n")).unwrap();

        let messages =
            load_claude_code_user_source_messages_from_path("claudecodeapp-x", &path).unwrap();
        let turn_id = claude_window_turn_id(assistant.len() as u64 + 1);
        let inline = format!("{INLINE_IMAGE_REF_PREFIX}0");
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
                text: "look at https://a.dev/page".to_string(),
                images: vec![
                    transcript_image_ref("claudecodeapp-x", &turn_id, &inline),
                    "https://a.dev/pic.png".to_string(),
                ],
            }]
        );
        assert_eq!(
            load_claude_code_image_from_path(&path, &turn_id, &inline).unwrap(),
            Some("data:image/png;base64,AAA".to_string())
        );
        assert_eq!(
            load_claude_code_image_from_path(&path, &turn_id, "claude-inline-image:1").unwrap(),
            None
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn streams_visible_assistant_and_paired_successful_tool_resources() {
        use serde_json::json;
        let dir = std::env::temp_dir().join(format!(
            "orgii-claude-source-conversation-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("session.jsonl");
        let records = vec![
            json!({"type":"user","isMeta":true,"uuid":"meta","message":{"content":"https://hidden.example/meta"}}),
            json!({"type":"user","isCompactSummary":true,"message":{"content":"https://hidden.example/summary"}}),
            json!({"type":"assistant","message":{"content":[{"type":"thinking","thinking":"https://hidden.example/thought"},{"type":"text","text":"[Report](/repo/report.md) https://public.example"},{"type":"tool_use","id":"read1","name":"Read","input":{"file_path":"/repo/input.ts"}},{"type":"tool_use","id":"read2","name":"Read","input":{"file_path":"/missing.ts"}},{"type":"tool_use","id":"report","name":"make_report","input":{}}]}}),
            json!({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"read1","content":"https://untrusted.example/file-body"},{"type":"tool_result","tool_use_id":"read2","is_error":true,"content":"Not found"},{"type":"tool_result","tool_use_id":"report","content":[{"type":"resource_link","uri":"https://reports.example/result"},{"type":"text","text":"https://untrusted.example/tool-text"}]}]}}),
            json!({"type":"assistant","isApiErrorMessage":true,"message":{"content":[{"type":"text","text":"https://hidden.example/api-error"}]}}),
            json!({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"unknown","content":[{"type":"resource_link","uri":"https://unknown.example"}]}]}}),
        ];
        std::fs::write(
            &path,
            records
                .iter()
                .map(Value::to_string)
                .collect::<Vec<_>>()
                .join("\n"),
        )
        .unwrap();
        let messages =
            load_claude_code_user_source_messages_from_path("claudecodeapp-x", &path).unwrap();
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
            "untrusted.example",
            "unknown.example",
            "/missing.ts",
        ] {
            assert!(!text.contains(excluded), "unexpected {excluded}: {text}");
        }
        assert_eq!(
            messages
                .iter()
                .filter(|message| message.role == SourceMessageRole::Assistant)
                .count(),
            1
        );
        assert!(messages
            .iter()
            .any(|message| message.tool_name.as_deref() == Some("Read")));
        assert!(messages
            .iter()
            .all(|message| message.role != SourceMessageRole::User));
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        writeln!(file, "\n{}", json!({"type":"assistant","message":{"content":[{"type":"text","text":"https://appended.example/new"}]}})).unwrap();
        let reread =
            load_claude_code_user_source_messages_from_path("claudecodeapp-x", &path).unwrap();
        assert_eq!(reread.len(), messages.len() + 1);
        assert!(reread
            .last()
            .unwrap()
            .text
            .contains("https://appended.example/new"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn retains_failed_terminal_and_web_actions_without_double_counting_sidecars_or_replayed_calls()
    {
        use crate::sources::imported_history::user_sources::{
            ToolActivityKind, ToolActivityStatus,
        };
        use serde_json::json;
        let dir = std::env::temp_dir().join(format!(
            "orgii-claude-source-activities-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("session.jsonl");
        let calls = json!({"type":"assistant","message":{"content":[
            {"type":"tool_use","id":"terminal","name":"mcp__codex_app__read_thread_terminal","input":{}},
            {"type":"tool_use","id":"web","name":"web.run","input":{"search_query":[{"q":"full query"}],"open":[{"ref_id":"https://docs.example/page"}]}}
        ]}});
        let failed = json!({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"terminal","is_error":true,"content":"No terminal attached"}]}});
        let web = json!({"type":"user","toolUseResult":{"artifact_path":"/repo/report.md"},"message":{"content":[{"type":"tool_result","tool_use_id":"web","content":"ordinary output"}]}});
        // A replayed provider record must not create another logical tool call.
        std::fs::write(
            &path,
            [&calls, &failed, &web, &calls, &failed, &web]
                .iter()
                .map(|record| record.to_string())
                .collect::<Vec<_>>()
                .join("\n"),
        )
        .unwrap();
        let messages =
            load_claude_code_user_source_messages_from_path("claudecodeapp-x", &path).unwrap();
        let activities: Vec<_> = messages
            .iter()
            .filter_map(|message| message.tool_activity.as_ref())
            .collect();
        assert_eq!(activities.len(), 2);
        let terminal = activities
            .iter()
            .find(|activity| activity.call_id == "claude-call:terminal")
            .unwrap();
        assert_eq!(terminal.status, ToolActivityStatus::Error);
        assert_eq!(terminal.error.as_deref(), Some("No terminal attached"));
        assert_eq!(terminal.actions[0].kind, ToolActivityKind::ReadTerminal);
        let web = activities
            .iter()
            .find(|activity| activity.call_id == "claude-call:web")
            .unwrap();
        assert_eq!(web.actions[0].query.as_deref(), Some("full query"));
        assert_eq!(
            web.actions[1].url.as_deref(),
            Some("https://docs.example/page")
        );
        assert!(messages
            .iter()
            .any(|message| message.text.contains("/repo/report.md")));
        assert_eq!(
            load_claude_code_user_source_messages_from_path("claudecodeapp-x", &path).unwrap(),
            messages
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn bounded_stream_skips_oversized_line_and_preserves_next_image_offset() {
        let mut reader = std::io::Cursor::new(format!("{}\nnext\n", "x".repeat(100)));
        let mut seen = Vec::new();
        visit_bounded_lines(&mut reader, 8, |offset, bytes| {
            seen.push((offset, bytes.to_vec()))
        })
        .unwrap();
        assert_eq!(seen, vec![(101, b"next\n".to_vec())]);
    }
}
