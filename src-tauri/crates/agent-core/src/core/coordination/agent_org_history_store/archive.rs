//! Copy raw values and original DDL before retiring any private object.
use rusqlite::{params, Connection};

use super::{capture, copies, quoted, table_exists};

const OLD_SCHEMA: &str = include_str!("../fixtures/official_v2_0_8_agent_org.sql");
const LEGACY_TABLES: &[&str] = &[
    "agent_org_runs",
    "agent_org_run_progress",
    "agent_org_plan_approvals",
    "agent_org_recovery_attempts",
    "agent_org_tasks",
    "agent_org_task_events",
    "agent_org_task_run_schema_migrations",
    "agent_inbox",
    "agent_inbox_materializations",
    "agent_inbox_delivery_resolutions",
    "agent_member_interventions",
];
const COMPANIONS: &[&str] = &[
    "agent_org_task_execution_leases",
    "agent_org_task_execution_reconciliations",
    "agent_org_scope_removal_receipts",
    "agent_org_scope_resolution_receipts",
    "agent_org_coordinator_completion_rechecks",
    "agent_org_member_turn_admissions",
];

struct Object {
    kind: String,
    name: String,
    table: String,
    sql: Option<String>,
}

fn owns(table: &str) -> bool {
    table.starts_with("agent_org_runtime_")
        || LEGACY_TABLES.contains(&table)
        || COMPANIONS.contains(&table)
}

fn objects(conn: &Connection) -> rusqlite::Result<Vec<Object>> {
    let mut stmt =
        conn.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name")?;
    let all = stmt
        .query_map([], |row| {
            Ok(Object {
                kind: row.get(0)?,
                name: row.get(1)?,
                table: row.get(2)?,
                sql: row.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(all
        .into_iter()
        .filter(|object| owns(&object.table))
        .collect())
}

pub(super) fn retire_previous_execution(conn: &Connection, fresh: bool) -> rusqlite::Result<()> {
    let objects = objects(conn)?;
    let tables = objects
        .iter()
        .filter(|object| object.kind == "table")
        .collect::<Vec<_>>();
    let mut has_rows = false;
    for table in &tables {
        has_rows |= conn.query_row(
            &format!(
                "SELECT EXISTS(SELECT 1 FROM {} LIMIT 1)",
                quoted(&table.name)
            ),
            [],
            |row| row.get::<_, bool>(0),
        )?;
    }
    // The fixed old area is normally empty. Checking its bounded object list
    // never scans shared conversation bodies on a normal restart.
    let expected = Connection::open_in_memory()?;
    expected.execute_batch(OLD_SCHEMA)?;
    let expected_objects = self::objects(&expected)?;
    let same_schema = objects.len() == expected_objects.len()
        && objects
            .iter()
            .zip(&expected_objects)
            .all(|(a, b)| a.kind == b.kind && a.name == b.name && a.sql == b.sql);
    if !fresh && !has_rows && same_schema {
        return Ok(());
    }
    if fresh || has_rows {
        conn.execute("INSERT INTO org_history_archives DEFAULT VALUES", [])?;
        let archive_id = conn.last_insert_rowid();
        for object in &objects {
            let raw = (object.kind == "table")
                .then(|| format!("org_history_raw_{archive_id}_{}", object.name));
            if let Some(raw) = &raw {
                // CTAS intentionally carries no indexes, triggers, foreign keys,
                // or execution constraints. SQLite copies BLOBs without decoding.
                conn.execute_batch(&format!(
                    "CREATE TABLE {} AS SELECT rowid AS __source_rowid, * FROM {}",
                    quoted(raw),
                    quoted(&object.name),
                ))?;
            }
            conn.execute(
                "INSERT INTO org_history_schema_objects
                 (archive_id,name,object_type,table_name,original_sql,raw_table)
                 VALUES (?1,?2,?3,?4,?5,?6)",
                params![
                    archive_id,
                    object.name,
                    object.kind,
                    object.table,
                    object.sql,
                    raw
                ],
            )?;
        }
        capture::retired_sessions(conn, fresh)?;
        capture::retired_items(conn)?;
        copies::backfill_retired(conn)?;
    }
    // FK actions are disabled by the owning initializer, not by this helper.
    // All schema/data changes and the completion marker share its transaction.
    for table in tables {
        conn.execute_batch(&format!("DROP TABLE {}", quoted(&table.name)))?;
    }
    conn.execute_batch(OLD_SCHEMA)?;
    debug_assert!(table_exists(conn, "agent_org_runtime_runs")?);
    Ok(())
}
