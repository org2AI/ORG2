//! Read-only native replay: normalize inside Rust and keep Chat bodies lazy.

use core_types::activity::ActivityChunk;
use serde::Deserialize;

use crate::agent_sessions::event_pipeline::{
    ingestion::{self, types::RawActivityChunk},
    types::SessionEvent,
};

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CliHistoryRead {
    Full,
    Preview,
    Turn {
        #[serde(rename = "turnId")]
        turn_id: String,
    },
}

fn native_window_chunks(
    session_id: &str,
    read: &CliHistoryRead,
) -> Result<Option<Vec<ActivityChunk>>, String> {
    use super::super::{native_materializer, native_transcript, persistence};
    use orgtrack_core::sources::{claude_code::history as claude, codex::app as codex};

    let Some(session) = persistence::get_session(session_id).map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    if session.transcript_source != native_transcript::TRANSCRIPT_SOURCE_NATIVE {
        return Ok(None);
    }
    let Some((_, native_id)) = native_transcript::current_native_store_key_for_session(&session)?
    else {
        return Ok(None);
    };
    let (provider, path) =
        match native_materializer::materialized_cli_transcript_path(&session, &native_id)? {
            Some(candidate) => candidate,
            None => {
                // Legacy/moved provider files are still native history. Resolve
                // their discovered path without first loading the complete body.
                let conn = database::db::get_connection().map_err(|error| error.to_string())?;
                let provider = session.cli_agent_type.as_deref().unwrap_or_default();
                let path = match provider {
                    "claude_code" => claude::resolve_claude_session_path(&conn, &native_id)?,
                    "codex" => codex::resolve_codex_session_path(&conn, &native_id)?,
                    _ => return Ok(None),
                };
                (provider.to_string(), path)
            }
        };
    let chunks = match (provider.as_str(), read) {
        ("claude_code", CliHistoryRead::Preview) => {
            claude::load_claude_code_initial_window_from_path(session_id, &path, 1)?.chunks
        }
        ("codex", CliHistoryRead::Preview) => {
            codex::load_codex_app_initial_window_from_path(session_id, &path, 1)?.chunks
        }
        ("claude_code", CliHistoryRead::Turn { turn_id }) => {
            claude::load_claude_code_turn_windows_from_path(
                session_id,
                &path,
                std::slice::from_ref(turn_id),
            )?
            .into_iter()
            .flat_map(|window| window.chunks)
            .collect()
        }
        ("codex", CliHistoryRead::Turn { turn_id }) => {
            codex::load_codex_app_window_turn_from_path(session_id, &path, turn_id)?.chunks
        }
        _ => return Ok(None),
    };
    Ok(Some(chunks))
}

fn normalize_history(chunks: Vec<ActivityChunk>, session_id: &str) -> Vec<SessionEvent> {
    // Move fields instead of a serialize/parse round-trip through the WebView.
    // This mirrors rustBridge.toRawChunk, including its absent top-level call id.
    let raw: Vec<_> = chunks
        .into_iter()
        .map(|chunk| RawActivityChunk {
            chunk_id: Some(chunk.chunk_id),
            session_id: Some(chunk.session_id),
            action_type: Some(chunk.action_type),
            function: Some(chunk.function),
            args: Some(chunk.args),
            result: Some(chunk.result),
            created_at: Some(chunk.created_at),
            thread_id: chunk.thread_id,
            process_id: chunk.process_id,
            call_id: None,
        })
        .collect();
    let mut result = ingestion::ingest_raw_chunks(&raw, session_id);
    agent_core::tools::impls::coding::exec::external_replay::persist_external_shell_replays(
        &mut result.events,
    );
    result.events
}

fn read_history(session_id: &str, read: &CliHistoryRead) -> Result<Vec<SessionEvent>, String> {
    let chunks = match read {
        CliHistoryRead::Full => super::transcript::load_session_chunks(session_id)?,
        _ => match native_window_chunks(session_id, read)? {
            Some(chunks) => chunks,
            None if matches!(read, CliHistoryRead::Turn { .. }) => {
                return Err("Native turn history is unavailable".to_string())
            }
            // Legacy chunk-backed providers retain their established replay.
            None => super::transcript::load_session_chunks(session_id)?,
        },
    };
    Ok(normalize_history(chunks, session_id))
}

#[tauri::command]
pub async fn cli_agent_history(
    session_id: String,
    read: CliHistoryRead,
) -> Result<Vec<SessionEvent>, String> {
    tokio::task::spawn_blocking(move || read_history(&session_id, &read))
        .await
        .map_err(|error| format!("Read CLI history: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_sessions::cli::persistence::{self, CreateCodeSessionParams};
    use serde_json::json;
    use std::{fs, io::Write};

    #[test]
    fn managed_native_preview_is_bounded_and_old_bodies_remain_fetchable() {
        let sandbox = crate::test_utils::test_env::sandbox();
        let cwd = fs::canonicalize(sandbox.path()).unwrap();
        for provider in ["claude_code", "codex"] {
            let sid = format!("cliagent-window-{provider}");
            let native_id = if provider == "codex" {
                "33333333-3333-4333-8333-333333333333"
            } else {
                "11111111-1111-4111-8111-111111111111"
            };
            let params: CreateCodeSessionParams = serde_json::from_value(json!({
                "platform": provider, "accountId": "fixture-account", "repoPath": cwd,
                "model": "fixture-model"
            }))
            .unwrap();
            persistence::create_session(&sid, &params).unwrap();
            persistence::update_cli_session_id_for_account(
                &sid,
                Some("fixture-account"),
                native_id,
            )
            .unwrap();
            let conn = database::db::get_connection().unwrap();
            conn.execute(
                "UPDATE code_sessions SET transcript_source = 'native' WHERE session_id = ?1",
                [&sid],
            )
            .unwrap();
            let path = if provider == "codex" {
                app_paths::native_transcript_home_dir()
                    .join(".codex/sessions/2026/09/09")
                    .join(format!("rollout-2026-09-09T00-00-00-{native_id}.jsonl"))
            } else {
                let slug: String = cwd
                    .to_string_lossy()
                    .chars()
                    .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
                    .collect();
                app_paths::native_transcript_home_dir()
                    .join(".claude/projects")
                    .join(slug)
                    .join(format!("{native_id}.jsonl"))
            };
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            let mut file = fs::File::create(&path).unwrap();
            if provider == "codex" {
                writeln!(
                    file,
                    "{}",
                    json!({"type":"session_meta","payload":{"id":native_id,"cwd":cwd}})
                )
                .unwrap();
            }
            let mut parent = None;
            for index in 0..128 {
                for (offset, role) in [(0, "user"), (1, "assistant")] {
                    let text = if role == "user" {
                        format!("question-{index}")
                    } else {
                        format!("answer-{index}:{}:tail-{index}", "x".repeat(16 * 1024))
                    };
                    let timestamp =
                        chrono::DateTime::from_timestamp(1_783_000_000 + index * 2 + offset, 0)
                            .unwrap()
                            .to_rfc3339();
                    let uuid = format!("00000000-0000-4000-8000-{:012}", index * 2 + offset);
                    let row = if provider == "codex" {
                        json!({"type":"event_msg","timestamp":timestamp,"payload":{"type":if role == "user" {"user_message"} else {"agent_message"},"message":text}})
                    } else {
                        json!({"type":role,"uuid":uuid,"parentUuid":parent,"sessionId":native_id,"cwd":cwd,"timestamp":timestamp,
                            "message":{"role":role,"content":if role == "user" {json!(text)} else {json!([{"type":"text","text":text}])}}})
                    };
                    writeln!(file, "{row}").unwrap();
                    parent = Some(uuid);
                }
            }
            drop(file);
            // Exercise the production managed binding, path resolver and IPC
            // result producer, without discovery/cache rows for the raw file.
            let preview = read_history(&sid, &CliHistoryRead::Preview).unwrap();
            let full = read_history(&sid, &CliHistoryRead::Full).unwrap();
            let preview_json = serde_json::to_string(&preview).unwrap();
            let full_json = serde_json::to_string(&full).unwrap();
            assert!(
                preview_json.len() < full_json.len() / 8,
                "{provider}: preview must not ship every body"
            );
            assert!(preview_json.contains("tail-127"));
            assert!(!preview_json.contains("tail-0"));
            assert!(full_json.contains("tail-0"));
            let turn_id = preview
                .iter()
                .find_map(|event| {
                    event
                        .result
                        .pointer("/unloadedTurn/turnId")
                        .and_then(|v| v.as_str())
                })
                .expect("old round placeholder");
            let body = read_history(
                &sid,
                &CliHistoryRead::Turn {
                    turn_id: turn_id.to_string(),
                },
            )
            .unwrap();
            assert!(
                serde_json::to_string(&body).unwrap().contains("tail-0"),
                "{provider}: requested old turn {turn_id} must survive an intervening full read"
            );
            assert!(body.iter().all(|event| event.session_id == sid));
            assert!(
                body.iter().any(|event| event.id == turn_id
                    && event.source
                        == crate::agent_sessions::event_pipeline::types::EventSource::User),
                "{provider}: body user must retain the requested placeholder identity"
            );
            let mut store = crate::agent_sessions::event_pipeline::store::EventStore::new();
            store.set(preview.clone());
            store.merge_round_window_events(body.clone());
            let merged = store.events();
            assert!(
                serde_json::to_string(merged).unwrap().contains("tail-0"),
                "{provider}: loaded body must survive the real store merge"
            );
            assert!(body.len() < full.len());
            let moved = if provider == "claude_code" {
                path.parent()
                    .unwrap()
                    .parent()
                    .unwrap()
                    .join("old-project")
                    .join(path.file_name().unwrap())
            } else {
                app_paths::external_history_home_dir()
                    .join(".codex/archived_sessions")
                    .join(path.file_name().unwrap())
            };
            fs::create_dir_all(moved.parent().unwrap()).unwrap();
            fs::rename(&path, &moved).unwrap();
            if provider == "codex" {
                // Only the discovered raw path is indexed, never normalized
                // events. Alternate CODEX_HOME roots need this catalog entry.
                database::db::get_connection().unwrap().execute(
                    "INSERT INTO imported_history_session_cache (source, source_session_id, session_id, source_path) VALUES (?1, ?2, ?3, ?4)",
                    rusqlite::params![orgtrack_core::sources::imported_history::metadata::SOURCE_CODEX_APP, native_id, format!("codex:{native_id}"), moved.to_string_lossy().as_ref()],
                ).unwrap();
            }
            let moved_preview = read_history(&sid, &CliHistoryRead::Preview).unwrap();
            assert_eq!(serde_json::to_string(&moved_preview).unwrap(), preview_json);
            let moved_body = read_history(
                &sid,
                &CliHistoryRead::Turn {
                    turn_id: turn_id.to_string(),
                },
            )
            .unwrap();
            assert!(
                serde_json::to_string(&moved_body)
                    .unwrap()
                    .contains("tail-0"),
                "{provider}: discovered fallback must remain lazy and fetchable"
            );
        }
    }
}
