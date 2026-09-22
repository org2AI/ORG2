//! Database connection management for PostgreSQL and MySQL.
//!
//! Provides Tauri commands that the frontend TypeScript providers
//! (PostgresProvider, MySQLProvider) call via `invoke()`. Each engine
//! is gated behind a Cargo feature (`postgres`, `mysql`); both are
//! default-on so the production binary ships unchanged. A build with
//! `--no-default-features --features postgres` (or `mysql`) compiles
//! only the requested engine, dropping the other's driver crates.
//!
//! Uses sqlx connection pools behind the scenes.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

#[cfg(feature = "mysql")]
use crate::row_values::mysql_row_to_json;
#[cfg(feature = "postgres")]
use crate::row_values::pg_row_to_json;
use serde::{Deserialize, Serialize};
#[cfg(any(feature = "postgres", feature = "mysql"))]
use sqlx::{Column, Executor, Row, Statement};

static POOLS: LazyLock<Mutex<HashMap<String, Slot>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

const MAX_POOLS: usize = 20;

#[allow(dead_code)] // Variant set is feature-gated; both off is a no-op build.
#[derive(Clone)]
enum PoolEntry {
    #[cfg(feature = "postgres")]
    Postgres(sqlx::PgPool),
    #[cfg(feature = "mysql")]
    Mysql(sqlx::MySqlPool),
}

// ============================================
// Tauri-serializable result types
// ============================================

#[derive(Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: usize,
}

#[derive(Serialize, Deserialize)]
pub struct ExecuteResult {
    pub rows_affected: u64,
}

#[derive(Serialize, Deserialize)]
pub struct TableInfo {
    pub name: String,
    pub table_type: String,
    pub row_count: Option<i64>,
}

#[derive(Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub primary_key: bool,
    pub default_value: Option<String>,
    pub auto_increment: bool,
}

// ============================================
// Helpers
// ============================================

struct LeasePool {
    pool: PoolEntry,
}
/// A registry entry. `owner` is the label of the window whose webview opened
/// the lease; `pool` is `None` while the connection is still being dialled.
struct Slot {
    owner: String,
    pool: Option<Arc<LeasePool>>,
}
impl Drop for LeasePool {
    fn drop(&mut self) {
        LIVE_POOLS.fetch_sub(1, Ordering::AcqRel);
    }
}
static LIVE_POOLS: AtomicUsize = AtomicUsize::new(0);
static NEXT_LEASE: AtomicU64 = AtomicU64::new(1);

struct Reservation {
    id: String,
    committed: bool,
}
impl Drop for Reservation {
    fn drop(&mut self) {
        if !self.committed {
            POOLS
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&self.id);
            LIVE_POOLS.fetch_sub(1, Ordering::AcqRel);
        }
    }
}
fn reserve(owner: &str) -> Result<Reservation, String> {
    let mut pools = POOLS.lock().unwrap_or_else(|e| e.into_inner());
    if LIVE_POOLS.load(Ordering::Acquire) >= MAX_POOLS {
        return Err(format!(
            "Database connection limit ({MAX_POOLS}) reached. Close a database first."
        ));
    }
    let id = format!("sql-lease:{}", NEXT_LEASE.fetch_add(1, Ordering::Relaxed));
    LIVE_POOLS.fetch_add(1, Ordering::AcqRel);
    pools.insert(
        id.clone(),
        Slot {
            owner: owner.to_string(),
            pool: None,
        },
    );
    Ok(Reservation {
        id,
        committed: false,
    })
}
fn get_pool(id: &str) -> Result<Arc<LeasePool>, String> {
    POOLS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(id)
        .and_then(|slot| slot.pool.clone())
        .ok_or_else(|| format!("No connection found for: {id}"))
}

async fn close_pool(entry: Arc<LeasePool>) {
    match &entry.pool {
        #[cfg(feature = "postgres")]
        PoolEntry::Postgres(pool) => pool.close().await,
        #[cfg(feature = "mysql")]
        PoolEntry::Mysql(pool) => pool.close().await,
    }
}

/// Release every lease opened from `owner` (a window label). A reloaded or
/// destroyed webview never runs its JS disconnects, and with capacity
/// rejection instead of eviction its orphaned leases would otherwise hold
/// slots until the process exits. Returns how many leases were released.
pub async fn release_owner(owner: &str) -> usize {
    let released: Vec<Option<Arc<LeasePool>>> = {
        let mut pools = POOLS.lock().unwrap_or_else(|e| e.into_inner());
        let ids: Vec<String> = pools
            .iter()
            .filter(|(_, slot)| slot.owner == owner)
            .map(|(id, _)| id.clone())
            .collect();
        ids.iter()
            .filter_map(|id| pools.remove(id))
            .map(|slot| slot.pool)
            .collect()
    };
    let count = released.len();
    // A still-dialling reservation loses its slot here; its connect call
    // notices on publication and closes the new pool itself.
    for entry in released.into_iter().flatten() {
        close_pool(entry).await;
    }
    count
}

// ============================================
// Tauri Commands
// ============================================

#[tauri::command]
pub async fn db_sql_connect(
    window: tauri::Window,
    connection_id: String,
    db_type: String,
    connection_string: String,
) -> Result<String, String> {
    let _ = connection_id; // Config identity is not a resource lease.
    connect_lease(window.label(), &db_type, &connection_string).await
}

async fn connect_lease(
    owner: &str,
    db_type: &str,
    connection_string: &str,
) -> Result<String, String> {
    let mut reservation = reserve(owner)?;
    let entry = match db_type {
        #[cfg(feature = "postgres")]
        "postgres" => {
            let pool = sqlx::postgres::PgPoolOptions::new()
                .max_connections(5)
                .acquire_timeout(Duration::from_secs(30))
                .connect(connection_string)
                .await
                .map_err(|err| format!("PostgreSQL connection failed: {err}"))?;
            sqlx::query("SELECT 1")
                .execute(&pool)
                .await
                .map_err(|err| format!("PostgreSQL ping failed: {err}"))?;
            PoolEntry::Postgres(pool)
        }
        #[cfg(feature = "mysql")]
        "mysql" => {
            let pool = sqlx::mysql::MySqlPoolOptions::new()
                .max_connections(5)
                .acquire_timeout(Duration::from_secs(30))
                .connect(connection_string)
                .await
                .map_err(|err| format!("MySQL connection failed: {err}"))?;
            sqlx::query("SELECT 1")
                .execute(&pool)
                .await
                .map_err(|err| format!("MySQL ping failed: {err}"))?;
            PoolEntry::Mysql(pool)
        }
        other => return Err(format!("Unsupported db_type: {other}")),
    };

    let id = reservation.id.clone();
    let entry = Arc::new(LeasePool { pool: entry });
    reservation.committed = true;
    let published = match POOLS.lock().unwrap_or_else(|e| e.into_inner()).get_mut(&id) {
        Some(slot) => {
            slot.pool = Some(entry.clone());
            true
        }
        None => false,
    };
    if !published {
        // The owning webview reloaded or closed while this pool was dialling.
        close_pool(entry).await;
        return Err("Database connection owner was released".into());
    }
    Ok(id)
}

#[tauri::command]
pub async fn db_sql_disconnect(connection_id: String) -> Result<(), String> {
    let entry = POOLS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&connection_id)
        .and_then(|slot| slot.pool);
    if let Some(entry) = entry {
        close_pool(entry).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn db_sql_query(connection_id: String, sql: String) -> Result<QueryResult, String> {
    let entry = get_pool(&connection_id)?;

    match &entry.pool {
        #[cfg(feature = "postgres")]
        PoolEntry::Postgres(pool) => {
            // Preparation and execution must share session state (for example,
            // temporary tables). Retain metadata even when execution returns no rows.
            let mut connection = pool
                .acquire()
                .await
                .map_err(|err| format!("Query failed: {err}"))?;
            let statement = connection
                .prepare(&sql)
                .await
                .map_err(|err| format!("Query failed: {err}"))?;
            let rows: Vec<sqlx::postgres::PgRow> = statement
                .query()
                .fetch_all(&mut *connection)
                .await
                .map_err(|err| format!("Query failed: {err}"))?;

            let columns: Vec<String> = if rows.is_empty() {
                statement
                    .columns()
                    .iter()
                    .map(|column| column.name().to_string())
                    .collect()
            } else {
                rows[0]
                    .columns()
                    .iter()
                    .map(|c| c.name().to_string())
                    .collect()
            };
            let row_count = rows.len();
            let json_rows: Vec<Vec<serde_json::Value>> =
                rows.iter().map(pg_row_to_json).collect::<Result<_, _>>()?;
            Ok(QueryResult {
                columns,
                rows: json_rows,
                row_count,
            })
        }
        #[cfg(feature = "mysql")]
        PoolEntry::Mysql(pool) => {
            // Preparation and execution must share session state (for example,
            // temporary tables). Retain metadata even when execution returns no rows.
            let mut connection = pool
                .acquire()
                .await
                .map_err(|err| format!("Query failed: {err}"))?;
            let statement = connection
                .prepare(&sql)
                .await
                .map_err(|err| format!("Query failed: {err}"))?;
            let rows: Vec<sqlx::mysql::MySqlRow> = statement
                .query()
                .fetch_all(&mut *connection)
                .await
                .map_err(|err| format!("Query failed: {err}"))?;

            let columns: Vec<String> = if rows.is_empty() {
                statement
                    .columns()
                    .iter()
                    .map(|column| column.name().to_string())
                    .collect()
            } else {
                rows[0]
                    .columns()
                    .iter()
                    .map(|c| c.name().to_string())
                    .collect()
            };
            let row_count = rows.len();
            let json_rows: Vec<Vec<serde_json::Value>> = rows
                .iter()
                .map(mysql_row_to_json)
                .collect::<Result<_, _>>()?;
            Ok(QueryResult {
                columns,
                rows: json_rows,
                row_count,
            })
        }
    }
}

#[tauri::command]
pub async fn db_sql_execute(connection_id: String, sql: String) -> Result<ExecuteResult, String> {
    let entry = get_pool(&connection_id)?;

    let rows_affected = match &entry.pool {
        #[cfg(feature = "postgres")]
        PoolEntry::Postgres(pool) => sqlx::query(&sql)
            .execute(pool)
            .await
            .map_err(|err| format!("Execute failed: {err}"))?
            .rows_affected(),
        #[cfg(feature = "mysql")]
        PoolEntry::Mysql(pool) => sqlx::query(&sql)
            .execute(pool)
            .await
            .map_err(|err| format!("Execute failed: {err}"))?
            .rows_affected(),
    };

    Ok(ExecuteResult { rows_affected })
}

#[tauri::command]
pub async fn db_sql_get_tables(connection_id: String) -> Result<Vec<TableInfo>, String> {
    let entry = get_pool(&connection_id)?;

    match &entry.pool {
        #[cfg(feature = "postgres")]
        PoolEntry::Postgres(pool) => {
            let rows: Vec<(String, String)> = sqlx::query_as(
                "SELECT table_name, table_type \
                 FROM information_schema.tables \
                 WHERE table_schema = 'public' \
                   AND table_type IN ('BASE TABLE', 'VIEW') \
                 ORDER BY table_name",
            )
            .fetch_all(pool)
            .await
            .map_err(|err| format!("Failed to list tables: {err}"))?;

            Ok(rows
                .into_iter()
                .map(|(name, table_type)| TableInfo {
                    name,
                    table_type,
                    row_count: None,
                })
                .collect())
        }
        #[cfg(feature = "mysql")]
        PoolEntry::Mysql(pool) => {
            let rows: Vec<(String, String)> = sqlx::query_as(
                "SELECT TABLE_NAME, TABLE_TYPE \
                 FROM information_schema.TABLES \
                 WHERE TABLE_SCHEMA = DATABASE() \
                   AND TABLE_TYPE IN ('BASE TABLE', 'VIEW') \
                 ORDER BY TABLE_NAME",
            )
            .fetch_all(pool)
            .await
            .map_err(|err| format!("Failed to list tables: {err}"))?;

            Ok(rows
                .into_iter()
                .map(|(name, table_type)| TableInfo {
                    name,
                    table_type,
                    row_count: None,
                })
                .collect())
        }
    }
}

#[tauri::command]
pub async fn db_sql_get_table_schema(
    connection_id: String,
    table_name: String,
) -> Result<Vec<ColumnInfo>, String> {
    let entry = get_pool(&connection_id)?;

    match &entry.pool {
        #[cfg(feature = "postgres")]
        PoolEntry::Postgres(pool) => {
            let rows: Vec<sqlx::postgres::PgRow> = sqlx::query(
                "SELECT \
                   c.column_name, \
                   COALESCE(c.udt_name, c.data_type) as data_type, \
                   c.is_nullable, \
                   c.column_default, \
                   CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_pk \
                 FROM information_schema.columns c \
                 LEFT JOIN ( \
                   SELECT ku.column_name \
                   FROM information_schema.table_constraints tc \
                   JOIN information_schema.key_column_usage ku \
                     ON tc.constraint_name = ku.constraint_name \
                     AND tc.table_schema = ku.table_schema \
                   WHERE tc.constraint_type = 'PRIMARY KEY' \
                     AND tc.table_schema = 'public' \
                     AND tc.table_name = $1 \
                 ) pk ON c.column_name = pk.column_name \
                 WHERE c.table_schema = 'public' \
                   AND c.table_name = $1 \
                 ORDER BY c.ordinal_position",
            )
            .bind(&table_name)
            .fetch_all(pool)
            .await
            .map_err(|err| format!("Failed to get schema: {err}"))?;

            Ok(rows
                .iter()
                .map(|row| {
                    let col_default: Option<String> = row.try_get("column_default").unwrap_or(None);
                    let is_auto = col_default
                        .as_ref()
                        .map(|d| d.contains("nextval"))
                        .unwrap_or(false);
                    ColumnInfo {
                        name: row.get("column_name"),
                        data_type: row
                            .try_get::<String, _>("data_type")
                            .unwrap_or_default()
                            .to_uppercase(),
                        nullable: row.try_get::<String, _>("is_nullable").unwrap_or_default()
                            == "YES",
                        primary_key: row.try_get::<bool, _>("is_pk").unwrap_or(false),
                        default_value: col_default,
                        auto_increment: is_auto,
                    }
                })
                .collect())
        }
        #[cfg(feature = "mysql")]
        PoolEntry::Mysql(pool) => {
            let rows: Vec<sqlx::mysql::MySqlRow> = sqlx::query(
                "SELECT \
                   COLUMN_NAME, \
                   COLUMN_TYPE, \
                   IS_NULLABLE, \
                   COLUMN_DEFAULT, \
                   COLUMN_KEY, \
                   EXTRA \
                 FROM information_schema.COLUMNS \
                 WHERE TABLE_SCHEMA = DATABASE() \
                   AND TABLE_NAME = ? \
                 ORDER BY ORDINAL_POSITION",
            )
            .bind(&table_name)
            .fetch_all(pool)
            .await
            .map_err(|err| format!("Failed to get schema: {err}"))?;

            Ok(rows
                .iter()
                .map(|row| ColumnInfo {
                    name: row.try_get("COLUMN_NAME").unwrap_or_default(),
                    data_type: row
                        .try_get::<String, _>("COLUMN_TYPE")
                        .unwrap_or_default()
                        .to_uppercase(),
                    nullable: row.try_get::<String, _>("IS_NULLABLE").unwrap_or_default() == "YES",
                    primary_key: row.try_get::<String, _>("COLUMN_KEY").unwrap_or_default()
                        == "PRI",
                    default_value: row.try_get("COLUMN_DEFAULT").unwrap_or(None),
                    auto_increment: row
                        .try_get::<String, _>("EXTRA")
                        .unwrap_or_default()
                        .contains("auto_increment"),
                })
                .collect())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    static TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    const OWNER: &str = "db-clients-test-window";

    fn owned_by(owner: &str) -> usize {
        POOLS
            .lock()
            .unwrap()
            .values()
            .filter(|slot| slot.owner == owner)
            .count()
    }

    fn publish(reservation: &mut Reservation, entry: Arc<LeasePool>) {
        POOLS
            .lock()
            .unwrap()
            .get_mut(&reservation.id)
            .expect("reserved slot")
            .pool = Some(entry);
        reservation.committed = true;
    }

    /// Every command in this module resolves a pooled connection first, so a
    /// test only needs an id that was never connected.
    fn unconnected_id(name: &str) -> String {
        format!("db-clients-test-never-connected-{name}")
    }

    /// The result payloads are plain serde DTOs without `Debug`, so unwrap the
    /// error side by hand rather than widening the production derives.
    fn err_of<T>(result: Result<T, String>) -> String {
        match result {
            Ok(_) => panic!("expected an error, got Ok"),
            Err(err) => err,
        }
    }

    #[tokio::test]
    async fn reserved_capacity_is_bounded_and_failure_releases_it() {
        let _guard = TEST_LOCK.lock().await;
        let mut held: Vec<_> = (0..MAX_POOLS).map(|_| reserve(OWNER).unwrap()).collect();
        assert!(reserve(OWNER).is_err());
        assert_eq!(POOLS.lock().unwrap().len(), MAX_POOLS);
        drop(held.pop());
        let retry = reserve(OWNER).unwrap();
        drop(held);
        drop(retry);
        assert_eq!(LIVE_POOLS.load(Ordering::Acquire), 0);
    }

    #[cfg(feature = "postgres")]
    #[tokio::test]
    async fn closed_lease_is_not_reusable_and_retained_operation_counts_toward_capacity() {
        let _guard = TEST_LOCK.lock().await;
        // connect_lazy with min_connections=0 does not dial a server.
        let pool = sqlx::postgres::PgPoolOptions::new()
            .min_connections(0)
            .connect_lazy("postgres://fake:fake@db.invalid/fake")
            .unwrap();
        let mut reservation = reserve(OWNER).unwrap();
        let id = reservation.id.clone();
        let entry = Arc::new(LeasePool {
            pool: PoolEntry::Postgres(pool),
        });
        publish(&mut reservation, entry.clone());
        let borrowed = get_pool(&id).unwrap();
        let remaining: Vec<_> = (1..MAX_POOLS).map(|_| reserve(OWNER).unwrap()).collect();
        db_sql_disconnect(id.clone()).await.unwrap();
        assert!(get_pool(&id).is_err());
        assert!(
            reserve(OWNER).is_err(),
            "in-flight resource still uses capacity"
        );
        drop(borrowed);
        drop(entry);
        let next = reserve(OWNER).unwrap();
        assert_ne!(next.id, id);
        drop(next);
        drop(remaining);
        assert_eq!(LIVE_POOLS.load(Ordering::Acquire), 0);
    }

    #[cfg(feature = "postgres")]
    #[tokio::test]
    async fn releasing_an_owner_frees_only_its_leases_and_capacity() {
        let _guard = TEST_LOCK.lock().await;
        let lazy_pool = || {
            sqlx::postgres::PgPoolOptions::new()
                .min_connections(0)
                .connect_lazy("postgres://fake:fake@db.invalid/fake")
                .unwrap()
        };
        let mut reloaded = reserve("reloaded-window").unwrap();
        publish(
            &mut reloaded,
            Arc::new(LeasePool {
                pool: PoolEntry::Postgres(lazy_pool()),
            }),
        );
        // A connect still dialling when its webview reloads loses its slot too.
        let dialling = reserve("reloaded-window").unwrap();
        let mut survivor = reserve("other-window").unwrap();
        publish(
            &mut survivor,
            Arc::new(LeasePool {
                pool: PoolEntry::Postgres(lazy_pool()),
            }),
        );

        assert_eq!(release_owner("reloaded-window").await, 2);
        assert_eq!(owned_by("reloaded-window"), 0);
        assert!(get_pool(&reloaded.id).is_err());
        assert!(get_pool(&survivor.id).is_ok());
        assert_eq!(LIVE_POOLS.load(Ordering::Acquire), 2, "dialling + survivor");
        drop(dialling);
        assert_eq!(LIVE_POOLS.load(Ordering::Acquire), 1);

        db_sql_disconnect(survivor.id.clone()).await.unwrap();
        assert_eq!(LIVE_POOLS.load(Ordering::Acquire), 0);
        assert_eq!(release_owner("reloaded-window").await, 0);
    }

    // ---------- connection lifecycle ----------

    #[tokio::test]
    async fn connect_rejects_an_unknown_engine_without_dialling_out() {
        let _guard = TEST_LOCK.lock().await;
        let err = connect_lease(OWNER, "sqlite", "sqlite:///tmp/whatever.db")
            .await
            .unwrap_err();

        assert_eq!(err, "Unsupported db_type: sqlite");
        // A rejected engine must not leave a half-registered pool entry
        // behind for later commands to find.
        assert_eq!(owned_by(OWNER), 0);
    }

    #[tokio::test]
    async fn connect_engine_name_matching_is_exact_and_case_sensitive() {
        let _guard = TEST_LOCK.lock().await;
        for engine in ["Postgres", "POSTGRES", "postgresql", "MySQL", ""] {
            let err = connect_lease(OWNER, engine, "ignored").await.unwrap_err();
            assert_eq!(err, format!("Unsupported db_type: {engine}"));
        }
    }

    #[tokio::test]
    async fn disconnect_is_a_no_op_for_an_unknown_connection() {
        let _guard = TEST_LOCK.lock().await;
        // The frontend calls disconnect on teardown paths that may never have
        // connected; that must not surface an error to the user.
        assert_eq!(
            db_sql_disconnect(unconnected_id("disconnect")).await,
            Ok(())
        );
    }

    // ---------- unresolved-connection guards ----------

    #[tokio::test]
    async fn query_requires_an_established_connection() {
        let _guard = TEST_LOCK.lock().await;
        let id = unconnected_id("query");
        let err = err_of(db_sql_query(id.clone(), "SELECT 1".to_string()).await);

        assert_eq!(err, format!("No connection found for: {id}"));
    }

    #[tokio::test]
    async fn execute_requires_an_established_connection() {
        let _guard = TEST_LOCK.lock().await;
        let id = unconnected_id("execute");
        let err = err_of(db_sql_execute(id.clone(), "DELETE FROM t".to_string()).await);

        // The guard runs before the SQL is handed to any driver, so a
        // destructive statement against a dead connection is never sent.
        assert_eq!(err, format!("No connection found for: {id}"));
    }

    #[tokio::test]
    async fn get_tables_requires_an_established_connection() {
        let _guard = TEST_LOCK.lock().await;
        let id = unconnected_id("tables");
        let err = err_of(db_sql_get_tables(id.clone()).await);

        assert_eq!(err, format!("No connection found for: {id}"));
    }

    #[tokio::test]
    async fn get_table_schema_requires_an_established_connection() {
        let _guard = TEST_LOCK.lock().await;
        let id = unconnected_id("schema");
        let err = err_of(db_sql_get_table_schema(id.clone(), "users".to_string()).await);

        assert_eq!(err, format!("No connection found for: {id}"));
    }

    // ---------- wire contract ----------
    //
    // These structs cross the Tauri boundary with **no** `rename_all`, so the
    // JSON keys stay snake_case. `DatabaseCore`'s `PostgresProvider` /
    // `MySQLProvider` read `table_type`, `row_count`, `data_type`,
    // `primary_key`, `default_value` and `auto_increment` verbatim. Adding
    // `#[serde(rename_all = "camelCase")]` here — as the sibling `db_browser`
    // crate does — would silently produce `undefined` in both providers, so
    // the field names are pinned.

    /// Field names in sorted order — JSON object key order is not part of the
    /// contract, the set of names is.
    fn field_names(value: &serde_json::Value) -> Vec<&str> {
        let mut names: Vec<&str> = value
            .as_object()
            .expect("serializes to a JSON object")
            .keys()
            .map(String::as_str)
            .collect();
        names.sort_unstable();
        names
    }

    #[test]
    fn query_result_serializes_with_snake_case_keys() {
        let json = serde_json::to_value(QueryResult {
            columns: vec!["id".to_string()],
            rows: vec![vec![serde_json::json!(1)]],
            row_count: 1,
        })
        .expect("serialize");

        assert_eq!(field_names(&json), vec!["columns", "row_count", "rows"]);
        assert_eq!(json["rows"][0][0], serde_json::json!(1));
    }

    #[test]
    fn execute_result_serializes_with_snake_case_keys() {
        let json = serde_json::to_value(ExecuteResult { rows_affected: 7 }).expect("serialize");

        assert_eq!(field_names(&json), vec!["rows_affected"]);
        assert_eq!(json["rows_affected"], serde_json::json!(7));
    }

    #[test]
    fn table_info_serializes_with_snake_case_keys_and_nullable_row_count() {
        let json = serde_json::to_value(TableInfo {
            name: "users".to_string(),
            table_type: "VIEW".to_string(),
            row_count: None,
        })
        .expect("serialize");

        assert_eq!(field_names(&json), vec!["name", "row_count", "table_type"]);
        // The providers map `row_count ?? undefined`, so `null` must be sent
        // rather than the field being skipped.
        assert_eq!(json["row_count"], serde_json::Value::Null);
    }

    #[test]
    fn column_info_serializes_with_snake_case_keys() {
        let json = serde_json::to_value(ColumnInfo {
            name: "id".to_string(),
            data_type: "INT4".to_string(),
            nullable: false,
            primary_key: true,
            default_value: Some("nextval('users_id_seq')".to_string()),
            auto_increment: true,
        })
        .expect("serialize");

        assert_eq!(
            field_names(&json),
            vec![
                "auto_increment",
                "data_type",
                "default_value",
                "name",
                "nullable",
                "primary_key",
            ]
        );
    }
}

#[cfg(all(test, feature = "mysql"))]
mod row_boundary_tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires ORGII_TEST_MYSQL_URL pointing to a disposable local MySQL server"]
    async fn mysql_same_config_owns_independent_leases() {
        let url = std::env::var("ORGII_TEST_MYSQL_URL").unwrap();
        let first = connect_lease("same-config", "mysql", &url).await.unwrap();
        let second = connect_lease("same-config", "mysql", &url).await.unwrap();
        assert_ne!(first, second);
        db_sql_disconnect(first.clone()).await.unwrap();
        let closed = db_sql_query(first, "SELECT 1".into()).await;
        let peer = db_sql_query(second.clone(), "SELECT 1".into()).await;
        db_sql_disconnect(second).await.unwrap();
        assert!(closed.is_err());
        assert_eq!(peer.unwrap().rows, vec![vec![serde_json::json!(1)]]);
    }

    #[tokio::test]
    #[ignore = "requires ORGII_TEST_MYSQL_URL pointing to a disposable local MySQL server"]
    async fn mysql_query_preserves_values_nulls_errors_and_empty_columns() {
        let url = std::env::var("ORGII_TEST_MYSQL_URL").expect("disposable MySQL URL");
        let id = connect_lease("row-contract-mysql-fixture", "mysql", &url)
            .await
            .unwrap();
        let result = async {
            let values = db_sql_query(id.clone(),
                r#"SELECT NULL AS nil, CAST(7 AS SIGNED) AS small_value, CAST(18446744073709551615 AS UNSIGNED) AS huge_value, 'hello' AS text_value, CAST('{"ok":true}' AS JSON) AS json_value"#.into()).await?;
            let empty = db_sql_query(id.clone(), "SELECT CAST(1 AS SIGNED) AS preserved_column WHERE FALSE".into()).await?;
            let temporal = db_sql_query(id.clone(),
                "SELECT DATE('2026-09-14') AS date_value, CAST('2026-09-14 12:34:56' AS DATETIME) AS datetime_value, CAST('-01:02:03' AS TIME) AS time_value, CAST(123.45 AS DECIMAL(10,2)) AS decimal_value, UNHEX('00AB') AS binary_value".into()).await?;
            let unsupported = db_sql_query(id.clone(), "SELECT POINT(1, 1) AS point_value".into()).await;
            Ok::<_, String>((values, empty, temporal, unsupported))
        }.await;
        db_sql_disconnect(id).await.unwrap();
        let (values, empty, temporal, unsupported) = result.unwrap();
        assert_eq!(
            temporal.rows,
            vec![vec![
                serde_json::json!("2026-09-14"),
                serde_json::json!("2026-09-14 12:34:56"),
                serde_json::json!("-01:02:03"),
                serde_json::json!("123.45"),
                serde_json::json!("0x00ab")
            ]]
        );
        assert_eq!(
            values.rows,
            vec![vec![
                serde_json::Value::Null,
                serde_json::json!(7),
                serde_json::json!("18446744073709551615"),
                serde_json::json!("hello"),
                serde_json::json!({"ok":true})
            ]]
        );
        assert_eq!(empty.row_count, 0);
        assert_eq!(empty.columns, vec!["preserved_column"]);
        assert!(unsupported
            .err()
            .unwrap()
            .contains("Unsupported SQL type GEOMETRY"));
    }
}

#[cfg(test)]
mod session_metadata_tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    // A one-connection pool makes before_acquire count every checkout. The old
    // fetch_all(pool) + describe(pool) path checks out twice for an empty result.

    #[cfg(feature = "postgres")]
    #[tokio::test]
    #[ignore = "requires ORGII_TEST_POSTGRES_URL pointing to a disposable local server"]
    async fn postgres_query_keeps_session_metadata_and_releases_connection() {
        let url = std::env::var("ORGII_TEST_POSTGRES_URL").expect("disposable database URL");
        let checkouts = Arc::new(AtomicUsize::new(0));
        let counter = checkouts.clone();
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .before_acquire(move |_, _| {
                counter.fetch_add(1, Ordering::SeqCst);
                Box::pin(async { Ok(true) })
            })
            .connect(&url)
            .await
            .unwrap();
        // citext is the real extension type, not a fabricated type-info name.
        sqlx::query("CREATE EXTENSION IF NOT EXISTS citext")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("CREATE TEMP TABLE row_contract AS SELECT 'Alice'::citext AS label, 7::int2 AS small_value").execute(&pool).await.unwrap();
        let mut reservation = reserve("session-metadata-fixture").unwrap();
        let id = reservation.id.clone();
        POOLS.lock().unwrap_or_else(|e| e.into_inner()).insert(
            id.clone(),
            Slot {
                owner: "session-metadata-fixture".into(),
                pool: Some(Arc::new(LeasePool {
                    pool: PoolEntry::Postgres(pool),
                })),
            },
        );
        reservation.committed = true;
        let result = async {
            let values = db_sql_query(id.clone(), "SELECT * FROM row_contract".into()).await?;
            assert_eq!(
                values.rows,
                vec![vec![serde_json::json!("Alice"), serde_json::json!(7)]]
            );
            checkouts.store(0, Ordering::SeqCst);
            let empty =
                db_sql_query(id.clone(), "SELECT * FROM row_contract WHERE FALSE".into()).await?;
            assert_eq!(empty.columns, vec!["label", "small_value"]);
            assert!(empty.rows.is_empty());
            assert_eq!(
                checkouts.load(Ordering::SeqCst),
                1,
                "metadata must use the execution checkout"
            );
            assert!(
                db_sql_query(id.clone(), "SELECT * FROM nonexistent_row_contract".into())
                    .await
                    .is_err()
            );
            let typed = db_sql_query(
                id.clone(),
                r#"SELECT 123.45::numeric AS n, DATE '2026-09-14' AS d, TIMESTAMPTZ '2026-09-14 12:00:00+00' AS ts, '00000000-0000-0000-0000-000000000001'::uuid AS u, '\x00ab'::bytea AS b"#.into(),
            )
            .await?;
            assert_eq!(
                typed.rows,
                vec![vec![
                    serde_json::json!("123.45"),
                    serde_json::json!("2026-09-14"),
                    serde_json::json!("2026-09-14T12:00:00Z"),
                    serde_json::json!("00000000-0000-0000-0000-000000000001"),
                    serde_json::json!("\\x00ab")
                ]]
            );
            db_sql_execute(
                id.clone(),
                "CREATE TYPE pg_temp.row_contract_mood AS ENUM ('calm')".into(),
            )
            .await?;
            let label = db_sql_query(
                id.clone(),
                "SELECT 'calm'::pg_temp.row_contract_mood AS mood".into(),
            )
            .await?;
            assert_eq!(label.rows, vec![vec![serde_json::json!("calm")]]);
            assert!(
                db_sql_query(id.clone(), "SELECT '127.0.0.1'::inet AS unsupported".into())
                    .await
                    .is_err()
            );
            // Both prepare and decoding errors must release the only connection.
            let recovered = tokio::time::timeout(
                std::time::Duration::from_secs(5),
                db_sql_query(id.clone(), "SELECT * FROM row_contract WHERE FALSE".into()),
            )
            .await
            .map_err(|err| err.to_string())??;
            assert_eq!(recovered.columns, vec!["label", "small_value"]);
            Ok::<_, String>(())
        }
        .await;
        db_sql_disconnect(id).await.unwrap();
        result.unwrap();
    }

    #[cfg(feature = "mysql")]
    #[tokio::test]
    #[ignore = "requires ORGII_TEST_MYSQL_URL pointing to a disposable local server"]
    async fn mysql_query_keeps_session_metadata_and_releases_connection() {
        let url = std::env::var("ORGII_TEST_MYSQL_URL").expect("disposable database URL");
        let checkouts = Arc::new(AtomicUsize::new(0));
        let counter = checkouts.clone();
        let pool = sqlx::mysql::MySqlPoolOptions::new()
            .max_connections(1)
            .before_acquire(move |_, _| {
                counter.fetch_add(1, Ordering::SeqCst);
                Box::pin(async { Ok(true) })
            })
            .connect(&url)
            .await
            .unwrap();
        sqlx::query("CREATE TEMPORARY TABLE row_contract AS SELECT 'Alice' AS label, CAST(7 AS SIGNED) AS small_value").execute(&pool).await.unwrap();
        let mut reservation = reserve("session-metadata-fixture").unwrap();
        let id = reservation.id.clone();
        POOLS.lock().unwrap_or_else(|e| e.into_inner()).insert(
            id.clone(),
            Slot {
                owner: "session-metadata-fixture".into(),
                pool: Some(Arc::new(LeasePool {
                    pool: PoolEntry::Mysql(pool),
                })),
            },
        );
        reservation.committed = true;
        let result = async {
            let values = db_sql_query(id.clone(), "SELECT * FROM row_contract".into()).await?;
            assert_eq!(
                values.rows,
                vec![vec![serde_json::json!("Alice"), serde_json::json!(7)]]
            );
            checkouts.store(0, Ordering::SeqCst);
            let empty =
                db_sql_query(id.clone(), "SELECT * FROM row_contract WHERE FALSE".into()).await?;
            assert_eq!(empty.columns, vec!["label", "small_value"]);
            assert!(empty.rows.is_empty());
            assert_eq!(
                checkouts.load(Ordering::SeqCst),
                1,
                "metadata must use the execution checkout"
            );
            assert!(
                db_sql_query(id.clone(), "SELECT * FROM nonexistent_row_contract".into())
                    .await
                    .is_err()
            );
            assert!(
                db_sql_query(id.clone(), "SELECT POINT(1, 1) AS unsupported".into())
                    .await
                    .is_err()
            );
            // Both prepare and decoding errors must release the only connection.
            let recovered = tokio::time::timeout(
                std::time::Duration::from_secs(5),
                db_sql_query(id.clone(), "SELECT * FROM row_contract WHERE FALSE".into()),
            )
            .await
            .map_err(|err| err.to_string())??;
            assert_eq!(recovered.columns, vec!["label", "small_value"]);
            Ok::<_, String>(())
        }
        .await;
        db_sql_disconnect(id).await.unwrap();
        result.unwrap();
    }
}
