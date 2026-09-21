//! Read-only, bounded historical change review. Never reads today's files to
//! fill missing historical snapshots, and never labels summed edits as net diff.

use std::collections::BTreeMap;

use database::db::get_connection;
use orgtrack_core::canonical::SessionDiffChunkRecord;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::api::mobile_bridge::rpc::RpcError;
use crate::orgtrack::imported_changes::reconstruction::{self, FileVersion, RecordedEdit};

const MAX_RECORDS: usize = 500;
const MAX_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Params {
    session_id: String,
    round_id: Option<String>,
    file_path: Option<String>,
    scope: Scope,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum Scope {
    Turn,
    Session,
    Workspace,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeFile {
    path: String,
    additions: Option<i32>,
    deletions: Option<i32>,
    /// Ordered edit patches; NOT a fabricated whole-file or net snapshot.
    patches: Vec<String>,
    before: Option<String>,
    after: Option<String>,
    availability: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeReview {
    files: Vec<ChangeFile>,
    complete: bool,
}

fn attach_version(file: &mut ChangeFile, version: FileVersion) {
    if version.before.is_some() || version.after.is_some() {
        file.before = version.before;
        file.after = version.after;
        file.availability = "reconstructed_from_history";
    }
}

fn project(chunks: Vec<SessionDiffChunkRecord>) -> ChangeReview {
    let mut grouped: BTreeMap<String, Vec<SessionDiffChunkRecord>> = BTreeMap::new();
    for chunk in chunks {
        grouped
            .entry(chunk.file_path.clone())
            .or_default()
            .push(chunk);
    }
    let files = grouped
        .into_iter()
        .map(|(path, chunks)| {
            // Even exact chunk contents may be local old_string/new_string spans.
            // Multiple patches may overlap or reverse each other; summing their
            // counters would violate the net-change contract.
            let single = (chunks.len() == 1)
                .then(|| &chunks[0])
                .and_then(|c| c.diff.as_deref())
                .filter(|d| !d.is_empty())
                .and_then(super::change_review_stats::numstat);
            let patches = chunks
                .iter()
                .filter_map(|chunk| chunk.diff.clone())
                .collect();
            ChangeFile {
                path,
                additions: single.map(|(added, _)| added),
                deletions: single.map(|(_, removed)| removed),
                patches,
                before: None,
                after: None,
                availability: "patch_only",
            }
        })
        .collect();
    ChangeReview {
        files,
        complete: false,
    }
}

/// Read historical artifacts without claiming partial fragments are full files.
pub async fn historical_changes(params: &Value) -> Result<Value, RpcError> {
    let params: Params = serde_json::from_value(params.clone())
        .map_err(|_| RpcError::invalid_params("invalid historical change request"))?;
    for value in std::iter::once(&params.session_id)
        .chain(params.round_id.iter())
        .chain(params.file_path.iter())
    {
        if value.trim().is_empty() || value.len() > 1024 {
            return Err(RpcError::invalid_params(
                "invalid session or round identity",
            ));
        }
    }
    if params.scope == Scope::Workspace {
        return super::workspace_changes::read(&params.session_id, params.file_path.as_deref())
            .await;
    }
    if params.scope == Scope::Turn && params.round_id.is_none() {
        return Err(RpcError::invalid_params(
            "roundId is required for turn scope",
        ));
    }
    if params.scope == Scope::Turn {
        // The transcript is the authority for a round, including imported
        // history not yet materialized in the orgtrack artifact index.
        let round = params.round_id.as_deref().unwrap();
        let events = super::session::authoritative_round_events(&params.session_id, round).await?;
        let mut chunks = Vec::new();
        let mut bytes = 0;
        let mut first_call = None;
        let mut history = Vec::new();
        for (index, event) in events.into_iter().enumerate() {
            if event.display_status != core_types::session_event::EventDisplayStatus::Completed {
                continue;
            }
            if let Some(core_types::extracted::ExtractedData::Edit(ref edit)) = event.extracted {
                let context = orgtrack_core::edit_extraction::EditArtifactContext {
                    source: "mobile_round_projection".into(),
                    source_session_id: None,
                    session_id: params.session_id.clone(),
                    source_event_id: Some(event.id.clone()),
                    turn_id: Some(round.to_owned()),
                    sequence_index: index as i64,
                    timestamp: None,
                    workspace_path: None,
                    metadata: Default::default(),
                };
                let artifacts =
                    orgtrack_core::edit_extraction::artifacts_from_extracted_edit(&context, edit);
                if params.file_path.is_some() {
                    history.push(RecordedEdit::from_event(
                        &event,
                        artifacts
                            .chunks
                            .iter()
                            .map(|c| c.file_path.clone())
                            .collect(),
                    ));
                    bytes += history
                        .last()
                        .and_then(|e| e.patch.as_ref())
                        .map_or(0, String::len);
                }
                for chunk in artifacts.chunks {
                    bytes += chunk.diff.as_ref().map_or(0, String::len)
                        + chunk.old_content.as_ref().map_or(0, String::len)
                        + chunk.new_content.as_ref().map_or(0, String::len);
                    if bytes > MAX_BYTES || chunks.len() >= MAX_RECORDS {
                        return Err(RpcError::invalid_params("round exceeds review budget"));
                    }
                    if params
                        .file_path
                        .as_ref()
                        .is_none_or(|path| path == &chunk.file_path)
                    {
                        if chunks.is_empty() {
                            first_call = event.call_id.clone();
                        }
                        chunks.push(chunk);
                    }
                }
            }
        }
        let selected: Vec<_> = history
            .iter()
            .filter(|e| {
                params
                    .file_path
                    .as_ref()
                    .is_some_and(|path| e.paths.contains(path))
            })
            .collect();
        let range = selected
            .first()
            .map(|e| e.event_id.clone())
            .zip(selected.last().map(|e| e.event_id.clone()));
        let mut result = project(chunks);
        if let (Some(path), Some(range)) = (params.file_path.as_ref(), range) {
            let id = params.session_id.clone();
            let path = path.clone();
            let round = round.to_owned();
            let version = tokio::task::spawn_blocking(move || -> Result<FileVersion, String> {
                let before = first_call.and_then(|call| {
                    agent_core::tools::file_history::read_pre_tool_file(&id, &call, &path)
                });
                let local = reconstruction::replay(&history, &path, None, before);
                if local.before.is_some() || local.after.is_some() {
                    return Ok(local);
                }
                let conn = get_connection().map_err(|e| e.to_string())?;
                crate::orgtrack::imported_changes::read_file_version(
                    &conn,
                    &id,
                    &path,
                    Some((&round, &range.0, &range.1)),
                )
            })
            .await
            .map_err(|_| RpcError::invalid_params("snapshot reader failed"))?
            .map_err(RpcError::invalid_params)?;
            if let Some(file) = result.files.first_mut() {
                attach_version(file, version);
            }
        }
        if params.file_path.is_none() {
            for file in &mut result.files {
                file.patches.clear();
            }
        }
        return serde_json::to_value(result)
            .map_err(|_| RpcError::invalid_params("change serialization failed"));
    }
    let review = tokio::task::spawn_blocking(move || -> Result<ChangeReview, String> {
        let conn = get_connection().map_err(|error| error.to_string())?;
        load_history(&conn, &params)
    })
    .await
    .map_err(|_| RpcError::invalid_params("change reader failed"))?
    .map_err(RpcError::invalid_params)?;
    serde_json::to_value(review)
        .map_err(|_| RpcError::invalid_params("change serialization failed"))
}

fn load_history(conn: &rusqlite::Connection, params: &Params) -> Result<ChangeReview, String> {
    if params.scope == Scope::Session {
        if let Some(imported) = crate::orgtrack::imported_changes::read(conn, &params.session_id)? {
            let mut review = project(
                imported
                    .chunks
                    .into_iter()
                    .filter(|chunk| {
                        params
                            .file_path
                            .as_ref()
                            .is_none_or(|path| path == &chunk.file_path)
                    })
                    .collect(),
            );
            if params.file_path.is_none() {
                for file in &mut review.files {
                    file.patches.clear();
                }
            } else if let Some(file) = review.files.first_mut() {
                let version = crate::orgtrack::imported_changes::read_file_version(
                    conn,
                    &params.session_id,
                    &file.path,
                    None,
                )?;
                attach_version(file, version);
            }
            return Ok(review);
        }
    }
    let round_id = if params.scope == Scope::Turn {
        params.round_id.clone()
    } else {
        None
    };
    // Bound payload size in SQL before materializing JSON in the process.
    // Select only the exact owner; never query every session then filter.
    let mut statement = conn.prepare(
            "SELECT CASE WHEN length(c.payload_json) <= 2097152 THEN c.payload_json ELSE NULL END FROM orgtrack_core_diff_chunks c
             WHERE c.session_id = ?1 AND (?2 IS NULL OR EXISTS (
               SELECT 1 FROM orgtrack_core_edit_artifacts e
               WHERE e.record_id = c.edit_record_id
                 AND e.session_id = c.session_id
                 AND json_extract(e.payload_json, '$.turnId') = ?2
             )) AND (?3 IS NULL OR c.file_path = ?3)
             ORDER BY c.sequence_index, c.chunk_index LIMIT ?4"
        ).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            rusqlite::params![
                params.session_id,
                round_id,
                params.file_path,
                (MAX_RECORDS + 1) as i64
            ],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| error.to_string())?;
    let mut chunks = Vec::new();
    let mut bytes = 0;
    for row in rows {
        let payload = row.map_err(|error| error.to_string())?;
        bytes += payload.len();
        if bytes > MAX_BYTES || chunks.len() == MAX_RECORDS {
            return Err("historical change window exceeds review budget".into());
        }
        chunks.push(
            serde_json::from_str(&payload)
                .map_err(|error| format!("invalid change artifact: {error}"))?,
        );
    }
    let mut review = project(chunks);
    for file in &mut review.files {
        if params.file_path.as_deref() != Some(&file.path) {
            file.patches.clear();
        }
    }
    Ok(review)
}

#[cfg(test)]
mod tests {
    use super::*;
    use orgtrack_core::{
        canonical::{AgentMetadata, ArtifactQuality, SessionEditArtifactRecord, SessionEditKind},
        store::{sqlite::SqliteRecordStore, RecordStore},
    };

    #[test]
    fn reconstructed_version_is_serialized_as_full_content_not_patch_fragments() {
        let mut file = ChangeFile {
            path: "a".into(),
            additions: Some(1),
            deletions: Some(1),
            patches: vec!["fragment".into()],
            before: None,
            after: None,
            availability: "patch_only",
        };
        attach_version(
            &mut file,
            FileVersion {
                before: Some("head\nold\ntail\n".into()),
                after: Some("head\nnew\ntail\n".into()),
            },
        );
        let wire = serde_json::to_value(&file).unwrap();
        assert_eq!(wire["after"], "head\nnew\ntail\n");
        assert_eq!(wire["before"], "head\nold\ntail\n");
        assert_eq!(wire["availability"], "reconstructed_from_history");
        attach_version(
            &mut file,
            FileVersion {
                before: None,
                after: Some(String::new()),
            },
        );
        assert_eq!(serde_json::to_value(&file).unwrap()["after"], "");
    }

    fn seed(conn: &rusqlite::Connection, owner: &str, turn: &str, index: i64) {
        let store = SqliteRecordStore::new(conn);
        let id = format!("{owner}:{turn}:{index}");
        store
            .upsert_edit_artifact(&SessionEditArtifactRecord {
                schema_version: 1,
                record_id: id.clone(),
                source: "fixture".into(),
                source_session_id: None,
                session_id: owner.into(),
                source_event_id: Some(id.clone()),
                turn_id: Some(turn.into()),
                sequence_index: index,
                timestamp: None,
                workspace_path: None,
                file_path: "file.ts".into(),
                path_hash: "fixture".into(),
                edit_kind: SessionEditKind::Patch,
                old_start_line: Some(1),
                new_start_line: Some(1),
                start_line: Some(1),
                end_line: Some(1),
                lines_added: 1,
                lines_removed: 1,
                quality: ArtifactQuality::Exact,
                metadata: AgentMetadata::default(),
            })
            .unwrap();
        store
            .upsert_diff_chunk(&SessionDiffChunkRecord {
                schema_version: 1,
                record_id: id.clone(),
                edit_record_id: id.clone(),
                source: "fixture".into(),
                session_id: owner.into(),
                source_event_id: Some(id),
                sequence_index: index,
                chunk_index: 0,
                file_path: "file.ts".into(),
                old_start_line: Some(1),
                new_start_line: Some(1),
                old_content: Some("a".into()),
                new_content: Some("b".into()),
                diff: Some("@@ -1 +1 @@\n-a\n+b\n".into()),
                lines_added: 1,
                lines_removed: 1,
                is_deleted: false,
                quality: ArtifactQuality::Exact,
            })
            .unwrap();
    }

    #[test]
    fn owner_and_round_are_scoped_and_fragments_never_become_full_files() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        SqliteRecordStore::init_tables(&conn).unwrap();
        seed(&conn, "a", "one", 1);
        seed(&conn, "a", "two", 2);
        seed(&conn, "b", "one", 3);
        let mut params = Params {
            session_id: "a".into(),
            round_id: Some("one".into()),
            file_path: Some("file.ts".into()),
            scope: Scope::Turn,
        };
        let round = load_history(&conn, &params).unwrap();
        assert_eq!(round.files.len(), 1);
        assert_eq!(round.files[0].patches.len(), 1);
        assert_eq!(round.files[0].additions, Some(1));
        assert!(round.files[0].before.is_none());
        assert!(round.files[0].after.is_none());
        params.scope = Scope::Session;
        let session = load_history(&conn, &params).unwrap();
        assert_eq!(session.files[0].patches.len(), 2);
        assert_eq!(session.files[0].additions, None); // Not summed as net.
        params.file_path = None;
        assert!(load_history(&conn, &params).unwrap().files[0]
            .patches
            .is_empty());
        params.file_path = Some("unrelated.ts".into());
        assert!(load_history(&conn, &params).unwrap().files.is_empty());
    }
}
