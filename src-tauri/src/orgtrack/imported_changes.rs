//! Read-only projection of imported Codex edits. The rollout, not the native
//! runtime artifact table or today's worktree, is authoritative for this owner.
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::SystemTime,
};

use crate::agent_sessions::event_pipeline::{
    extractors::extract_event_data,
    ingestion::{ingest_raw_chunks, types::RawActivityChunk},
};
use orgtrack_core::{
    edit_extraction::{
        artifacts_from_extracted_edit, EditArtifactContext, NormalizedEditArtifacts,
    },
    sources::codex::app,
};

pub(crate) mod reconstruction;
use reconstruction::{FileVersion, RecordedEdit};

#[derive(Debug, Clone, Default)]
struct Review {
    artifacts: NormalizedEditArtifacts,
    history: Vec<RecordedEdit>,
}

type Key = (String, PathBuf, SystemTime, u64);
// One bounded entry; serializing reads also single-flights Desktop/mobile.
static REVIEW: Mutex<Option<(Key, Arc<Review>)>> = Mutex::new(None);
type ContextKey = (Key, String, String, String);
static CONTEXT_REVIEW: Mutex<Option<(ContextKey, Arc<Review>)>> = Mutex::new(None);

pub(crate) fn read(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> Result<Option<NormalizedEditArtifacts>, String> {
    Ok(read_review(conn, session_id)?.map(|review| review.artifacts.clone()))
}

pub(crate) fn read_file_version(
    conn: &rusqlite::Connection,
    session_id: &str,
    path: &str,
    range: Option<(&str, &str, &str)>,
) -> Result<FileVersion, String> {
    if let Some((round, first, last)) = range {
        let canonical = crate::agent_sessions::cli::native_transcript::imported_transcript_id_for_managed_session(session_id);
        let session_id = canonical.as_deref().unwrap_or(session_id);
        if !session_id.starts_with(orgtrack_core::sources::codex::SESSION_PREFIX) {
            return Ok(FileVersion::default());
        }
        let source = app::codex_app_review_path(conn, session_id)?;
        let signature = || -> Result<ContextKey, String> {
            let meta = std::fs::metadata(&source).map_err(|e| e.to_string())?;
            Ok((
                (
                    session_id.into(),
                    source.clone(),
                    meta.modified().map_err(|e| e.to_string())?,
                    meta.len(),
                ),
                round.into(),
                path.into(),
                last.into(),
            ))
        };
        let key = signature()?;
        let mut cache = CONTEXT_REVIEW
            .lock()
            .map_err(|_| "file review lock poisoned")?;
        let review = match cache.as_ref() {
            Some((previous, review)) if previous == &key => review.clone(),
            _ => {
                *cache = None;
                let chunks =
                    app::load_codex_app_review_context_from_path(session_id, &source, round, last)?;
                let review = Arc::new(project_selected_review(session_id, chunks, Some(path))?);
                if signature()? != key {
                    return Err("History changed during review; retry".into());
                }
                *cache = Some((key, review.clone()));
                review
            }
        };
        return Ok(reconstruction::replay(
            &review.history,
            path,
            Some((first, last)),
            None,
        ));
    }
    Ok(
        read_review(conn, session_id)?.map_or_else(FileVersion::default, |review| {
            reconstruction::replay(&review.history, path, None, None)
        }),
    )
}

fn read_review(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> Result<Option<Arc<Review>>, String> {
    let canonical =
        crate::agent_sessions::cli::native_transcript::imported_transcript_id_for_managed_session(
            session_id,
        );
    let session_id = canonical.as_deref().unwrap_or(session_id);
    if !session_id.starts_with(orgtrack_core::sources::codex::SESSION_PREFIX) {
        return Ok(None);
    }
    let path = app::codex_app_review_path(conn, session_id)?;
    let signature = || -> Result<Key, String> {
        let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        Ok((
            session_id.into(),
            path.clone(),
            meta.modified().map_err(|e| e.to_string())?,
            meta.len(),
        ))
    };
    let mut cache = REVIEW.lock().map_err(|_| "imported review lock poisoned")?;
    let key = signature()?;
    if let Some((previous, value)) = cache.as_ref() {
        if previous == &key {
            return Ok(Some(value.clone()));
        }
    }
    // Drop stale data before parsing; a failed read cannot serve the old owner.
    *cache = None;
    let chunks = app::load_codex_app_review_from_path(session_id, &path)?;
    let value = Arc::new(project_review(session_id, chunks)?);
    if signature()? != key {
        return Err("History changed during review; retry".into());
    }
    *cache = Some((key, value.clone()));
    Ok(Some(value))
}

fn project_review(
    session_id: &str,
    chunks: Vec<core_types::activity::ActivityChunk>,
) -> Result<Review, String> {
    project_selected_review(session_id, chunks, None)
}

fn project_selected_review(
    session_id: &str,
    chunks: Vec<core_types::activity::ActivityChunk>,
    selected_file: Option<&str>,
) -> Result<Review, String> {
    let raw: Vec<RawActivityChunk> = chunks
        .into_iter()
        .map(|chunk| RawActivityChunk {
            chunk_id: Some(chunk.chunk_id),
            session_id: Some(session_id.into()),
            action_type: Some(chunk.action_type),
            function: Some(chunk.function),
            args: Some(chunk.args),
            result: Some(chunk.result),
            created_at: Some(chunk.created_at),
            ..Default::default()
        })
        .collect();
    let mut output = NormalizedEditArtifacts::default();
    let mut history = Vec::new();
    let mut history_bytes = 0;
    let mut bytes = 0;
    let mut turn = None;
    for (index, event) in ingest_raw_chunks(&raw, session_id)
        .events
        .into_iter()
        .enumerate()
    {
        if event.action_type == "user_message" {
            turn = Some(event.id.clone());
        }
        if event.display_status != core_types::session_event::EventDisplayStatus::Completed {
            continue;
        }
        let Some(core_types::extracted::ExtractedData::Edit(edit)) = extract_event_data(&event)
        else {
            continue;
        };
        let context = EditArtifactContext {
            source: "codex_app".into(),
            source_session_id: None,
            session_id: session_id.into(),
            source_event_id: Some(event.id.clone()),
            turn_id: turn.clone(),
            sequence_index: index as i64,
            timestamp: Some(event.created_at.clone()),
            workspace_path: None,
            metadata: Default::default(),
        };
        let mut artifacts = artifacts_from_extracted_edit(&context, &edit);
        if let Some(path) = selected_file {
            artifacts.chunks.retain(|chunk| chunk.file_path == path);
            artifacts.edits.retain(|edit| edit.file_path == path);
            if artifacts.chunks.is_empty() {
                continue;
            }
        }
        let mut recorded = RecordedEdit::from_event(
            &event,
            artifacts
                .chunks
                .iter()
                .map(|c| c.file_path.clone())
                .collect(),
        );
        history_bytes += recorded.patch.as_ref().map_or(0, String::len);
        if history_bytes > 2 * 1024 * 1024 {
            // Keep the invalidating event, not its body. Exhausting the replay
            // budget must not make the existing Desktop diff list fail.
            recorded.patch = None;
        }
        for chunk in &artifacts.chunks {
            bytes += chunk.diff.as_ref().map_or(0, String::len)
                + chunk.old_content.as_ref().map_or(0, String::len)
                + chunk.new_content.as_ref().map_or(0, String::len);
        }
        if bytes > 2 * 1024 * 1024 || output.chunks.len() + artifacts.chunks.len() > 500 {
            return Err("Imported changes exceed review budget".into());
        }
        output.edits.extend(artifacts.edits);
        output.chunks.extend(artifacts.chunks);
        history.push(recorded);
    }
    Ok(Review {
        artifacts: output,
        history,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn project(
        session_id: &str,
        chunks: Vec<core_types::activity::ActivityChunk>,
    ) -> Result<NormalizedEditArtifacts, String> {
        Ok(project_review(session_id, chunks)?.artifacts)
    }
    #[test]
    #[ignore = "explicit read-only verification against a user-selected rollout"]
    fn verify_selected_rollout() {
        let path = std::env::var("ORGII_REVIEW_VERIFY_PATH").expect("select a rollout");
        let start = std::time::Instant::now();
        let result = project(
            "codexapp-verification",
            app::load_codex_app_review_from_path(
                "codexapp-verification",
                std::path::Path::new(&path),
            )
            .unwrap(),
        )
        .unwrap();
        let files: std::collections::BTreeSet<_> =
            result.chunks.iter().map(|c| c.file_path.as_str()).collect();
        eprintln!(
            "review: {} edits, {} files, {:?}",
            result.chunks.len(),
            files.len(),
            start.elapsed()
        );
        assert!(!files.is_empty());
    }
    #[test]
    fn exec_rollout_projects_successful_edits_without_native_artifact_rows() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("rollout.jsonl");
        let patch = "*** Begin Patch\n*** Add File: src/example.ts\n+hello\n*** End Patch";
        let input = format!(
            "text(await tools.apply_patch({}));",
            serde_json::to_string(patch).unwrap()
        );
        let records = [
            serde_json::json!({"type":"response_item","payload":{"type":"custom_tool_call","call_id":"edit-1","name":"exec","input":input}}),
            serde_json::json!({"type":"response_item","payload":{"type":"custom_tool_call_output","call_id":"edit-1","output":[{"type":"input_text","text":"Script completed\nWall time 0.0 seconds\nOutput:\n"},{"type":"input_text","text":"{}"}]}}),
        ];
        std::fs::write(
            &path,
            records
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("\n"),
        )
        .unwrap();
        let result = project(
            "codexapp-test",
            app::load_codex_app_review_from_path("codexapp-test", &path).unwrap(),
        )
        .unwrap();
        assert_eq!(result.edits.len(), 1);
        assert_eq!(result.chunks[0].file_path, "src/example.ts");
        assert_eq!(result.chunks[0].session_id, "codexapp-test");
        assert!(result.chunks[0].diff.as_deref().unwrap().contains("+hello"));
        std::fs::write(&path, records[0].to_string()).unwrap();
        assert!(
            project(
                "codexapp-test",
                app::load_codex_app_review_from_path("codexapp-test", &path).unwrap()
            )
            .unwrap()
            .chunks
            .is_empty(),
            "pending intent must not count as a completed edit"
        );
        let failed = records[1]
            .to_string()
            .replace("Script completed", "Script failed");
        std::fs::write(&path, format!("{}\n{}", records[0], failed)).unwrap();
        assert!(project(
            "codexapp-test",
            app::load_codex_app_review_from_path("codexapp-test", &path).unwrap()
        )
        .unwrap()
        .chunks
        .is_empty());
    }

    #[test]
    fn raw_rollout_replays_full_file_with_unmodified_lines_and_stable_event_boundaries() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("rollout.jsonl");
        let patches = [
            "*** Begin Patch\n*** Add File: a\n+head\n+one\n+gap\n+two\n+tail\n*** End Patch",
            "*** Begin Patch\n*** Update File: a\n@@\n-one\n+ONE\n@@\n-two\n+TWO\n*** End Patch",
            "*** Begin Patch\n*** Update File: a\n@@\n-tail\n+later\n*** End Patch",
        ];
        let mut records = Vec::new();
        for (i, patch) in patches.iter().enumerate() {
            records.push(serde_json::json!({"type":"event_msg","payload":{"type":"user_message","message":format!("turn {i}")}}));
            records.push(serde_json::json!({"type":"response_item","payload":{"type":"custom_tool_call","call_id":format!("edit-{i}"),"name":"exec","input":format!("text(await tools.apply_patch({})); text(await tools.exec_command({{cmd:\"check\"}}));", serde_json::to_string(patch).unwrap())}}));
            records.push(serde_json::json!({"type":"response_item","payload":{"type":"custom_tool_call_output","call_id":format!("edit-{i}"),"output":[{"type":"input_text","text":"Script completed\nOutput:\n"},{"type":"input_text","text":"{}"},{"type":"input_text","text":if i == 0 {r#"{"session_id":71,"output":"building"}"#} else {r#"{"exit_code":1,"output":"check failed"}"#}}]}}));
        }
        std::fs::write(
            &path,
            records
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("\n"),
        )
        .unwrap();
        let review = project_review(
            "codexapp-test",
            app::load_codex_app_review_from_path("codexapp-test", &path).unwrap(),
        )
        .unwrap();
        assert_eq!(review.history.len(), 3);
        let target = &review.history[1].event_id;
        let version = reconstruction::replay(&review.history, "a", Some((target, target)), None);
        assert_eq!(
            version.before.as_deref(),
            Some("head\none\ngap\ntwo\ntail\n")
        );
        assert_eq!(
            version.after.as_deref(),
            Some("head\nONE\ngap\nTWO\ntail\n")
        );
        // The display conversion flattens @@ sections. Replay retains the raw
        // sections and must not rely on the synthetic contiguous line range.
        assert!(review.history[1]
            .patch
            .as_deref()
            .unwrap()
            .contains("+ONE\n@@"));
        let version = reconstruction::replay(&review.history, "a", None, None);
        assert_eq!(
            version.after.as_deref(),
            Some("head\nONE\ngap\nTWO\nlater\n")
        );
        let target_offset: usize = records[..3].iter().map(|r| r.to_string().len() + 1).sum();
        let context = project_selected_review(
            "codexapp-test",
            app::load_codex_app_review_context_from_path(
                "codexapp-test",
                &path,
                &format!("codex-user-{target_offset}"),
                "edit-1:part-0",
            )
            .unwrap(),
            Some("a"),
        )
        .unwrap();
        assert_eq!(context.history.len(), 2, "stop before later turns");
        let scoped = reconstruction::replay(&context.history, "a", Some((target, target)), None);
        assert_eq!(scoped.after.as_deref(), Some("head\nONE\ngap\nTWO\ntail\n"));
        // A sparse old prefix puts the same fixture beyond the whole-rollout
        // budget. Review must seek to nearby turns, not read that prefix.
        use std::io::{Seek, SeekFrom, Write};
        let prefix = 70 * 1024 * 1024;
        let mut large = std::fs::OpenOptions::new()
            .write(true)
            .truncate(true)
            .open(&path)
            .unwrap();
        large.set_len(prefix).unwrap();
        large.seek(SeekFrom::End(0)).unwrap();
        writeln!(large).unwrap();
        large
            .write_all(
                records
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join("\n")
                    .as_bytes(),
            )
            .unwrap();
        drop(large);
        let chunks = app::load_codex_app_review_context_from_path(
            "codexapp-test",
            &path,
            &format!("codex-user-{}", prefix + 1 + target_offset as u64),
            "edit-1:part-0",
        )
        .unwrap();
        let context = project_selected_review("codexapp-test", chunks, Some("a")).unwrap();
        assert_eq!(context.history.len(), 2);
        assert_eq!(
            reconstruction::replay(&context.history, "a", Some((target, target)), None).after,
            scoped.after
        );
    }

    #[test]
    #[ignore = "read-only verification of explicitly selected user history"]
    fn verify_selected_file_version() {
        let path = std::env::var("ORGII_REVIEW_VERIFY_PATH").unwrap();
        let file = std::env::var("ORGII_REVIEW_VERIFY_FILE").unwrap();
        let marker = std::env::var("ORGII_REVIEW_VERIFY_MARKER").unwrap();
        let round = std::env::var("ORGII_REVIEW_VERIFY_ROUND").unwrap();
        let call = std::env::var("ORGII_REVIEW_VERIFY_CALL").unwrap();
        let start = std::time::Instant::now();
        let review = project_selected_review(
            "codexapp-verification",
            app::load_codex_app_review_context_from_path(
                "codexapp-verification",
                std::path::Path::new(&path),
                &round,
                &call,
            )
            .unwrap(),
            Some(&file),
        )
        .unwrap();
        let edits: Vec<_> = review
            .history
            .iter()
            .filter(|e| e.paths.contains(&file))
            .collect();
        for edit in &edits {
            eprintln!(
                "file edit {}, patch bytes {}",
                edit.event_id,
                edit.patch.as_ref().map_or(0, String::len)
            );
        }
        let target = edits
            .iter()
            .find(|e| e.patch.as_deref().is_some_and(|p| p.contains(&marker)))
            .expect("selected event exists");
        let version = reconstruction::replay(
            &review.history,
            &file,
            Some((&target.event_id, &target.event_id)),
            None,
        );
        eprintln!(
            "version: before {:?} bytes, after {:?} bytes, elapsed {:?}",
            version.before.as_ref().map(String::len),
            version.after.as_ref().map(String::len),
            start.elapsed()
        );
        assert!(version.before.as_ref().is_some_and(|s| s.starts_with('#')));
        assert!(version.after.as_ref().is_some_and(|s| s.starts_with('#')));
        assert!(version
            .after
            .as_ref()
            .is_some_and(|s| s.contains("VERIFIED")));
    }
}
