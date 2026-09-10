//! Claude prompt footprint includes cached tokens; billing totals do not describe context.
use super::discovery::claude_file_stem_from_session_id;
use crate::sources::imported_history::{
    cache,
    context_usage::{read_context_tail, ImportedContextUsage},
    metadata::SOURCE_CLAUDE_CODE,
};
use rusqlite::Connection;
use serde_json::Value;
use std::path::Path;

pub fn load_claude_context_usage_for_session(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<ImportedContextUsage>, String> {
    let file_stem = claude_file_stem_from_session_id(session_id)?;
    let Some(path) = cache::get_cached_source_path_from_conn(conn, SOURCE_CLAUDE_CODE, file_stem)?
    else {
        return Ok(None);
    };
    Ok(parse_context_usage(&read_context_tail(Path::new(&path))?))
}

fn parse_context_usage(bytes: &[u8]) -> Option<ImportedContextUsage> {
    for line in bytes.rsplit(|byte| *byte == b'\n') {
        let Ok(record) = serde_json::from_slice::<Value>(line) else {
            continue;
        };
        if record["type"] == "system" && record["subtype"] == "compact_boundary" {
            return None;
        }
        if record["type"] != "assistant" {
            continue;
        }
        let usage = &record["message"]["usage"];
        if usage.is_null() {
            continue;
        }
        // Missing/invalid input cannot safely resurrect an older request footprint.
        let input = usage["input_tokens"].as_u64()?;
        let cache_read = optional_tokens(usage, "cache_read_input_tokens")?;
        let cache_write = optional_tokens(usage, "cache_creation_input_tokens")?;
        return Some(ImportedContextUsage {
            used_tokens: input.checked_add(cache_read)?.checked_add(cache_write)?,
            max_tokens: None,
            updated_at: record["timestamp"].as_str().unwrap_or_default().to_owned(),
            sections: Vec::new(),
            warnings: Vec::new(),
            cache_read_tokens: Some(cache_read),
            cache_write_tokens: Some(cache_write),
        });
    }
    None
}

fn optional_tokens(usage: &Value, key: &str) -> Option<u64> {
    match usage.get(key) {
        None => Some(0),
        Some(value) => value.as_u64(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn raw_file_append_partial_line_compaction_and_rewrite() {
        use std::io::Write;
        let path =
            std::env::temp_dir().join(format!("orgii-claude-context-{}.jsonl", std::process::id()));
        let initial = "{\"type\":\"assistant\",\"message\":{\"usage\":{\"input_tokens\":100}}}\n";
        std::fs::write(&path, initial).unwrap();
        let read = || parse_context_usage(&read_context_tail(&path).unwrap());
        assert_eq!(read().unwrap().used_tokens, 100);
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        file.write_all(initial.replace("100", "200").trim_end().as_bytes())
            .unwrap();
        assert_eq!(read().unwrap().used_tokens, 100);
        file.write_all(b"\n").unwrap();
        assert_eq!(read().unwrap().used_tokens, 200);
        file.write_all(b"{\"type\":\"system\",\"subtype\":\"compact_boundary\"}\n")
            .unwrap();
        assert!(read().is_none());
        drop(file);
        std::fs::write(&path, initial.replace("100", "10")).unwrap();
        let wire = serde_json::to_value(read().unwrap()).unwrap();
        assert_eq!(wire["usedTokens"], 10);
        assert!(wire["maxTokens"].is_null());
        assert_eq!(wire["cacheReadTokens"], 0);
        assert!(wire.get("used_tokens").is_none());
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn latest_assistant_includes_cache_once_and_not_output_or_cumulative_usage() {
        let raw = br#"{"type":"assistant","message":{"usage":{"input_tokens":9999}}}
{"type":"assistant","timestamp":"latest","message":{"id":"same","usage":{"input_tokens":10,"cache_read_input_tokens":80,"cache_creation_input_tokens":20,"output_tokens":900}}}
{"type":"assistant","timestamp":"latest","message":{"id":"same","usage":{"input_tokens":10,"cache_read_input_tokens":80,"cache_creation_input_tokens":20,"output_tokens":950}}}
{"type":"result","usage":{"input_tokens":100000}}
"#;
        let snapshot = parse_context_usage(raw).unwrap();
        assert_eq!(snapshot.used_tokens, 110);
        assert_eq!(snapshot.cache_read_tokens, Some(80));
        assert_eq!(snapshot.cache_write_tokens, Some(20));
        assert_eq!(snapshot.max_tokens, None);
    }
    #[test]
    fn compaction_invalidates_old_usage_and_new_request_replaces_it() {
        let before = "{\"type\":\"assistant\",\"message\":{\"usage\":{\"input_tokens\":1000}}}\n";
        let compacted =
            format!("{before}{{\"type\":\"system\",\"subtype\":\"compact_boundary\"}}\n");
        assert!(parse_context_usage(compacted.as_bytes()).is_none());
        let after = format!("{compacted}{}", before.replace("1000", "10"));
        assert_eq!(
            parse_context_usage(after.as_bytes()).unwrap().used_tokens,
            10
        );
    }
    #[test]
    fn zero_is_valid_and_malformed_cache_is_not_zero() {
        assert_eq!(
            parse_context_usage(br#"{"type":"assistant","message":{"usage":{"input_tokens":0}}}"#)
                .unwrap()
                .used_tokens,
            0
        );
        assert!(parse_context_usage(br#"{"type":"assistant","message":{"usage":{"input_tokens":10,"cache_read_input_tokens":-1}}}"#).is_none());
    }
}
