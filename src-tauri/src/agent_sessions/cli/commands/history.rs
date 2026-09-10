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

fn native_history_path(session_id: &str) -> Result<Option<(String, std::path::PathBuf)>, String> {
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
    Ok(Some((provider, path)))
}

fn native_window_chunks(
    session_id: &str,
    read: &CliHistoryRead,
) -> Result<Option<Vec<ActivityChunk>>, String> {
    use orgtrack_core::sources::{claude_code::history as claude, codex::app as codex};
    let Some((provider, path)) = native_history_path(session_id)? else {
        return Ok(None);
    };
    let mut chunks = match (provider.as_str(), read) {
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
    if let Some(catalog) =
        super::super::persistence::load_native_commands_for_provider(session_id, &provider)?
    {
        chunks.insert(0, catalog);
    }
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
    if matches!(read, CliHistoryRead::Full) {
        let mut output = Vec::new();
        visit_cli_history(session_id, &mut |events| {
            output.extend(events);
            Ok(())
        })?;
        return Ok(output);
    }
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

/// Visit complete canonical history without retaining completed native turns.
/// The sink owns persistence/output; an error aborts parsing immediately.
pub(crate) fn visit_cli_history(
    session_id: &str,
    visit: &mut dyn FnMut(Vec<SessionEvent>) -> Result<(), String>,
) -> Result<(), String> {
    use orgtrack_core::sources::{claude_code::history as claude, codex::app as codex};
    // Preserve the canonical resolver's legacy/unbound fallback and missing-
    // artifact errors. A failed window lookup is not evidence of empty history.
    if let Ok(Some((provider, path))) = native_history_path(session_id) {
        let mut normalize = |chunks| visit(normalize_history(chunks, session_id));
        let before = super::super::native_store::native_transcript_revision(&path)?;
        if let Some(catalog) =
            super::super::persistence::load_native_commands_for_provider(session_id, &provider)?
        {
            normalize(vec![catalog])?;
        }
        match provider.as_str() {
            "codex" => codex::visit_codex_app_from_path(session_id, &path, &mut normalize)?,
            "claude_code" => {
                claude::visit_claude_code_history_from_path(session_id, &path, &mut normalize)?
            }
            _ => return Err("Unsupported native visitor".into()),
        }
        if super::super::native_store::native_transcript_revision(&path)? != before {
            return Err("Native transcript changed while reading; retry the operation".into());
        }
        return Ok(());
    }
    visit(normalize_history(
        super::transcript::load_session_chunks(session_id)?,
        session_id,
    ))
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
        check_managed_native_history(128);
    }

    #[test]
    #[ignore = "explicit 64 MiB per-provider resource acceptance"]
    fn managed_native_full_export_large_history_acceptance() {
        check_managed_native_history(4096);
    }

    #[test]
    #[ignore = "explicit streaming-only resource acceptance"]
    fn managed_native_streaming_export_resource_acceptance() {
        let turns = std::env::var("ORG2_EXPORT_TEST_TURNS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(4096);
        check_managed_native_history_impl(turns, true);
    }

    fn check_managed_native_history(turn_count: i64) {
        check_managed_native_history_impl(turn_count, false);
    }

    fn check_managed_native_history_impl(turn_count: i64, streaming_only: bool) {
        let last_tail = format!("tail-{}", turn_count - 1);
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
            assert_eq!(
                read_history(&sid, &CliHistoryRead::Full).is_err(),
                super::super::transcript::load_session_chunks(&sid).is_err(),
                "{provider}: missing-artifact behavior must remain unchanged"
            );
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
            for index in 0..turn_count {
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
            if streaming_only {
                let mode = std::env::var("ORG2_EXPORT_TEST_MODE").unwrap_or_default();
                eprintln!("RESOURCE_MODE={mode:?} PROVIDER={provider} TURNS={turn_count}");
                if mode == "full" || mode == "baseline" {
                    let events = if mode == "baseline" {
                        normalize_history(
                            super::super::transcript::load_session_chunks(&sid).unwrap(),
                            &sid,
                        )
                    } else {
                        read_history(&sid, &CliHistoryRead::Full).unwrap()
                    };
                    assert_eq!(events.len() as i64, turn_count * 2);
                    assert!(events.last().unwrap().display_text.ends_with(&last_tail));
                    continue;
                }
                let destination = path.with_extension("md");
                crate::agent_sessions::event_pipeline::commands::export_markdown_output(
                    &sid,
                    vec![],
                    Some(destination.to_string_lossy().into_owned()),
                )
                .unwrap();
                use std::io::BufRead;
                let reader = std::io::BufReader::new(fs::File::open(&destination).unwrap());
                let mut users = 0;
                let mut assistants = 0;
                for line in reader.lines() {
                    let line = line.unwrap();
                    if line.starts_with("question-") {
                        assert_eq!(line, format!("question-{users}"));
                        users += 1;
                    } else if line.starts_with("answer-") {
                        assert_eq!(
                            line,
                            format!(
                                "answer-{assistants}:{}:tail-{assistants}",
                                "x".repeat(16 * 1024)
                            )
                        );
                        assistants += 1;
                    }
                }
                assert_eq!(users, turn_count);
                assert_eq!(assistants, turn_count);
                continue;
            }
            let mut catalog = core_types::activity::ActivityChunk::new(
                &sid,
                "native_command_catalog",
                "native_command_catalog",
            );
            catalog.args =
                json!({"native_provider": provider, "slash_commands": ["fixture-command"]});
            persistence::record_native_commands(&catalog).unwrap();
            // Exercise the production managed binding, path resolver and IPC
            // result producer, without discovery/cache rows for the raw file.
            let preview = read_history(&sid, &CliHistoryRead::Preview).unwrap();
            let full = read_history(&sid, &CliHistoryRead::Full).unwrap();
            for events in [&preview, &full] {
                let catalogs: Vec<_> = events
                    .iter()
                    .filter(|event| event.action_type == "native_command_catalog")
                    .collect();
                assert_eq!(
                    catalogs.len(),
                    1,
                    "{provider}: native catalog survives each read path exactly once"
                );
                assert_eq!(
                    catalogs[0].args["slash_commands"],
                    json!(["fixture-command"])
                );
            }
            let baseline = normalize_history(
                super::super::transcript::load_session_chunks(&sid).unwrap(),
                &sid,
            );
            assert_eq!(
                serde_json::to_value(&full).unwrap(),
                serde_json::to_value(&baseline).unwrap()
            );
            drop(baseline);

            let preview_json = serde_json::to_string(&preview).unwrap();
            let full_json = serde_json::to_string(&full).unwrap();
            let mut streamed = Vec::new();
            let mut largest_batch = 0;
            visit_cli_history(&sid, &mut |events| {
                largest_batch = largest_batch.max(events.len());
                streamed.extend(events);
                Ok(())
            })
            .unwrap();
            assert!(
                largest_batch <= 2,
                "{provider}: parser retained completed turns"
            );
            assert_eq!(
                serde_json::to_value(&streamed).unwrap(),
                serde_json::to_value(&full).unwrap()
            );
            let mut calls = 0;
            let error = visit_cli_history(&sid, &mut |_| {
                calls += 1;
                Err("export sink closed".into())
            })
            .unwrap_err();
            assert_eq!(calls, 1);
            assert_eq!(error, "export sink closed");
            drop(streamed);
            let mut changed = false;
            let error = visit_cli_history(&sid, &mut |_| {
                if !changed {
                    let mut source = fs::OpenOptions::new().append(true).open(&path).unwrap();
                    writeln!(source).unwrap();
                    changed = true;
                }
                Ok(())
            })
            .unwrap_err();
            assert!(error.contains("changed while reading"));

            assert!(
                preview_json.len() < full_json.len() / 8,
                "{provider}: preview must not ship every body"
            );
            assert!(preview_json.contains(&last_tail));
            assert!(!preview_json.contains("tail-0"));
            assert!(full_json.contains("tail-0"));
            let export_path = cwd.join(format!("{provider}-export.md"));
            let response = crate::agent_sessions::event_pipeline::commands::export_markdown_output(
                &sid,
                Vec::new(),
                Some(export_path.to_string_lossy().into_owned()),
            )
            .unwrap();
            assert!(
                response.is_empty(),
                "file export must not send the body through IPC"
            );
            assert!(fs::read_to_string(&export_path).unwrap().contains("tail-0"));
            // An unreadable authoritative file must not replace a previous
            // successful export with a partial/empty result.
            let held = path.with_extension("held");
            fs::rename(&path, &held).unwrap();
            fs::create_dir(&path).unwrap();
            let old_export = fs::read(&export_path).unwrap();
            assert!(
                crate::agent_sessions::event_pipeline::commands::export_markdown_output(
                    &sid,
                    Vec::new(),
                    Some(export_path.to_string_lossy().into_owned()),
                )
                .is_err()
            );
            assert_eq!(fs::read(&export_path).unwrap(), old_export);
            fs::remove_dir(&path).unwrap();
            fs::rename(held, &path).unwrap();
            for cached in [preview.clone(), Vec::new()] {
                let mut markdown = Vec::new();
                crate::agent_sessions::event_pipeline::commands::export_session_markdown(
                    &sid,
                    cached,
                    &mut markdown,
                )
                .unwrap();
                let markdown = String::from_utf8(markdown).unwrap();
                assert!(
                    markdown.contains("tail-0"),
                    "{provider}: export must include unloaded body"
                );
                assert!(markdown.contains(&last_tail));
                assert_eq!(markdown.matches("**User**").count(), turn_count as usize);
                assert_eq!(
                    markdown.matches("**Assistant**").count(),
                    turn_count as usize
                );
            }

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
            // Provider compaction is metadata, not a new human turn. Exercise
            // it after the managed window and discovered-path caches are warm.
            let transition = |label: &str, padding: usize| {
                let mut rows = if provider == "codex" {
                    vec![
                        json!({"type":"compacted","timestamp":"2026-09-09T00:00:00Z",
                        "payload":{"message":"provider compact summary", "replacement_history":[]}}),
                    ]
                } else {
                    vec![
                        json!({"type":"system","subtype":"compact_boundary","uuid":format!("{label}-boundary"),"timestamp":"2026-09-09T00:00:00Z"}),
                        json!({"type":"user","isCompactSummary":true,"uuid":format!("{label}-summary"),"timestamp":"2026-09-09T00:00:00Z",
                            "message":{"role":"user","content":"provider compact summary"}}),
                    ]
                };
                for (i, role) in [(1, "user"), (2, "assistant")] {
                    let text = format!("{label}-{role}{}", "x".repeat(padding));
                    rows.push(if provider == "codex" {
                        json!({"type":"event_msg","timestamp":format!("2026-09-09T00:00:0{i}Z"),
                            "payload":{"type":if role == "user" {"user_message"} else {"agent_message"},"message":text}})
                    } else {
                        json!({"type":role,"uuid":format!("{label}-{role}"),"sessionId":native_id,"cwd":cwd,
                            "timestamp":format!("2026-09-09T00:00:0{i}Z"),"message":{"role":role,"content":[{"type":"text","text":text}]}})
                    });
                }
                rows.into_iter()
                    .map(|row| format!("{row}\n"))
                    .collect::<String>()
            };
            fs::OpenOptions::new()
                .append(true)
                .open(&moved)
                .unwrap()
                .write_all(transition("after-compact", 0).as_bytes())
                .unwrap();
            let appended = read_history(&sid, &CliHistoryRead::Preview).unwrap();
            assert!(serde_json::to_string(&appended)
                .unwrap()
                .contains("after-compact-assistant"));
            let full = read_history(&sid, &CliHistoryRead::Full).unwrap();
            assert_eq!(
                full.iter()
                    .filter(|e| e.source == core_types::session_event::EventSource::User)
                    .count(),
                turn_count as usize + 1,
                "{provider}: compact summary must not create a human round"
            );
            for (label, padding, atomic) in [
                ("truncated", 0, false),
                ("grown-rewrite", 2048, false),
                ("rotated", 4096, true),
            ] {
                let replacement = transition(label, padding);
                if atomic {
                    let staging = moved.with_extension("replacement");
                    fs::write(&staging, replacement).unwrap();
                    fs::rename(staging, &moved).unwrap();
                } else {
                    fs::write(&moved, replacement).unwrap();
                }
                let refreshed = read_history(&sid, &CliHistoryRead::Preview).unwrap();
                assert!(
                    refreshed
                        .iter()
                        .filter(|e| e.source == core_types::session_event::EventSource::User)
                        .all(|e| e.display_text.starts_with(label)),
                    "{provider}: {label} resurrected an old user"
                );
                assert!(refreshed
                    .iter()
                    .any(|e| e.display_text.starts_with(&format!("{label}-assistant"))));
                store.set(refreshed.clone());
                assert!(!serde_json::to_string(store.events())
                    .unwrap()
                    .contains("question-0"));
                let mut exported = Vec::new();
                crate::agent_sessions::event_pipeline::commands::export_session_markdown(
                    &sid,
                    refreshed,
                    &mut exported,
                )
                .unwrap();
                let exported = String::from_utf8(exported).unwrap();
                assert_eq!(exported.matches("**User**").count(), 1);
                assert!(exported.contains(&format!("{label}-assistant")));
                assert!(!exported.contains("question-0"));
            }
        }
    }
}
