//! Durable continuation-output delivery with immutable capture receipts.
//! Canonical messages and auth tokens are never copied here.
mod snapshot_cache;
mod snapshot_chunks;
mod snapshots;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

const LEASE_MS: i64 = 5 * 60_000;
const MAX_BATCH: usize = 256;
static CAPTURE_SLOT: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);

pub fn init_tables(conn: &Connection) -> rusqlite::Result<()> {
    snapshots::init(conn)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS cloud_file_outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            identity TEXT NOT NULL,
            org_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            path TEXT NOT NULL,
            revision TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            next_attempt_at INTEGER NOT NULL DEFAULT 0,
            lease TEXT,
            last_outcome TEXT,
            UNIQUE(identity, org_id, session_id, path, revision)
        );
        CREATE INDEX IF NOT EXISTS cloud_file_outbox_due
            ON cloud_file_outbox(identity, next_attempt_at, id);",
    )
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    path: String,
    revision: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    id: i64,
    org_id: String,
    session_id: String,
    path: String,
    revision: String,
    lease: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Claim {
    job: Option<Job>,
    retry_at: Option<i64>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Uploaded,
    Retry,
    Quota,
    SourceUnavailable,
    CaptureFailed,
    Cancelled,
}

fn validate(value: &str, max: usize) -> Result<(), String> {
    if value.is_empty() || value.len() > max || value.contains('\0') {
        return Err("Invalid shared-file outbox field".into());
    }
    Ok(())
}

fn enqueue(
    conn: &Connection,
    identity: &str,
    org_id: &str,
    session_id: &str,
    candidates: &[Candidate],
) -> Result<(), String> {
    validate(identity, 2048)?;
    validate(org_id, 1024)?;
    validate(session_id, 1024)?;
    if candidates.len() > MAX_BATCH {
        return Err("Shared-file outbox IPC batch exceeds 256 items".into());
    }
    for candidate in candidates {
        validate(&candidate.path, 8192)?;
        validate(&candidate.revision, 1024)?;
    }
    let tx = database::begin_immediate(conn).map_err(|e| e.to_string())?;
    for candidate in candidates {
        tx.execute(
            "INSERT INTO cloud_file_outbox(identity, org_id, session_id, path, revision, next_attempt_at)
             VALUES (?1, ?2, ?3, ?4, ?5, COALESCE((SELECT MAX(next_attempt_at)
               FROM cloud_file_outbox WHERE identity = ?1 AND org_id = ?2 AND last_outcome = 'quota'), 0))
             ON CONFLICT DO NOTHING",
            params![identity, org_id, session_id, candidate.path, candidate.revision],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

fn claim(conn: &Connection, identity: &str, org_ids: &[String], now: i64) -> Result<Claim, String> {
    validate(identity, 2048)?;
    let orgs = serde_json::to_string(org_ids).map_err(|e| e.to_string())?;
    let tx = database::begin_immediate(conn).map_err(|e| e.to_string())?;
    let lease = uuid::Uuid::new_v4().to_string();
    let job = tx
        .query_row(
            "SELECT id, org_id, session_id, path, revision FROM cloud_file_outbox
         WHERE identity = ?1 AND next_attempt_at <= ?2
           AND org_id IN (SELECT value FROM json_each(?3))
         ORDER BY next_attempt_at, id LIMIT 1",
            params![identity, now, orgs],
            |row| {
                Ok(Job {
                    id: row.get(0)?,
                    org_id: row.get(1)?,
                    session_id: row.get(2)?,
                    path: row.get(3)?,
                    revision: row.get(4)?,
                    lease: lease.clone(),
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(job) = &job {
        tx.execute(
            "UPDATE cloud_file_outbox SET lease = ?1, next_attempt_at = ?2 WHERE id = ?3",
            params![lease, now + LEASE_MS, job.id],
        )
        .map_err(|e| e.to_string())?;
    }
    let retry_at = if job.is_none() {
        tx.query_row(
            "SELECT MIN(next_attempt_at) FROM cloud_file_outbox WHERE identity = ?1
             AND org_id IN (SELECT value FROM json_each(?2))",
            params![identity, orgs],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?
    } else {
        None
    };
    tx.commit().map_err(|e| e.to_string())?;
    Ok(Claim { job, retry_at })
}

fn settle(
    conn: &Connection,
    identity: &str,
    id: i64,
    lease: &str,
    outcome: Outcome,
    now: i64,
) -> Result<(), String> {
    // Releasing a large blob also walks SQLite pages; bound the whole transaction.
    snapshot_cache::bounded(conn, || {
        let tx = database::begin_immediate(conn).map_err(|e| e.to_string())?;
        let row: Option<(String, i64)> = tx.query_row(
        "SELECT org_id, attempts FROM cloud_file_outbox WHERE id = ?1 AND identity = ?2 AND lease = ?3",
        params![id, identity, lease], |row| Ok((row.get(0)?, row.get(1)?)),
    ).optional().map_err(|e| e.to_string())?;
        let Some((org_id, attempts)) = row else {
            return Ok(());
        };
        if matches!(outcome, Outcome::Uploaded | Outcome::CaptureFailed) {
            if matches!(outcome, Outcome::Uploaded) {
                snapshots::release(&tx, identity, id)?;
            }
            tx.execute("DELETE FROM cloud_file_outbox WHERE id = ?1", [id])
                .map_err(|e| e.to_string())?;
        } else {
            let (label, delay) = match outcome {
                Outcome::Cancelled => ("cancelled", 0),
                Outcome::Quota => ("quota", 30 * 60_000),
                Outcome::SourceUnavailable => ("source_unavailable", 30 * 60_000),
                Outcome::Retry => (
                    "retry",
                    (5_000_i64 * 2_i64.pow(attempts.clamp(0, 9) as u32)).min(30 * 60_000),
                ),
                Outcome::Uploaded | Outcome::CaptureFailed => unreachable!(),
            };
            tx.execute(
                "UPDATE cloud_file_outbox SET lease = NULL, next_attempt_at = ?1,
             attempts = MIN(attempts + ?2, 32), last_outcome = ?3 WHERE id = ?4",
                params![
                    now + delay,
                    i64::from(!matches!(outcome, Outcome::Cancelled)),
                    label,
                    id
                ],
            )
            .map_err(|e| e.to_string())?;
            if matches!(outcome, Outcome::Quota) {
                // Quota is organization-wide. Do not hammer it once for every file.
                tx.execute(
                "UPDATE cloud_file_outbox SET next_attempt_at = MAX(next_attempt_at, ?1), last_outcome = 'quota'
                 WHERE identity = ?2 AND org_id = ?3 AND lease IS NULL",
                params![now + delay, identity, org_id],
            ).map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())
    })
}

async fn run<T: Send + 'static>(
    operation: impl FnOnce(&Connection) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(move || {
        database::with_sessions_writer(|| {
            let conn = database::db::get_connection().map_err(|e| e.to_string())?;
            operation(&conn)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn cloud_file_outbox_enqueue(
    identity: String,
    org_id: String,
    session_id: String,
    candidates: Vec<Candidate>,
) -> Result<(), String> {
    validate(&identity, 2048)?;
    validate(&org_id, 1024)?;
    validate(&session_id, 1024)?;
    if candidates.len() > MAX_BATCH {
        return Err("Shared-file outbox IPC batch exceeds 256 items".into());
    }
    for candidate in &candidates {
        validate(&candidate.path, 8192)?;
        validate(&candidate.revision, 1024)?;
    }
    // Capture one file at a time outside the sessions writer lock. Persist a
    // terminal capture receipt even on failure; repeated publication must not
    // substitute a later version. Enqueue only after the receipt is durable.
    for candidate in &candidates {
        let (identity, org_id, session_id, candidate) = (
            identity.clone(),
            org_id.clone(),
            session_id.clone(),
            candidate.clone(),
        );
        let permit = CAPTURE_SLOT.acquire().await.map_err(|e| e.to_string())?;
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let conn = database::db::get_connection().map_err(|e| e.to_string())?;
            let scope = [identity.as_str(), org_id.as_str(), session_id.as_str()];
            if !snapshots::exists(&conn, &scope, &candidate)? {
                let captured = snapshots::capture(&candidate.path);
                database::with_sessions_writer(|| {
                    snapshot_cache::bounded(&conn, || {
                        snapshots::save(&conn, &scope, &candidate, captured)
                    })
                })?;
            }
            Ok::<_, String>(())
        })
        .await
        .map_err(|e| e.to_string())??;
    }
    run(move |conn| enqueue(conn, &identity, &org_id, &session_id, &candidates)).await
}

#[tauri::command]
pub async fn cloud_file_outbox_claim(
    identity: String,
    org_ids: Vec<String>,
) -> Result<Claim, String> {
    run(move |conn| {
        claim(
            conn,
            &identity,
            &org_ids,
            chrono::Utc::now().timestamp_millis(),
        )
    })
    .await
}

#[tauri::command]
pub async fn cloud_file_outbox_settle(
    identity: String,
    id: i64,
    lease: String,
    outcome: Outcome,
) -> Result<(), String> {
    run(move |conn| {
        settle(
            conn,
            &identity,
            id,
            &lease,
            outcome,
            chrono::Utc::now().timestamp_millis(),
        )
    })
    .await
}

#[cfg(test)]
mod tests;

#[tauri::command]
pub async fn cloud_file_snapshot_read(
    identity: String,
    org_id: String,
    session_id: String,
    candidate: Candidate,
) -> Result<snapshots::Snapshot, String> {
    tokio::task::spawn_blocking(move || {
        let conn = database::db::get_connection().map_err(|e| e.to_string())?;
        snapshots::read(&conn, &[&identity, &org_id, &session_id], &candidate)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn cloud_file_snapshot_read_chunk(
    identity: String,
    org_id: String,
    session_id: String,
    candidate: Candidate,
    offset: usize,
) -> Result<snapshot_chunks::SnapshotChunk, String> {
    tokio::task::spawn_blocking(move || {
        let conn = database::db::get_connection().map_err(|e| e.to_string())?;
        snapshot_cache::bounded(&conn, || {
            snapshot_chunks::read(
                &conn,
                &[&identity, &org_id, &session_id],
                &candidate,
                offset,
            )
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
