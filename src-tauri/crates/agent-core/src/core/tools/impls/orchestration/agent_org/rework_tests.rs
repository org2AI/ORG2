//! Explicit graph repair uses the same authority, tools and durable dispatch as production.
use super::*;

async fn update(member: &str, turn: &str, params: Value) -> Value {
    let call = if member == COORDINATOR_MEMBER_ID {
        coordinator_call()
    } else {
        owner_call(turn)
    };
    serde_json::from_str(
        &TaskUpdateTool::new(tools_context(member))
            .execute_text(params, &call)
            .await
            .unwrap(),
    )
    .unwrap()
}

async fn finish_task(task: &str, turn: &str, content: &str) -> Value {
    insert_owner_context(&database::db::get_connection().unwrap(), turn, task);
    update(ALICE, turn, json!({"operation":"start","id":task})).await;
    update(
        ALICE,
        turn,
        json!({
            "operation":"complete","id":task,
            "output":{"summary":"Checked deliverable", "content":content}
        }),
    )
    .await
}

#[test]
fn task_list_guidance_does_not_equate_closure_with_acceptance() {
    let list = TaskListTool::new(tools_context(COORDINATOR_MEMBER_ID));
    let description = list.description();
    assert!(description.contains("record closure, not acceptance"));
    assert!(description.contains("actual TaskOutput evidence"));
    assert!(description.contains("create missing work or dependent repair/verification"));
    assert!(!description.contains("state=ready means call"));
}

#[tokio::test]
async fn replacement_requires_explicit_consumer_patch_and_preserves_other_dependencies() {
    let _sandbox = sandbox();
    let old = create_owned("original-implementation", ALICE).await;
    let other = create_owned("independent-input", ALICE).await;
    let old_id = old["task"]["id"].as_str().unwrap();
    let other_id = other["task"]["id"].as_str().unwrap();
    let consumer: Value = serde_json::from_str(
        &TaskCreateTool::new(tools_context(COORDINATOR_MEMBER_ID))
            .execute_text(
                json!({
                    "subject":"Review both inputs", "owner_member_id": BOB,
                    "execution_mode":"build", "dispatch_policy":"after_dependencies",
                    "dependency_task_ids":[old_id,other_id]
                }),
                &coordinator_call(),
            )
            .await
            .unwrap(),
    )
    .unwrap();
    let consumer_id = consumer["task"]["id"].as_str().unwrap();
    let conn = database::db::get_connection().unwrap();
    insert_owner_context(&conn, "old-implementation-turn", old_id);
    update(
        ALICE,
        "old-implementation-turn",
        json!({"operation":"start","id":old_id}),
    )
    .await;
    // Replay the observed Stop -> coordinator replacement path. A still-live
    // owner must retain its handoff barrier, not be bypassed by this fixture.
    completion_wait_tests::finish(
        ALICE_SESSION,
        "old-implementation-turn",
        crate::lifecycle::TurnTerminalStatus::Cancelled,
    )
    .unwrap();
    let replaced = update(
        COORDINATOR_MEMBER_ID,
        "",
        json!({
            "operation":"cancel_and_replace", "id":old_id,
            "reason":{"code":"scope.changed","message":"Replace interrupted implementation"},
            "replacement":{
                "subject":"Replacement implementation", "owner_member_id":ALICE,
                "execution_mode":"build", "eligible_member_ids":[ALICE]
            }
        }),
    )
    .await;
    let replacement = replaced["replacement"]["id"].as_str().unwrap();
    assert_eq!(replaced["task"]["status"], "cancelled");
    assert_eq!(replaced["replacement"]["replaces_task_id"], old_id);
    let before_patch = AgentOrgTaskStore::get(RUN_ID, consumer_id)
        .unwrap()
        .unwrap();
    assert!(before_patch.blocked_by.contains(&old_id.to_string()));
    assert!(!before_patch.blocked_by.contains(&replacement.to_string()));

    let patch_call = coordinator_call();
    let patch = json!({"operation":"patch_pending","id":consumer_id,
        "blocked_by":[replacement,other_id]});
    let coordinator = TaskUpdateTool::new(tools_context(COORDINATOR_MEMBER_ID));
    let first = coordinator
        .execute_text(patch.clone(), &patch_call)
        .await
        .unwrap();
    assert_eq!(
        coordinator.execute_text(patch, &patch_call).await.unwrap(),
        first
    );
    let after_patch = AgentOrgTaskStore::get(RUN_ID, consumer_id)
        .unwrap()
        .unwrap();
    assert_eq!(after_patch.blocked_by.len(), 2);
    assert!(after_patch.blocked_by.contains(&replacement.to_string()));
    assert!(after_patch.blocked_by.contains(&other_id.to_string()));
    assert!(!after_patch.blocked_by.contains(&old_id.to_string()));

    TaskUpdateTool::new(tools_context(ALICE))
        .execute_text(
            json!({"operation":"complete","id":old_id,"output":{"summary":"late old output"}}),
            &owner_call("old-implementation-turn"),
        )
        .await
        .unwrap_err();
    assert!(
        AgentOrgTaskStore::get(RUN_ID, old_id)
            .unwrap()
            .unwrap()
            .output
            .is_none(),
        "rejected old execution cannot publish output"
    );
    let fixed = finish_task(
        replacement,
        "replacement-turn",
        "New implementation checked",
    )
    .await;
    assert_eq!(fixed["unblocked_task_assigned_ids"], json!([]));
    let other_done = finish_task(other_id, "other-input-turn", "Independent input checked").await;
    assert!(other_done["unblocked_task_assigned_ids"]
        .as_array()
        .unwrap()
        .iter()
        .any(|id| id == consumer_id));
    let assignments: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM agent_org_execution_inbox WHERE org_run_id=?1
         AND payload_kind='task_assigned' AND json_extract(payload_json,'$.task_id')=?2",
            rusqlite::params![RUN_ID, consumer_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        assignments, 1,
        "review is dispatched once, only after both new inputs finish"
    );
    assert_eq!(
        AgentOrgTaskStore::get(RUN_ID, old_id)
            .unwrap()
            .unwrap()
            .status,
        TaskStatus::Cancelled
    );
}

#[tokio::test]
async fn terminal_rework_keeps_old_evidence_and_runs_new_dependent_verification() {
    let _sandbox = sandbox();
    let old = create_owned("first-version", ALICE).await;
    let old_id = old["task"]["id"].as_str().unwrap();
    finish_task(
        old_id,
        "first-version-turn",
        "First version implemented; verification found a defect",
    )
    .await;
    let old_output = AgentOrgTaskStore::get(RUN_ID, old_id)
        .unwrap()
        .unwrap()
        .output;
    let graph: Value = serde_json::from_str(
        &TaskGraphCreateTool::new(tools_context(COORDINATOR_MEMBER_ID))
            .execute_text(
                json!({"tasks":[
                    {"key":"repair","subject":"Repair defect","owner_member_id":ALICE,
                     "execution_mode":"build","replaces_task_id":old_id},
                    {"key":"verify","subject":"Verify repaired version","owner_member_id":ALICE,
                     "execution_mode":"build","depends_on":["repair"]}
                ]}),
                &coordinator_call(),
            )
            .await
            .unwrap(),
    )
    .unwrap();
    let repair = graph["task_id_by_key"]["repair"].as_str().unwrap();
    let verify = graph["task_id_by_key"]["verify"].as_str().unwrap();
    assert_eq!(
        AgentOrgTaskStore::get(RUN_ID, verify)
            .unwrap()
            .unwrap()
            .status,
        TaskStatus::Pending
    );
    let result = finish_task(
        repair,
        "repair-turn",
        "Defect repaired; new verification still required",
    )
    .await;
    assert!(result["unblocked_task_assigned_ids"]
        .as_array()
        .unwrap()
        .iter()
        .any(|id| id == verify));
    finish_task(
        verify,
        "new-verification-turn",
        "Executed repaired artifact: 4 tests passed; report at checks.txt",
    )
    .await;
    assert_eq!(
        AgentOrgTaskStore::get(RUN_ID, old_id)
            .unwrap()
            .unwrap()
            .output,
        old_output
    );
    let actual = AgentOrgTaskStore::get(RUN_ID, verify).unwrap().unwrap();
    assert_eq!(actual.blocked_by, vec![repair.to_string()]);
    assert!(actual
        .output
        .unwrap()
        .content
        .unwrap()
        .contains("4 tests passed"));
}
