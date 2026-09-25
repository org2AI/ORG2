//! Conversation sources: explicitly referenced resources from visible messages that a
//! Sources list reads — lines that can carry a web reference, and image
//! references a thumbnail loads on demand.
//!
//! Readers hand visible messages and successful structured tool resources through
//! [`UserSourceMessage`], retaining its historical wire name. Prose without a
//! reference never crosses IPC, embedded pill context (terminal output, page
//! snapshots) is cut, and inline image bytes are never included.

use core_types::activity::ActivityChunk;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{strip_generated_prompt_context, FUNCTION_ASSISTANT, FUNCTION_USER_MESSAGE};
#[path = "tool_activity.rs"]
mod tool_activity;
pub use tool_activity::{ToolActivity, ToolActivityAction, ToolActivityKind, ToolActivityStatus};

/// Pills whose `::payload` holds their web destination (a GitHub card's URL);
/// every other payload follows a destination that is already in the path.
const DESTINATION_PAYLOAD_PILLS: [&str; 2] = ["pr", "issue"];
const TRANSCRIPT_IMAGE_PREFIX: &str = "orgii-transcript-image:";
/// A longer line (minified logs, pasted blobs) keeps only its URL-bearing words.
const MAX_REFERENCE_LINE_BYTES: usize = 16 * 1024;

/// Wire provenance, separate from whether an agent actually read a resource.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceMessageRole {
    #[default]
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSourceMessage {
    pub id: String,
    #[serde(default)]
    pub role: SourceMessageRole,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_activity: Option<ToolActivity>,
    /// Reference-bearing lines and explicit attachment envelope entries, in order.
    pub text: String,
    /// Paths, web URLs, or transcript refs; never `data:` URLs.
    pub images: Vec<String>,
}

impl UserSourceMessage {
    /// `None` when the message has neither a reference line nor an image.
    pub fn new(
        id: impl Into<String>,
        text: &str,
        images: impl IntoIterator<Item = String>,
    ) -> Option<Self> {
        Self::with_role(id, text, images, SourceMessageRole::User)
    }

    pub fn with_role(
        id: impl Into<String>,
        text: &str,
        images: impl IntoIterator<Item = String>,
        role: SourceMessageRole,
    ) -> Option<Self> {
        let text = reference_text_visible(
            &strip_generated_prompt_context(text),
            role == SourceMessageRole::Assistant,
        );
        let images: Vec<String> = images
            .into_iter()
            .filter(|image| {
                !image.is_empty()
                    && !image.starts_with("data:")
                    && image.len() <= MAX_REFERENCE_LINE_BYTES
            })
            .take(256)
            .collect();
        (!text.is_empty() || !images.is_empty()).then(|| Self {
            id: id.into(),
            role,
            tool_name: None,
            tool_activity: None,
            text,
            images,
        })
    }
}

/// A lazily loadable reference to an image stored inside a transcript line,
/// resolved by `session_history_image`. Web URLs stay as they are.
pub fn transcript_image_ref(session_id: &str, turn_id: &str, original: &str) -> String {
    if original.starts_with("http://") || original.starts_with("https://") {
        return original.to_string();
    }
    format!(
        "{TRANSCRIPT_IMAGE_PREFIX}{}",
        serde_json::json!([session_id, turn_id, original])
    )
}

/// Successful tool resources are taken only from explicit structured fields.
/// Text output, shell commands, logs and embedded document contents are never scanned.
impl UserSourceMessage {
    pub fn from_tool(
        id: impl Into<String>,
        tool_name: &str,
        args: &Value,
        result: &Value,
        success: bool,
    ) -> Option<Self> {
        if pending_tool_result(result) {
            return None;
        }
        let id = id.into();
        let success = success && !failed_tool_result(result);
        let activity = ToolActivity::project(&id, tool_name, args, result, success);
        if !success {
            return Some(Self::tool_activity_only(id, tool_name, activity));
        }
        let mut refs = Vec::new();
        let mut remaining_nodes = 2048;
        collect_tool_resources(result, &mut refs, 0, &mut remaining_nodes);
        // Provider wrappers often carry JSON as output; decode JSON only, never prose.
        for field in ["output", "observation"] {
            if let Some(encoded) = result.get(field).and_then(Value::as_str) {
                if encoded.len() <= 256 * 1024 {
                    if let Ok(value) = serde_json::from_str::<Value>(encoded) {
                        if failed_tool_result(&value) {
                            let activity =
                                ToolActivity::project(&id, tool_name, args, &value, false);
                            return Some(Self::tool_activity_only(id, tool_name, activity));
                        }
                        collect_tool_resources(&value, &mut refs, 0, &mut remaining_nodes);
                    }
                }
            }
        }
        let name = tool_name
            .rsplit("__")
            .next()
            .unwrap_or(tool_name)
            .rsplit('.')
            .next()
            .unwrap_or(tool_name)
            .to_ascii_lowercase();
        if matches!(
            name.as_str(),
            "read" | "read_file" | "view_image" | "open_file"
        ) {
            for field in ["file_path", "filePath", "path", "filename"] {
                if let Some(path) = args.get(field).and_then(Value::as_str) {
                    push_tool_reference(path, false, &mut refs);
                }
            }
        }
        if matches!(
            name.as_str(),
            "attach_artifact" | "read_resource" | "fetch" | "web_fetch"
        ) {
            for field in ["url", "uri"] {
                if let Some(url) = args.get(field).and_then(Value::as_str) {
                    push_tool_reference(url, true, &mut refs);
                }
            }
        }
        let mut message = Self::tool_activity_only(id, tool_name, activity);
        message.text = reference_text(&refs.join("\n"));
        Some(message)
    }
    fn tool_activity_only(id: String, tool_name: &str, activity: ToolActivity) -> Self {
        Self {
            id,
            role: SourceMessageRole::Tool,
            tool_name: Some(tool_name.chars().take(256).collect()),
            tool_activity: Some(activity),
            text: String::new(),
            images: Vec::new(),
        }
    }
}

fn pending_tool_result(value: &Value) -> bool {
    matches!(
        value.get("status").and_then(Value::as_str),
        Some("pending" | "running" | "in_progress")
    )
}
fn failed_tool_result(value: &Value) -> bool {
    value
        .get("isError")
        .or_else(|| value.get("is_error"))
        .and_then(Value::as_bool)
        == Some(true)
        || value.get("success").and_then(Value::as_bool) == Some(false)
        || matches!(
            value.get("status").and_then(Value::as_str),
            Some("failed" | "error" | "cancelled" | "canceled" | "pending" | "interrupted")
        )
}

fn push_tool_reference(value: &str, is_url: bool, refs: &mut Vec<String>) {
    if refs.len() >= 256
        || value.is_empty()
        || value.len() > 8192
        || value.contains(['\n', '\r', '[', ']'])
        || value.starts_with("data:")
    {
        return;
    }
    let web = value.starts_with("https://") || value.starts_with("http://");
    if is_url && !web && !value.starts_with("file://") {
        return;
    }
    let kind = if web { "link" } else { "file" };
    let label = value
        .rsplit(['/', '\\'])
        .next()
        .filter(|part| !part.is_empty())
        .unwrap_or("resource");
    let line = format!("{label} [{kind}:{value}]");
    if !refs.contains(&line) {
        refs.push(line);
    }
}

fn collect_tool_resources(
    value: &Value,
    refs: &mut Vec<String>,
    depth: usize,
    remaining_nodes: &mut usize,
) {
    if depth > 5 || refs.len() >= 256 || *remaining_nodes == 0 {
        return;
    }
    *remaining_nodes -= 1;
    let Some(object) = value.as_object() else {
        if let Some(items) = value.as_array() {
            for item in items.iter().take(256) {
                collect_tool_resources(item, refs, depth + 1, remaining_nodes);
            }
        }
        return;
    };
    if failed_tool_result(value) {
        return;
    }
    // Output fields explicitly describe a produced/read resource; generic `path`
    // is accepted only inside a typed resource/artifact envelope below.
    for field in [
        "output_path",
        "outputPath",
        "file_path",
        "filePath",
        "artifact_path",
    ] {
        if let Some(path) = object.get(field).and_then(Value::as_str) {
            push_tool_reference(path, false, refs);
        }
    }
    for field in [
        "url",
        "uri",
        "artifact_url",
        "download_url",
        "pr_url",
        "prUrl",
    ] {
        if let Some(url) = object.get(field).and_then(Value::as_str) {
            push_tool_reference(url, true, refs);
        }
    }
    if matches!(
        object.get("type").and_then(Value::as_str),
        Some("resource_link" | "resource" | "artifact" | "file")
    ) {
        if let Some(path) = object.get("path").and_then(Value::as_str) {
            push_tool_reference(path, false, refs);
        }
    }
    for field in [
        "resource",
        "resources",
        "artifact",
        "artifacts",
        "structuredContent",
    ] {
        if let Some(child) = object.get(field) {
            if failed_tool_result(child) {
                continue;
            }
            if let Some(path) = child.get("path").and_then(Value::as_str) {
                push_tool_reference(path, false, refs);
            }
            if matches!(field, "artifacts" | "resources") {
                if let Some(items) = child.as_array() {
                    for item in items.iter().take(256) {
                        if !failed_tool_result(item) {
                            if let Some(path) = item.get("path").and_then(Value::as_str) {
                                push_tool_reference(path, false, refs);
                            }
                        }
                    }
                }
            }
            collect_tool_resources(child, refs, depth + 1, remaining_nodes);
        }
    }
    // MCP content text is deliberately excluded; only typed resource blocks count.
    if let Some(content) = object.get("content").and_then(Value::as_array) {
        for block in content.iter().take(256) {
            if matches!(
                block.get("type").and_then(Value::as_str),
                Some("resource_link" | "resource")
            ) {
                collect_tool_resources(block, refs, depth + 1, remaining_nodes);
            }
        }
    }
}

/// Sources from canonical visible messages and completed tools in replay order.
/// Kept under the historical function name to avoid churning provider imports.
pub fn user_source_messages_from_chunks(chunks: &[ActivityChunk]) -> Vec<UserSourceMessage> {
    chunks
        .iter()
        .filter_map(source_message_from_chunk)
        .collect()
}

pub fn source_message_from_chunk(chunk: &ActivityChunk) -> Option<UserSourceMessage> {
    if chunk.broadcast_only || chunk.result.get("is_delta").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    let images = chunk
        .result
        .get("images")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string);
    if chunk.function == FUNCTION_USER_MESSAGE {
        return UserSourceMessage::new(
            &chunk.chunk_id,
            chunk
                .result
                .pointer("/message/content")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            images,
        );
    }
    if chunk.function == FUNCTION_ASSISTANT || chunk.action_type == "assistant" {
        let text = chunk
            .result
            .get("content")
            .or_else(|| chunk.result.get("observation"))
            .or_else(|| chunk.result.pointer("/message/content"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        return UserSourceMessage::with_role(
            &chunk.chunk_id,
            text,
            images,
            SourceMessageRole::Assistant,
        );
    }
    if chunk.action_type != "tool_call" {
        return None;
    }
    let success = chunk.result.get("success").and_then(Value::as_bool) == Some(true)
        || chunk.result.get("status").and_then(Value::as_str) == Some("completed");
    if pending_tool_result(&chunk.result) || (!success && !failed_tool_result(&chunk.result)) {
        return None;
    }
    let tool = chunk
        .result
        .get("raw_tool_name")
        .and_then(Value::as_str)
        .unwrap_or(&chunk.function);
    UserSourceMessage::from_tool(
        chunk
            .result
            .get("call_id")
            .and_then(Value::as_str)
            .unwrap_or(&chunk.chunk_id),
        tool,
        &chunk.args,
        &chunk.result,
        success,
    )
}

pub fn reference_text(text: &str) -> String {
    reference_text_visible(text, false)
}

fn reference_text_visible(text: &str, skip_code: bool) -> String {
    let mut kept: Vec<String> = Vec::new();
    let mut attachment_envelope = false;
    let mut fence: Option<(char, usize)> = None;
    for line in text.lines() {
        if kept.len() >= 256 {
            break;
        }
        let trimmed = line.trim();
        if skip_code {
            let marker = trimmed.chars().next().filter(|c| *c == '`' || *c == '~');
            let count = marker
                .map(|c| trimmed.chars().take_while(|v| *v == c).count())
                .unwrap_or(0);
            if let Some((kind, length)) = fence {
                if marker == Some(kind) && count >= length && trimmed[count..].trim().is_empty() {
                    fence = None;
                }
                continue;
            }
            if count >= 3 {
                fence = marker.map(|c| (c, count));
                continue;
            }
        }
        let heading = trimmed.trim_start_matches('#').trim();
        if heading.eq_ignore_ascii_case("Files mentioned by the user:") {
            attachment_envelope = true;
            kept.push(line.to_string());
            continue;
        }
        if attachment_envelope
            && (heading.eq_ignore_ascii_case("My request:")
                || heading.eq_ignore_ascii_case("My request for Codex:"))
        {
            attachment_envelope = false;
            kept.push(line.to_string());
            continue;
        }
        let file_reference = line.contains("[file:")
            || line.contains("[folder:")
            || line.contains("](")
            || (attachment_envelope && trimmed.starts_with("##") && line.contains(": "));
        if !line.contains("://") && !file_reference {
            continue;
        }
        let line = strip_pill_payloads(line);
        if line.len() <= MAX_REFERENCE_LINE_BYTES {
            kept.push(line);
            continue;
        }
        let words: Vec<&str> = line
            .split_whitespace()
            .filter(|word| word.contains("://") && word.len() <= MAX_REFERENCE_LINE_BYTES)
            .scan(0usize, |bytes, word| {
                *bytes += word.len() + 1;
                (*bytes <= MAX_REFERENCE_LINE_BYTES).then_some(word)
            })
            .collect();
        if !words.is_empty() {
            kept.push(words.join(" "));
        }
    }
    kept.join("\n")
}

fn is_pill_type(token: &str) -> bool {
    !token.is_empty()
        && token
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte == b'-')
}

/// `[type:path::payload]` → `[type:path]`, except for pills whose payload is
/// their destination.
fn strip_pill_payloads(line: &str) -> String {
    let mut out = String::with_capacity(line.len().min(MAX_REFERENCE_LINE_BYTES));
    let mut rest = line;
    while let Some(separator) = rest.find("::") {
        let (before, after) = rest.split_at(separator);
        let pill_type = before.rfind('[').and_then(|open| {
            let token = &before[open + 1..];
            if token.contains(']') {
                return None;
            }
            token.find(':').map(|colon| &token[..colon])
        });
        match (pill_type, after.find(']')) {
            (Some(kind), Some(close))
                if is_pill_type(kind) && !DESTINATION_PAYLOAD_PILLS.contains(&kind) =>
            {
                out.push_str(before);
                rest = &after[close..];
            }
            _ => {
                out.push_str(before);
                out.push_str("::");
                rest = &after[2..];
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
#[path = "user_sources_tests.rs"]
mod tests;
