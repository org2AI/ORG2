//! Patch/impact extraction from Codex events and tool calls.

use std::collections::BTreeSet;

use serde_json::Value;

use crate::sources::imported_history::{self, metadata::ImportedHistoryImpactStats};

/// Tally impact from a `patch_apply_end` event — Codex's authoritative record
/// of a successfully applied patch. `changes` maps each touched path to a
/// file change; see [`accumulate_codex_file_changes`].
pub(super) fn collect_codex_impact_from_patch_apply_end(
    payload: &Value,
    impact: &mut ImportedHistoryImpactStats,
    touched_files: &mut BTreeSet<String>,
) {
    if payload.get("type").and_then(Value::as_str) != Some("patch_apply_end") {
        return;
    }
    // A failed apply changed nothing; don't attribute its diff.
    if payload.get("success").and_then(Value::as_bool) == Some(false) {
        return;
    }
    if let Some(changes) = payload.get("changes").and_then(Value::as_object) {
        accumulate_codex_file_changes(changes, impact, touched_files);
    }
}

/// Tally impact from a completed `FileChange` thread item. Codex Desktop
/// rollouts never persist `patch_apply_end`: edits run inside the generated
/// `exec` JavaScript wrapper (`tools.apply_patch(...)`), and the applied result
/// is recorded only as `event_msg` → `item_completed` → `FileChange`. A wrapper
/// whose patch failed verification writes no such item, so it is never counted.
pub(super) fn collect_codex_impact_from_file_change_item(
    payload: &Value,
    impact: &mut ImportedHistoryImpactStats,
    touched_files: &mut BTreeSet<String>,
) {
    if payload.get("type").and_then(Value::as_str) != Some("item_completed") {
        return;
    }
    let Some(item) = payload.get("item") else {
        return;
    };
    if item.get("type").and_then(Value::as_str) != Some("FileChange") {
        return;
    }
    // `failed` / `declined` applies changed nothing.
    let applied = item
        .get("status")
        .and_then(Value::as_str)
        .is_none_or(|status| status.eq_ignore_ascii_case("completed"));
    if !applied {
        return;
    }
    if let Some(changes) = item.get("changes").and_then(Value::as_object) {
        accumulate_codex_file_changes(changes, impact, touched_files);
    }
}

/// Fold a Codex `path -> FileChange` map. Updates carry a `unified_diff` whose
/// `+`/`-` lines are exact counts; adds and deletes carry the whole file as
/// `content` instead. A rename (`move_path`) counts once, at its destination.
fn accumulate_codex_file_changes(
    changes: &serde_json::Map<String, Value>,
    impact: &mut ImportedHistoryImpactStats,
    touched_files: &mut BTreeSet<String>,
) {
    for (path, change) in changes {
        let path = change
            .get("move_path")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|move_path| !move_path.is_empty())
            .unwrap_or_else(|| path.trim());
        if path.is_empty() {
            continue;
        }
        touched_files.insert(path.to_string());
        if let Some(diff) = change.get("unified_diff").and_then(Value::as_str) {
            for line in diff.lines() {
                if line.starts_with('+') && !line.starts_with("+++") {
                    impact.lines_added += 1;
                } else if line.starts_with('-') && !line.starts_with("---") {
                    impact.lines_removed += 1;
                }
            }
        } else if let Some(content) = change.get("content").and_then(Value::as_str) {
            let lines = content.lines().count() as i64;
            match change.get("type").and_then(Value::as_str) {
                Some("add") => impact.lines_added += lines,
                Some("delete") => impact.lines_removed += lines,
                _ => {}
            }
        }
    }
}

pub(super) fn collect_codex_impact_from_payload(
    payload: &Value,
    impact: &mut ImportedHistoryImpactStats,
    touched_files: &mut BTreeSet<String>,
) {
    let Some(payload_type) = payload.get("type").and_then(Value::as_str) else {
        return;
    };
    let patch = match payload_type {
        "function_call" if payload.get("name").and_then(Value::as_str) == Some("apply_patch") => {
            payload
                .get("arguments")
                .and_then(Value::as_str)
                .map(imported_history::parse_inner_json)
                .and_then(|args| patch_from_codex_args(&args))
        }
        "custom_tool_call"
            if payload.get("name").and_then(Value::as_str) == Some("apply_patch") =>
        {
            payload
                .get("input")
                .and_then(Value::as_str)
                .map(str::to_string)
        }
        _ => None,
    };
    if let Some(patch) = patch {
        accumulate_patch_impact(&patch, impact, touched_files);
    }
}

fn patch_from_codex_args(args: &Value) -> Option<String> {
    args.get("patch")
        .and_then(Value::as_str)
        .or_else(|| args.get("input").and_then(Value::as_str))
        .map(str::to_string)
}

pub(super) fn accumulate_patch_impact(
    patch: &str,
    impact: &mut ImportedHistoryImpactStats,
    touched_files: &mut BTreeSet<String>,
) {
    for line in patch.lines() {
        if let Some(path) = patch_file_path_from_line(line) {
            touched_files.insert(path);
        }
        if line.starts_with('+') && !line.starts_with("+++") {
            impact.lines_added += 1;
        } else if line.starts_with('-') && !line.starts_with("---") {
            impact.lines_removed += 1;
        }
    }
}

pub(super) fn patch_file_path_from_line(line: &str) -> Option<String> {
    for prefix in [
        "*** Add File:",
        "*** Update File:",
        "*** Modify File:",
        "*** Delete File:",
    ] {
        if let Some(path) = line.strip_prefix(prefix) {
            let path = path.trim();
            if !path.is_empty() {
                return Some(path.to_string());
            }
        }
    }
    if let Some(rest) = line.strip_prefix("diff --git ") {
        let mut parts = rest.split_whitespace();
        let _old_path = parts.next();
        return parts.next().and_then(normalize_patch_path);
    }
    line.strip_prefix("+++ ")
        .and_then(normalize_patch_path)
        .filter(|path| path != "/dev/null")
}

fn normalize_patch_path(path: &str) -> Option<String> {
    let normalized = path
        .strip_prefix("b/")
        .or_else(|| path.strip_prefix("a/"))
        .unwrap_or(path)
        .trim();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.to_string())
    }
}
