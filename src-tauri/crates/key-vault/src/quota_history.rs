//! Local, bounded observations of provider weekly quotas. Never stores credentials.
use chrono::Utc;
use rusqlite::{params, Connection};
use serde::Serialize;

use crate::types::QuotaInfo;

pub const HOUR: i64 = 3600;
const RETENTION: i64 = 28 * 24 * HOUR;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaHistoryPoint {
    pub captured_at: i64,
    pub remaining_percent: f64,
    pub reset_at: Option<String>,
}

pub fn open() -> Result<Connection, String> {
    let path = crate::key_store::KEY_SERVICE
        .get_storage_dir()
        .join("quota-history.sqlite");
    let db = Connection::open(path).map_err(|e| e.to_string())?;
    initialize(&db).map_err(|e| e.to_string())?;
    Ok(db)
}

pub(crate) fn initialize(db: &Connection) -> rusqlite::Result<()> {
    db.busy_timeout(std::time::Duration::from_secs(2))?;
    db.execute_batch(
        "PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY, last_attempt INTEGER NOT NULL, status TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS samples (
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          captured_at INTEGER NOT NULL, remaining REAL NOT NULL CHECK(remaining BETWEEN 0 AND 100),
          reset_at TEXT, PRIMARY KEY(account_id, captured_at));",
    )
}

/// Persist the cooldown before network I/O, including failures and process exits.
pub fn claim(db: &Connection, id: &str, now: i64) -> rusqlite::Result<bool> {
    Ok(db.execute(
        "INSERT INTO accounts VALUES (?1, ?2, 'pending')
        ON CONFLICT(id) DO UPDATE SET last_attempt=excluded.last_attempt, status='pending'
        WHERE accounts.last_attempt <= ?2 - ?3",
        params![id, now, HOUR],
    )? == 1)
}

pub fn record(
    db: &Connection,
    id: &str,
    quota: Option<&QuotaInfo>,
    captured: i64,
) -> rusqlite::Result<()> {
    // Only explicit weekly data counts. A provider's generic default 100% is not a reading.
    let weekly_item = quota.and_then(|q| {
        q.usage_items
            .iter()
            .find(|item| item.usage_type == "weekly" && item.enabled)
    });
    let weekly = weekly_item.filter(|item| {
        item.remaining_percentage.is_finite() && (0.0..=100.0).contains(&item.remaining_percentage)
    });
    if let Some(item) = weekly {
        db.execute(
            "INSERT OR IGNORE INTO samples SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM accounts WHERE id=?1)",
            params![id, captured, item.remaining_percentage, item.reset_time],
        )?;
    }
    db.execute(
        "UPDATE accounts SET status=?2 WHERE id=?1",
        params![
            id,
            if weekly.is_some() {
                "ok"
            } else if quota.is_some() && weekly_item.is_none() {
                "unsupported"
            } else {
                "unavailable"
            }
        ],
    )?;
    Ok(())
}

pub fn last_attempt(db: &Connection, id: &str) -> rusqlite::Result<Option<i64>> {
    use rusqlite::OptionalExtension;
    db.query_row(
        "SELECT last_attempt FROM accounts WHERE id=?1",
        [id],
        |row| row.get(0),
    )
    .optional()
}

pub fn promote_scope(db: &Connection, previous: &str, current: &str) -> rusqlite::Result<()> {
    let tx = db.unchecked_transaction()?;
    tx.execute("INSERT INTO accounts SELECT ?2, last_attempt, status FROM accounts WHERE id=?1
        ON CONFLICT(id) DO UPDATE SET last_attempt=MAX(accounts.last_attempt, excluded.last_attempt)", params![previous, current])?;
    tx.execute(
        "INSERT OR IGNORE INTO samples SELECT ?2, captured_at, remaining, reset_at
        FROM samples WHERE account_id=?1",
        params![previous, current],
    )?;
    tx.execute("DELETE FROM accounts WHERE id=?1", [previous])?;
    tx.commit()
}

pub fn prune(db: &Connection, active_ids: &[String], now: i64) -> rusqlite::Result<()> {
    let ids = db
        .prepare("SELECT id FROM accounts")?
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for id in ids {
        let key_id = id.rsplit_once(':').map_or(id.as_str(), |(key, _)| key);
        if !active_ids.iter().any(|key| key == key_id) {
            db.execute("DELETE FROM accounts WHERE id=?1", [id])?;
        }
    }
    db.execute(
        "DELETE FROM samples WHERE captured_at < ?1",
        [now - RETENTION],
    )?;
    db.execute(
        "DELETE FROM accounts WHERE last_attempt < ?1",
        [now - RETENTION],
    )?;
    Ok(())
}

pub fn read(db: &Connection, id: &str) -> rusqlite::Result<(String, Vec<QuotaHistoryPoint>)> {
    let status = db
        .query_row("SELECT status FROM accounts WHERE id=?1", [id], |r| {
            r.get(0)
        })
        .or_else(|e| {
            if matches!(e, rusqlite::Error::QueryReturnedNoRows) {
                Ok("pending".to_string())
            } else {
                Err(e)
            }
        })?;
    let points = db.prepare("SELECT captured_at, remaining, reset_at FROM
        (SELECT * FROM samples WHERE account_id=?1 AND captured_at>=?2 ORDER BY captured_at DESC LIMIT 672)
        ORDER BY captured_at")?.query_map(params![id, Utc::now().timestamp() - RETENTION], |r| Ok(QuotaHistoryPoint {
            captured_at: r.get(0)?, remaining_percent: r.get(1)?, reset_at: r.get(2)?,
        }))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok((status, points))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn enrichment_moves_observations_and_cooldown_atomically() {
        let db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        let now = Utc::now().timestamp();
        claim(&db, "key:before", now).unwrap();
        db.execute(
            "INSERT INTO samples VALUES ('key:before', ?1, 75, NULL)",
            [now],
        )
        .unwrap();
        promote_scope(&db, "key:before", "key:after").unwrap();
        assert_eq!(read(&db, "key:after").unwrap().1[0].remaining_percent, 75.0);
        assert!(!claim(&db, "key:after", now + 1).unwrap());
        assert!(last_attempt(&db, "key:before").unwrap().is_none());
    }
    #[test]
    fn pruning_preserves_scopes_of_existing_keys_beyond_display_limit() {
        let db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        let now = Utc::now().timestamp();
        let ids: Vec<_> = (0..130).map(|i| format!("key-{i}")).collect();
        for id in &ids {
            claim(&db, &format!("{id}:scope"), now).unwrap();
        }
        claim(&db, "key-129:older-scope", now).unwrap();
        prune(&db, &ids, now).unwrap();
        assert!(last_attempt(&db, "key-129:scope").unwrap().is_some());
        assert!(last_attempt(&db, "key-129:older-scope").unwrap().is_some());
        prune(&db, &ids[..129], now).unwrap();
        assert!(last_attempt(&db, "key-129:scope").unwrap().is_none());
    }

    #[test]
    fn concurrent_connections_claim_only_once() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.sqlite");
        initialize(&Connection::open(&path).unwrap()).unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let workers: Vec<_> = (0..2)
            .map(|_| {
                let path = path.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    let db = Connection::open(path).unwrap();
                    initialize(&db).unwrap();
                    barrier.wait();
                    claim(&db, "account", 10000).unwrap()
                })
            })
            .collect();
        let winners = workers
            .into_iter()
            .map(|w| usize::from(w.join().unwrap()))
            .sum::<usize>();
        assert_eq!(winners, 1);
    }

    #[test]
    fn records_real_weekly_observations_resets_and_rejects_invalid_values() {
        let db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        let now = Utc::now().timestamp();
        claim(&db, "a", now).unwrap();
        for (index, value) in [100.0, 20.0, 0.0, 100.0, -1.0, 101.0, f64::NAN]
            .iter()
            .enumerate()
        {
            let quota = QuotaInfo {
                usage_items: vec![crate::types::UsageItem {
                    usage_type: "weekly".into(),
                    enabled: true,
                    remaining_percentage: *value,
                    reset_time: Some(format!("cycle-{}", index / 3)),
                    ..Default::default()
                }],
                ..Default::default()
            };
            record(&db, "a", Some(&quota), now + index as i64 * HOUR).unwrap();
        }
        let points = read(&db, "a").unwrap().1;
        assert_eq!(
            points
                .iter()
                .map(|p| p.remaining_percent)
                .collect::<Vec<_>>(),
            vec![100.0, 20.0, 0.0, 100.0]
        );
        assert_ne!(points[2].reset_at, points[3].reset_at);
        assert_eq!(read(&db, "a").unwrap().0, "unavailable");
        assert!(read(&db, "b").unwrap().1.is_empty());
        // A deleted account cannot be resurrected by an in-flight result.
        prune(&db, &[], now).unwrap();
        record(&db, "a", None, now).unwrap();
        assert_eq!(
            db.query_row("SELECT count(*) FROM accounts", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn cooldown_survives_restart_and_failure() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.sqlite");
        let db = Connection::open(&path).unwrap();
        initialize(&db).unwrap();
        assert!(claim(&db, "a", 10000).unwrap());
        record(&db, "a", None, 10000).unwrap();
        drop(db);
        let db = Connection::open(path).unwrap();
        initialize(&db).unwrap();
        assert!(!claim(&db, "a", 10001).unwrap());
        assert!(claim(&db, "a", 13600).unwrap());
        assert!(claim(&db, "b", 10001).unwrap());
        assert!(read(&db, "a").unwrap().1.is_empty());
    }
    #[test]
    fn missing_weekly_is_not_full_quota_and_deleted_accounts_are_pruned() {
        let db = Connection::open_in_memory().unwrap();
        initialize(&db).unwrap();
        let now = Utc::now().timestamp();
        claim(&db, "a", now).unwrap();
        record(&db, "a", Some(&QuotaInfo::default()), now).unwrap();
        assert_eq!(read(&db, "a").unwrap().0, "unsupported");
        assert!(read(&db, "a").unwrap().1.is_empty());
        db.execute(
            "INSERT INTO samples VALUES ('a', ?1, 20, NULL)",
            [now - RETENTION - 1],
        )
        .unwrap();
        prune(&db, &["a".into()], now).unwrap();
        assert_eq!(
            db.query_row("SELECT count(*) FROM samples", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        prune(&db, &[], now).unwrap();
        assert!(claim(&db, "a", now).unwrap());
    }
}
