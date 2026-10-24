//! Single production owner for persistence crash reconciliation.
//!
//! Schema initialization is deliberately pure. This module runs once after
//! the EventStore exists, returns the exact durable Agent Org receipts it
//! created, and rings only those doorbells after AgentAppState is managed.

use std::collections::BTreeMap;

use agent_core::coordination::agent_org_runs::{
    AgentOrgRunStore, AgentOrgStartupRecoveryPlan, COORDINATOR_MEMBER_ID,
};
use agent_core::tools::impls::orchestration::org_send_message::InboxWakeHook;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersistenceStartupRecoveryReport {
    pub ordinary_turn_intents_reconciled: usize,
    pub agent_org_turn_intents_reconciled: usize,
    pub terminal_sessions_reconciled: usize,
    pub sessions_abandoned: usize,
    pub agent_org: AgentOrgStartupRecoveryPlan,
}

pub(crate) fn run_persistence_startup_recovery() -> Result<PersistenceStartupRecoveryReport, String>
{
    let conn = database::db::get_connection()
        .map_err(|error| format!("open sessions database for startup recovery failed: {error}"))?;
    // Each recovery phase owns different durable state. Do not short-circuit
    // the stale-session sweep if an auxiliary turn-intent table is missing or
    // corrupt: that leaves phantom "running" rows on *every* later restart.
    // Retain errors and report them after the independent cleanup attempts.
    let ordinary_result =
        session_persistence::turn_intents::reconcile_in_flight_after_restart(&conn)
            .map_err(|error| format!("ordinary turn-intent recovery failed: {error}"));
    let agent_org_intents_result =
        agent_core::coordination::reconcile_agent_org_turns_after_restart(&conn)
            .map_err(|error| format!("Agent Org turn-intent recovery failed: {error}"));
    drop(conn);

    // Terminal markers are stronger evidence than the stale in-flight flag,
    // so preserve their ordering even when either operation fails.
    let terminal_result =
        agent_core::session::persistence::reconcile_sessions_with_terminal_turn_markers()
            .map_err(|error| format!("terminal session-marker recovery failed: {error}"));
    let abandon_result =
        agent_core::session::persistence::mark_stale_running_sessions_abandoned()
            .map_err(|error| format!("stale session recovery failed: {error}"));

    // Log every failed phase; the first error remains the caller's result.
    // Attempt the Agent Org requeue independently, after session repair.
    let agent_org_result = AgentOrgRunStore::requeue_abandoned_member_tasks_on_startup()
        .map_err(|error| format!("Agent Org TaskExecution recovery failed: {error}"));

    let mut errors = Vec::new();
    for result in [
        ordinary_result.as_ref().map(|_| ()),
        agent_org_intents_result.as_ref().map(|_| ()),
        terminal_result.as_ref().map(|_| ()),
        abandon_result.as_ref().map(|_| ()),
        agent_org_result.as_ref().map(|_| ()),
    ] {
        if let Err(error) = result {
            tracing::warn!(error = %error, "[StartupRecovery] recovery phase failed");
            errors.push(error.to_string());
        }
    }
    if !errors.is_empty() {
        return Err(errors.join("; "));
    }

    let ordinary_turn_intents_reconciled = ordinary_result.expect("recovery phase checked");
    let agent_org_turn_intents_reconciled = agent_org_intents_result.expect("recovery phase checked");
    let terminal_sessions_reconciled = terminal_result.expect("recovery phase checked");
    let sessions_abandoned = abandon_result.expect("recovery phase checked");
    let agent_org = agent_org_result.expect("recovery phase checked");

    Ok(PersistenceStartupRecoveryReport {
        ordinary_turn_intents_reconciled,
        agent_org_turn_intents_reconciled,
        terminal_sessions_reconciled,
        sessions_abandoned,
        agent_org,
    })
}

pub(crate) fn dispatch_agent_org_recovery_receipts(
    app_handle: tauri::AppHandle,
    plan: &AgentOrgStartupRecoveryPlan,
) {
    let mut receipts_by_run = BTreeMap::<String, Vec<String>>::new();
    for recovery in &plan.recovered_tasks {
        let Some(receipt_id) = recovery.receipt_id.as_ref() else {
            continue;
        };
        receipts_by_run
            .entry(recovery.task.org_run_id.clone())
            .or_default()
            .push(receipt_id.clone());
    }

    let wake_hook =
        agent_core::tools::impls::orchestration::inbox_wake::AppHandleInboxWakeHook::new(
            app_handle,
        );
    for (org_run_id, receipt_ids) in receipts_by_run {
        wake_hook.wake_member_for_formal_receipts(COORDINATOR_MEMBER_ID, &org_run_id, &receipt_ids);
    }
}
