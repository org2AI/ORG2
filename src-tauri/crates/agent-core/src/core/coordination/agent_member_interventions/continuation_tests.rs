use super::*;

fn returned_task(prefix: &str) -> (DirectFixture, String, String, String) {
    let (fixture, accepted, task_id, original) = create_recoverable_formal_intervention(prefix);
    crate::coordination::agent_org_finality::finalize_turn(
        &fixture.member_session_id,
        &original,
        crate::lifecycle::TurnTerminalStatus::Cancelled,
        "user_directed_yield",
    )
    .expect("release original formal execution authority");
    let returned = AgentMemberInterventionStore::return_to_work(
        &fixture.member_session_id,
        &accepted.intervention.intervention_receipt_id,
        prefix,
    )
    .expect("explicit Return commits");
    let continuation = returned
        .continuation_turn_intent_id
        .expect("formal continuation");
    (fixture, task_id, original, continuation)
}

#[test]
fn explicit_return_supplies_bound_task_instruction_without_new_input_rows() {
    let _sandbox = test_helpers::test_env::sandbox();
    let (fixture, task_id, original, continuation) = returned_task("return-input");
    let conn = get_connection().expect("database");
    let counts = || {
        [
            "events",
            "agent_org_execution_inbox",
            "session_turn_intents",
        ]
        .map(|table| {
            conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap()
        })
    };
    let before = counts();
    let nudge = continuation_nudge_for_turn(&fixture.member_session_id, &continuation)
        .expect("read Return authority")
        .expect("Return must not continue the latest direct user request");
    assert!(nudge.contains(&task_id));
    assert!(nudge.contains("task_get"));
    assert!(nudge.contains("direct conversation has ended"));
    assert!(nudge.contains("not a request to repeat"));
    assert_eq!(
        continuation_nudge_for_turn(&fixture.member_session_id, &continuation).unwrap(),
        Some(nudge),
        "repeated projection must be stable"
    );
    assert!(
        continuation_nudge_for_turn(&fixture.member_session_id, &original)
            .unwrap()
            .is_none()
    );
    assert!(
        continuation_nudge_for_turn("another-session", &continuation)
            .unwrap()
            .is_none()
    );
    assert_eq!(
        before,
        counts(),
        "provider-only context must not fabricate user/inbox rows"
    );
}

#[test]
fn direct_work_and_return_without_original_task_get_no_formal_instruction() {
    let _sandbox = test_helpers::test_env::sandbox();
    let fixture = create_fixture("return-no-task", AgentOrgRunStatus::Idle);
    seed_direct_source(&fixture, "direct-event", "direct-turn", "temporary request");
    let accepted = enqueue(
        &fixture,
        "direct-event",
        "direct-turn",
        "temporary request",
        32,
    )
    .expect("direct work");
    assert!(
        continuation_nudge_for_turn(&fixture.member_session_id, "direct-turn")
            .unwrap()
            .is_none()
    );
    mark_direct_terminal(&fixture, "direct-turn");
    let returned = AgentMemberInterventionStore::return_to_work(
        &fixture.member_session_id,
        &accepted.intervention.intervention_receipt_id,
        "return-no-task",
    )
    .expect("Return without old task");
    assert!(returned.continuation_turn_intent_id.is_none());
    assert!(
        continuation_nudge_for_turn(&fixture.member_session_id, "direct-turn")
            .unwrap()
            .is_none()
    );
}

#[test]
fn return_instruction_revalidates_generation_and_task_before_provider() {
    let _sandbox = test_helpers::test_env::sandbox();
    let (fixture, task_id, _, continuation) = returned_task("return-stale-input");
    let conn = get_connection().expect("database");
    conn.execute(
        "UPDATE agent_org_execution_runs SET activation_generation=2 WHERE id=?1",
        [&fixture.run_id],
    )
    .unwrap();
    assert!(continuation_nudge_for_turn(&fixture.member_session_id, &continuation).is_err());
    conn.execute(
        "UPDATE agent_org_execution_runs SET activation_generation=1 WHERE id=?1",
        [&fixture.run_id],
    )
    .unwrap();
    conn.execute(
        "UPDATE agent_org_execution_tasks SET status='completed',output_json='{}' WHERE org_run_id=?1 AND id=?2",
        params![fixture.run_id, task_id],
    )
    .unwrap();
    assert!(continuation_nudge_for_turn(&fixture.member_session_id, &continuation).is_err());
    conn.execute(
        "UPDATE agent_org_execution_tasks SET status='in_progress',output_json=NULL WHERE org_run_id=?1 AND id=?2",
        params![fixture.run_id, task_id],
    )
    .unwrap();
    conn.execute("UPDATE session_turn_intents SET status='cancelled' WHERE session_id=?1 AND turn_intent_id=?2", params![fixture.member_session_id,continuation]).unwrap();
    assert!(
        continuation_nudge_for_turn(&fixture.member_session_id, &continuation)
            .unwrap()
            .is_none()
    );
    conn.execute_batch("DROP TABLE agent_org_execution_member_interventions")
        .unwrap();
    assert!(
        continuation_nudge_for_turn(&fixture.member_session_id, &continuation).is_err(),
        "storage errors are not empty continuation"
    );
}
