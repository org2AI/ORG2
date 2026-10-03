use super::*;
use crate::tools::call_context::{TurnProcessControl, TurnProcessOwner};
use crate::tools::impls::coding::exec::registry;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn pause_drains_unfinished_task_resources_and_preserves_completed_services() {
    verify_task_resource_teardown(false).await;
}

#[tokio::test]
async fn member_yield_drains_prior_task_turns_and_preserves_completed_services() {
    verify_task_resource_teardown(true).await;
}

async fn verify_task_resource_teardown(intervention: bool) {
    let _sandbox = test_helpers::test_env::sandbox();
    let context = prepare_command_run("paused");
    let conn = get_connection().unwrap();
    let now = chrono::Utc::now().to_rfc3339();
    let mut jobs = Vec::new();
    for (task, status) in [
        ("unfinished-service", "in_progress"),
        ("completed-service", "completed"),
    ] {
        let output = (status == "completed").then(|| {
            serde_json::to_string(&crate::coordination::agent_org_tasks::TaskOutput {
                summary: "delivered".into(),
                content: None,
                artifact_ids: Vec::new(),
                plan_revision_id: None,
                produced_by_member_id: "member-planner".into(),
                produced_at: now.clone(),
            })
            .unwrap()
        });
        conn.execute("INSERT INTO agent_org_execution_tasks (
            id,org_run_id,activation_generation,subject,description,owner,status,execution_mode,
            blocked_by_json,created_by_participant_id,source_turn_intent_id,created_at,updated_at,output_json
        ) VALUES (?1,?2,1,?1,'service','member-planner',?3,'build','[]','coordinator','seed',?4,?4,
                  ?5)",
            params![task, context.run_id, status, now, output]).unwrap();
        let control = TurnProcessControl {
            owner: TurnProcessOwner {
                session_id: format!("session-{task}"),
                turn_intent_id: task.into(),
                runtime_lease_id: format!("lease-{task}"),
                dialog_turn_generation: format!("generation-{task}"),
            },
            background_cancel: CancellationToken::new(),
            is_agent_org: true,
        };
        let handle = format!("shell-{}", uuid::Uuid::new_v4());
        let cancel = CancellationToken::new();
        let completion = registry::register_managed_shell(registry::ManagedShellRegistration {
            handle: &handle,
            pid: 99_940,
            command: "service",
            log_path: Default::default(),
            session_id: &control.owner.session_id,
            call_id: task,
            control: Some(&control),
            org_scope: Some(registry::OrgResourceScope {
                org_run_id: context.run_id.clone(),
                task_id: Some(task.into()),
            }),
            cancel: cancel.clone(),
        })
        .unwrap();
        registry::detach_shell(&handle);
        jobs.push((handle, cancel, completion));
    }
    let (completed, completed_cancel, completed_monitor) = jobs.pop().unwrap();
    let (unfinished, unfinished_cancel, unfinished_monitor) = jobs.pop().unwrap();
    let monitor = tokio::spawn(async move {
        unfinished_cancel.cancelled().await;
        registry::mark_exited(&unfinished, registry::JobStatus::Killed);
        unfinished_monitor.finish(Ok(()));
    });
    let result = if intervention {
        let owner = TurnProcessOwner {
            session_id: "session-unfinished-service".into(),
            turn_intent_id: "newer-turn".into(),
            runtime_lease_id: "newer-lease".into(),
            dialog_turn_generation: "newer-generation".into(),
        };
        conn.execute("INSERT INTO agent_org_execution_member_interventions (
            intervention_receipt_id,org_run_id,member_id,agent_id,session_id,status,source_event_id,
            original_task_id,original_turn_intent_id,runtime_lease_id,dialog_turn_generation,
            entered_at,last_user_activity_at,updated_at
        ) VALUES ('yield-resource-receipt',?1,'member-planner','builtin:sde',?2,'yield_requested','direct-event',
                  'unfinished-service',?3,?4,?5,?6,?6,?6)",
            params![context.run_id, owner.session_id, owner.turn_intent_id, owner.runtime_lease_id,
                owner.dialog_turn_generation, now]).unwrap();
        super::super::resource_teardown::release_user_directed_resources(
            "yield-resource-receipt",
            &owner,
            Duration::from_secs(2),
        )
        .await
    } else {
        super::super::resource_teardown::release_paused_task_resources(
            &context.run_id,
            Duration::from_secs(2),
        )
        .await
    };
    let completed_preserved = !completed_cancel.is_cancelled();
    registry::mark_exited(&completed, registry::JobStatus::Exited(0));
    completed_monitor.finish(Ok(()));
    registry::remove(&completed);
    result.unwrap();
    monitor.await.unwrap();
    assert!(completed_preserved);
}
