use super::*;
use crate::tools::call_context::{TurnProcessControl, TurnProcessOwner};
use crate::tools::impls::coding::exec::registry;
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn terminal_task_replacement_waits_for_prior_turn_resource_release() {
    let _sandbox = sandbox();
    let original = create_owned("replace-delivered-service", ALICE).await;
    let id = original["task"]["id"].as_str().unwrap();
    let conn = database::db::get_connection().unwrap();
    insert_owner_context(&conn, "delivered-turn", id);
    let tool = TaskUpdateTool::new(tools_context(ALICE));
    tool.execute_text(
        json!({"operation":"start","id":id}),
        &owner_call("delivered-turn"),
    )
    .await
    .unwrap();
    tool.execute_text(
        json!({"operation":"complete","id":id,"output":{"summary":"Service ready"}}),
        &owner_call("delivered-turn"),
    )
    .await
    .unwrap();

    let control = TurnProcessControl {
        owner: TurnProcessOwner {
            session_id: ALICE_SESSION.into(),
            turn_intent_id: "delivered-turn".into(),
            runtime_lease_id: "delivered-lease".into(),
            dialog_turn_generation: "delivered-generation".into(),
        },
        background_cancel: CancellationToken::new(),
        is_agent_org: true,
    };
    let cancel = CancellationToken::new();
    let handle = format!("shell-{}", uuid::Uuid::new_v4());
    let completion = registry::register_managed_shell(registry::ManagedShellRegistration {
        handle: &handle,
        pid: 99_939,
        command: "old service",
        log_path: Default::default(),
        session_id: ALICE_SESSION,
        call_id: "delivered-service-call",
        control: Some(&control),
        org_scope: Some(registry::OrgResourceScope {
            org_run_id: RUN_ID.into(),
            task_id: Some(id.into()),
        }),
        cancel: cancel.clone(),
    })
    .unwrap();
    registry::detach_shell(&handle);
    let stopped_handle = handle.clone();
    let released = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let released_observer = Arc::clone(&released);
    let monitor = tokio::spawn(async move {
        cancel.cancelled().await;
        // A killed verdict alone does not release the output-write boundary.
        registry::mark_exited(&stopped_handle, registry::JobStatus::Killed);
        tokio::task::yield_now().await;
        released_observer.store(true, Ordering::SeqCst);
        completion.finish(Ok(()));
    });
    let result = TaskCreateTool::new(tools_context(COORDINATOR_MEMBER_ID))
        .execute_text(
            json!({
                "subject":"Replace delivered service", "owner_member_id":ALICE,
                "dispatch_policy":"immediate", "execution_mode":"build",
                "allow_parallel_with_unlisted_open_tasks":true, "replaces_task_id":id,
            }),
            &coordinator_call(),
        )
        .await;
    if result.is_err() {
        registry::remove(&handle);
        monitor.abort();
    }
    let replacement: Value = serde_json::from_str(&result.unwrap()).unwrap();
    assert!(released.load(Ordering::SeqCst));
    monitor.await.unwrap();
    assert_eq!(replacement["task"]["status"], "pending");
    assert_eq!(replacement["task"]["replaces_task_id"], id);
    assert!(registry::get_status(&handle).is_none());
    assert_eq!(
        AgentOrgTaskStore::get(RUN_ID, id).unwrap().unwrap().status,
        TaskStatus::Completed
    );
}
