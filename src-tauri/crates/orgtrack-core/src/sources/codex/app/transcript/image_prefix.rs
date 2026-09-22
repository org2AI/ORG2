//! Recover a UI mirror's immediately preceding image record on bounded reads.
//! The catalog keeps only offsets and small references, never embedded images.

use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};

use super::{super::CodexJsonlLine, messages::user_image_data_urls_from_response_message};

const BLOCK_BYTES: usize = 64 * 1024;
const MAX_PREFIX_BYTES: usize = 16 * 1024 * 1024;

pub(super) fn preceding_user_images(path: &Path, offset: u64) -> Result<Vec<String>, String> {
    if offset == 0 {
        return Ok(Vec::new());
    }
    let mut file = File::open(path).map_err(|err| format!("Open Codex image prefix: {err}"))?;
    let mut cursor = offset;
    // Scan backwards in fixed blocks; allocate the JSON line only once after
    // locating its start. Never scan another turn or retain a process cache.
    let mut block = vec![0; BLOCK_BYTES];
    let mut end = offset;
    let lower = offset.saturating_sub(MAX_PREFIX_BYTES as u64);
    while cursor > lower {
        let start = cursor.saturating_sub(BLOCK_BYTES as u64).max(lower);
        let count = (cursor - start) as usize;
        file.seek(SeekFrom::Start(start))
            .map_err(|err| format!("Seek Codex image prefix: {err}"))?;
        file.read_exact(&mut block[..count])
            .map_err(|err| format!("Read Codex image prefix: {err}"))?;
        for index in (0..count).rev() {
            let position = start + index as u64;
            if position + 1 == end && matches!(block[index], b'\n' | b'\r') {
                end = position;
                continue;
            }
            if block[index] == b'\n' || position == 0 {
                let line_start = if block[index] == b'\n' {
                    position + 1
                } else {
                    0
                };
                let mut line = vec![0; (end - line_start) as usize];
                file.seek(SeekFrom::Start(line_start))
                    .map_err(|err| format!("Seek Codex image record: {err}"))?;
                file.read_exact(&mut line)
                    .map_err(|err| format!("Read Codex image record: {err}"))?;
                let Ok(parsed) = serde_json::from_slice::<CodexJsonlLine>(&line) else {
                    return Ok(Vec::new());
                };
                drop(line);
                return Ok(user_image_data_urls_from_response_message(&parsed.payload));
            }
        }
        cursor = start;
    }
    // Oversized/partial prefixes retain the UI row's original references.
    Ok(Vec::new())
}

/// Resolve exactly one attachment from its source user record without loading
/// the turn body. The original reference also guards against stale offsets.
pub fn load_codex_image_from_path(
    path: &Path,
    turn_id: &str,
    original_ref: &str,
) -> Result<Option<String>, String> {
    use std::io::{BufRead, BufReader};
    if turn_id.starts_with(super::output_images::OUTPUT_IMAGE_PREFIX) {
        return super::output_images::load_output_image(path, turn_id, original_ref);
    }
    let offset = super::catalog::codex_lazy_turn_offset(turn_id)
        .ok_or_else(|| "Invalid Codex image turn id".to_string())?;
    let mut file = File::open(path).map_err(|err| format!("Open Codex image source: {err}"))?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|err| format!("Seek Codex image source: {err}"))?;
    let mut line = String::new();
    BufReader::new(file.take(MAX_PREFIX_BYTES as u64 + 1))
        .read_line(&mut line)
        .map_err(|err| format!("Read Codex image source: {err}"))?;
    if line.len() > MAX_PREFIX_BYTES {
        return Err("Codex image record exceeds read limit".into());
    }
    let parsed: CodexJsonlLine =
        serde_json::from_str(&line).map_err(|err| format!("Parse Codex image source: {err}"))?;
    let message = super::messages::user_message_from_line(&parsed)
        .ok_or_else(|| "Codex image turn no longer points to a user message".to_string())?;
    if let Some(position) = original_ref.strip_prefix(super::sources::INLINE_IMAGE_REF_PREFIX) {
        return Ok(position
            .parse::<usize>()
            .ok()
            .and_then(|position| message.image_refs.get(position))
            .filter(|image| image.starts_with("data:image/"))
            .cloned());
    }
    let index = message
        .image_refs
        .iter()
        .position(|value| value == original_ref)
        .ok_or_else(|| "Codex image reference no longer matches its source turn".to_string())?;
    drop(parsed);
    drop(line);
    let mut portable = preceding_user_images(path, offset)?;
    if portable.len() == message.image_refs.len() {
        return Ok(Some(portable.swap_remove(index)));
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefix_is_bounded_and_never_uses_tool_or_older_turn_images() {
        let dir = std::env::temp_dir().join(format!("orgii-image-prefix-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("rollout.jsonl");
        let image = r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_image","image_url":"data:image/png;base64,AAA"}]}}"#;
        let content = format!("{image}\r\n");
        std::fs::write(&path, &content).unwrap();
        assert_eq!(
            preceding_user_images(&path, content.len() as u64).unwrap(),
            vec!["data:image/png;base64,AAA"]
        );
        let content = format!(
            "{image}\n{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"task_started\"}}}}\n"
        );
        std::fs::write(&path, &content).unwrap();
        assert!(preceding_user_images(&path, content.len() as u64)
            .unwrap()
            .is_empty());
        let content = format!("{image}\n{}\n", "x".repeat(MAX_PREFIX_BYTES + 1));
        std::fs::write(&path, &content).unwrap();
        assert!(preceding_user_images(&path, content.len() as u64)
            .unwrap()
            .is_empty());
        assert!(preceding_user_images(&path, 0).unwrap().is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
