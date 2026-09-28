//! Transcript loading and mutation — native/legacy chunk resolution
//! (`cli_agent_chunks`, `cli_agent_transcript_path`) and message-edit
//! truncation (`cli_agent_truncate_after_chunk`).

use super::super::persistence::{self, CodeSession};
use super::super::session_runner;
use core_types::activity::ActivityChunk;

use super::super::native_store::native_transcript_revision;

fn stamp_managed_session_id(
    mut chunks: Vec<ActivityChunk>,
    managed_session_id: &str,
) -> Vec<ActivityChunk> {
    for chunk in &mut chunks {
        chunk.session_id = managed_session_id.to_string();
    }
    chunks
}

/// Read the exact provider path first, then its imported-history discovery
/// path. A readable exact transcript is authoritative and never consults the
/// eventually-consistent discovery cache. If either candidate exists but its
/// reader fails, propagate that error unless the other candidate succeeds;
/// silently falling back to DB chunks would certify a shorter history against
/// the still-stable native file revision.
fn load_native_transcript_candidate<Exact, Discovery>(
    managed_session_id: &str,
    imported_id: &str,
    exact: Exact,
    discovery: Discovery,
) -> Result<Option<Vec<ActivityChunk>>, String>
where
    Exact: FnOnce() -> Result<Option<Vec<ActivityChunk>>, String>,
    Discovery: FnOnce() -> Result<Option<Vec<ActivityChunk>>, String>,
{
    let exact_error = match exact() {
        Ok(Some(chunks)) if !chunks.is_empty() => {
            return Ok(Some(stamp_managed_session_id(chunks, managed_session_id)));
        }
        Ok(_) => None,
        Err(error) => Some(error),
    };

    let discovery_error = match discovery() {
        Ok(Some(chunks)) if !chunks.is_empty() => {
            return Ok(Some(stamp_managed_session_id(chunks, managed_session_id)));
        }
        Ok(_) => None,
        Err(error) => Some(error),
    };

    match (exact_error, discovery_error) {
        (Some(exact), Some(discovery)) => Err(format!(
            "Native transcript load failed for {imported_id}: exact={exact}; discovery={discovery}"
        )),
        (Some(exact), None) => Err(format!(
            "Exact native transcript load failed for {imported_id}: {exact}"
        )),
        (None, Some(discovery)) => Err(format!(
            "Native transcript discovery failed for {imported_id}: {discovery}"
        )),
        (None, None) => Ok(None),
    }
}

/// Resolve and parse a native-mode session's transcript from the CLI's own
/// store through the imported-history loaders. `Ok(None)` falls back to legacy
/// chunks only when no native candidate exists (pre-migration or a first turn
/// before its native file is created). Existing-but-unreadable native state is
/// an error and must never degrade to a shorter DB replay.
fn load_native_transcript_chunks(
    session: &CodeSession,
) -> Result<Option<Vec<ActivityChunk>>, String> {
    use super::super::native_transcript;
    if session.transcript_source != native_transcript::TRANSCRIPT_SOURCE_NATIVE {
        return Ok(None);
    }
    // UI replay and provider resume must use the same account-scoped native
    // UUID. The historical ledger is source-wide and may contain another
    // account's newest UUID after A→B→A; consulting it here would render B's
    // transcript while the next send resumes A. Until the ledger itself is
    // profile-scoped, fail closed to the exact current account mapping.
    let Some((binding, cli_session_id)) =
        native_transcript::current_native_store_key_for_session(session)?
    else {
        return Ok(None);
    };
    let imported_id = binding.imported_session_id(&cli_session_id);
    if super::super::native_materializer::has_indexed_codex_transcript(session)? {
        // SQLite owns the current physical generation. Neither a read failure
        // nor an empty indexed rollout authorizes replaying an older import.
        return super::super::native_materializer::load_materialized_cli_transcript(
            session,
            &cli_session_id,
        )?
        .map(|chunks| Some(stamp_managed_session_id(chunks, &session.session_id)))
        .ok_or_else(|| "Indexed Codex transcript is unavailable".to_string());
    }
    load_native_transcript_candidate(
        &session.session_id,
        &imported_id,
        || {
            // A managed native session already has an exact provider UUID and
            // execution workspace. Read that authoritative file first: it is
            // available synchronously after materialization and does not
            // require the eventually-consistent imported-history cache.
            super::super::native_materializer::load_materialized_cli_transcript(
                session,
                &cli_session_id,
            )
        },
        || {
            // Discovery covers legacy/provider files that moved away from the
            // bound workspace. The exact success path above stays independent
            // of this cache and its database connection.
            let conn = database::db::get_connection()
                .map_err(|error| format!("Failed to open imported history DB: {error}"))?;
            orgtrack_core::sources::imported_history::load_activity_chunks_for_session(
                &conn,
                &imported_id,
            )
        },
    )
}

#[cfg(test)]
mod native_transcript_resolution_tests {
    use super::*;

    fn one_chunk(session_id: &str) -> Vec<ActivityChunk> {
        vec![ActivityChunk::new(session_id, "raw", "assistant_message")]
    }

    #[test]
    fn exact_success_is_authoritative_and_skips_discovery() {
        let chunks = load_native_transcript_candidate(
            "managed",
            "codex:native",
            || Ok(Some(one_chunk("native"))),
            || -> Result<Option<Vec<ActivityChunk>>, String> {
                panic!("discovery must not run after an exact transcript succeeds")
            },
        )
        .expect("exact transcript should load")
        .expect("exact transcript should be present");

        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].session_id, "managed");
    }

    #[test]
    fn healthy_discovery_recovers_an_unreadable_exact_candidate() {
        let chunks = load_native_transcript_candidate(
            "managed",
            "claude-code:native",
            || Err("exact parse failed".to_string()),
            || Ok(Some(one_chunk("imported"))),
        )
        .expect("discovery transcript should recover exact failure")
        .expect("discovery transcript should be present");

        assert_eq!(chunks[0].session_id, "managed");
    }

    #[test]
    fn unreadable_native_candidate_fails_closed_instead_of_falling_back() {
        let error = load_native_transcript_candidate(
            "managed",
            "codex:native",
            || Err("invalid jsonl".to_string()),
            || Ok(None),
        )
        .expect_err("an unreadable native file must not fall back to DB chunks");

        assert!(error.contains("invalid jsonl"));
    }

    #[test]
    fn absent_native_candidates_allow_the_legacy_fallback() {
        let chunks =
            load_native_transcript_candidate("managed", "codex:native", || Ok(None), || Ok(None))
                .expect("absence is not a read failure");

        assert!(chunks.is_none());
    }

    #[test]
    fn indexed_codex_reads_follow_current_generation_and_never_replay_stale_imports() {
        use serde_json::json;
        use std::{fs, path::Path};

        let sandbox = crate::test_utils::test_env::sandbox();
        let native_id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
        for managed in [false, true] {
            let sid = format!("cliagent-indexed-replay-{managed}");
            let account = (!managed).then_some("indexed-account");
            let params = serde_json::from_value(json!({
                "platform": "codex", "accountId": account, "repoPath": sandbox.path(),
                "model": "fixture-model", "keySource": "own_key"
            }))
            .unwrap();
            persistence::create_session_with_source(
                &sid,
                &params,
                managed.then_some("test:workspace"),
            )
            .unwrap();
            persistence::update_cli_session_id_for_account(&sid, account, native_id).unwrap();
            let conn = database::db::get_connection().unwrap();
            conn.execute(
                "UPDATE code_sessions SET transcript_source='native' WHERE session_id=?1",
                [&sid],
            )
            .unwrap();
            let home = if managed {
                agent_cli::managed_config::launch::native_home(&sid).unwrap()
            } else {
                app_paths::native_transcript_home_dir().join(".codex")
            };
            fs::create_dir_all(home.join("sessions")).unwrap();
            let old = home
                .join("sessions")
                .join(format!("rollout-{native_id}.jsonl"));
            let current = home.join("sessions/rollout-bbbbbbbb-cccc-4ddd-8eee-ffffffffffff.jsonl");
            let write = |path: &Path, text: &str| {
                fs::write(path, format!("{}\n{}\n{}\n",
                    json!({"type":"session_meta","payload":{"id":native_id,"cwd":sandbox.path()}}),
                    json!({"type":"turn_context","payload":{}}),
                    json!({"type":"event_msg","payload":{"type":"user_message","message":text}}),
                )).unwrap();
            };
            write(&old, "stale-import-content");
            write(&current, "fresh-native-content");
            assert_eq!(
                fs::metadata(&old).unwrap().len(),
                fs::metadata(&current).unwrap().len()
            );
            let same_time = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1);
            fs::File::open(&old)
                .unwrap()
                .set_modified(same_time)
                .unwrap();
            fs::File::open(&current)
                .unwrap()
                .set_modified(same_time)
                .unwrap();
            conn.execute(
                "INSERT OR REPLACE INTO imported_history_session_cache (source, source_session_id, session_id, source_path) VALUES ('codex_app', ?1, ?2, ?3)",
                rusqlite::params![native_id, format!("codex:{native_id}"), old.to_string_lossy()],
            ).unwrap();
            let index = rusqlite::Connection::open(home.join("state_5.sqlite")).unwrap();
            index
                .execute_batch(
                    "CREATE TABLE threads(id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL)",
                )
                .unwrap();
            index
                .execute(
                    "INSERT INTO threads VALUES (?1, ?2)",
                    rusqlite::params![native_id, old.to_string_lossy()],
                )
                .unwrap();
            let old_revision = load_cli_transcript_revision(&sid)
                .unwrap()
                .revision
                .unwrap();
            assert!(serde_json::to_string(&load_session_chunks(&sid).unwrap())
                .unwrap()
                .contains("stale-import-content"));
            index
                .execute(
                    "UPDATE threads SET rollout_path=?1 WHERE id=?2",
                    rusqlite::params![current.to_string_lossy(), native_id],
                )
                .unwrap();
            for _ in 0..2 {
                let chunks = serde_json::to_string(&load_session_chunks(&sid).unwrap()).unwrap();
                assert!(chunks.contains("fresh-native-content"));
                assert!(!chunks.contains("stale-import-content"));
                assert_ne!(
                    load_cli_transcript_revision(&sid)
                        .unwrap()
                        .revision
                        .unwrap(),
                    old_revision
                );
                let location = load_cli_transcript_location(&sid).unwrap().path.unwrap();
                assert_eq!(
                    fs::canonicalize(location).unwrap(),
                    fs::canonicalize(&current).unwrap()
                );
                assert_eq!(
                    fs::canonicalize(
                        super::super::history::native_history_path(&sid)
                            .unwrap()
                            .unwrap()
                            .1
                    )
                    .unwrap(),
                    fs::canonicalize(&current).unwrap(),
                );
            }
            // Even a readable stale import must never rescue index failure.
            for invalid in ["missing-row", "missing-file", "unreadable-file"] {
                match invalid {
                    "missing-row" => {
                        index.execute("DELETE FROM threads", []).unwrap();
                    }
                    "missing-file" => {
                        index
                            .execute(
                                "INSERT INTO threads VALUES (?1, ?2)",
                                rusqlite::params![
                                    native_id,
                                    home.join("sessions/missing.jsonl").to_string_lossy()
                                ],
                            )
                            .unwrap();
                    }
                    _ => {
                        index
                            .execute(
                                "UPDATE threads SET rollout_path=?1",
                                [current.to_string_lossy().as_ref()],
                            )
                            .unwrap();
                        fs::write(&current, b"\xff\n").unwrap();
                    }
                }
                assert!(load_session_chunks(&sid).is_err(), "{managed}/{invalid}");
                let mut events = Vec::new();
                assert!(
                    super::super::history::visit_cli_history(&sid, &mut |batch| {
                        events.extend(batch);
                        Ok(())
                    })
                    .is_err()
                );
                if invalid != "unreadable-file" {
                    assert!(load_cli_transcript_revision(&sid).is_err());
                    assert!(load_cli_transcript_location(&sid).is_err());
                    assert!(super::super::history::native_history_path(&sid).is_err());
                }
            }
            fs::write(&current, b"").unwrap();
            assert!(
                load_session_chunks(&sid).unwrap().is_empty(),
                "empty authority must not replay stale history"
            );
        }
    }
}

/// Where a managed session's transcript of record lives, for display
/// surfaces (session hover card storage row).
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliTranscriptLocation {
    /// True when the transcript lives in the CLI's native store
    /// (`code_sessions.transcript_source = 'native'`), not `sessions.db`.
    pub native: bool,
    /// Resolved native store path (e.g. a Codex rollout jsonl). Indexed Codex
    /// stores use the current SQLite row; legacy stores use discovery.
    /// `None` for chunks-mode sessions or an unavailable native binding.
    pub path: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliTranscriptRevision {
    /// False for legacy DB-chunk sessions, which have no provider file.
    native: bool,
    /// Opaque provider-file-set or proven unstarted-child token. `None` for
    /// unavailable/ambiguous native history; that snapshot is not stable.
    revision: Option<String>,
}

fn cached_native_transcript_path(
    conn: &rusqlite::Connection,
    source: &str,
    native_id: &str,
) -> Result<Option<String>, String> {
    orgtrack_core::sources::imported_history::cache::get_cached_source_path_from_conn(
        conn, source, native_id,
    )
    .and_then(|path| {
        if path.is_some() {
            Ok(path)
        } else {
            orgtrack_core::sources::imported_history::cache::
                get_cached_source_path_by_suffix_from_conn(conn, source, native_id)
        }
    })
}

fn load_cli_transcript_revision(session_id: &str) -> Result<CliTranscriptRevision, String> {
    use super::super::native_transcript;

    let legacy = || CliTranscriptRevision {
        native: false,
        revision: None,
    };
    let unavailable = || CliTranscriptRevision {
        native: true,
        revision: None,
    };

    let Some(session) =
        persistence::get_session(session_id).map_err(|error| format!("DB error: {error}"))?
    else {
        return Ok(legacy());
    };
    if session.transcript_source != native_transcript::TRANSCRIPT_SOURCE_NATIVE {
        return Ok(legacy());
    }
    let Some(binding) = session
        .cli_agent_type
        .as_deref()
        .and_then(key_vault::key_store::ModelType::from_str)
        .and_then(|agent| native_transcript::native_transcript_binding(&agent))
    else {
        return Ok(unavailable());
    };
    let account_id = session
        .account_id
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    let Some(native_id) = persistence::get_cli_session_id_for_account(session_id, account_id)
        .map_err(|error| format!("read native binding for {session_id}: {error}"))?
    else {
        return Ok(CliTranscriptRevision {
            native: true,
            revision: persistence::unstarted_native_child_revision(session_id)
                .map_err(|error| format!("read unstarted native child {session_id}: {error}"))?,
        });
    };

    if super::super::native_materializer::has_indexed_codex_transcript(&session)? {
        return Ok(CliTranscriptRevision {
            native: true,
            revision: super::super::native_materializer::materialized_cli_transcript_revision(
                &session, &native_id,
            )?,
        });
    }

    let exact_revision = super::super::native_materializer::materialized_cli_transcript_revision(
        &session, &native_id,
    )
    .ok()
    .flatten();

    let discovery_revision = database::db::get_connection()
        .ok()
        .and_then(|conn| {
            cached_native_transcript_path(&conn, binding.source, &native_id)
                .ok()
                .flatten()
        })
        .map(std::path::PathBuf::from)
        .filter(|path| path.is_file())
        .and_then(|path| native_transcript_revision(&path).ok());
    // The transcript reader tries the exact materialized path and then its
    // imported-history discovery path. Track both candidates: if the exact
    // file is unreadable and replay falls back to discovery, an external App
    // append to either possible source still invalidates the snapshot.
    let revision = if exact_revision.is_none() && discovery_revision.is_none() {
        None
    } else {
        Some(
            serde_json::to_string(&("native-file-set-v1", exact_revision, discovery_revision))
                .map_err(|error| format!("serialize native transcript revision: {error}"))?,
        )
    };
    Ok(CliTranscriptRevision {
        native: true,
        revision,
    })
}

/// Return the provider-file-set revision through the same native binding and
/// path resolution used by transcript replay. The token is opaque to
/// TypeScript; callers may only compare it for equality around a canonical
/// read.
#[tauri::command]
pub async fn cli_agent_transcript_revision(
    session_id: String,
) -> Result<CliTranscriptRevision, String> {
    tokio::task::spawn_blocking(move || load_cli_transcript_revision(&session_id))
        .await
        .map_err(|error| format!("Task error: {error}"))?
}

/// Resolve the storage location of a session's transcript of record.
/// Chunks-mode sessions report `native: false`. Indexed Codex sessions report
/// their authoritative native path; other native sessions use discovery.
#[tauri::command]
pub async fn cli_agent_transcript_path(
    session_id: String,
) -> Result<CliTranscriptLocation, String> {
    tokio::task::spawn_blocking(move || load_cli_transcript_location(&session_id))
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

fn load_cli_transcript_location(session_id: &str) -> Result<CliTranscriptLocation, String> {
    use super::super::native_transcript;
    let session = persistence::get_session(session_id).map_err(|e| format!("DB error: {}", e))?;
    let is_native = session.as_ref().is_some_and(|session| {
        session.transcript_source == native_transcript::TRANSCRIPT_SOURCE_NATIVE
    });
    if !is_native {
        return Ok(CliTranscriptLocation {
            native: false,
            path: None,
        });
    }
    if let Some(session) = session.as_ref() {
        if super::super::native_materializer::has_indexed_codex_transcript(session)? {
            let path = match native_transcript::current_native_store_key_for_session(session)? {
                Some((_, native_id)) => Some(
                    super::super::native_materializer::materialized_cli_transcript_path(
                        session, &native_id,
                    )?
                    .ok_or("Indexed Codex transcript is unavailable")?
                    .1
                    .to_string_lossy()
                    .into_owned(),
                ),
                None => None,
            };
            return Ok(CliTranscriptLocation { native: true, path });
        }
    }
    // Native session with no bound CLI id yet (first turn still running,
    // or crash before bind): native, but no path to show.
    let Some((binding, cli_session_id)) =
        native_transcript::native_store_key_for_managed_session(session_id)
    else {
        return Ok(CliTranscriptLocation {
            native: true,
            path: None,
        });
    };
    let conn = database::db::get_connection()
        .map_err(|err| format!("Failed to open orgtrack source cache DB: {err}"))?;
    // Exact match first; Codex caches key on the rollout file stem, which
    // only the `-`-bounded suffix variant matches.
    let path = cached_native_transcript_path(&conn, binding.source, &cli_session_id)?;
    Ok(CliTranscriptLocation { native: true, path })
}

/// A failed first turn in native mode may leave no readable transcript at
/// all; a synthesized user bubble beats a blank chat.
fn synthesized_user_message_chunk(session: &CodeSession) -> Option<ActivityChunk> {
    let user_input = session.user_input.as_deref()?.trim();
    if user_input.is_empty() {
        return None;
    }
    let mut chunk = ActivityChunk::new(&session.session_id, "raw", "user_message");
    chunk.chunk_id = format!("user-input-{}-synthesized", session.session_id);
    chunk.created_at = session.created_at.clone();
    chunk.result = serde_json::json!({
        "type": "user",
        "message": { "content": user_input, "role": "user" }
    });
    Some(chunk)
}

/// Load persisted chunks for a session (for resume/session switch).
/// Native-transcript sessions route through the imported-history loaders;
/// everything else (and every fallback) reads legacy `code_session_chunks`.
#[tauri::command]
pub async fn cli_agent_chunks(session_id: String) -> Result<Vec<ActivityChunk>, String> {
    tracing::info!(
        "[cli_agent_chunks] Loading chunks for session: {}",
        session_id
    );
    let result = tokio::task::spawn_blocking(move || load_session_chunks(&session_id))
        .await
        .map_err(|e| format!("Task error: {}", e))?;

    match &result {
        Ok(chunks) => {
            tracing::info!("[cli_agent_chunks] Loaded {} chunks", chunks.len())
        }
        Err(ref err) => tracing::error!("[cli_agent_chunks] Failed: {}", err),
    }
    result
}

pub(crate) fn load_session_chunks(session_id: &str) -> Result<Vec<ActivityChunk>, String> {
    let session = persistence::get_session(session_id).map_err(|e| format!("DB error: {}", e))?;
    if let Some(session) = session.as_ref() {
        if let Some(mut chunks) = load_native_transcript_chunks(session)? {
            if let Some(catalog) = persistence::load_native_commands_for_provider(
                session_id,
                session.cli_agent_type.as_deref().unwrap_or_default(),
            )? {
                chunks.insert(0, catalog);
            }
            return Ok(chunks);
        }
    }
    let chunks = persistence::load_chunks(session_id).map_err(|e| format!("DB error: {}", e))?;
    if chunks.is_empty() {
        if let Some(chunk) = session
            .as_ref()
            .filter(|session| {
                session.transcript_source
                    == super::super::native_transcript::TRANSCRIPT_SOURCE_NATIVE
            })
            .and_then(synthesized_user_message_chunk)
        {
            return Ok(vec![chunk]);
        }
    }
    Ok(chunks)
}

/// Truncate chunks at and after a specific timestamp.
/// Used for message editing — removes chunks at or after the given timestamp,
/// kills the running agent, clears CLI resume state, and optionally restores file snapshots.
#[tauri::command]
pub async fn cli_agent_truncate_after_chunk(
    session_id: String,
    created_at: String,
    revert_files: Option<bool>,
) -> Result<i64, String> {
    let control_lock = session_runner::session_control_lock(&session_id).await;
    let _control_guard = control_lock.lock_owned().await;
    // Kill any running agent first to prevent it from writing new chunks
    session_runner::kill_running_agent(&session_id).await;
    let _identity_guard = session_runner::session_identity_lock(&session_id)
        .await
        .lock_owned()
        .await;
    // Wipe the Cursor config dir so the agent starts fresh — legacy chunk mode
    // ONLY. Under `transcript_source = 'native'` that directory IS the
    // transcript of record (hosted-key Cursor stores its chats under the
    // per-session config dir), so deleting it would erase the whole
    // conversation instead of truncating it. The fork is driven by
    // `clear_cli_resume_state_with_tx` inside the truncate below: with no
    // resume id the CLI opens a fresh conversation, and the superseded store
    // stays on disk hidden behind the native-transcript ledger — the same
    // semantics Claude/Codex native forks already have.
    if persistence::session_persists_chunks(&session_id) {
        session_runner::cleanup_cursor_config_dir(&session_id);
    }

    let should_revert_files = revert_files.unwrap_or(true);
    if should_revert_files {
        let rewind_sid = session_id.clone();
        let rewind_ts = created_at.clone();
        let stats = tokio::task::spawn_blocking(move || {
            agent_core::tools::file_history::rewind_to_message(&rewind_sid, &rewind_ts)
        })
        .await
        .map_err(|err| format!("Task error: {}", err))?
        .map_err(|err| format!("File history rewind failed: {}", err))?;

        tracing::info!(
            "[code_session] file-history rewind at {}: restored={} deleted={} skipped={} failed={}",
            created_at,
            stats.restored,
            stats.deleted,
            stats.skipped_unchanged,
            stats.failed,
        );
    }

    let sid = session_id.clone();
    let mutation_reason = if should_revert_files {
        agent_core::foundation::session_bridge::CLI_HISTORY_MUTATION_FILE_REWIND
    } else {
        agent_core::foundation::session_bridge::CLI_HISTORY_MUTATION_MESSAGE_TRUNCATE
    };
    tokio::task::spawn_blocking(move || {
        persistence::truncate_chunks_after_with_reason(&sid, &created_at, mutation_reason)
            .map_err(|e| format!("DB error: {}", e))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

#[cfg(test)]
#[path = "transcript_revision_tests.rs"]
mod transcript_revision_tests;
