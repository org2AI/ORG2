//! Every user message of a Codex rollout, reduced to its sources.
//!
//! Unlike the turn catalog this keeps each message's full text and every
//! image reference, but it still parses only lines that can be user
//! messages. Images become transcript refs keyed by the line's byte offset —
//! the same turn id the catalog uses — so `load_codex_image_from_path` can
//! read the embedded bytes back when a thumbnail asks for them.

use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

use memchr::{memchr, memmem};

use crate::sources::imported_history::user_sources::{transcript_image_ref, UserSourceMessage};

use super::super::CodexJsonlLine;
use super::catalog::codex_lazy_turn_id;
use super::messages::user_message_from_line;

/// Stand-in for an image a UI row embeds as a data URL (no file path), so its
/// transcript ref stays small; `load_codex_image_from_path` maps it back to
/// the row's image at that position.
pub(super) const INLINE_IMAGE_REF_PREFIX: &str = "codex-inline-image:";
const LEGACY_USER_MESSAGE_NEEDLE: &[u8] = b"\"user_message\"";
const PAGINATED_USER_MESSAGE_NEEDLE: &[u8] = b"\"UserMessage\"";
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
    visit_bounded_lines(&mut reader, MAX_USER_LINE_BYTES, |offset, line| {
        if memmem::find(line, LEGACY_USER_MESSAGE_NEEDLE).is_none()
            && memmem::find(line, PAGINATED_USER_MESSAGE_NEEDLE).is_none()
        {
            return;
        }
        let Ok(parsed) = serde_json::from_slice::<CodexJsonlLine>(line) else {
            return;
        };
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
    Ok(messages)
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
            messages,
            vec![UserSourceMessage {
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
