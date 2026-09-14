//! Codex session discovery, indexing, and cache sync.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use core_types::activity::ActivityChunk;
use rusqlite::Connection;
use serde::Deserialize;
use serde_json::Value;

use crate::sources::codex::{canonical_session_id, SESSION_PREFIX as CODEX_APP_SESSION_PREFIX};
use crate::sources::imported_history::{
    self, cache as imported_cache,
    metadata::{ImportedHistoryDiscoveredRecord, SOURCE_CODEX_APP},
    paths as imported_paths, scan_snapshot,
};
use crate::store::{sqlite::SqliteRecordStore, RecordStore};

use super::meta::{
    parse_codex_session_meta_with_title, resolve_codex_transcript_for_thread_id_near_path,
    resume_codex_session_meta_with_title, session_meta_to_cache_input, CodexSessionMetaParse,
};
use super::transcript::{
    load_codex_app_cloud_turn_from_path, load_codex_app_from_path,
    load_codex_app_initial_window_from_path, load_codex_app_mobile_tail_window_from_path,
    load_codex_app_turn_from_path, load_codex_app_turn_ids_from_path, user_message_text_from_line,
    CodexAppInitialWindow, CodexAppTurnWindow,
};
use super::{
    CodexAppRecentPath, CodexAppSessionPage, CodexAppSourceMetadata, CodexJsonlLine,
    CODEX_APP_METADATA_PARSER_VERSION,
};

/// Metadata discovery normally parses changed rollouts to derive repo, title,
/// and rounds. Re-reading a very large rollout while Codex is still appending
/// can allocate several times the file size and immediately become stale.
/// Such files may advance only through their validated incremental watermark;
/// without one, keep the existing cached row and retry after a quiet window.
const MAX_EAGER_ACTIVE_CODEX_METADATA_BYTES: i64 = 32 * 1024 * 1024;
const ACTIVE_CODEX_METADATA_QUIET_NS: i64 = 10 * 60 * 1_000_000_000;

#[derive(Debug, Clone)]
struct CodexSessionIndexEntry {
    thread_name: String,
    updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CodexSessionIndexLine {
    #[serde(default)]
    id: String,
    #[serde(default)]
    thread_name: String,
    #[serde(default)]
    updated_at: Option<String>,
}

pub fn list_codex_app_sessions_paginated(
    conn: &mut Connection,
    limit: usize,
    offset: usize,
) -> Result<CodexAppSessionPage, String> {
    sync_codex_app_cache(conn)?;
    imported_cache::query_imported_session_page_from_conn(conn, SOURCE_CODEX_APP, limit, offset)
}

pub fn list_codex_app_recent_paths(
    conn: &mut Connection,
    limit: usize,
) -> Result<Vec<CodexAppRecentPath>, String> {
    sync_codex_app_cache(conn)?;
    imported_cache::query_imported_recent_paths_from_conn(conn, SOURCE_CODEX_APP, limit)
}

pub fn list_codex_app_reconciliation_sessions(
    conn: &mut Connection,
    limit: usize,
) -> Result<Vec<imported_cache::ImportedHistoryCachedSession>, String> {
    sync_codex_app_cache(conn)?;
    imported_cache::query_recent_cached_sessions_for_source_from_conn(conn, SOURCE_CODEX_APP, limit)
}

pub fn load_codex_app_for_session(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<ActivityChunk>, String> {
    let file_stem = codex_file_stem_from_session_id(session_id)?;
    let path = resolve_codex_session_path(conn, file_stem)?;
    let mut chunks = load_codex_app_from_path(session_id, &path)?;
    link_codex_subagent_chunks(conn, session_id, &mut chunks)?;
    Ok(chunks)
}

pub fn codex_app_review_path(conn: &Connection, session_id: &str) -> Result<PathBuf, String> {
    resolve_codex_session_path(conn, codex_file_stem_from_session_id(session_id)?)
}

pub fn load_codex_app_initial_window_for_session(
    conn: &Connection,
    session_id: &str,
    recent_turn_count: usize,
) -> Result<CodexAppInitialWindow, String> {
    let file_stem = codex_file_stem_from_session_id(session_id)?;
    let path = resolve_codex_session_path(conn, file_stem)?;
    let mut window = load_codex_app_initial_window_from_path(session_id, &path, recent_turn_count)?;
    link_codex_subagent_chunks(conn, session_id, &mut window.chunks)?;
    Ok(window)
}

pub fn load_codex_app_mobile_tail_window_for_session(
    conn: &Connection,
    session_id: &str,
) -> Result<CodexAppInitialWindow, String> {
    let file_stem = codex_file_stem_from_session_id(session_id)?;
    let path = resolve_codex_session_path(conn, file_stem)?;
    let mut window = load_codex_app_mobile_tail_window_from_path(session_id, &path)?;
    link_codex_subagent_chunks(conn, session_id, &mut window.chunks)?;
    Ok(window)
}

pub fn load_codex_app_turn_for_session(
    conn: &Connection,
    session_id: &str,
    turn_id: &str,
) -> Result<CodexAppTurnWindow, String> {
    let file_stem = codex_file_stem_from_session_id(session_id)?;
    let path = resolve_codex_session_path(conn, file_stem)?;
    let mut window = load_codex_app_turn_from_path(session_id, &path, turn_id)?;
    link_codex_subagent_chunks(conn, session_id, &mut window.chunks)?;
    Ok(window)
}

pub fn load_codex_app_turn_ids_for_session(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<String>, String> {
    let file_stem = codex_file_stem_from_session_id(session_id)?;
    let path = resolve_codex_session_path(conn, file_stem)?;
    load_codex_app_turn_ids_from_path(&path)
}

pub fn load_codex_app_cloud_turn_for_session(
    conn: &Connection,
    session_id: &str,
    turn_id: &str,
    start_sequence: usize,
) -> Result<Vec<ActivityChunk>, String> {
    let file_stem = codex_file_stem_from_session_id(session_id)?;
    let path = resolve_codex_session_path(conn, file_stem)?;
    load_codex_app_cloud_turn_from_path(session_id, &path, turn_id, start_sequence)
}

#[derive(Debug, Clone)]
struct CodexChildSessionLink {
    session_id: String,
    thread_id: Option<String>,
    created_at_ms: i64,
    metadata: CodexAppSourceMetadata,
}

fn link_codex_subagent_chunks(
    conn: &Connection,
    parent_session_id: &str,
    chunks: &mut [ActivityChunk],
) -> Result<(), String> {
    let mut children = codex_child_session_links(conn, parent_session_id)?;
    link_codex_subagent_chunks_from_children(chunks, &mut children);
    Ok(())
}

fn codex_child_session_links(
    conn: &Connection,
    parent_session_id: &str,
) -> Result<Vec<CodexChildSessionLink>, String> {
    // Children bind to the physical parent rollout they were parsed against.
    // A resend rotates the parent rollout, so match every generation of the
    // parent's native thread; the historical parent keeps resolving exactly.
    // The filename fallback reads the thread id off the child's own parent
    // key, so a child bound to a generation whose row was pruned still links.
    let parent_thread_id = codex_parent_thread_id(conn, parent_session_id)?.unwrap_or_default();
    let mut statement = conn
        .prepare(
            "SELECT child.session_id, child.source_session_id, child.created_at_ms,
                    child.source_metadata_json
             FROM imported_history_session_cache child
             LEFT JOIN imported_history_session_cache parent
               ON parent.source = child.source
              AND parent.session_id = child.parent_session_id
             WHERE child.source = ?1
               AND COALESCE(child.parent_session_id, '') != ''
               AND (child.parent_session_id = ?2
                    OR (?3 != ''
                        AND (CASE WHEN json_valid(parent.source_metadata_json)
                                  THEN json_extract(parent.source_metadata_json,
                                                    '$.continuationGroupKey')
                             END = ?3
                             OR child.parent_session_id LIKE '%-' || ?3
                             OR child.parent_session_id LIKE '%-' || ?3 || '\\_%' ESCAPE '\\')))
             ORDER BY child.created_at_ms ASC, child.source_session_id ASC",
        )
        .map_err(|err| format!("Failed to prepare Codex child-session query: {err}"))?;
    let rows = statement
        .query_map(
            [
                SOURCE_CODEX_APP,
                parent_session_id,
                parent_thread_id.as_str(),
            ],
            |row| {
                let source_session_id: String = row.get(1)?;
                let metadata_json: String = row.get(3)?;
                Ok(CodexChildSessionLink {
                    session_id: row.get(0)?,
                    thread_id: codex_thread_id_from_file_stem(&source_session_id)
                        .map(str::to_string),
                    created_at_ms: row.get(2)?,
                    metadata: serde_json::from_str(&metadata_json).unwrap_or_default(),
                })
            },
        )
        .map_err(|err| format!("Failed to query Codex child sessions: {err}"))?;

    let mut children = Vec::new();
    for row in rows {
        children.push(row.map_err(|err| format!("Failed to read Codex child-session row: {err}"))?);
    }
    Ok(children)
}

fn codex_parent_thread_id(
    conn: &Connection,
    parent_session_id: &str,
) -> Result<Option<String>, String> {
    use rusqlite::OptionalExtension;
    let cached = conn
        .query_row(
            "SELECT CASE WHEN json_valid(source_metadata_json)
                    THEN json_extract(source_metadata_json, '$.continuationGroupKey') END
             FROM imported_history_session_cache
             WHERE source = ?1 AND session_id = ?2",
            [SOURCE_CODEX_APP, parent_session_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|err| format!("Failed to query Codex parent thread id: {err}"))?
        .flatten()
        .filter(|value| !value.trim().is_empty());
    if cached.is_some() {
        return Ok(cached);
    }
    Ok(codex_file_stem_from_session_id(parent_session_id)
        .ok()
        .and_then(codex_thread_id_from_file_stem)
        .map(str::to_string))
}

fn link_codex_subagent_chunks_from_children(
    chunks: &mut [ActivityChunk],
    children: &mut Vec<CodexChildSessionLink>,
) {
    for chunk in chunks
        .iter_mut()
        .filter(|chunk| chunk.function == "subagent")
    {
        if chunk
            .args
            .get("subagentSessionId")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty())
        {
            continue;
        }
        let task_name = chunk
            .args
            .get("task_name")
            .or_else(|| chunk.args.get("taskName"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let agent_thread_id = chunk
            .args
            .get("codexAgentThreadId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let chunk_created_at_ms = imported_history::parse_iso_to_epoch_ms_opt(&chunk.created_at);
        let Some(child_index) =
            best_codex_child_match(children, agent_thread_id, task_name, chunk_created_at_ms)
        else {
            continue;
        };
        let child = children.remove(child_index);
        let Some(args) = chunk.args.as_object_mut() else {
            continue;
        };
        args.insert(
            "subagentSessionId".to_string(),
            Value::String(child.session_id),
        );
        args.entry("action".to_string())
            .or_insert_with(|| Value::String("delegate".to_string()));
        if let Some(prompt) = child
            .metadata
            .first_prompt
            .filter(|value| !value.trim().is_empty())
        {
            args.entry("prompt".to_string())
                .or_insert_with(|| Value::String(prompt));
        }
        if let Some(nickname) = child
            .metadata
            .agent_nickname
            .filter(|value| !value.trim().is_empty())
        {
            args.entry("subagent_type".to_string())
                .or_insert_with(|| Value::String(nickname));
        }
    }
}

fn best_codex_child_match(
    children: &[CodexChildSessionLink],
    agent_thread_id: Option<&str>,
    task_name: Option<&str>,
    chunk_created_at_ms: Option<i64>,
) -> Option<usize> {
    // A spawn that names its child thread links only that thread. Children
    // are pooled across every generation of the parent, so a ranking penalty
    // would attach another generation's child when the named one is absent.
    if let Some(thread_id) = agent_thread_id {
        return children
            .iter()
            .position(|child| child.thread_id.as_deref() == Some(thread_id));
    }
    children
        .iter()
        .enumerate()
        .min_by_key(|(_, child)| {
            let task_mismatch = task_name.is_some_and(|task_name| {
                child
                    .metadata
                    .agent_path
                    .as_deref()
                    .and_then(|path| path.rsplit('/').next())
                    != Some(task_name)
            });
            let time_distance = chunk_created_at_ms
                .map(|created_at_ms| created_at_ms.abs_diff(child.created_at_ms))
                .unwrap_or_default();
            (task_mismatch, time_distance)
        })
        .map(|(index, _)| index)
}

fn sync_codex_app_cache(conn: &mut Connection) -> Result<(), String> {
    sync_codex_app_cache_from_dirs(conn, &codex_sessions_dirs()?)
}

pub(super) fn sync_codex_app_cache_from_dirs(
    conn: &mut Connection,
    session_dirs: &[PathBuf],
) -> Result<(), String> {
    let previous_snapshots = scan_snapshot::read_dir_snapshots_from_conn(conn, SOURCE_CODEX_APP);
    let mut walker = scan_snapshot::SnapshotDirWalker::new(&previous_snapshots, "jsonl", "Codex");
    let discovery = discover_codex_app_records(session_dirs, &mut walker)?;
    let next_snapshots = walker.into_snapshots();
    scan_snapshot::persist_dir_snapshots_if_changed(
        conn,
        SOURCE_CODEX_APP,
        &previous_snapshots,
        &next_snapshots,
    )?;
    let CodexAppDiscovery {
        records: mut discovered,
        external_titles,
    } = discovery;
    // Managed (GUI-launched) Codex sessions surface through their
    // code_sessions row (`cli_agent_type = 'codex'`); the imported twin goes
    // unlistable. Same pattern as the OpenCode/Claude readers.
    let mut managed_ids =
        crate::sources::imported_history::managed_mirror::managed_source_session_ids_from_conn(
            conn,
            "codex",
            SOURCE_CODEX_APP,
        )?;
    for record in &mut discovered {
        // A resend rollout ends in <thread UUID>_<rollout UUID>. The ledger
        // owns the thread, not the final UUID. Expand only discovered keys.
        if codex_thread_id_from_file_stem(&record.source_session_id)
            .is_some_and(|id| managed_ids.contains(id))
        {
            managed_ids.insert(record.source_session_id.clone());
        }
        crate::sources::imported_history::managed_mirror::append_managed_origin_fingerprint(
            &mut record.source_fingerprint,
            // Suffix match: the imported key is the rollout stem while the
            // runner binds the bare thread uuid.
            crate::sources::imported_history::managed_mirror::is_managed_source_session_id(
                &managed_ids,
                &record.source_session_id,
            ),
        );
    }
    repair_cached_generated_codex_names(conn, &discovered)?;
    let signatures = discovered
        .iter()
        .map(ImportedHistoryDiscoveredRecord::signature)
        .collect::<Vec<_>>();
    let changed = imported_cache::changed_records_with_generated_name_repairs_from_conn(
        conn,
        SOURCE_CODEX_APP,
        &discovered,
        |record| record.signature(),
    )?;
    let mut inputs = Vec::new();
    let mut rounds = Vec::new();
    let mut reparsed_ids = Vec::new();
    let now_ns = unix_epoch_now_ns();
    for record in changed {
        let stored_watermark = imported_history::watermark::read_parse_watermark_from_conn(
            conn,
            SOURCE_CODEX_APP,
            &record.source_session_id,
        )?;
        let external_title = external_titles
            .get(&record.source_session_id)
            .cloned()
            .unwrap_or_default();
        let Some(parse) = imported_history::skip_unparsable_record(
            SOURCE_CODEX_APP,
            &record.source_session_id,
            parse_changed_codex_metadata(record, stored_watermark.as_ref(), external_title, now_ns),
        )
        .flatten() else {
            continue;
        };
        imported_history::watermark::write_parse_watermark_from_conn(
            conn,
            SOURCE_CODEX_APP,
            &record.source_session_id,
            &parse.watermark,
        )?;
        if let Some(mut meta) = parse.meta {
            reparsed_ids.push(meta.session_id.clone());
            rounds.append(&mut meta.rounds);
            let mut input = session_meta_to_cache_input(meta);
            crate::sources::imported_history::managed_mirror::apply_managed_history_mirror(
                &mut input,
                &managed_ids,
            );
            inputs.push(input);
        }
    }
    imported_cache::sync_source_cache_from_conn(
        conn,
        SOURCE_CODEX_APP,
        imported_cache::live_ids_from_signatures(&signatures),
        inputs,
    )?;
    crate::sources::imported_history::managed_mirror::demote_org2_origin_mirrors_from_conn(
        conn,
        SOURCE_CODEX_APP,
    )?;
    imported_cache::write_session_rounds_from_conn(conn, &reparsed_ids, &rounds)?;
    repair_cached_codex_thread_identity(conn)?;
    imported_cache::demote_superseded_continuations_from_conn(conn, SOURCE_CODEX_APP)?;
    Ok(())
}

/// Older watermarks predate native thread identity. Repair their projection
/// from Codex's filename contract without invalidating a multi-GB transcript's
/// incremental watermark. Fresh parses use session_meta.id instead. This also
/// covers large active files deliberately deferred by the metadata budget.
fn repair_cached_codex_thread_identity(conn: &Connection) -> Result<(), String> {
    let mut statement = conn
        .prepare(
            "SELECT source_session_id, source_metadata_json FROM imported_history_session_cache
         WHERE source = ?1 AND COALESCE(parent_session_id, '') = ''
           AND CASE WHEN json_valid(source_metadata_json)
               THEN json_extract(source_metadata_json, '$.continuationGroupKey') IS NULL
               ELSE 1 END",
        )
        .map_err(|err| format!("Failed to prepare Codex thread identity repair: {err}"))?;
    let rows = statement
        .query_map([SOURCE_CODEX_APP], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })
        .map_err(|err| format!("Failed to query Codex thread identity repair: {err}"))?;
    for row in rows {
        let (source_id, metadata) =
            row.map_err(|err| format!("Failed to read Codex identity: {err}"))?;
        let Some(thread_id) = codex_thread_id_from_file_stem(&source_id) else {
            continue;
        };
        let mut value = metadata
            .as_deref()
            .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
            .filter(Value::is_object)
            .unwrap_or_else(|| serde_json::json!({}));
        value[imported_cache::CONTINUATION_GROUP_KEY_FIELD] = Value::String(thread_id.to_string());
        conn.execute(
            "UPDATE imported_history_session_cache SET source_metadata_json = ?3
             WHERE source = ?1 AND source_session_id = ?2",
            rusqlite::params![SOURCE_CODEX_APP, source_id, value.to_string()],
        )
        .map_err(|err| format!("Failed to repair Codex thread identity: {err}"))?;
    }
    Ok(())
}

pub(super) fn first_codex_user_prompt_from_path(path: &Path) -> Result<Option<String>, String> {
    let file = fs::File::open(path)
        .map_err(|err| format!("Failed to open Codex transcript {}: {err}", path.display()))?;
    for line in BufReader::new(file).lines() {
        let line = line
            .map_err(|err| format!("Failed to read Codex transcript {}: {err}", path.display()))?;
        let Ok(parsed) = serde_json::from_str::<CodexJsonlLine>(line.trim()) else {
            continue;
        };
        if let Some(prompt) = user_message_text_from_line(&parsed) {
            return Ok(Some(prompt));
        }
    }
    Ok(None)
}

fn repair_cached_generated_codex_names(
    conn: &Connection,
    discovered: &[ImportedHistoryDiscoveredRecord],
) -> Result<(), String> {
    let repair_ids =
        imported_cache::generated_name_repair_source_session_ids_from_conn(conn, SOURCE_CODEX_APP)?;
    if repair_ids.is_empty() {
        return Ok(());
    }

    for record in discovered
        .iter()
        .filter(|record| repair_ids.contains(&record.source_session_id))
    {
        let Some(prompt) = imported_history::skip_unparsable_record(
            SOURCE_CODEX_APP,
            &record.source_session_id,
            first_codex_user_prompt_from_path(&record.source_path),
        )
        .flatten() else {
            continue;
        };
        let name = imported_history::resolve_imported_session_name(
            "",
            &prompt,
            &record.source_record_key,
            200,
        );
        imported_cache::update_cached_session_name_from_conn(
            conn,
            SOURCE_CODEX_APP,
            &record.source_session_id,
            &name,
        )?;
    }
    Ok(())
}

fn unix_epoch_now_ns() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| i64::try_from(elapsed.as_nanos()).ok())
        .unwrap_or(i64::MAX)
}

fn parse_changed_codex_metadata(
    record: &ImportedHistoryDiscoveredRecord,
    watermark: Option<&imported_history::watermark::ImportedParseWatermark>,
    external_title: String,
    now_ns: i64,
) -> Result<Option<CodexSessionMetaParse>, String> {
    if requires_resumable_active_codex_metadata(record, now_ns) {
        resume_codex_session_meta_with_title(record, watermark, external_title)
    } else {
        parse_codex_session_meta_with_title(record, watermark, external_title).map(Some)
    }
}

fn requires_resumable_active_codex_metadata(
    record: &ImportedHistoryDiscoveredRecord,
    now_ns: i64,
) -> bool {
    record.source_size_bytes > MAX_EAGER_ACTIVE_CODEX_METADATA_BYTES
        && now_ns.saturating_sub(record.source_mtime_ms) < ACTIVE_CODEX_METADATA_QUIET_NS
}

#[derive(Debug)]
struct CodexAppDiscovery {
    records: Vec<ImportedHistoryDiscoveredRecord>,
    external_titles: HashMap<String, String>,
}

fn discover_codex_app_records(
    sessions_dirs: &[PathBuf],
    walker: &mut scan_snapshot::SnapshotDirWalker<'_>,
) -> Result<CodexAppDiscovery, String> {
    let mut records = Vec::new();
    let mut external_titles = HashMap::new();
    let mut discovered_files: HashSet<String> = HashSet::new();
    for sessions_dir in sessions_dirs {
        if !sessions_dir.is_dir() {
            continue;
        }
        let title_index = load_codex_session_index_for_sessions_dir(sessions_dir)?;
        let mut files = Vec::new();
        walker.collect_files(sessions_dir, &mut files)?;
        for path in files {
            let Some(file_stem) = path
                .file_stem()
                .and_then(|value| value.to_str())
                .map(ToString::to_string)
            else {
                continue;
            };
            let (source_mtime_ms, source_size_bytes) =
                match imported_paths::file_metadata_signature(&path, "Codex") {
                    Ok(signature) => signature,
                    // Files can disappear between directory enumeration and
                    // metadata lookup, and managed profiles keep rollout
                    // symlinks whose target Codex has since archived. Neither
                    // makes the other Codex rollouts unreadable.
                    Err(_) if !path.exists() => continue,
                    Err(error) => return Err(error),
                };
            // Managed profiles expose native rollouts through symlinks, so one
            // rollout can be enumerated from CODEX_HOME and from a profile.
            // Both share the file stem that keys the cache row; resolve the
            // symlink and keep the first discovery so unchanged files do not
            // alternate writers on every scan.
            let canonical = match fs::canonicalize(&path) {
                Ok(target) => target,
                Err(_) if !path.exists() => continue,
                Err(error) => return Err(format!("Failed to resolve Codex rollout: {error}")),
            };
            let is_symlink =
                fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.file_type().is_symlink());
            let path = if is_symlink { canonical } else { path };
            // The stem keys the cache row. A native rollout and a managed
            // profile copy of the same session are two files with one stem;
            // emitting both makes them alternate as the row's writer on
            // every scan. Native roots enumerate first, so the first file
            // per stem wins deterministically.
            if !discovered_files.insert(file_stem.clone()) {
                continue;
            }
            if let Some(entry) = codex_title_entry_for_file_stem(&file_stem, &title_index) {
                external_titles.insert(
                    file_stem.clone(),
                    imported_history::truncate_name(&entry.thread_name, 200),
                );
            }
            let source_fingerprint = codex_source_fingerprint(&file_stem, &title_index);
            records.push(ImportedHistoryDiscoveredRecord {
                source_session_id: file_stem.clone(),
                source_path: path,
                source_record_key: file_stem,
                source_mtime_ms,
                source_size_bytes,
                source_fingerprint,
                parser_version: CODEX_APP_METADATA_PARSER_VERSION,
            });
        }
    }
    Ok(CodexAppDiscovery {
        records,
        external_titles,
    })
}

pub(super) fn collect_codex_session_files(
    dir: &Path,
    out: &mut Vec<PathBuf>,
) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|err| format!("Failed to read Codex dir: {err}"))? {
        let entry = entry.map_err(|err| format!("Failed to read Codex dir entry: {err}"))?;
        let path = entry.path();
        if path.is_dir() {
            collect_codex_session_files(&path, out)?;
        } else if path
            .extension()
            .is_some_and(|extension| extension == "jsonl")
        {
            out.push(path);
        }
    }
    Ok(())
}

fn load_codex_session_index_for_sessions_dir(
    sessions_dir: &Path,
) -> Result<HashMap<String, CodexSessionIndexEntry>, String> {
    let Some(root) = sessions_dir.parent() else {
        return Ok(HashMap::new());
    };
    load_codex_session_index(&root.join("session_index.jsonl"))
}

fn load_codex_session_index(
    index_path: &Path,
) -> Result<HashMap<String, CodexSessionIndexEntry>, String> {
    let mut entries = HashMap::new();
    if !index_path.is_file() {
        return Ok(entries);
    }

    let file = fs::File::open(index_path).map_err(|err| {
        format!(
            "Failed to open Codex session index {}: {err}",
            index_path.display()
        )
    })?;
    let reader = BufReader::new(file);

    for line in reader.lines() {
        let line = line.map_err(|err| {
            format!(
                "Failed to read Codex session index {}: {err}",
                index_path.display()
            )
        })?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed: CodexSessionIndexLine = match serde_json::from_str(trimmed) {
            Ok(parsed) => parsed,
            Err(_) => continue,
        };
        let id = parsed.id.trim();
        let thread_name = parsed.thread_name.trim();
        if id.is_empty() || thread_name.is_empty() {
            continue;
        }
        entries.insert(
            id.to_string(),
            CodexSessionIndexEntry {
                thread_name: thread_name.to_string(),
                updated_at: parsed.updated_at,
            },
        );
    }

    Ok(entries)
}

fn codex_source_fingerprint(
    file_stem: &str,
    title_index: &HashMap<String, CodexSessionIndexEntry>,
) -> String {
    codex_title_entry_for_file_stem(file_stem, title_index)
        .map(|entry| {
            format!(
                "session-index:{}:{}",
                entry.updated_at.as_deref().unwrap_or_default(),
                entry.thread_name
            )
        })
        .unwrap_or_default()
}

#[cfg(test)]
pub(super) fn codex_session_index_title_for_record(
    record: &ImportedHistoryDiscoveredRecord,
) -> Result<String, String> {
    let Some(index_path) = codex_index_path_for_session_path(&record.source_path) else {
        return Ok(String::new());
    };
    let title_index = load_codex_session_index(&index_path)?;
    Ok(
        codex_title_entry_for_file_stem(&record.source_record_key, &title_index)
            .map(|entry| imported_history::truncate_name(&entry.thread_name, 200))
            .unwrap_or_default(),
    )
}

#[cfg(test)]
fn codex_index_path_for_session_path(session_path: &Path) -> Option<PathBuf> {
    codex_sessions_dir_for_session_path(session_path).and_then(|sessions_dir| {
        sessions_dir
            .parent()
            .map(|root| root.join("session_index.jsonl"))
    })
}

pub(super) fn codex_sessions_dir_for_session_path(session_path: &Path) -> Option<PathBuf> {
    session_path
        .ancestors()
        .find(|ancestor| ancestor.file_name().and_then(|name| name.to_str()) == Some("sessions"))
        .map(Path::to_path_buf)
}

fn codex_title_entry_for_file_stem<'a>(
    file_stem: &str,
    title_index: &'a HashMap<String, CodexSessionIndexEntry>,
) -> Option<&'a CodexSessionIndexEntry> {
    codex_thread_id_from_file_stem(file_stem).and_then(|thread_id| title_index.get(thread_id))
}

pub fn codex_thread_id_from_file_stem(file_stem: &str) -> Option<&str> {
    crate::sources::cli_resume::codex_thread_uuid_from_stem(file_stem)
}

fn codex_file_stem_from_session_id(session_id: &str) -> Result<&str, String> {
    let Some(file_stem) = session_id.strip_prefix(CODEX_APP_SESSION_PREFIX) else {
        return Err(format!("Invalid Codex app session id: {session_id}"));
    };
    if file_stem.is_empty() {
        return Err("Codex app session id is missing file stem".to_string());
    }
    Ok(file_stem)
}

pub fn resolve_codex_session_path(conn: &Connection, file_stem: &str) -> Result<PathBuf, String> {
    let transcript_session_id = canonical_session_id(file_stem);
    let store = SqliteRecordStore::new(conn);
    if let Some(path) = store
        .get_session_actor_by_transcript_session_id(SOURCE_CODEX_APP, &transcript_session_id)?
        .and_then(|actor| actor.transcript_path)
    {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
    }

    // The lifecycle record stores the stable parent thread UUID plus the
    // child's concrete transcript path. That is enough to rediscover the
    // parent's rollout even when CODEX_HOME is outside the standard roots.
    for actor in store.list_session_actors(SOURCE_CODEX_APP, &transcript_session_id)? {
        let Some(reference_path) = actor.transcript_path.as_deref() else {
            continue;
        };
        let Some(locator) = resolve_codex_transcript_for_thread_id_near_path(
            Path::new(reference_path),
            &actor.source_session_id,
        )?
        else {
            continue;
        };
        if locator.session_id == transcript_session_id && locator.source_path.is_file() {
            return Ok(locator.source_path);
        }
    }

    // Suffix form: runner bindings carry the bare thread uuid while rollout
    // stems are `rollout-<timestamp>-<thread-uuid>`.
    if let Some(path) = imported_cache::get_cached_source_path_by_suffix_from_conn(
        conn,
        SOURCE_CODEX_APP,
        file_stem,
    )? {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
    }

    let mut files = Vec::new();
    for sessions_dir in codex_sessions_dirs()? {
        if sessions_dir.is_dir() {
            collect_codex_session_files(&sessions_dir, &mut files)?;
        }
    }
    let stem_matches = |stem: &str| {
        stem == file_stem
            || (stem.len() > file_stem.len() + 1
                && stem.ends_with(file_stem)
                && stem.as_bytes()[stem.len() - file_stem.len() - 1] == b'-')
    };
    files
        .into_iter()
        .filter(|path| {
            path.file_stem()
                .and_then(|value| value.to_str())
                .is_some_and(stem_matches)
        })
        // Newest rollout wins when several share a thread (resume forks).
        .max_by_key(|path| {
            std::fs::metadata(path)
                .and_then(|meta| meta.modified())
                .ok()
        })
        .ok_or_else(|| format!("Codex app file not found for session: {file_stem}"))
}

fn codex_sessions_dirs() -> Result<Vec<PathBuf>, String> {
    let home = app_paths::external_history_home_dir();
    let mut dirs = codex_sessions_dir_candidates(&home);
    // ORGII-managed Codex runs redirect CODEX_HOME into isolated profile
    // directories; native-transcript mode reads those rollouts back here.
    dirs.extend(codex_managed_sessions_dirs(
        &app_paths::codex_cli_profile_root(),
        &app_paths::codex_hosted_cli_profile_root(),
    ));
    Ok(dirs)
}

pub(crate) fn codex_managed_sessions_dirs(
    account_profiles_root: &Path,
    hosted_profiles_root: &Path,
) -> Vec<PathBuf> {
    let mut dirs = crate::sources::imported_history::managed_roots::profile_root_children(
        account_profiles_root,
        &["sessions"],
    );
    dirs.extend(
        crate::sources::imported_history::managed_roots::profile_root_children(
            hosted_profiles_root,
            &["sessions"],
        ),
    );
    dirs
}

pub(crate) fn codex_sessions_dir_candidates(home: &Path) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    roots.push(home.join(".codex"));

    #[cfg(target_os = "macos")]
    {
        roots.push(
            home.join("Library")
                .join("Application Support")
                .join("Codex"),
        );
        roots.push(
            home.join("Library")
                .join("Application Support")
                .join("codex"),
        );
    }

    #[cfg(target_os = "windows")]
    {
        roots.push(home.join("AppData").join("Roaming").join("Codex"));
        roots.push(home.join("AppData").join("Roaming").join("codex"));
        roots.push(home.join("AppData").join("Local").join("Codex"));
        roots.push(home.join("AppData").join("Local").join("codex"));
    }

    #[cfg(target_os = "linux")]
    {
        roots.push(home.join(".config").join("codex"));
        roots.push(home.join(".local").join("share").join("codex"));
    }

    let mut seen = HashSet::new();
    roots
        .into_iter()
        .filter(|root| seen.insert(root.clone()))
        .map(|root| root.join("sessions"))
        .collect()
}

/// Context refresh only follows indexed source paths. Unlike transcript recovery,
/// missing telemetry must not initiate a recursive history-directory scan.
pub fn load_codex_context_usage_for_session(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<crate::sources::imported_history::context_usage::ImportedContextUsage>, String> {
    let file_stem = codex_file_stem_from_session_id(session_id)?;
    let store = SqliteRecordStore::new(conn);
    let actor_path = store
        .get_session_actor_by_transcript_session_id(
            SOURCE_CODEX_APP,
            &canonical_session_id(file_stem),
        )?
        .and_then(|actor| actor.transcript_path);
    let path = match actor_path {
        Some(path) => Some(path),
        None => imported_cache::get_cached_source_path_by_suffix_from_conn(
            conn,
            SOURCE_CODEX_APP,
            file_stem,
        )?,
    };
    match path {
        Some(path) => super::context_usage::read_context_usage(Path::new(&path)),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn discovered_record(
        source_size_bytes: i64,
        source_mtime_ns: i64,
    ) -> ImportedHistoryDiscoveredRecord {
        ImportedHistoryDiscoveredRecord {
            source_session_id: "rollout-test".to_string(),
            source_path: PathBuf::from("rollout-test.jsonl"),
            source_record_key: "rollout-test".to_string(),
            source_mtime_ms: source_mtime_ns,
            source_size_bytes,
            source_fingerprint: String::new(),
            parser_version: CODEX_APP_METADATA_PARSER_VERSION,
        }
    }

    #[test]
    fn giant_active_codex_metadata_requires_a_valid_resume() {
        let now_ns = 1_750_000_000_000_000_000;
        let record = discovered_record(
            MAX_EAGER_ACTIVE_CODEX_METADATA_BYTES + 1,
            now_ns - ACTIVE_CODEX_METADATA_QUIET_NS + 1,
        );

        assert!(requires_resumable_active_codex_metadata(&record, now_ns));
        assert!(!requires_resumable_active_codex_metadata(
            &discovered_record(
                record.source_size_bytes,
                now_ns - ACTIVE_CODEX_METADATA_QUIET_NS
            ),
            now_ns
        ));
    }

    #[test]
    fn bounded_active_codex_metadata_remains_eager() {
        let now_ns = 1_750_000_000_000_000_000;
        let record = discovered_record(MAX_EAGER_ACTIVE_CODEX_METADATA_BYTES, now_ns);

        assert!(!requires_resumable_active_codex_metadata(&record, now_ns));
    }

    #[test]
    fn giant_active_codex_metadata_advances_from_its_watermark() {
        let temp_dir = std::env::temp_dir().join(format!(
            "orgii-codex-active-watermark-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&temp_dir).expect("create temp dir");
        let path = temp_dir.join("rollout-active-watermark.jsonl");
        let prefix = concat!(
            r#"{"timestamp":"2026-08-05T15:00:00.000Z","type":"session_meta","payload":{"cwd":"/tmp/org2","id":"active"}}"#,
            "\n",
            r#"{"timestamp":"2026-08-05T15:00:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"start"}}"#,
            "\n"
        );
        std::fs::write(&path, prefix).expect("write prefix");

        let record_for = |source_size_bytes: Option<i64>, source_mtime_ms: Option<i64>| {
            let (actual_mtime_ms, actual_size_bytes) =
                imported_paths::file_metadata_signature(&path, "Codex").expect("metadata");
            ImportedHistoryDiscoveredRecord {
                source_session_id: "rollout-active-watermark".to_string(),
                source_path: path.clone(),
                source_record_key: "rollout-active-watermark".to_string(),
                source_mtime_ms: source_mtime_ms.unwrap_or(actual_mtime_ms),
                source_size_bytes: source_size_bytes.unwrap_or(actual_size_bytes),
                source_fingerprint: String::new(),
                parser_version: CODEX_APP_METADATA_PARSER_VERSION,
            }
        };

        let first_record = record_for(None, None);
        let first = parse_changed_codex_metadata(
            &first_record,
            None,
            String::new(),
            first_record.source_mtime_ms + ACTIVE_CODEX_METADATA_QUIET_NS,
        )
        .expect("initial parse")
        .expect("initial metadata");
        assert!(!first.resumed);

        let suffix = concat!(
            r#"{"timestamp":"2026-08-05T15:01:00.000Z","type":"event_msg","payload":{"type":"user_message","message":"still active"}}"#,
            "\n"
        );
        std::fs::write(&path, format!("{prefix}{suffix}")).expect("append suffix");
        let now_ns = unix_epoch_now_ns();
        // The logical size selects the exact >32 MiB production branch without
        // making the unit fixture allocate a giant file. The reader still
        // validates the real prefix seam and reads only the appended suffix.
        let active_record = record_for(
            Some(MAX_EAGER_ACTIVE_CODEX_METADATA_BYTES + 1),
            Some(now_ns),
        );
        let resumed = parse_changed_codex_metadata(
            &active_record,
            Some(&first.watermark),
            String::new(),
            now_ns,
        )
        .expect("resume active parse")
        .expect("resumed metadata");

        assert!(resumed.resumed);
        assert_eq!(
            resumed.meta.expect("session metadata").updated_at_ms,
            imported_history::parse_iso_to_epoch_ms_opt("2026-08-05T15:01:00.000Z")
                .expect("fixture timestamp")
        );

        // If the file was rewritten instead of appended, the boundary check
        // rejects the watermark and the active-file path must defer rather
        // than silently rewind and parse the whole giant rollout.
        let mutated = format!("{prefix}{suffix}").replace("start", "START");
        std::fs::write(&path, mutated).expect("mutate prefix");
        let mutated_record = record_for(
            Some(MAX_EAGER_ACTIVE_CODEX_METADATA_BYTES + 1),
            Some(now_ns + 1),
        );
        let rejected = parse_changed_codex_metadata(
            &mutated_record,
            Some(&resumed.watermark),
            String::new(),
            now_ns + 1,
        )
        .expect("reject invalid resume");
        assert!(rejected.is_none());

        std::fs::remove_dir_all(&temp_dir).expect("remove temp dir");
    }

    #[test]
    fn giant_active_codex_metadata_without_a_watermark_stays_deferred() {
        let now_ns = unix_epoch_now_ns();
        let record = discovered_record(MAX_EAGER_ACTIVE_CODEX_METADATA_BYTES + 1, now_ns);

        let parsed = parse_changed_codex_metadata(&record, None, String::new(), now_ns)
            .expect("defer without opening the missing fixture");

        assert!(parsed.is_none());
    }

    #[test]
    fn links_spawn_chunk_to_matching_codex_child_and_restores_prompt() {
        let mut chunks = vec![
            ActivityChunk::new("codexapp-parent", "tool_call", "subagent").with_args(json!({
                "task_name": "audit_todays_commits",
                "description": "audit_todays_commits",
                "codexAgentThreadId": "019f-audit"
            })),
        ];
        chunks[0].created_at = "2026-07-23T10:18:52Z".to_string();
        let mut children = vec![
            CodexChildSessionLink {
                session_id: "codexapp-wrong-nearby-child".to_string(),
                thread_id: Some("019f-wrong".to_string()),
                created_at_ms: 1_753_265_932_100,
                metadata: CodexAppSourceMetadata {
                    first_prompt: Some("wrong prompt".to_string()),
                    agent_path: Some("/root/other_task".to_string()),
                    agent_nickname: Some("Wrong".to_string()),
                    ..Default::default()
                },
            },
            CodexChildSessionLink {
                session_id: "codexapp-audit-child".to_string(),
                thread_id: Some("019f-audit".to_string()),
                created_at_ms: 1_753_265_940_000,
                metadata: CodexAppSourceMetadata {
                    first_prompt: Some("audit today's commit history".to_string()),
                    agent_path: Some("/root/audit_todays_commits".to_string()),
                    agent_nickname: Some("Peirce".to_string()),
                    ..Default::default()
                },
            },
        ];

        link_codex_subagent_chunks_from_children(&mut chunks, &mut children);

        assert_eq!(chunks[0].args["subagentSessionId"], "codexapp-audit-child");
        assert_eq!(chunks[0].args["prompt"], "audit today's commit history");
        assert_eq!(chunks[0].args["subagent_type"], "Peirce");
        assert_eq!(chunks[0].args["action"], "delegate");
        assert_eq!(children.len(), 1);
        assert_eq!(children[0].session_id, "codexapp-wrong-nearby-child");
    }
}
