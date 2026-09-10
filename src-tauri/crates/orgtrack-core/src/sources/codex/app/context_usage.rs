//! Codex last-request context telemetry (not cumulative billing).
#[cfg(test)]
use crate::sources::imported_history::context_usage::MAX_CONTEXT_TAIL_BYTES;
use crate::sources::imported_history::context_usage::{read_context_tail, ImportedContextUsage};
use serde_json::Value;
use std::path::Path;

pub(super) fn read_context_usage(path: &Path) -> Result<Option<ImportedContextUsage>, String> {
    Ok(parse_context_usage(&read_context_tail(path)?))
}

fn parse_context_usage(bytes: &[u8]) -> Option<ImportedContextUsage> {
    for line in bytes.rsplit(|byte| *byte == b'\n') {
        let Ok(record) = serde_json::from_slice::<Value>(line) else {
            continue;
        };
        // A compaction invalidates the preceding request's context footprint.
        if record["type"] == "compacted" || record["payload"]["type"] == "context_compacted" {
            return None;
        }
        if record["type"] != "event_msg" || record["payload"]["type"] != "token_count" {
            continue;
        }
        let info = &record["payload"]["info"];
        // Null-info rate-limit notifications do not supersede usage telemetry.
        if info.is_null() {
            continue;
        }
        let usage = &info["last_token_usage"];
        let used_tokens = usage["total_tokens"].as_u64().or_else(|| {
            usage["input_tokens"]
                .as_u64()?
                .checked_add(usage["output_tokens"].as_u64()?)
        })?;
        return Some(ImportedContextUsage {
            used_tokens,
            max_tokens: info["model_context_window"]
                .as_u64()
                .filter(|value| *value > 0),
            updated_at: record["timestamp"].as_str().unwrap_or_default().to_owned(),
            cache_read_tokens: None,
            cache_write_tokens: None,
            sections: Vec::new(),
            warnings: Vec::new(),
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reread_tracks_append_compaction_rewrite_and_partial_lines_with_bounded_tail() {
        use std::io::Write;
        let path = std::env::temp_dir().join(format!("orgii-context-{}.jsonl", std::process::id()));
        let first = "{\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"last_token_usage\":{\"total_tokens\":120},\"model_context_window\":1000}}}\n";
        std::fs::write(&path, first).unwrap();
        assert_eq!(read_context_usage(&path).unwrap().unwrap().used_tokens, 120);
        let next = first.replace("120", "200");
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        file.write_all(next.trim_end().as_bytes()).unwrap();
        assert_eq!(read_context_usage(&path).unwrap().unwrap().used_tokens, 120);
        file.write_all(b"\n").unwrap();
        assert_eq!(read_context_usage(&path).unwrap().unwrap().used_tokens, 200);
        file.write_all(b"{\"type\":\"compacted\"}\n").unwrap();
        assert!(read_context_usage(&path).unwrap().is_none());
        drop(file);
        std::fs::write(&path, first.replace("120", "10")).unwrap();
        assert_eq!(read_context_usage(&path).unwrap().unwrap().used_tokens, 10);
        let mut large = vec![b'x'; MAX_CONTEXT_TAIL_BYTES as usize + 100];
        large.push(b'\n');
        large.extend_from_slice(first.as_bytes());
        std::fs::write(&path, large).unwrap();
        assert_eq!(read_context_usage(&path).unwrap().unwrap().used_tokens, 120);
        std::fs::remove_file(&path).unwrap();
        assert!(read_context_usage(&path).is_err());
    }

    #[test]
    fn latest_request_not_cumulative_or_double_counted_cache_and_reasoning() {
        let raw = br#"{"type":"event_msg","timestamp":"now","payload":{"type":"token_count","info":{"total_token_usage":{"total_tokens":999999},"last_token_usage":{"input_tokens":100,"cached_input_tokens":80,"output_tokens":20,"reasoning_output_tokens":10,"total_tokens":120},"model_context_window":272000}}}
{"type":"event_msg","payload":{"type":"token_count","info":null}}
"#;
        let usage = parse_context_usage(raw).unwrap();
        assert_eq!(usage.used_tokens, 120);
        assert_eq!(usage.max_tokens, Some(272000));
    }

    #[test]
    fn compaction_and_missing_last_usage_do_not_reuse_old_fill() {
        let raw = br#"{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"total_tokens":120}}}}
{"type":"compacted"}
"#;
        assert!(parse_context_usage(raw).is_none());
        assert!(parse_context_usage(br#"{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"total_tokens":9999}}}}"#).is_none());
    }

    #[test]
    fn zero_is_valid_and_unknown_window_is_not_defaulted() {
        let raw = br#"{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":0,"output_tokens":0},"model_context_window":0}}}"#;
        let usage = parse_context_usage(raw).unwrap();
        assert_eq!(usage.used_tokens, 0);
        assert_eq!(usage.max_tokens, None);
    }
}
