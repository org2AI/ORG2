use rusqlite::Connection;

/// The general pool has a large cache for session reads. File transfer gets a
/// small connection-local page cache and releases those pages before returning
/// the exclusively borrowed connection to the pool. Never changes other readers.
pub(super) fn bounded<T>(
    conn: &Connection,
    work: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let previous: i64 = conn
        .pragma_query_value(None, "cache_size", |row| row.get(0))
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "cache_size", -2048)
        .map_err(|e| e.to_string())?;
    struct Restore<'a>(&'a Connection, i64);
    impl Drop for Restore<'_> {
        fn drop(&mut self) {
            if let Err(error) = self.0.execute_batch("PRAGMA shrink_memory;") {
                tracing::warn!(%error, "Snapshot page cache release failed");
            }
            if let Err(error) = self.0.pragma_update(None, "cache_size", self.1) {
                tracing::warn!(%error, "Snapshot page cache setting restore failed");
            }
        }
    }
    let _restore = Restore(conn, previous);
    work()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restores_pool_policy_after_success_and_error() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "cache_size", -64000).unwrap();
        for fail in [false, true] {
            let result = bounded(&conn, || {
                let size: i64 = conn
                    .pragma_query_value(None, "cache_size", |r| r.get(0))
                    .unwrap();
                assert_eq!(size, -2048);
                if fail {
                    Err("test failure".into())
                } else {
                    Ok(())
                }
            });
            assert_eq!(result.is_err(), fail);
            let size: i64 = conn
                .pragma_query_value(None, "cache_size", |r| r.get(0))
                .unwrap();
            assert_eq!(size, -64000);
        }
    }
}
