//! Atomic cutover to isolated execution, with a frozen v2.0.8 compatibility area.

use std::collections::BTreeMap;

use rusqlite::{ffi, Connection, Error as SqliteError, Result as SqliteResult};
use sha2::{Digest, Sha256};

use super::{
    agent_inbox, agent_member_interventions, agent_org_archive, agent_org_final_summary,
    agent_org_formal_triggers, agent_org_pause, agent_org_plan_approvals, agent_org_run_completion,
    agent_org_runs, agent_org_task_handoffs, agent_org_tasks, agent_org_tool_receipts,
    agent_org_turn_contexts, agent_org_user_directed_work, agent_org_watchdog,
    agent_org_work_episodes,
};

const RUNTIME_TABLES: [&str; 39] = [
    "agent_org_execution_archive_episodes",
    "agent_org_execution_archive_teardowns",
    "agent_org_execution_coordinator_completion_rechecks",
    "agent_org_execution_final_summary_receipts",
    "agent_org_execution_formal_trigger_attempts",
    "agent_org_execution_formal_trigger_receipts",
    "agent_org_execution_inbox",
    "agent_org_execution_inbox_delivery_resolutions",
    "agent_org_execution_inbox_materializations",
    "agent_org_execution_inbox_task_bindings",
    "agent_org_execution_initial_inputs",
    "agent_org_execution_member_dispatch_allocators",
    "agent_org_execution_member_intervention_turns",
    "agent_org_execution_member_interventions",
    "agent_org_execution_member_materializations",
    "agent_org_execution_member_turn_admissions",
    "agent_org_execution_pause_episodes",
    "agent_org_execution_pause_handoffs",
    "agent_org_execution_plan_decisions",
    "agent_org_execution_plan_revisions",
    "agent_org_execution_recovery_attempts",
    "agent_org_execution_run_completion_certificates",
    "agent_org_execution_run_progress",
    "agent_org_execution_runs",
    "agent_org_execution_scope_removal_receipts",
    "agent_org_execution_scope_resolution_receipts",
    "agent_org_execution_task_annotations",
    "agent_org_execution_task_events",
    "agent_org_execution_task_execution_handoffs",
    "agent_org_execution_task_execution_leases",
    "agent_org_execution_task_execution_reconciliations",
    "agent_org_execution_tasks",
    "agent_org_execution_tool_call_receipts",
    "agent_org_execution_turn_contexts",
    "agent_org_execution_user_directed_coordinator_bindings",
    "agent_org_execution_user_directed_deliveries",
    "agent_org_execution_user_directed_roots",
    "agent_org_execution_work_episode_tasks",
    "agent_org_execution_work_episodes",
];

const RUNTIME_INDEXES: [&str; 79] = [
    "idx_agent_org_execution_archive_pending",
    "idx_agent_org_execution_archive_teardown_pending",
    "idx_agent_org_execution_completion_recheck_inbox",
    "idx_agent_org_execution_completion_recheck_pending",
    "idx_agent_org_execution_final_summary_one_active",
    "idx_agent_org_execution_final_summary_public_timeline",
    "idx_agent_org_execution_final_summary_run_current",
    "idx_agent_org_execution_final_summary_turn",
    "idx_agent_org_execution_formal_trigger_attempt_turn",
    "idx_agent_org_execution_formal_trigger_missing_doorbell",
    "idx_agent_org_execution_formal_trigger_one_active_attempt",
    "idx_agent_org_execution_formal_trigger_pending",
    "idx_agent_org_execution_formal_trigger_task",
    "idx_agent_org_execution_inbox_causation_recipient_once",
    "idx_agent_org_execution_inbox_delivery_resolutions_run",
    "idx_agent_org_execution_inbox_materializations_session",
    "idx_agent_org_execution_inbox_org_run",
    "idx_agent_org_execution_inbox_org_run_id",
    "idx_agent_org_execution_inbox_recipient_member_unread",
    "idx_agent_org_execution_inbox_recipient_unread",
    "idx_agent_org_execution_inbox_request_id",
    "idx_agent_org_execution_inbox_run_kind_id",
    "idx_agent_org_execution_inbox_run_task_assignment_v4",
    "idx_agent_org_execution_inbox_run_unread_recipient",
    "idx_agent_org_execution_inbox_task_bindings_wake",
    "idx_agent_org_execution_inbox_user_message_once",
    "idx_agent_org_execution_initial_inputs_dispatch",
    "idx_agent_org_execution_member_intervention_active",
    "idx_agent_org_execution_member_intervention_continuation",
    "idx_agent_org_execution_member_intervention_public_timeline",
    "idx_agent_org_execution_member_intervention_return_request",
    "idx_agent_org_execution_member_intervention_session",
    "idx_agent_org_execution_member_intervention_turn_queue",
    "idx_agent_org_execution_member_materializations_pending",
    "idx_agent_org_execution_member_turn_admission_recovery",
    "idx_agent_org_execution_pause_capture",
    "idx_agent_org_execution_pause_dispatch",
    "idx_agent_org_execution_pause_drain",
    "idx_agent_org_execution_pause_one_active",
    "idx_agent_org_execution_pause_public_timeline",
    "idx_agent_org_execution_pause_request",
    "idx_agent_org_execution_plan_decisions_status",
    "idx_agent_org_execution_plan_revisions_path",
    "idx_agent_org_execution_plan_revisions_run_task",
    "idx_agent_org_execution_plan_revisions_source_session_turn",
    "idx_agent_org_execution_recovery_attempts_run",
    "idx_agent_org_execution_resume_public_timeline",
    "idx_agent_org_execution_run_completion_certificates_turn",
    "idx_agent_org_execution_run_completion_public_timeline",
    "idx_agent_org_execution_runs_org_updated",
    "idx_agent_org_execution_runs_root_session",
    "idx_agent_org_execution_runs_status",
    "idx_agent_org_execution_runs_work_item",
    "idx_agent_org_execution_scope_removal_episode",
    "idx_agent_org_execution_scope_resolution_episode",
    "idx_agent_org_execution_task_annotations_page",
    "idx_agent_org_execution_task_events_run",
    "idx_agent_org_execution_task_events_task",
    "idx_agent_org_execution_task_execution_handoffs_replacement",
    "idx_agent_org_execution_task_execution_handoffs_run",
    "idx_agent_org_execution_task_execution_one_live",
    "idx_agent_org_execution_task_execution_reconciliation_task",
    "idx_agent_org_execution_task_execution_task",
    "idx_agent_org_execution_task_execution_turn",
    "idx_agent_org_execution_tasks_history_page",
    "idx_agent_org_execution_tasks_owner",
    "idx_agent_org_execution_tasks_page",
    "idx_agent_org_execution_tasks_replacement",
    "idx_agent_org_execution_turn_contexts_group_root_session",
    "idx_agent_org_execution_turn_contexts_member_sequence",
    "idx_agent_org_execution_turn_contexts_public_timeline",
    "idx_agent_org_execution_turn_contexts_source",
    "idx_agent_org_execution_udw_coordinator_pending",
    "idx_agent_org_execution_udw_member_fifo",
    "idx_agent_org_execution_udw_pending_recovery",
    "idx_agent_org_execution_udw_source_inbox",
    "idx_agent_org_execution_work_episode_tasks_episode",
    "idx_agent_org_execution_work_episodes_active",
    "idx_agent_org_execution_work_episodes_current",
];

const RUNTIME_TRIGGERS: [&str; 1] = ["trg_agent_org_execution_plan_revisions_immutable"];
const RUNTIME_MANIFEST_SHA256: &str =
    "547907b63c1a2c3a7d27a57fbe3642efb4349acc4090581910b0ee915e58c5eb";

const RUNTIME_OBJECTS_QUERY: &str = "SELECT type, name, tbl_name, sql
     FROM sqlite_master
     WHERE sql IS NOT NULL
       AND type IN ('table', 'index', 'trigger')
       AND (name LIKE 'agent_org_execution_%' OR tbl_name LIKE 'agent_org_execution_%')
     ORDER BY type, name";

type SchemaManifest = BTreeMap<(String, String), (String, String)>;

pub(super) fn initialize(conn: &Connection) -> SqliteResult<()> {
    // Private tables contain cycles. Disable FK actions on this connection only
    // while atomically copying and retiring them; otherwise DROP could cascade
    // into data before its raw archive is written. Always restore caller policy.
    if !conn.is_autocommit() {
        return Err(schema_error(
            "Agent Org initialization requires its own transaction".into(),
        ));
    }
    let foreign_keys: bool = conn.pragma_query_value(None, "foreign_keys", |row| row.get(0))?;
    conn.pragma_update(None, "foreign_keys", false)?;
    let result = initialize_transaction(conn);
    let restore = conn.pragma_update(None, "foreign_keys", foreign_keys);
    result.and(restore)
}

fn initialize_transaction(conn: &Connection) -> SqliteResult<()> {
    let expected = expected_manifest()?;
    let tx = database::db::begin_immediate(conn)?;
    let actual = read_manifest(&tx)?;
    let ready = super::agent_org_history_store::cutover_complete(&tx)?;
    let fresh = actual.is_empty() && !ready;
    if !fresh {
        // A completion marker with missing tables is corruption, including a
        // completely missing execution area. Never silently reset live teams.
        verify_manifest(&tx, &expected)?;
    }
    super::agent_org_history_store::prepare_cutover(&tx, fresh)?;
    if fresh {
        create_runtime_schema(&tx)?;
    }
    verify_manifest(&tx, &expected)?;
    agent_inbox::repair_dangling_materializations(&tx)?;
    super::agent_org_history_store::finish_cutover(&tx)?;
    tx.commit()?;
    Ok(())
}

fn create_runtime_schema(conn: &Connection) -> SqliteResult<()> {
    agent_org_runs::create_schema(conn)?;
    agent_org_work_episodes::create_schema(conn)?;
    agent_org_run_completion::create_schema(conn)?;
    agent_inbox::create_schema(conn)?;
    agent_org_formal_triggers::create_schema(conn)?;
    agent_org_tasks::create_schema(conn)?;
    agent_org_task_handoffs::create_schema(conn)?;
    agent_org_plan_approvals::create_schema(conn)?;
    agent_org_final_summary::create_schema(conn)?;
    agent_member_interventions::create_schema(conn)?;
    agent_org_watchdog::create_schema(conn)?;
    agent_org_turn_contexts::create_schema(conn)?;
    agent_org_user_directed_work::create_schema(conn)?;
    agent_org_pause::create_schema(conn)?;
    agent_org_archive::create_schema(conn)?;
    agent_org_tool_receipts::create_schema(conn)?;
    super::agent_org_finality::create_schema(conn)?;
    agent_member_interventions::create_runtime_admission_schema(conn)
}

fn expected_manifest() -> SqliteResult<SchemaManifest> {
    let expected = Connection::open_in_memory()?;
    expected.execute_batch("PRAGMA foreign_keys=ON;")?;
    create_runtime_schema(&expected)?;
    let manifest = read_manifest(&expected)?;
    verify_frozen_runtime_contract(&manifest)?;
    Ok(manifest)
}

fn manifest_object_names(manifest: &SchemaManifest, object_type: &str) -> Vec<String> {
    manifest
        .keys()
        .filter(|(kind, _)| kind == object_type)
        .map(|(_, name)| name.clone())
        .collect()
}

fn sorted_names(names: &[&str]) -> Vec<String> {
    let mut names = names
        .iter()
        .map(|name| (*name).to_string())
        .collect::<Vec<_>>();
    names.sort_unstable();
    names
}

fn manifest_snapshot(manifest: &SchemaManifest) -> String {
    manifest
        .iter()
        .map(|((object_type, name), (table_name, sql))| {
            format!(
                "{object_type}|{name}|{table_name}|{:x}\n",
                Sha256::digest(sql.as_bytes())
            )
        })
        .collect()
}

fn verify_frozen_runtime_contract(manifest: &SchemaManifest) -> SqliteResult<()> {
    let tables = manifest_object_names(manifest, "table");
    let indexes = manifest_object_names(manifest, "index");
    let triggers = manifest_object_names(manifest, "trigger");
    let digest = format!(
        "{:x}",
        Sha256::digest(manifest_snapshot(manifest).as_bytes())
    );
    if tables == sorted_names(&RUNTIME_TABLES)
        && indexes == sorted_names(&RUNTIME_INDEXES)
        && triggers == sorted_names(&RUNTIME_TRIGGERS)
        && digest == RUNTIME_MANIFEST_SHA256
    {
        return Ok(());
    }
    Err(schema_error(format!(
        "compiled Agent Org runtime schema differs from the frozen final compatibility contract; tables={}/{}, indexes={}/{}, triggers={}/{}, digest={digest}",
        tables.len(),
        RUNTIME_TABLES.len(),
        indexes.len(),
        RUNTIME_INDEXES.len(),
        triggers.len(),
        RUNTIME_TRIGGERS.len(),
    )))
}

fn verify_manifest(conn: &Connection, expected: &SchemaManifest) -> SqliteResult<()> {
    let actual = read_manifest(conn)?;
    if &actual == expected {
        return Ok(());
    }

    let missing = expected
        .keys()
        .filter(|key| !actual.contains_key(*key))
        .cloned()
        .collect::<Vec<_>>();
    let unexpected = actual
        .keys()
        .filter(|key| !expected.contains_key(*key))
        .cloned()
        .collect::<Vec<_>>();
    let changed = expected
        .iter()
        .filter(|(key, value)| actual.get(*key).is_some_and(|item| item != *value))
        .map(|(key, _)| key.clone())
        .collect::<Vec<_>>();
    Err(schema_error(format!(
        "unknown Agent Org runtime schema; missing={missing:?}, unexpected={unexpected:?}, changed={changed:?}"
    )))
}

fn read_manifest(conn: &Connection) -> SqliteResult<SchemaManifest> {
    let mut statement = conn.prepare(RUNTIME_OBJECTS_QUERY)?;
    let rows = statement.query_map([], |row| {
        let object_type: String = row.get(0)?;
        let name: String = row.get(1)?;
        let table_name: String = row.get(2)?;
        let sql: String = row.get(3)?;
        Ok(((object_type, name), (table_name, sql.trim().to_string())))
    })?;
    rows.collect()
}

fn schema_error(message: String) -> SqliteError {
    SqliteError::SqliteFailure(ffi::Error::new(ffi::SQLITE_SCHEMA), Some(message))
}

#[cfg(test)]
#[path = "schema_tests.rs"]
mod tests;
