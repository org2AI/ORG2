//! User-message sources: the parts of a session's user messages that a
//! Sources list reads — lines that can carry a web reference, and image
//! references a thumbnail loads on demand.
//!
//! Readers hand every user message of a session through
//! [`UserSourceMessage::new`], which keeps the payload small: prose without a
//! `://` never crosses IPC, embedded pill context (terminal output, page
//! snapshots) is cut, and inline image bytes are never included.

use core_types::activity::ActivityChunk;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{strip_generated_prompt_context, FUNCTION_USER_MESSAGE};

/// Pills whose `::payload` holds their web destination (a GitHub card's URL);
/// every other payload follows a destination that is already in the path.
const DESTINATION_PAYLOAD_PILLS: [&str; 2] = ["pr", "issue"];
const TRANSCRIPT_IMAGE_PREFIX: &str = "orgii-transcript-image:";
/// A longer line (minified logs, pasted blobs) keeps only its URL-bearing words.
const MAX_REFERENCE_LINE_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSourceMessage {
    pub id: String,
    /// The message's lines that contain `://`, in order.
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
        let text = reference_text(&strip_generated_prompt_context(text));
        let images: Vec<String> = images
            .into_iter()
            .filter(|image| !image.is_empty() && !image.starts_with("data:"))
            .collect();
        (!text.is_empty() || !images.is_empty()).then(|| Self {
            id: id.into(),
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

/// Sources of the canonical user chunks in a replayed chunk stream.
pub fn user_source_messages_from_chunks(chunks: &[ActivityChunk]) -> Vec<UserSourceMessage> {
    chunks
        .iter()
        .filter(|chunk| chunk.function == FUNCTION_USER_MESSAGE)
        .filter_map(|chunk| {
            let text = chunk
                .result
                .pointer("/message/content")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let images = chunk
                .result
                .get("images")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_string);
            UserSourceMessage::new(chunk.chunk_id.clone(), text, images)
        })
        .collect()
}

pub fn reference_text(text: &str) -> String {
    let mut kept: Vec<String> = Vec::new();
    for line in text.lines() {
        if !line.contains("://") {
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
mod tests {
    use super::*;

    #[test]
    fn keeps_only_reference_lines_and_cuts_context_payloads() {
        let text = "please review\nsee pr [link:https://example.com/a] now\n\
                    page [browser:browser://https://example.com/b/1726000000000::SGVsbG8=]\n\
                    log [terminal:terminal://t1::QUJD] done\n\
                    card [pr:pr://org/repo/1::eyJwclVybCI6MX0=]";
        assert_eq!(
            reference_text(text),
            "see pr [link:https://example.com/a] now\n\
             page [browser:browser://https://example.com/b/1726000000000]\n\
             log [terminal:terminal://t1] done\n\
             card [pr:pr://org/repo/1::eyJwclVybCI6MX0=]"
        );
    }

    #[test]
    fn drops_urls_inside_generated_prompt_context() {
        let message = UserSourceMessage::new(
            "m",
            "<in-app-browser-context>\nURL: https://page.dev/open\n</in-app-browser-context>\n\
             read https://example.com/mine",
            Vec::new(),
        )
        .unwrap();
        assert_eq!(message.text, "read https://example.com/mine");
    }

    #[test]
    fn leaves_ipv6_hosts_and_closed_pills_alone() {
        let text = "a [link:http://x] then http://[::1]:3000/path";
        assert_eq!(reference_text(text), text);
    }

    #[test]
    fn reduces_oversized_lines_to_their_urls() {
        let text = format!("{} https://example.com/deep end", "x".repeat(20_000));
        assert_eq!(reference_text(&text), "https://example.com/deep");
    }

    #[test]
    fn drops_inline_image_bytes_and_empty_messages() {
        assert_eq!(
            UserSourceMessage::new("m", "no links here", Vec::new()),
            None
        );
        let message = UserSourceMessage::new(
            "m",
            "",
            vec![
                "data:image/png;base64,AAAA".to_string(),
                "/tmp/shot.png".to_string(),
            ],
        )
        .unwrap();
        assert_eq!(message.images, vec!["/tmp/shot.png"]);
        assert_eq!(message.text, "");
    }

    #[test]
    fn wraps_local_image_refs_for_lazy_reads() {
        assert_eq!(
            transcript_image_ref("s", "t", "/tmp/a.png"),
            r#"orgii-transcript-image:["s","t","/tmp/a.png"]"#
        );
        assert_eq!(
            transcript_image_ref("s", "t", "https://example.com/a.png"),
            "https://example.com/a.png"
        );
    }

    #[test]
    fn reads_user_chunks_only() {
        let mut user = super::super::user_message_chunk("s", "p", 0, "now", "https://a.dev/x");
        user.result["images"] = serde_json::json!(["/tmp/u.png", "data:image/png;base64,A"]);
        let assistant =
            super::super::assistant_message_chunk("s", "p", 1, "now", "https://b.dev/y");
        assert_eq!(
            user_source_messages_from_chunks(&[user, assistant]),
            vec![UserSourceMessage {
                id: "p-user-0".to_string(),
                text: "https://a.dev/x".to_string(),
                images: vec!["/tmp/u.png".to_string()],
            }]
        );
    }
}
