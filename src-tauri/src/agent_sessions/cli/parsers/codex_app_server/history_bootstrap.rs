//! One-time native schema initialization and native default-model resolution.
//!
//! This never sends turn/start: a private disposable thread acquires one raw
//! user item through the supported injection API, then is permanently deleted.
//! Native Codex owns schema creation. The operation and its private directory
//! are durable BEFORE thread/start. A lost reply retains that ownership fence;
//! recovery never retries a creation whose outcome is unknown.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use agent_cli::managed_config::native_app::codex_history::configured_route;
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::catalog::{request, with_rpc_command};

const JOURNAL: &str = ".org2-history-bootstrap.json";
const WORK_PREFIX: &str = "org2-history-bootstrap-";
const OWNER_MARKER: &str = ".org2-bootstrap-owner";
const BOOTSTRAP_TEXT: &str = "ORG2 temporary native history store initialization";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ResolvedCodexHistoryRoute {
    pub model: String,
    pub provider: String,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct OwnedThread {
    version: u8,
    /// Empty only in a v2 journal whose thread/start outcome is unknown.
    id: String,
    cwd: PathBuf,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    operation_id: Option<String>,
}

/// Read-only target route resolution. An omitted native model is not permission
/// to borrow a package model or create a probe in the primary home. Callers may
/// supply a default only when matching binary/provider evidence established it.
pub(crate) fn resolve_target_route(
    home: &Path,
    verified_default: Option<&ResolvedCodexHistoryRoute>,
) -> Result<ResolvedCodexHistoryRoute, String> {
    let (model, provider) = configured_route(home)?;
    let model = model.or_else(|| {
        verified_default
            .filter(|route| route.provider == provider)
            .map(|route| route.model.clone())
    });
    Ok(ResolvedCodexHistoryRoute {
        model: route_token(model.as_deref()).map_err(|_| "target_route_unknown")?,
        provider: route_token(Some(&provider))?,
    })
}

fn marker_identity(owned: &OwnedThread) -> &str {
    owned.operation_id.as_deref().unwrap_or(&owned.id)
}

fn regular(path: &Path, missing: bool) -> Result<(), String> {
    if !path.is_absolute()
        || path
            .components()
            .any(|part| part == std::path::Component::ParentDir)
    {
        return Err("Invalid native Codex bootstrap path".into());
    }
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err("Native Codex bootstrap paths must not be symbolic links".into())
            }
            Ok(_) => {}
            Err(error) if missing && error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Inspect native Codex bootstrap path: {error}")),
        }
    }
    Ok(())
}

fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    regular(path, false)?;
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|error| error.to_string())?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("Native Codex bootstrap input exceeds its size limit".into());
    }
    Ok(bytes)
}

fn route_token(value: Option<&str>) -> Result<String, String> {
    value
        .filter(|value| {
            !value.is_empty() && value.len() <= 256 && !value.chars().any(char::is_control)
        })
        .map(str::to_owned)
        .ok_or_else(|| "Native Codex returned an invalid model/provider".into())
}

fn sync_directory(path: &Path) -> Result<(), String> {
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("Sync native Codex bootstrap directory: {error}"))
}

fn write_marker(owned: &OwnedThread) -> Result<(), String> {
    let mut marker = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(owned.cwd.join(OWNER_MARKER))
        .map_err(|error| error.to_string())?;
    marker
        .write_all(marker_identity(owned).as_bytes())
        .map_err(|error| error.to_string())?;
    marker.sync_all().map_err(|error| error.to_string())?;
    sync_directory(&owned.cwd)
}

fn write_owned(home: &Path, owned: &OwnedThread) -> Result<(), String> {
    let path = home.join(JOURNAL);
    regular(&path, true)?;
    let mut temporary = tempfile::NamedTempFile::new_in(home).map_err(|error| error.to_string())?;
    serde_json::to_writer(&mut temporary, owned).map_err(|error| error.to_string())?;
    temporary
        .as_file_mut()
        .flush()
        .map_err(|error| error.to_string())?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    temporary
        .persist(&path)
        .map_err(|error| error.to_string())?;
    sync_directory(home)
}

fn validate_owned_structure(home: &Path, owned: &OwnedThread) -> Result<(), String> {
    let identity_valid = match owned.version {
        1 => owned.operation_id.is_none() && uuid::Uuid::parse_str(&owned.id).is_ok(),
        2 => {
            owned
                .operation_id
                .as_deref()
                .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok())
                && (owned.id.is_empty() || uuid::Uuid::parse_str(&owned.id).is_ok())
        }
        _ => false,
    };
    if !identity_valid
        || owned.cwd.parent() != Some(home)
        || !owned
            .cwd
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|name| {
                name.starts_with(WORK_PREFIX)
                    && name.len() > WORK_PREFIX.len()
                    && name.len() <= 128
                    && name
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
            })
    {
        return Err("Invalid native Codex bootstrap ownership journal".into());
    }
    regular(&owned.cwd, true)?;
    Ok(())
}

fn validate_marker(owned: &OwnedThread) -> Result<(), String> {
    if read_bounded(&owned.cwd.join(OWNER_MARKER), 64)? != marker_identity(owned).as_bytes() {
        return Err("Native Codex bootstrap owner marker changed".into());
    }
    Ok(())
}

/// A start reply can be lost before its ID is journaled. The pre-RPC private cwd
/// is the only recovery lookup key. Zero rows is NOT proof no thread was made
/// (the native process may not have flushed yet); multiple rows is ambiguous.
/// Both retain cleanup_pending, with no second start or guessed deletion.
fn recover_started_identity(home: &Path, owned: &mut OwnedThread) -> Result<(), String> {
    validate_owned_structure(home, owned)?;
    if !owned.id.is_empty() {
        return Ok(());
    }
    validate_marker(owned)?;
    let path = home.join("state_5.sqlite");
    regular(&path, true)?;
    if !path.is_file() {
        return Err("cleanup_pending: native Codex start outcome is unknown".into());
    }
    let database = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("Inspect native Codex bootstrap ownership: {error}"))?;
    database
        .busy_timeout(Duration::from_millis(200))
        .map_err(|error| error.to_string())?;
    let mut statement = database
        .prepare("SELECT id FROM threads WHERE cwd = ?1 LIMIT 2")
        .map_err(|error| format!("Inspect native Codex bootstrap directory: {error}"))?;
    let ids = statement
        .query_map(
            [owned.cwd.to_str().ok_or("Invalid bootstrap directory")?],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    if ids.len() != 1 || uuid::Uuid::parse_str(&ids[0]).is_err() {
        return Err("cleanup_pending: native Codex start identity cannot be proven".into());
    }
    owned.id = ids[0].clone();
    write_owned(home, owned)
}

/// Read only our recorded ID. Injected threads are intentionally hidden by
/// thread/list until their first real turn, so listing cannot prove absence.
fn stored_owned(home: &Path, owned: &OwnedThread) -> Result<bool, String> {
    let path = home.join("state_5.sqlite");
    regular(&path, true)?;
    if !path.exists() {
        return Ok(false);
    }
    let database = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("Inspect native Codex bootstrap ownership: {error}"))?;
    database
        .busy_timeout(Duration::from_millis(200))
        .map_err(|error| error.to_string())?;
    let cwd: Option<String> = database
        .query_row(
            "SELECT cwd FROM threads WHERE id = ?1",
            [&owned.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Inspect native Codex bootstrap thread: {error}"))?;
    match cwd {
        Some(cwd) if Path::new(&cwd) != owned.cwd => {
            Err("Native Codex bootstrap thread belongs to a different directory".into())
        }
        Some(_) => Ok(true),
        None => Ok(false),
    }
}

fn remove_owned_files(home: &Path, owned: &OwnedThread) -> Result<(), String> {
    // Cleanup is restartable after any unlink. Never recursively delete, and
    // only permit an empty directory or our exact owner marker.
    if owned.cwd.exists() {
        let entries = fs::read_dir(&owned.cwd)
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        if entries.len() > 1
            || entries
                .first()
                .is_some_and(|entry| entry.file_name() != OWNER_MARKER)
        {
            return Err("Unexpected content in native Codex bootstrap directory".into());
        }
        if !entries.is_empty() {
            validate_marker(owned)?;
            fs::remove_file(owned.cwd.join(OWNER_MARKER)).map_err(|error| error.to_string())?;
            sync_directory(&owned.cwd)?;
        }
        fs::remove_dir(&owned.cwd).map_err(|error| error.to_string())?;
        sync_directory(home)?;
    }
    let journal = home.join(JOURNAL);
    if journal.exists() {
        fs::remove_file(journal).map_err(|error| error.to_string())?;
        sync_directory(home)?;
    }
    Ok(())
}

fn delete_owned(
    rpc: &mut impl FnMut(&str, Value) -> Result<Value, String>,
    home: &Path,
    owned: &OwnedThread,
    live: bool,
) -> Result<(), String> {
    validate_owned_structure(home, owned)?;
    if owned.id.is_empty() {
        return Err("cleanup_pending: native Codex start identity cannot be proven".into());
    }
    let stored = stored_owned(home, owned)?;
    if stored {
        // Both fresh and recovered identities retain the same durable marker.
        // A changed marker is never permission to remove user-owned data.
        validate_marker(owned)?;
        let result = rpc(
            "thread/read",
            json!({"threadId":owned.id,"includeTurns":false}),
        )?;
        if result["thread"]["id"].as_str() != Some(owned.id.as_str())
            || result["thread"]["cwd"].as_str().map(Path::new) != Some(owned.cwd.as_path())
        {
            return Err("Native Codex bootstrap thread identity changed".into());
        }
    }
    if stored || live {
        // thread/delete supports loaded threads; no unload/closing race is needed.
        rpc("thread/delete", json!({"threadId":owned.id}))?;
        if stored_owned(home, owned)? {
            return Err("Native Codex did not remove its bootstrap thread".into());
        }
    }
    remove_owned_files(home, owned)
}

/// Caller holds its profile/configuration barrier and supplies the active owner
/// fence. Call from a blocking worker, never from a Tokio async executor thread.
pub(crate) fn prepare_history_store(
    runtime_binary: &Path,
    home: &Path,
    check: impl Fn() -> Result<(), String>,
) -> Result<ResolvedCodexHistoryRoute, String> {
    check()?;
    regular(home, false)?;
    let history = home.join("thread_history_1.sqlite");
    regular(&history, true)?;
    let configured = configured_route(home)?;
    let journal = home.join(JOURNAL);
    regular(&journal, true)?;
    if history.is_file() && !journal.exists() {
        if let Some(model) = &configured.0 {
            return Ok(ResolvedCodexHistoryRoute {
                model: model.clone(),
                provider: configured.1.clone(),
            });
        }
    }
    let lock_path = home.join(".org2-history-bootstrap.lock");
    regular(&lock_path, true)?;
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(lock_path)
        .map_err(|error| error.to_string())?;
    fs2::FileExt::try_lock_exclusive(&lock)
        .map_err(|_| "Native Codex history initialization is already in progress")?;
    check()?;
    // Prove a lost start reply's identity without launching another process.
    // Missing/ambiguous native state remains pending, never a new thread/start.
    read_pending(home)?;
    check()?;
    with_rpc_command(runtime_binary, home, home, |runtime, client| {
        bootstrap_with_rpc(home, configured, &check, |method, params| {
            request(runtime, client, method, params)
        })
    })
}

fn read_pending(home: &Path) -> Result<Option<OwnedThread>, String> {
    let journal = home.join(JOURNAL);
    regular(&journal, true)?;
    if !journal.exists() {
        return Ok(None);
    }
    let mut owned: OwnedThread = serde_json::from_slice(&read_bounded(&journal, 16 * 1024)?)
        .map_err(|_| "Invalid native Codex bootstrap journal")?;
    recover_started_identity(home, &mut owned)?;
    Ok(Some(owned))
}

fn bootstrap_with_rpc(
    home: &Path,
    configured: (Option<String>, String),
    check: &impl Fn() -> Result<(), String>,
    mut request_rpc: impl FnMut(&str, Value) -> Result<Value, String>,
) -> Result<ResolvedCodexHistoryRoute, String> {
    check()?;
    let mut rpc = |method: &str, params: Value| {
        check()?;
        request_rpc(method, params)
    };
    if let Some(owned) = read_pending(home)? {
        delete_owned(&mut rpc, home, &owned, false)
            .map_err(|error| format!("Recover native Codex bootstrap {}: {error}", owned.id))?;
    }
    check()?;
    let history = home.join("thread_history_1.sqlite");
    let missing_history = !history.is_file();
    if !missing_history {
        if let Some(model) = &configured.0 {
            return Ok(ResolvedCodexHistoryRoute {
                model: model.clone(),
                provider: configured.1,
            });
        }
    }
    let directory = tempfile::Builder::new()
        .prefix(WORK_PREFIX)
        .tempdir_in(home)
        .map_err(|error| error.to_string())?;
    let mut owned = OwnedThread {
        version: 2,
        id: String::new(),
        cwd: directory.path().to_owned(),
        operation_id: Some(uuid::Uuid::new_v4().to_string()),
    };
    write_marker(&owned)?;
    write_owned(home, &owned)?;
    // Once the journal is durable, even a crash before send is conservatively
    // an unknown outcome. Dropping TempDir must no longer remove its evidence.
    let _ = directory.keep();
    check()?;
    let started = rpc(
        "thread/start",
        json!({
            "cwd":owned.cwd,"historyMode":"paginated","ephemeral":false,
            "approvalPolicy":"on-request","sandbox":"read-only"
        }),
    )
    .map_err(|error| {
        format!("cleanup_pending: native Codex thread/start outcome is unknown: {error}")
    })?;
    owned.id = started["thread"]["id"]
        .as_str()
        .filter(|id| uuid::Uuid::parse_str(id).is_ok())
        .ok_or("cleanup_pending: native Codex bootstrap returned no valid owned thread ID")?
        .to_owned();
    // The operation marker is stable across this update. Losing the update
    // leaves the pre-start journal recoverable by its exact private directory.
    write_owned(home, &owned)?;
    let operation = (|| {
        let route = ResolvedCodexHistoryRoute {
            model: route_token(started["model"].as_str())?,
            provider: route_token(started["modelProvider"].as_str())?,
        };
        if route.provider != configured.1
            || configured
                .0
                .as_ref()
                .is_some_and(|model| *model != route.model)
        {
            return Err("Native Codex resolved a different configured route".into());
        }
        check()?;
        if missing_history {
            rpc(
                "thread/inject_items",
                json!({"threadId":owned.id,"items":[{
                    "type":"message","role":"user","content":[{"type":"input_text","text":BOOTSTRAP_TEXT}]
                }]}),
            )?;
            regular(&history, false)?;
            if !history.is_file() {
                return Err("Native Codex did not initialize its history database".into());
            }
        }
        check()?;
        Ok(route)
    })();
    let cleanup = check().and_then(|()| delete_owned(&mut rpc, home, &owned, true));
    match (operation, cleanup) {
        (Ok(route), Ok(())) => Ok(route),
        (Err(error), Ok(())) => Err(error),
        (result, Err(cleanup)) => Err(format!(
            "{}; cleanup_pending: native Codex bootstrap {}: {cleanup}",
            result
                .err()
                .unwrap_or_else(|| "Native Codex bootstrap completed".into()),
            owned.id
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn configured() -> (Option<String>, String) {
        (Some("fixture-model".into()), "orgii".into())
    }

    fn read_journal(home: &Path) -> OwnedThread {
        serde_json::from_slice(&fs::read(home.join(JOURNAL)).unwrap()).unwrap()
    }

    fn persist_native_thread(home: &Path, id: &str, cwd: &Path) {
        let database = Connection::open(home.join("state_5.sqlite")).unwrap();
        database
            .execute(
                "CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, cwd TEXT NOT NULL)",
                [],
            )
            .unwrap();
        database
            .execute(
                "INSERT INTO threads VALUES (?1, ?2)",
                [id, cwd.to_str().unwrap()],
            )
            .unwrap();
    }

    #[test]
    fn lost_start_reply_retains_pre_rpc_evidence_and_never_retries_creation() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().canonicalize().unwrap();
        let error = bootstrap_with_rpc(&home, configured(), &|| Ok(()), |method, params| {
            assert_eq!(method, "thread/start");
            let pending = read_journal(&home);
            assert_eq!(pending.version, 2);
            assert!(pending.id.is_empty());
            assert_eq!(params["cwd"], json!(pending.cwd));
            validate_marker(&pending).unwrap();
            Err("lost start response".into())
        })
        .unwrap_err();
        assert!(error.contains("cleanup_pending"));
        let before = fs::read(home.join(JOURNAL)).unwrap();
        assert!(bootstrap_with_rpc(&home, configured(), &|| Ok(()), |_, _| {
            panic!("unknown start outcome must not send another RPC")
        })
        .unwrap_err()
        .contains("cleanup_pending"));
        assert_eq!(before, fs::read(home.join(JOURNAL)).unwrap());
        validate_marker(&read_journal(&home)).unwrap();
    }

    #[test]
    fn lost_start_reply_recovers_only_the_unique_private_cwd() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().canonicalize().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let unrelated = uuid::Uuid::new_v4().to_string();
        persist_native_thread(&home, &unrelated, &home.join("real-user-project"));
        bootstrap_with_rpc(&home, configured(), &|| Ok(()), |method, _| {
            assert_eq!(method, "thread/start");
            let pending = read_journal(&home);
            persist_native_thread(&home, &id, &pending.cwd);
            fs::write(
                home.join("thread_history_1.sqlite"),
                b"native schema fixture",
            )
            .unwrap();
            Err("lost start response".into())
        })
        .unwrap_err();
        let pending = read_journal(&home);
        let mut calls = Vec::new();
        bootstrap_with_rpc(&home, configured(), &|| Ok(()), |method, params| {
            calls.push(method.to_owned());
            assert_eq!(params["threadId"], id);
            match method {
                "thread/read" => Ok(json!({"thread":{"id":id,"cwd":pending.cwd}})),
                "thread/delete" => {
                    Connection::open(home.join("state_5.sqlite"))
                        .unwrap()
                        .execute("DELETE FROM threads WHERE id=?1", [&id])
                        .unwrap();
                    Ok(json!({}))
                }
                _ => panic!("recovery must not create or inject: {method}"),
            }
        })
        .unwrap();
        assert_eq!(calls, ["thread/read", "thread/delete"]);
        assert!(!home.join(JOURNAL).exists());
        assert!(!pending.cwd.exists());
        let remaining: String = Connection::open(home.join("state_5.sqlite"))
            .unwrap()
            .query_row("SELECT id FROM threads", [], |row| row.get(0))
            .unwrap();
        assert_eq!(remaining, unrelated);
    }

    #[test]
    fn ambiguous_or_changed_ownership_never_authorizes_cleanup() {
        for changed_marker in [false, true] {
            let temp = tempfile::tempdir().unwrap();
            let home = temp.path().canonicalize().unwrap();
            bootstrap_with_rpc(&home, configured(), &|| Ok(()), |_, _| {
                Err("lost start response".into())
            })
            .unwrap_err();
            let pending = read_journal(&home);
            persist_native_thread(&home, &uuid::Uuid::new_v4().to_string(), &pending.cwd);
            if changed_marker {
                fs::write(pending.cwd.join(OWNER_MARKER), "not-owned").unwrap();
            } else {
                persist_native_thread(&home, &uuid::Uuid::new_v4().to_string(), &pending.cwd);
            }
            assert!(bootstrap_with_rpc(&home, configured(), &|| Ok(()), |_, _| {
                panic!("ambiguous ownership must not send RPC")
            })
            .is_err());
            assert!(home.join(JOURNAL).is_file());
            assert!(pending.cwd.is_dir());
        }
    }

    #[test]
    fn owner_loss_after_start_preserves_the_returned_identity_without_injection() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().canonicalize().unwrap();
        let lost = std::cell::Cell::new(false);
        let id = uuid::Uuid::new_v4().to_string();
        let error = bootstrap_with_rpc(
            &home,
            configured(),
            &|| {
                if lost.get() {
                    Err("owner changed".into())
                } else {
                    Ok(())
                }
            },
            |method, _| {
                assert_eq!(method, "thread/start");
                lost.set(true);
                Ok(json!({"thread":{"id":id},"model":"fixture-model","modelProvider":"orgii"}))
            },
        )
        .unwrap_err();
        assert!(error.contains("owner changed"));
        assert_eq!(read_journal(&home).id, id);
        validate_marker(&read_journal(&home)).unwrap();
    }

    #[test]
    fn lost_delete_reply_is_recovered_without_creating_or_reinjecting() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().canonicalize().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let mut calls = Vec::new();
        let result = bootstrap_with_rpc(&home, configured(), &|| Ok(()), |method, _| {
            calls.push(method.to_owned());
            let owned = read_journal(&home);
            match method {
                "thread/start" => {
                    persist_native_thread(&home, &id, &owned.cwd);
                    Ok(json!({"thread":{"id":id},"model":"fixture-model","modelProvider":"orgii"}))
                }
                "thread/inject_items" => {
                    fs::write(
                        home.join("thread_history_1.sqlite"),
                        b"native schema fixture",
                    )
                    .unwrap();
                    Ok(json!({}))
                }
                "thread/read" => Ok(json!({"thread":{"id":id,"cwd":owned.cwd}})),
                "thread/delete" => {
                    Connection::open(home.join("state_5.sqlite"))
                        .unwrap()
                        .execute("DELETE FROM threads WHERE id=?1", [&id])
                        .unwrap();
                    Err("lost delete response".into())
                }
                _ => panic!("unexpected RPC: {method}"),
            }
        });
        assert!(result.unwrap_err().contains("cleanup_pending"));
        assert_eq!(
            calls,
            [
                "thread/start",
                "thread/inject_items",
                "thread/read",
                "thread/delete"
            ]
        );
        bootstrap_with_rpc(&home, configured(), &|| Ok(()), |_, _| {
            panic!("cleanup already completed")
        })
        .unwrap();
        assert!(!home.join(JOURNAL).exists());
    }

    #[test]
    fn target_default_is_read_only_and_never_borrowed_from_another_provider() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().canonicalize().unwrap();
        assert!(resolve_target_route(&home, None)
            .unwrap_err()
            .contains("target_route_unknown"));
        let verified = ResolvedCodexHistoryRoute {
            model: "native-default".into(),
            provider: "openai".into(),
        };
        assert_eq!(
            resolve_target_route(&home, Some(&verified)).unwrap(),
            verified
        );
        assert_eq!(fs::read_dir(&home).unwrap().count(), 0);
        fs::write(home.join("config.toml"), "model_provider='orgii'\n").unwrap();
        assert!(resolve_target_route(&home, Some(&verified))
            .unwrap_err()
            .contains("target_route_unknown"));
        fs::write(
            home.join("config.toml"),
            "model_provider='orgii'\nmodel='explicit'\n",
        )
        .unwrap();
        assert_eq!(
            resolve_target_route(&home, Some(&verified)).unwrap().model,
            "explicit"
        );
        fs::write(home.join("config.toml"), "model='root-model'\nmodel_provider='orgii'\nprofile='native'\n[profiles.native]\nmodel='selected-model'\nmodel_provider='openai'\n").unwrap();
        assert_eq!(
            resolve_target_route(&home, Some(&verified)).unwrap(),
            ResolvedCodexHistoryRoute {
                model: "selected-model".into(),
                provider: "openai".into()
            }
        );
        fs::write(
            home.join("config.toml"),
            "model='root-model'\nprofile='missing'\n",
        )
        .unwrap();
        assert!(resolve_target_route(&home, None)
            .unwrap_err()
            .contains("target_route_unknown"));
    }

    #[test]
    fn existing_store_and_explicit_model_require_no_native_process() {
        let directory = tempfile::tempdir().unwrap();
        let home = directory.path().canonicalize().unwrap();
        fs::write(
            home.join("config.toml"),
            "model='gpt-6-astra'\nmodel_provider='orgii'\n",
        )
        .unwrap();
        fs::write(
            home.join("thread_history_1.sqlite"),
            b"checked by downstream schema adapter",
        )
        .unwrap();
        assert_eq!(
            prepare_history_store(Path::new("/not-launched/codex"), &home, || Ok(())).unwrap(),
            ResolvedCodexHistoryRoute {
                model: "gpt-6-astra".into(),
                provider: "orgii".into()
            }
        );
        assert!(!home.join(JOURNAL).exists());
        assert!(!home.join(".org2-history-bootstrap.lock").exists());
    }

    #[test]
    fn stale_owner_and_malformed_configuration_fail_before_native_launch() {
        let directory = tempfile::tempdir().unwrap();
        let home = directory.path().canonicalize().unwrap();
        assert_eq!(
            prepare_history_store(Path::new("/not-launched/codex"), &home, || Err(
                "owner changed".into()
            ))
            .unwrap_err(),
            "owner changed"
        );
        fs::write(home.join("config.toml"), "model=123").unwrap();
        assert!(prepare_history_store(Path::new("/not-launched/codex"), &home, || Ok(())).is_err());
        assert!(!home.join(".org2-history-bootstrap.lock").exists());
    }
    #[test]
    fn owned_cleanup_can_resume_after_marker_or_directory_was_removed() {
        for phase in 0..3 {
            let directory = tempfile::tempdir().unwrap();
            let home = directory.path().canonicalize().unwrap();
            let cwd = home.join("org2-history-bootstrap-recovery");
            let owned = OwnedThread {
                version: 1,
                operation_id: None,
                id: uuid::Uuid::new_v4().to_string(),
                cwd: cwd.clone(),
            };
            if phase < 2 {
                fs::create_dir(&cwd).unwrap();
            }
            if phase == 0 {
                write_marker(&owned).unwrap();
            }
            write_owned(&home, &owned).unwrap();
            validate_owned_structure(&home, &owned).unwrap();
            remove_owned_files(&home, &owned).unwrap();
            assert!(!home.join(JOURNAL).exists());
            assert!(!cwd.exists());
        }
    }

    #[test]
    fn cleanup_retains_unexpected_content_and_journal() {
        let directory = tempfile::tempdir().unwrap();
        let home = directory.path().canonicalize().unwrap();
        let cwd = home.join("org2-history-bootstrap-unexpected");
        fs::create_dir(&cwd).unwrap();
        let owned = OwnedThread {
            version: 1,
            operation_id: None,
            id: uuid::Uuid::new_v4().to_string(),
            cwd: cwd.clone(),
        };
        write_marker(&owned).unwrap();
        write_owned(&home, &owned).unwrap();
        fs::write(cwd.join("unrelated.txt"), "retain").unwrap();
        assert!(remove_owned_files(&home, &owned).is_err());
        assert!(home.join(JOURNAL).exists());
        assert_eq!(
            fs::read_to_string(cwd.join("unrelated.txt")).unwrap(),
            "retain"
        );
    }
}
