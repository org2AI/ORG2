//! Pause preserves completed deliveries, but unfinished tasks must release
//! their writers before Resume can admit another execution.

use crate::coordination::agent_org_runs::{AgentOrgRunStatus, AgentOrgRunStore};
use crate::coordination::agent_org_tasks::AgentOrgTaskStore;
use crate::tools::impls::coding::exec::registry;
use std::time::Duration;

pub(crate) async fn release_user_directed_resources(
    receipt_id: &str,
    owner: &crate::tools::call_context::TurnProcessOwner,
    timeout: Duration,
) -> Result<(), String> {
    let receipt_id = receipt_id.to_string();
    let owner = owner.clone();
    let owners = tokio::task::spawn_blocking(move || {
        database::db::with_sessions_writer(|| -> Result<_, String> {
            let receipt = crate::coordination::agent_member_interventions::AgentMemberInterventionStore::get_by_receipt(&receipt_id)?
                .ok_or_else(|| "member intervention receipt missing".to_string())?;
            if receipt.status != crate::coordination::agent_member_interventions::MemberInterventionStatus::YieldRequested
                || receipt.session_id != owner.session_id
                || receipt.original_turn_intent_id.as_deref() != Some(owner.turn_intent_id.as_str())
                || receipt.runtime_lease_id.as_deref() != Some(owner.runtime_lease_id.as_str())
                || receipt.dialog_turn_generation.as_deref() != Some(owner.dialog_turn_generation.as_str())
            {
                return Err("member intervention no longer owns this execution".into());
            }
            let conn = database::db::get_connection().map_err(|error| error.to_string())?;
            let tasks = AgentOrgTaskStore::list_with_connection(&conn, &receipt.org_run_id)?;
            let unfinished = tasks.into_iter()
                .filter(|task| task.status.is_open() && Some(&task.id) == receipt.original_task_id.as_ref())
                .map(|task| task.id).collect();
            let mut owners = registry::resource_owners_for_tasks(&receipt.org_run_id, &unfinished);
            owners.insert(owner);
            Ok(owners)
        })
    }).await.map_err(|error| format!("member resource snapshot failed: {error}"))??;
    release_owners(owners, timeout).await
}

pub(super) async fn release_paused_task_resources(
    run_id: &str,
    timeout: Duration,
) -> Result<(), String> {
    let run_id = run_id.to_string();
    let owners = tokio::task::spawn_blocking(move || {
        database::db::with_sessions_writer(|| -> Result<_, String> {
            let conn = database::db::get_connection().map_err(|error| error.to_string())?;
            if AgentOrgRunStore::get_run_status_with_connection(&conn, &run_id)?
                != Some(AgentOrgRunStatus::Paused)
            {
                return Ok(Default::default());
            }
            let unfinished = AgentOrgTaskStore::list_with_connection(&conn, &run_id)?
                .into_iter()
                .filter(|task| task.status.is_open())
                .map(|task| task.id)
                .collect();
            // Snapshot exact owners while Resume is excluded by the writer
            // boundary. A delayed cleanup cannot capture a resumed execution.
            Ok(registry::resource_owners_for_tasks(&run_id, &unfinished))
        })
    })
    .await
    .map_err(|error| format!("paused resource snapshot failed: {error}"))??;
    release_owners(owners, timeout).await
}

async fn release_owners(
    owners: std::collections::HashSet<crate::tools::call_context::TurnProcessOwner>,
    timeout: Duration,
) -> Result<(), String> {
    let results = tokio::time::timeout(
        timeout,
        futures::future::join_all(
            owners
                .iter()
                .map(|owner| registry::cancel_and_await_jobs_for_owner(owner, timeout)),
        ),
    )
    .await
    .map_err(|_| "task resources did not stop before the deadline".to_string())?;
    let errors = results
        .into_iter()
        .filter_map(Result::err)
        .collect::<Vec<_>>();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}
