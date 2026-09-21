use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use memchr::{memchr_iter, memmem};
use serde_json::Value;

use crate::sources::imported_history;
use crate::sources::imported_history::raw_json::{
    line_might_contain_json_field, line_might_contain_json_string_field,
};

use super::super::CodexJsonlLine;
use super::cache::{
    bounded_codex_turn_preview, codex_turn_catalog_cache, CodexAgentPreview,
    CodexTranscriptSignature, CodexTurnCatalogEntry, CODEX_INITIAL_TURN_LIMIT,
    CODEX_REVERSE_SCAN_MAX_LINE_BYTES,
};
use super::messages::{content_text_from_payload, user_message_from_line};

const CODEX_LEGACY_USER_MESSAGE_NEEDLE: &[u8] = b"\"user_message\"";
const CODEX_PAGINATED_USER_MESSAGE_NEEDLE: &[u8] = b"\"UserMessage\"";
const CODEX_REVERSE_SCAN_BLOCK_BYTES: usize = 1024 * 1024;

pub(super) fn codex_lazy_turn_sequence(byte_offset: u64) -> usize {
    usize::try_from(byte_offset).unwrap_or(usize::MAX)
}

pub(super) fn codex_lazy_turn_id(byte_offset: u64) -> String {
    format!("codex-user-{}", codex_lazy_turn_sequence(byte_offset))
}

pub(super) fn codex_lazy_turn_offset(turn_id: &str) -> Option<u64> {
    turn_id.strip_prefix("codex-user-")?.parse().ok()
}

pub(super) fn load_codex_turn_catalog(
    path: &Path,
    signature: CodexTranscriptSignature,
) -> Result<Vec<CodexTurnCatalogEntry>, String> {
    {
        let mut cache = codex_turn_catalog_cache()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(entries) = cache.exact(path, signature) {
            return Ok(entries);
        }
    }
    // Growth is not proof of append: rotation and in-place rewrites can both
    // produce a larger file at this path. Rebuild changed catalogs from the
    // source instead of retaining offsets/previews from an older revision.
    // The reverse scanner still bounds the catalog and skips body decoding;
    // unchanged revisions retain the exact-signature cache fast path.
    let entries =
        find_codex_user_offsets_in_range(path, signature.size_bytes, 0, CODEX_INITIAL_TURN_LIMIT)?;

    codex_turn_catalog_cache()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(path.to_path_buf(), signature, entries.clone());
    Ok(entries)
}

pub(super) fn find_recent_codex_user_offsets(
    path: &Path,
    before_exclusive: u64,
    limit: usize,
) -> Result<Vec<CodexTurnCatalogEntry>, String> {
    find_codex_user_offsets_in_range(path, before_exclusive, 0, limit)
}

pub(super) fn find_recent_codex_user_offsets_bounded(
    path: &Path,
    before_exclusive: u64,
    limit: usize,
    max_scan_bytes: u64,
) -> Result<Vec<CodexTurnCatalogEntry>, String> {
    find_codex_user_offsets_in_range(
        path,
        before_exclusive,
        before_exclusive.saturating_sub(max_scan_bytes),
        limit,
    )
}

fn find_codex_user_offsets_in_range(
    path: &Path,
    before_exclusive: u64,
    after_inclusive: u64,
    limit: usize,
) -> Result<Vec<CodexTurnCatalogEntry>, String> {
    if limit == 0 || before_exclusive <= after_inclusive {
        return Ok(Vec::new());
    }
    let mut file = fs::File::open(path)
        .map_err(|err| format!("Failed to open Codex history {}: {err}", path.display()))?;
    let file_len = file
        .metadata()
        .map_err(|err| format!("Failed to stat Codex history {}: {err}", path.display()))?
        .len();
    let mut cursor = before_exclusive.min(file_len);
    let mut suffix = Vec::<u8>::new();
    let mut discarding_oversized_line = false;
    let mut entries = Vec::with_capacity(limit.min(CODEX_INITIAL_TURN_LIMIT));
    let mut lines_since_boundary = 0usize;
    let mut last_agent_preview = None;
    let mut output_images = Vec::new();

    while cursor > after_inclusive && entries.len() < limit {
        let block_start = cursor
            .saturating_sub(CODEX_REVERSE_SCAN_BLOCK_BYTES as u64)
            .max(after_inclusive);
        let block_len = usize::try_from(cursor - block_start).unwrap_or_default();
        file.seek(SeekFrom::Start(block_start)).map_err(|err| {
            format!(
                "Failed to seek Codex history {} to {block_start}: {err}",
                path.display()
            )
        })?;
        let mut combined = vec![0u8; block_len];
        file.read_exact(&mut combined)
            .map_err(|err| format!("Failed to reverse-read Codex history: {err}"))?;
        combined.extend_from_slice(&suffix);
        suffix.clear();

        let mut line_end = combined.len();
        let mut skipped_boundary_fragment = !discarding_oversized_line;
        // Keep the byte-heavy scan in memchr's optimized implementation.
        // The catalog parser itself only visits complete JSONL records.
        for newline_index in memchr_iter(b'\n', &combined).rev() {
            let line_start = newline_index + 1;
            if skipped_boundary_fragment {
                observe_codex_catalog_line(
                    &combined[line_start..line_end],
                    block_start.saturating_add(line_start as u64),
                    &mut entries,
                    limit,
                    &mut lines_since_boundary,
                    &mut last_agent_preview,
                    &mut output_images,
                );
            } else {
                skipped_boundary_fragment = true;
                discarding_oversized_line = false;
            }
            if entries.len() >= limit {
                break;
            }
            line_end = newline_index;
        }
        if entries.len() >= limit {
            break;
        }

        let leading_fragment = &combined[..line_end];
        if block_start == after_inclusive {
            if !discarding_oversized_line {
                observe_codex_catalog_line(
                    leading_fragment,
                    block_start,
                    &mut entries,
                    limit,
                    &mut lines_since_boundary,
                    &mut last_agent_preview,
                    &mut output_images,
                );
            }
        } else if discarding_oversized_line {
            suffix.clear();
        } else if leading_fragment.len() <= CODEX_REVERSE_SCAN_MAX_LINE_BYTES {
            suffix.extend_from_slice(leading_fragment);
        } else {
            suffix.clear();
            discarding_oversized_line = true;
        }
        cursor = block_start;
    }

    Ok(entries)
}

fn observe_codex_catalog_line(
    line: &[u8],
    byte_offset: u64,
    entries: &mut Vec<CodexTurnCatalogEntry>,
    limit: usize,
    lines_since_boundary: &mut usize,
    last_agent_preview: &mut Option<CodexAgentPreview>,
    output_images: &mut Vec<super::output_images::CatalogOutputImage>,
) {
    const AGENT_MESSAGE_NEEDLE: &[u8] = b"\"agent_message\"";
    const ASSISTANT_ROLE_NEEDLE: &[u8] = b"\"assistant\"";
    if line.is_empty() {
        return;
    }
    if entries.len() >= limit {
        return;
    }
    let may_contain_user = memmem::find(line, CODEX_LEGACY_USER_MESSAGE_NEEDLE).is_some()
        || memmem::find(line, CODEX_PAGINATED_USER_MESSAGE_NEEDLE).is_some();
    let may_contain_assistant = last_agent_preview.is_none()
        && (memmem::find(line, AGENT_MESSAGE_NEEDLE).is_some()
            || memmem::find(line, ASSISTANT_ROLE_NEEDLE).is_some());
    if output_images.len() < 64
        && (memmem::find(line, b"image_url").is_some()
            || memmem::find(line, b"image_generation_call").is_some())
    {
        let mut images = super::output_images::catalog_output_images(line, byte_offset);
        let mut remaining = 2048usize.saturating_sub(
            output_images
                .iter()
                .map(|image| image.retained_bytes())
                .sum(),
        );
        images.retain(|image| {
            let cost = image.retained_bytes();
            if cost > remaining {
                return false;
            }
            remaining -= cost;
            true
        });
        // Rows arrive newest first, but preserve image order within each row.
        images.append(output_images);
        *output_images = images;
    }
    if !may_contain_user && !may_contain_assistant {
        count_codex_body_line(line, lines_since_boundary);
        return;
    }
    let Ok(parsed) = serde_json::from_slice::<CodexJsonlLine>(line) else {
        count_codex_body_line(line, lines_since_boundary);
        return;
    };
    if may_contain_user {
        if let Some(message) = user_message_from_line(&parsed) {
            let started_at = parsed
                .timestamp
                .as_deref()
                .map(imported_history::normalize_created_at)
                .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
            entries.push(CodexTurnCatalogEntry {
                byte_offset,
                output_images: std::mem::take(output_images),
                image_refs: imported_history::images::bounded_image_refs(
                    message.image_refs.iter().map(String::as_str),
                ),
                started_at,
                user_preview: if message.text.trim().is_empty() && !message.image_refs.is_empty() {
                    "(image)".to_string()
                } else {
                    bounded_codex_turn_preview(&message.text)
                },
                last_agent_preview: last_agent_preview.take(),
                following_line_count: *lines_since_boundary,
            });
            *lines_since_boundary = 0;
            return;
        }
    }
    if may_contain_assistant {
        let payload_type = parsed.payload.get("type").and_then(Value::as_str);
        let message = match payload_type {
            Some("agent_message") => parsed
                .payload
                .get("message")
                .and_then(Value::as_str)
                .map(ToString::to_string),
            Some("message")
                if parsed.payload.get("role").and_then(Value::as_str) == Some("assistant") =>
            {
                content_text_from_payload(&parsed.payload)
            }
            _ => None,
        };
        *last_agent_preview = message
            .filter(|message| !message.trim().is_empty())
            .map(|message| CodexAgentPreview::new(&message));
    }
    count_codex_body_line(line, lines_since_boundary);
}

/// Count a non-header line toward its round's body-size surrogate only when
/// the replay parser could render it, so a round the agent never answered
/// reports zero instead of its lifecycle and settings rows.
fn count_codex_body_line(line: &[u8], lines_since_boundary: &mut usize) {
    if line_might_produce_codex_body(line) {
        *lines_since_boundary = lines_since_boundary.saturating_add(1);
    }
}

/// Raw prefilter for rollout lines `parse_codex_app_from_path_with_mode` can
/// turn into body chunks: replies, reasoning with text, tool calls and their
/// outputs, web searches, compaction markers, and failed task completions.
/// User and developer message mirrors, `item_completed` projections, turn
/// context, token counts and lifecycle rows never render. Conservative: a
/// nested match only over-counts, it never hides a real body.
fn line_might_produce_codex_body(line: &[u8]) -> bool {
    const BODY_TYPES: &[&[u8]] = &[
        b"agent_message",
        b"function_call",
        b"function_call_output",
        b"custom_tool_call",
        b"custom_tool_call_output",
        b"web_search_call",
        b"image_generation_call",
        b"compacted",
        b"context_compacted",
        b"context_compaction",
    ];
    let has_type = |kind: &[u8]| line_might_contain_json_string_field(line, b"type", kind);
    BODY_TYPES.iter().any(|kind| has_type(kind))
        || (has_type(b"message")
            && line_might_contain_json_string_field(line, b"role", b"assistant"))
        || ((has_type(b"reasoning") || has_type(b"agent_reasoning"))
            && codex_reasoning_might_have_text(line))
        || (has_type(b"task_complete")
            && line_might_contain_json_field(line, b"error", |index| {
                line.get(index..)
                    .is_some_and(|value| !value.starts_with(b"null"))
            }))
}

/// Mirrors `reasoning_text_from_payload`: encrypted-only reasoning carries
/// neither a string `content` nor a non-empty `summary` and renders nothing.
fn codex_reasoning_might_have_text(line: &[u8]) -> bool {
    line_might_contain_json_field(line, b"content", |index| line.get(index) == Some(&b'"'))
        || line_might_contain_json_field(line, b"summary", |index| {
            line.get(index) == Some(&b'[')
                && line
                    .get(index + 1..)
                    .and_then(|rest| rest.iter().find(|byte| !byte.is_ascii_whitespace()))
                    .is_some_and(|byte| *byte != b']')
        })
}
