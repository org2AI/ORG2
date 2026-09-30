//! Provider-owned subagent turns need not contain a UserMessage. Select their
//! native task window before parsing so copied parent history stays out of the
//! preview and no synthetic user message is needed to manufacture a turn.

use std::collections::VecDeque;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::Path;

use serde_json::Value;

use super::cache::{codex_transcript_file_signature, CODEX_INITIAL_TURN_LIMIT};
use super::catalog::codex_lazy_turn_sequence;
use super::collector::CodexTranscriptCollectionMode;
use super::parser::parse_codex_app_bounded;
use super::reader::CodexAppInitialWindow;

const HEADER_BYTES: u64 = 4 * 1024 * 1024;
const TASK_WINDOW_SCAN_BYTES: u64 = 32 * 1024 * 1024;

pub(super) fn load_subagent_task_window(
    session_id: &str,
    path: &Path,
    recent_task_count: usize,
) -> Result<Option<CodexAppInitialWindow>, String> {
    load_subagent_task_window_with_limit(
        session_id,
        path,
        recent_task_count,
        TASK_WINDOW_SCAN_BYTES,
    )
}

fn load_subagent_task_window_with_limit(
    session_id: &str,
    path: &Path,
    recent_task_count: usize,
    scan_bytes: u64,
) -> Result<Option<CodexAppInitialWindow>, String> {
    let signature = codex_transcript_file_signature(path)?;
    let mut file =
        File::open(path).map_err(|err| format!("Failed to open Codex task history: {err}"))?;
    let mut header = Vec::new();
    BufReader::new((&mut file).take(HEADER_BYTES))
        .read_until(b'\n', &mut header)
        .map_err(|err| format!("Failed to read Codex task metadata: {err}"))?;
    let Some(start_ordinal) = subagent_start_ordinal(&header) else {
        return Ok(None);
    };

    let start = signature.size_bytes.saturating_sub(scan_bytes);
    let starts_mid_record = if start > 0 {
        file.seek(SeekFrom::Start(start - 1))
            .map_err(|err| format!("Failed to seek Codex task boundary: {err}"))?;
        let mut preceding = [0];
        file.read_exact(&mut preceding)
            .map_err(|err| format!("Failed to read Codex task boundary: {err}"))?;
        preceding[0] != b'\n'
    } else {
        false
    };
    file.seek(SeekFrom::Start(start))
        .map_err(|err| format!("Failed to seek Codex task history: {err}"))?;
    let mut reader = BufReader::new(file.take(signature.size_bytes - start));
    let mut offset = start;
    let mut line = Vec::new();
    if starts_mid_record {
        // The bounded suffix may start in a JSON string, including copied
        // context. Only complete provider records can establish task ownership.
        offset += reader
            .read_until(b'\n', &mut line)
            .map_err(|err| format!("Failed to skip partial Codex record: {err}"))?
            as u64;
    }
    let mut task_offsets = VecDeque::new();
    let recent_task_count = recent_task_count.clamp(1, CODEX_INITIAL_TURN_LIMIT);
    loop {
        line.clear();
        let size = reader
            .read_until(b'\n', &mut line)
            .map_err(|err| format!("Failed to scan Codex task history: {err}"))?;
        if size == 0 {
            break;
        }
        // Avoid decoding large tool output and inherited context records.
        if memchr::memmem::find(&line, b"\"task_started\"").is_some() {
            if let Ok(record) = serde_json::from_slice::<Value>(&line) {
                if record.get("type").and_then(Value::as_str) == Some("event_msg")
                    && record.pointer("/payload/type").and_then(Value::as_str)
                        == Some("task_started")
                    && record
                        .get("ordinal")
                        .and_then(Value::as_u64)
                        .is_some_and(|ordinal| ordinal >= start_ordinal)
                    && record
                        .pointer("/payload/turn_id")
                        .and_then(Value::as_str)
                        .is_some_and(|id| !id.is_empty())
                {
                    task_offsets.push_back(offset);
                    if task_offsets.len() > recent_task_count {
                        task_offsets.pop_front();
                    }
                }
            }
        }
        offset += size as u64;
    }
    let Some(task_start) = task_offsets.front().copied() else {
        if start > 0 {
            return Err(
                "No child task boundary found inside the bounded Codex history window".into(),
            );
        }
        return Ok(Some(CodexAppInitialWindow {
            chunks: Vec::new(),
            turns: Vec::new(),
        }));
    };
    // Full here means every real event in the selected bounded task window,
    // never the complete rollout. The ordinary collector drops user-less
    // Initial windows because it only catalogs conversational user turns.
    let (chunks, turns, _) = parse_codex_app_bounded(
        session_id,
        path,
        CodexTranscriptCollectionMode::Full,
        task_start,
        codex_lazy_turn_sequence(task_start),
        signature
            .size_bytes
            .saturating_sub(task_start)
            .saturating_add(1),
    )?;
    if codex_transcript_file_signature(path)? != signature {
        return Err("Codex task history changed during preview; retry".into());
    }
    Ok(Some(CodexAppInitialWindow { chunks, turns }))
}

fn subagent_start_ordinal(header: &[u8]) -> Option<u64> {
    let record: Value = serde_json::from_slice(header).ok()?;
    if record.get("type")?.as_str()? != "session_meta" {
        return None;
    }
    let payload = record.get("payload")?;
    if payload.pointer("/source/subagent").is_none()
        && payload.get("thread_source").and_then(Value::as_str) != Some("subagent")
    {
        return None;
    }
    payload.get("subagent_history_start_ordinal")?.as_u64()
}

#[cfg(test)]
mod tests;
