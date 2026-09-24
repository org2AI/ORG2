use super::*;

fn deliver(snapshot: &Task) -> Result<i64, String> {
    let member = snapshot.owner.as_deref().unwrap();
    enqueue_task_assigned_to(
        snapshot,
        if member == MEMBER_A {
            "agent-a"
        } else {
            "agent-b"
        },
        member,
        "agent-coordinator",
        Some("coordinator"),
        "Coordinator",
    )
}

fn complete(task: &Task) {
    let conn = get_connection().unwrap();
    insert_owner_context(
        &conn,
        MEMBER_A,
        MEMBER_A_SESSION,
        "late-assignment",
        &task.id,
        1,
    );
    start(&task.id, MEMBER_A_SESSION, "late-assignment");
    AgentOrgTaskStore::owner_complete_with_transactional_effects(
        owner_actor(MEMBER_A_SESSION, "late-assignment"),
        RUN_ID,
        &task.id,
        TaskOutputInput {
            summary: "done".into(),
            content: None,
            artifact_ids: vec![],
        },
        |_tx, _outcome, _tasks| Ok(()),
    )
    .unwrap();
}

fn assert_cancelled(conn: &rusqlite::Connection, id: i64) {
    let (read_at, kind, reason): (Option<String>, String, String) = conn.query_row(
        "SELECT inbox.read_at,resolution.resolution_kind,resolution.reason
         FROM agent_org_runtime_inbox inbox
         JOIN agent_org_runtime_inbox_delivery_resolutions resolution ON resolution.inbox_id=inbox.id
         WHERE inbox.id=?1", [id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).expect("obsolete delivery has an exact disposition");
    assert!(read_at.is_none(), "system disposition is not model read");
    assert_eq!(kind, "cancelled");
    let reason: serde_json::Value = serde_json::from_str(&reason).unwrap();
    assert_eq!(reason["code"], "obsolete_task_assignment");
    let extra: i64 = conn
        .query_row(
            "SELECT (SELECT COUNT(*) FROM agent_org_runtime_inbox WHERE causation_inbox_id=?1)
              + (SELECT COUNT(*) FROM agent_org_runtime_formal_trigger_receipts WHERE inbox_id=?1)",
            [id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        extra, 0,
        "obsolete assignment must not notify the coordinator"
    );
}

#[test]
fn task_assignment_race_completed_before_delivery_preserves_unread_cancelled_fact() {
    let _fixture = fixture();
    let snapshot = create(pending("late-completed", Some(MEMBER_A), vec![]));
    complete(&snapshot);
    let conn = get_connection().unwrap();
    for _ in 0..2 {
        assert_cancelled(&conn, deliver(&snapshot).unwrap());
    }
}

#[test]
fn task_assignment_race_owner_changed_keeps_new_delivery_and_exact_old_disposition() {
    let _fixture = fixture();
    let snapshot = create(pending("late-reassigned", Some(MEMBER_A), vec![]));
    let current = AgentOrgTaskStore::patch_pending_with_transactional_effects(
        graph_actor(),
        RUN_ID,
        &snapshot.id,
        PendingTaskGraphPatch {
            owner: Some(Some(MEMBER_B.into())),
            eligible_member_ids: Some(vec![MEMBER_B.into()]),
            ..Default::default()
        },
        |_tx, _outcome, _tasks| Ok(()),
    )
    .unwrap()
    .0
    .current;
    let fresh = deliver(&current).unwrap();
    let conn = get_connection().unwrap();
    assert_cancelled(&conn, deliver(&snapshot).unwrap());
    let state: (bool, i64) = conn.query_row(
        "SELECT NOT EXISTS(SELECT 1 FROM agent_org_runtime_inbox_delivery_resolutions WHERE inbox_id=?1),
         (SELECT COUNT(*) FROM agent_org_runtime_inbox WHERE causation_inbox_id=?1 AND payload_kind='task_assignment_committed')",
        [fresh], |row| Ok((row.get(0)?, row.get(1)?)),
    ).unwrap();
    assert_eq!(
        state,
        (true, 1),
        "fresh owner keeps its real work and coordinator notification"
    );
}

#[test]
fn task_assignment_race_disposition_failure_rolls_back_delivery_and_is_a_real_error() {
    let _fixture = fixture();
    let snapshot = create(pending("late-rollback", Some(MEMBER_A), vec![]));
    complete(&snapshot);
    let conn = get_connection().unwrap();
    let count = || {
        conn.query_row("SELECT COUNT(*) FROM agent_org_runtime_inbox", [], |row| {
            row.get::<_, i64>(0)
        })
        .unwrap()
    };
    let before = count();
    conn.execute_batch("CREATE TRIGGER reject_late_disposition BEFORE INSERT ON agent_org_runtime_inbox_delivery_resolutions
        BEGIN SELECT RAISE(ABORT, 'disposition storage failure'); END;").unwrap();
    assert!(deliver(&snapshot)
        .unwrap_err()
        .contains("disposition storage failure"));
    assert_eq!(
        count(),
        before,
        "failed disposition cannot commit a blocking delivery"
    );
    conn.execute_batch("DROP TRIGGER reject_late_disposition")
        .unwrap();
    assert_cancelled(&conn, deliver(&snapshot).unwrap());
}
