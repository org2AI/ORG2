use super::*;

#[test]
fn no_formal_work_is_normal_and_does_not_allocate_a_turn() {
    let conn = connection();
    let result = accept_wake_with_connection(
        &conn,
        RUN_ID,
        MEMBER_SESSION_ID,
        "empty-wake",
        None,
        MEMBER_ID,
    );
    assert!(
        matches!(result, Ok(WakeAdmission::NoReadyWork)),
        "no work is a normal admission result: {result:?}"
    );
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM session_turn_intents WHERE turn_intent_id='empty-wake'",
            [],
            |row| row.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
}

fn wake(
    conn: &Connection,
    turn: &str,
    member: &str,
) -> Result<WakeAdmission<AgentOrgTurnContext>, String> {
    accept_wake_with_connection(
        conn,
        RUN_ID,
        if member == COORDINATOR_MEMBER_ID {
            ROOT_SESSION_ID
        } else {
            MEMBER_SESSION_ID
        },
        turn,
        None,
        member,
    )
}

#[test]
fn obsolete_assignment_keeps_its_unread_evidence_and_new_work_gets_admitted() {
    let conn = connection();
    let obsolete = insert_task_assignment(&conn, "task-a");
    conn.execute(
        "UPDATE agent_org_execution_tasks SET status='completed' WHERE id='task-a'",
        [],
    )
    .unwrap();
    for id in ["late-first", "late-repeat"] {
        assert!(matches!(
            wake(&conn, id, MEMBER_ID).unwrap(),
            WakeAdmission::NoReadyWork
        ));
    }
    assert!(conn
        .query_row(
            "SELECT read_at IS NULL FROM agent_org_execution_inbox WHERE id=?1",
            [obsolete],
            |r| r.get::<_, bool>(0)
        )
        .unwrap());
    conn.execute_batch("INSERT INTO agent_org_execution_tasks(org_run_id,id,owner,status) VALUES('run-a','task-new','member-a','pending');
        INSERT INTO agent_org_execution_work_episode_tasks(org_run_id,work_episode_id,task_id,associated_at) VALUES('run-a','episode-a','task-new','now');").unwrap();
    insert_task_assignment(&conn, "task-new");
    let next = wake(&conn, "new-work", MEMBER_ID)
        .unwrap()
        .into_ready()
        .unwrap();
    assert_eq!(next.task_id.as_deref(), Some("task-new"));
    assert_eq!(row_count(&conn, "session_turn_intents"), 1);
}

#[test]
fn queued_wake_cannot_execute_or_inherit_a_replacement_task() {
    let conn = connection();
    insert_task_assignment(&conn, "task-a");
    wake(&conn, "queued-old", MEMBER_ID)
        .unwrap()
        .into_ready()
        .unwrap();
    conn.execute_batch("UPDATE agent_org_execution_tasks SET status='cancelled' WHERE id='task-a';
        INSERT INTO agent_org_execution_tasks(org_run_id,id,owner,status) VALUES('run-a','task-new','member-a','pending');
        INSERT INTO agent_org_execution_work_episode_tasks(org_run_id,work_episode_id,task_id,associated_at) VALUES('run-a','episode-a','task-new','now');").unwrap();
    insert_task_assignment(&conn, "task-new");
    assert!(!revalidate_wake_in_tx(&conn, MEMBER_SESSION_ID, "queued-old").unwrap());
    assert_eq!(
        conn.query_row(
            "SELECT status FROM session_turn_intents WHERE turn_intent_id='queued-old'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "cancelled"
    );
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM agent_org_execution_task_execution_leases WHERE state='active'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(
        wake(&conn, "queued-new", MEMBER_ID)
            .unwrap()
            .into_ready()
            .unwrap()
            .task_id
            .as_deref(),
        Some("task-new")
    );
}

#[test]
fn empty_wake_still_rejects_bad_identity_storage_and_payload() {
    let conn = connection();
    assert!(
        accept_wake_with_connection(&conn, RUN_ID, "wrong-session", "bad-id", None, MEMBER_ID)
            .is_err()
    );
    assert!(wake(&conn, "bad-member", "not-a-member").is_err());
    let row = insert_task_assignment(&conn, "task-a");
    conn.execute(
        "UPDATE agent_org_execution_inbox SET payload_json='broken' WHERE id=?1",
        [row],
    )
    .unwrap();
    assert!(wake(&conn, "bad-payload", MEMBER_ID).is_err());
    conn.execute("DELETE FROM agent_org_execution_inbox WHERE id=?1", [row])
        .unwrap();
    conn.execute("DROP TABLE agent_org_execution_inbox", [])
        .unwrap();
    assert!(wake(&conn, "broken-storage", MEMBER_ID).is_err());
    assert_eq!(row_count(&conn, "session_turn_intents"), 0);
}

#[test]
fn pause_and_old_generation_cannot_start_queued_work() {
    let conn = connection();
    insert_task_assignment(&conn, "task-a");
    wake(&conn, "queued-before-pause", MEMBER_ID)
        .unwrap()
        .into_ready()
        .unwrap();
    conn.execute("UPDATE agent_org_execution_runs SET status='paused'", [])
        .unwrap();
    assert!(matches!(
        wake(&conn, "paused-wake", MEMBER_ID).unwrap(),
        WakeAdmission::Deferred
    ));
    assert!(!revalidate_wake_in_tx(&conn, MEMBER_SESSION_ID, "queued-before-pause").unwrap());
    conn.execute("UPDATE agent_org_execution_runs SET status='running'", [])
        .unwrap();
    assert!(matches!(
        wake(&conn, "consumed-assignment", MEMBER_ID).unwrap(),
        WakeAdmission::NoReadyWork
    ));
    // Activation creates its own authority. An old receipt cannot be reused.
    let conn = connection();
    insert_task_assignment(&conn, "task-a");
    wake(&conn, "queued-before-generation", MEMBER_ID)
        .unwrap()
        .into_ready()
        .unwrap();
    conn.execute(
        "UPDATE agent_org_execution_runs SET activation_generation=2",
        [],
    )
    .unwrap();
    assert!(!revalidate_wake_in_tx(&conn, MEMBER_SESSION_ID, "queued-before-generation").unwrap());
}

#[test]
fn coordinator_no_work_gate_preserves_resolved_rows_and_mixed_new_input() {
    let conn = connection();
    assert!(matches!(
        wake(&conn, "empty-root", COORDINATOR_MEMBER_ID).unwrap(),
        WakeAdmission::NoReadyWork
    ));
    conn.execute_batch("INSERT INTO agent_org_execution_inbox(org_run_id,recipient_member_id,payload_kind,payload_json) VALUES('run-a','coordinator','plain','{}');
        INSERT INTO agent_org_execution_inbox_delivery_resolutions(inbox_id) VALUES(last_insert_rowid());").unwrap();
    assert!(matches!(
        wake(&conn, "resolved-root", COORDINATOR_MEMBER_ID).unwrap(),
        WakeAdmission::NoReadyWork
    ));
    conn.execute_batch("INSERT INTO agent_org_execution_inbox(org_run_id,recipient_member_id,payload_kind,payload_json) VALUES('run-a','coordinator','plain','{}');").unwrap();
    wake(&conn, "mixed-root", COORDINATOR_MEMBER_ID)
        .unwrap()
        .into_ready()
        .unwrap();
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM agent_org_execution_inbox WHERE recipient_member_id='coordinator' AND read_at IS NULL",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        2
    );
}

#[test]
fn consumed_authority_lookup_is_bounded_by_the_unique_receipt_index() {
    let conn = connection();
    let mut statement = conn
        .prepare(
            "EXPLAIN QUERY PLAN SELECT 1
        FROM agent_org_execution_task_execution_leases lease
        JOIN session_turn_intents intent USING(session_id,turn_intent_id)
        WHERE lease.continuation_receipt_id='inbox:' || ?1
          AND intent.status NOT IN ('queued','running','optimistic')",
        )
        .unwrap();
    let plan = statement
        .query_map([42], |row| row.get::<_, String>(3))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
        .join("\n");
    assert!(plan.contains("SEARCH lease USING INDEX"), "{plan}");
    assert!(!plan.contains("SCAN lease"), "{plan}");
}
