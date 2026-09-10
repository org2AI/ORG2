//! Bounded on-demand telemetry shared by imported and managed CLI sessions.
use serde::Serialize;
use serde_json::Value;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

pub(crate) const MAX_CONTEXT_TAIL_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedContextUsage {
    pub used_tokens: u64,
    pub max_tokens: Option<u64>,
    pub updated_at: String,
    pub sections: Vec<Value>,
    pub warnings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_read_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_write_tokens: Option<u64>,
}

pub(crate) fn read_context_tail(path: &Path) -> Result<Vec<u8>, String> {
    let mut file = std::fs::File::open(path).map_err(|err| err.to_string())?;
    let size = file.metadata().map_err(|err| err.to_string())?.len();
    let start = size.saturating_sub(MAX_CONTEXT_TAIL_BYTES);
    // Keep a record that starts exactly at the read boundary. Otherwise the
    // first newline belongs to the partial record that must be discarded.
    let starts_at_record = if start == 0 {
        true
    } else {
        file.seek(SeekFrom::Start(start - 1))
            .map_err(|err| err.to_string())?;
        let mut previous = [0_u8; 1];
        file.read_exact(&mut previous)
            .map_err(|err| err.to_string())?;
        previous[0] == b'\n'
    };
    file.seek(SeekFrom::Start(start))
        .map_err(|err| err.to_string())?;
    let mut bytes = Vec::new();
    file.take(MAX_CONTEXT_TAIL_BYTES)
        .read_to_end(&mut bytes)
        .map_err(|err| err.to_string())?;
    // Only complete JSONL records are authoritative while the writer is active.
    let end = bytes
        .iter()
        .rposition(|byte| *byte == b'\n')
        .map_or(0, |index| index + 1);
    let begin = if !starts_at_record {
        bytes
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(end, |index| index + 1)
    } else {
        0
    };
    bytes.truncate(end);
    if begin > 0 {
        bytes.drain(..begin);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_complete_record_exactly_at_tail_boundary() {
        let path = std::env::temp_dir().join(format!(
            "orgii-context-tail-boundary-{}",
            std::process::id()
        ));
        let record = b"{\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\"}}\n";
        let mut contents = b"prefix\n".to_vec();
        contents.extend_from_slice(record);
        contents.resize(7 + MAX_CONTEXT_TAIL_BYTES as usize, b' ');
        std::fs::write(&path, contents).unwrap();
        let result = read_context_tail(&path).unwrap();
        std::fs::remove_file(path).unwrap();
        assert_eq!(result, record);
    }
}
