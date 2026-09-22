//! Claude Code user-message sources, and on-demand reads of the images they
//! reference.
//!
//! Claude stores pasted images inline as base64 in the user row. Sources
//! never carry those bytes: an inline image becomes a positional stand-in
//! inside a transcript ref keyed by the row's byte offset (the window turn
//! id), and `load_claude_code_image_from_path` re-reads that one row when a
//! thumbnail or the image viewer asks for it.

use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::Path;

use serde_json::Value;

use crate::sources::imported_history::user_sources::{transcript_image_ref, UserSourceMessage};

use super::super::replay::claude_image_sources;
use super::super::types::ClaudeJsonlLine;
use super::index::{claude_window_turn_offset, index_claude_user_turns};

const INLINE_IMAGE_REF_PREFIX: &str = "claude-inline-image:";
const MAX_USER_ROW_BYTES: u64 = 16 * 1024 * 1024;

pub fn load_claude_code_user_source_messages_from_path(
    session_id: &str,
    path: &Path,
) -> Result<Vec<UserSourceMessage>, String> {
    let turns = index_claude_user_turns(session_id, path)?;
    let mut image_rows: Option<File> = None;
    let mut messages = Vec::new();
    for turn in turns {
        let turn_id = turn.user_chunk.chunk_id.clone();
        let text = turn
            .user_chunk
            .result
            .pointer("/message/content")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let images = if turn.has_images {
            let file = match image_rows.as_mut() {
                Some(file) => file,
                None => image_rows.insert(open_history(path)?),
            };
            user_row_image_refs(file, turn.start_offset)?
                .iter()
                .map(|original| transcript_image_ref(session_id, &turn_id, original))
                .collect()
        } else {
            Vec::new()
        };
        messages.extend(UserSourceMessage::new(turn_id, text, images));
    }
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

/// Web URLs as they are; inline images as positional stand-ins.
fn user_row_image_refs(file: &mut File, offset: u64) -> Result<Vec<String>, String> {
    let Some(message) = read_user_row(file, offset)?.and_then(|row| row.message) else {
        return Ok(Vec::new());
    };
    Ok(claude_image_sources(&message.content)
        .enumerate()
        .filter_map(
            |(position, source)| match source.get("type").and_then(Value::as_str) {
                Some("url") => source
                    .get("url")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                Some("base64") => Some(format!("{INLINE_IMAGE_REF_PREFIX}{position}")),
                _ => None,
            },
        )
        .collect())
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

#[cfg(test)]
mod tests {
    use super::super::index::claude_window_turn_id;
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
            messages,
            vec![UserSourceMessage {
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
}
