use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;

use core_types::activity::ActivityChunk;

use crate::projectors::turn_metadata::ProjectedTurnMetadata;
use crate::sources::imported_history;
use crate::sources::imported_history::raw_json::{
    line_might_contain_json_field, line_might_contain_json_string_field,
};

use super::super::replay::{
    claude_content_text, claude_image_sources, claude_local_command_input,
    claude_local_command_output, claude_tool_result_text,
};
use super::super::types::{
    is_claude_compact_summary, is_harness_injected_user_line, ClaudeControlEnvelope,
    ClaudeJsonlLine,
};
use super::super::CLAUDE_CODE_PROVIDER_SLUG;

pub(in crate::sources::claude_code::history) const CLAUDE_WINDOW_TURN_ID_PREFIX: &str =
    "claude-window-turn-";

#[derive(Debug, Clone)]
pub(in crate::sources::claude_code::history) struct ClaudeIndexedTurn {
    pub(in crate::sources::claude_code::history) start_offset: u64,
    pub(in crate::sources::claude_code::history) user_chunk: ActivityChunk,
    /// Transcript lines between this user row and the next one that the
    /// replay parser can turn into body chunks — a cheap body-size surrogate
    /// like the one Codex's catalog keeps. Placeholder rounds surface it as
    /// `bodyEventCount`; without it the flat-view collapse bar (the only
    /// expand affordance when turn pagination is off) never renders and
    /// unloaded bodies become unreachable. Bookkeeping rows (attachments,
    /// snapshots, queue operations) are left out, so a round the agent never
    /// answered reports zero instead of a phantom body.
    pub(in crate::sources::claude_code::history) following_line_count: usize,
    /// Byte range `(offset, length)` of the newest following line that
    /// raw-scans as an assistant message carrying a text item. Unloaded
    /// rounds parse only this one line so their placeholder can carry the
    /// final-reply preview and a real end timestamp — the metadata every
    /// full-stream provider derives in `build_initial_window_from_turns` —
    /// without materializing the whole round body.
    pub(in crate::sources::claude_code::history) last_assistant_text_line: Option<(u64, usize)>,
    /// The user row carries image blocks. `user_chunk` keeps URL refs only
    /// (bounded); inline bytes stay in the source row.
    pub(in crate::sources::claude_code::history) has_images: bool,
}

pub(in crate::sources::claude_code::history) fn claude_window_turn_id(start_offset: u64) -> String {
    format!("{CLAUDE_WINDOW_TURN_ID_PREFIX}{start_offset}")
}

pub(super) fn claude_window_turn_offset(turn_id: &str) -> Option<u64> {
    turn_id
        .strip_prefix(CLAUDE_WINDOW_TURN_ID_PREFIX)?
        .parse()
        .ok()
}

/// Raw prefilter for lines the replay parser can turn into body chunks. The
/// parser only emits from rows carrying a `message` envelope (replies,
/// thinking, tool calls and results), compact summaries, and `system`
/// local-command or compact-boundary rows; attachments, file-history
/// snapshots, queue operations, last-prompt markers, titles and hook
/// summaries are skipped outright. Conservative like the other prefilters: a
/// nested `"message":` key only over-counts, it never hides a real body.
fn line_might_produce_claude_body(line: &[u8]) -> bool {
    if is_claude_bookkeeping_system_row(line) {
        return false;
    }
    line_might_contain_json_field(line, b"message", |_| true)
        || line_might_contain_json_field(line, b"isCompactSummary", |_| true)
        || line_might_contain_json_string_field(line, b"subtype", b"local_command")
        || line_might_contain_json_string_field(line, b"subtype", b"compact_boundary")
}

/// `system` rows other than local-command output and compact boundaries —
/// API-error retries, hook summaries, notices — render nothing, even though an
/// API error's nested payload carries a `"message"` key. A line that also
/// mentions a user or assistant type is left to the checks above, so a nested
/// `"type":"system"` inside real output can never hide it.
fn is_claude_bookkeeping_system_row(line: &[u8]) -> bool {
    line_might_contain_json_string_field(line, b"type", b"system")
        && !line_might_contain_json_string_field(line, b"subtype", b"local_command")
        && !line_might_contain_json_string_field(line, b"subtype", b"compact_boundary")
        && !line_might_contain_json_string_field(line, b"type", b"user")
        && !line_might_contain_json_string_field(line, b"type", b"assistant")
}

fn line_might_be_claude_user(line: &[u8]) -> bool {
    line_might_contain_json_string_field(line, b"type", b"user")
}

fn line_is_obvious_tool_result(line: &[u8]) -> bool {
    line_might_contain_json_string_field(line, b"type", b"tool_result")
        && line
            .windows(b"\"tool_use_id\"".len())
            .any(|window| window == b"\"tool_use_id\"")
}

/// Raw prefilter for assistant lines that carry at least one text item
/// (`content: [{"type":"text", ...}]`). Thinking-only and tool_use-only lines
/// fail the second check, matching the preview policy of the full-stream
/// window builder (only `FUNCTION_ASSISTANT` chunks become round previews).
/// False positives (e.g. `"type":"text"` inside a tool input) are filtered by
/// the canonical parser when the line is actually loaded.
fn line_might_be_claude_assistant_text(line: &[u8]) -> bool {
    line_might_contain_json_string_field(line, b"type", b"assistant")
        && line_might_contain_json_string_field(line, b"type", b"text")
}

/// Build a byte-offset index by deserializing only likely human-user lines.
///
/// Claude transcripts are dominated by assistant/tool-result payloads. A
/// large real session can have thousands of tool-result lines but fewer than
/// one hundred conversational rounds, so parsing every JSON value just to
/// discover the round headers makes first open scale with the entire replay
/// body. The raw prefilter is conservative: false positives are validated by
/// the canonical parser below, while structurally obvious tool-result records
/// never allocate their potentially huge payloads.
pub(in crate::sources::claude_code::history) fn index_claude_user_turns(
    session_id: &str,
    path: &Path,
) -> Result<Vec<ClaudeIndexedTurn>, String> {
    let file = fs::File::open(path)
        .map_err(|err| format!("Failed to open Claude history {}: {err}", path.display()))?;
    let mut reader = BufReader::new(file);
    let mut line = Vec::new();
    let mut start_offset = 0u64;
    let mut turns = Vec::new();
    let mut awaiting_local_command_output = false;
    let mut control_envelope = ClaudeControlEnvelope::default();

    loop {
        line.clear();
        let bytes_read = reader
            .read_until(b'\n', &mut line)
            .map_err(|err| format!("Failed to read Claude history line: {err}"))?;
        if bytes_read == 0 {
            break;
        }
        let current_offset = start_offset;
        start_offset = start_offset.saturating_add(bytes_read as u64);
        // Most assistant bodies stay on the cheap raw-index path. Only a
        // synthetic candidate needs provenance parsing; no second file scan.
        if line_might_contain_json_string_field(&line, b"model", b"<synthetic>") {
            if let Ok(parsed) = serde_json::from_slice::<ClaudeJsonlLine>(&line) {
                if control_envelope.observe(&parsed) {
                    continue;
                }
            }
        }
        // A line that does not become a turn header counts toward the previous
        // turn's body-size surrogate when the parser could render it.
        let count_toward_previous_turn = |turns: &mut Vec<ClaudeIndexedTurn>| {
            if let Some(previous) = turns.last_mut() {
                if line_might_produce_claude_body(&line) {
                    previous.following_line_count += 1;
                }
                if line_might_be_claude_assistant_text(&line) {
                    previous.last_assistant_text_line = Some((current_offset, bytes_read));
                }
            }
        };
        if awaiting_local_command_output
            && (line_might_contain_json_string_field(&line, b"type", b"assistant")
                || (line_might_contain_json_string_field(&line, b"type", b"system")
                    && line_might_contain_json_string_field(&line, b"subtype", b"local_command")))
        {
            awaiting_local_command_output = false;
        }
        if !line_might_be_claude_user(&line) || line_is_obvious_tool_result(&line) {
            if line_might_be_claude_user(&line) && line_is_obvious_tool_result(&line) {
                control_envelope.clear();
            }
            count_toward_previous_turn(&mut turns);
            continue;
        }
        let Ok(parsed) = serde_json::from_slice::<ClaudeJsonlLine>(&line) else {
            count_toward_previous_turn(&mut turns);
            continue;
        };
        control_envelope.observe(&parsed);
        if parsed.r#type == "user"
            && !is_claude_compact_summary(&parsed)
            && is_harness_injected_user_line(&parsed)
        {
            continue;
        }
        if parsed.r#type != "user"
            || is_claude_compact_summary(&parsed)
            || is_harness_injected_user_line(&parsed)
        {
            count_toward_previous_turn(&mut turns);
            continue;
        }
        let created_at = parsed
            .timestamp
            .as_deref()
            .map(imported_history::normalize_created_at)
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
        let Some(message) = parsed.message else {
            count_toward_previous_turn(&mut turns);
            continue;
        };
        if claude_tool_result_text(&message.content).is_some() {
            count_toward_previous_turn(&mut turns);
            continue;
        }
        let has_images = claude_image_sources(&message.content).next().is_some();
        // Keep URL metadata only. Base64 image-only turns still need an index
        // entry so expansion can retrieve their bytes from the source row.
        let image_refs = imported_history::images::bounded_image_refs(
            claude_image_sources(&message.content)
                .filter_map(|source| source.get("url").and_then(serde_json::Value::as_str)),
        );
        let text = claude_content_text(&message.content).unwrap_or_default();
        let text = imported_history::strip_orgii_exec_mode_bridge(&text);
        if awaiting_local_command_output && claude_local_command_output(text).is_some() {
            awaiting_local_command_output = false;
            count_toward_previous_turn(&mut turns);
            continue;
        }
        let command = claude_local_command_input(text);
        awaiting_local_command_output = command.is_some();
        let text = command.as_deref().unwrap_or(text);
        if text.trim().is_empty() && !has_images {
            count_toward_previous_turn(&mut turns);
            continue;
        }
        let sequence = usize::try_from(current_offset).unwrap_or(usize::MAX);
        let mut user_chunk = imported_history::user_message_chunk(
            session_id,
            CLAUDE_CODE_PROVIDER_SLUG,
            sequence,
            &created_at,
            if text.trim().is_empty() {
                "(image)"
            } else {
                text
            },
        );
        if !image_refs.is_empty() {
            user_chunk.result["images"] = serde_json::json!(image_refs);
        }
        user_chunk.chunk_id = claude_window_turn_id(current_offset);
        turns.push(ClaudeIndexedTurn {
            start_offset: current_offset,
            user_chunk,
            following_line_count: 0,
            last_assistant_text_line: None,
            has_images,
        });
    }
    Ok(turns)
}

/// Overlay the index's cheap body-size surrogate onto reduced-stream
/// projections. `projected[i]` must correspond to `indexed[i]` (both are
/// emitted in transcript order). Rounds before `first_loaded_turn` only
/// contributed their header (plus at most the single parsed preview line), so
/// the index surrogate is always the honest count there; rounds at or past it
/// projected real bodies and keep their exact counts unless the parse came
/// back empty. A zero surrogate stays zero: it only counts lines the parser
/// can render, so zero means there is no body to fetch, and advertising one
/// would draw an "Agent worked for" bar over nothing.
pub(in crate::sources::claude_code::history) fn overlay_indexed_body_counts(
    projected: &mut [ProjectedTurnMetadata],
    indexed: &[ClaudeIndexedTurn],
    first_loaded_turn: usize,
) {
    for (turn_index, (turn, index_entry)) in projected.iter_mut().zip(indexed).enumerate() {
        if turn_index >= first_loaded_turn && turn.body_event_count > 0 {
            continue;
        }
        let body_event_count = i64::try_from(index_entry.following_line_count).unwrap_or(i64::MAX);
        turn.body_event_count = body_event_count;
        turn.event_count = body_event_count.saturating_add(1);
    }
}
