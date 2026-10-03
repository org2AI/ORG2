use super::*;
use crate::coordination::agent_inbox::{AgentInboxStore, InsertInboxParams};

#[derive(Default)]
struct WakeAfterPersistence {
    calls: Mutex<Vec<(String, String)>>,
}

impl InboxWakeHook for WakeAfterPersistence {
    fn wake_member(&self, member_id: &str, run_id: &str) {
        let session = session_persistence::get_session("member-session")
            .unwrap()
            .unwrap();
        assert_eq!(session.status, "idle", "the real wake gate rejects Running");
        let conn = database::db::get_connection().unwrap();
        let marker: String = conn.query_row(
            "SELECT last_terminal_turn_id FROM agent_sessions WHERE session_id='member-session'",
            [], |row| row.get(0),
        ).unwrap();
        assert_eq!(marker, "dialog-finished");
        assert!(AgentInboxStore::has_unread_for_member(member_id, run_id).unwrap());
        self.calls
            .lock()
            .unwrap()
            .push((member_id.into(), run_id.into()));
    }
}

fn finish_with_queued_input() -> (String, TerminalTurnSignal) {
    let run_id = seed_run("builtin:sde");
    seed_in_progress_task(&run_id, "original-task");
    seed_task_execution_turn(&run_id, "original-task", "original-execution");
    AgentInboxStore::insert(InsertInboxParams {
        recipient_agent_id: "builtin:sde".into(),
        recipient_member_id: Some("member-worker".into()),
        sender_agent_id: crate::coordination::agent_inbox::SYSTEM_SENDER_ID.into(),
        sender_member_id: None,
        org_run_id: Some(run_id.clone()),
        message: AgentMessage::Plain {
            summary: "new work while the previous execution finishes".into(),
            text: "This persisted input must get a later execution.".into(),
        },
    })
    .unwrap();
    assert!(finalize_agent_org_member_turn(
        None,
        "member-session",
        Some("original-execution"),
        &Ok(String::new()),
        TurnTerminalStatus::Completed,
    ));
    assert_eq!(
        session_persistence::get_session("member-session")
            .unwrap()
            .unwrap()
            .status,
        "running"
    );
    (
        run_id,
        TerminalTurnSignal {
            turn_id: "dialog-finished".into(),
            turn_intent_id: Some("original-execution".into()),
            status: TurnTerminalStatus::Completed,
            completed_at: chrono::Utc::now().to_rfc3339(),
        },
    )
}

#[test]
fn queued_input_wake_observes_durable_idle_and_terminal_replay_does_not_wake_again() {
    let _serial = test_serial_guard();
    let _sandbox = test_helpers::test_env::sandbox();
    let (run_id, signal) = finish_with_queued_input();
    let hook = WakeAfterPersistence::default();
    for _ in 0..2 {
        persist_and_emit_terminal_turn(
            "member-session",
            &signal,
            AgentSessionStatus::Idle,
            None,
            Some(&hook),
        );
    }
    assert_eq!(
        *hook.calls.lock().unwrap(),
        vec![("member-worker".into(), run_id)]
    );
}

#[test]
fn failed_terminal_persistence_leaves_input_pending_without_a_premature_wake() {
    let _serial = test_serial_guard();
    let _sandbox = test_helpers::test_env::sandbox();
    let (run_id, signal) = finish_with_queued_input();
    let conn = database::db::get_connection().unwrap();
    conn.execute_batch("CREATE TRIGGER reject_terminal_marker BEFORE UPDATE OF last_terminal_turn_id ON agent_sessions BEGIN SELECT RAISE(ABORT,'injected terminal write failure'); END;").unwrap();
    let hook = WakeAfterPersistence::default();
    persist_and_emit_terminal_turn(
        "member-session",
        &signal,
        AgentSessionStatus::Idle,
        None,
        Some(&hook),
    );
    assert!(hook.calls.lock().unwrap().is_empty());
    assert_eq!(
        session_persistence::get_session("member-session")
            .unwrap()
            .unwrap()
            .status,
        "running"
    );
    assert!(AgentInboxStore::has_unread_for_member("member-worker", &run_id).unwrap());
    conn.execute_batch("DROP TRIGGER reject_terminal_marker")
        .unwrap();
    persist_and_emit_terminal_turn(
        "member-session",
        &signal,
        AgentSessionStatus::Idle,
        None,
        Some(&hook),
    );
    assert_eq!(hook.calls.lock().unwrap().len(), 1);
}

#[test]
fn post_terminal_wake_still_defers_to_direct_user_intervention() {
    let _serial = test_serial_guard();
    let _sandbox = test_helpers::test_env::sandbox();
    let (run_id, signal) = finish_with_queued_input();
    crate::coordination::agent_member_interventions::AgentMemberInterventionStore::enter(
        crate::coordination::agent_member_interventions::EnterMemberInterventionParams {
            org_run_id: run_id.clone(),
            member_id: "member-worker".into(),
            agent_id: "builtin:sde".into(),
            session_id: "member-session".into(),
        },
    )
    .unwrap();
    let hook = WakeAfterPersistence::default();
    persist_and_emit_terminal_turn(
        "member-session",
        &signal,
        AgentSessionStatus::Idle,
        None,
        Some(&hook),
    );
    assert!(hook.calls.lock().unwrap().is_empty());
    assert_eq!(
        session_persistence::get_session("member-session")
            .unwrap()
            .unwrap()
            .status,
        "idle"
    );
    assert!(AgentInboxStore::has_unread_for_member("member-worker", &run_id).unwrap());
}
