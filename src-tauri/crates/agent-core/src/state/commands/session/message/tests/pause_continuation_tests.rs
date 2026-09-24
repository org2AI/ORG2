use super::*;
use crate::coordination::agent_org_pause as pause;
use crate::lifecycle::{TerminalTurnSignal, TurnTerminalStatus};

fn paused_running_task() -> WakeModeFixture {
    crate::foundation::session_bridge::register_upsert_turn_intent_with_connection(
        |conn, session, intent, client, run, source, status| {
            conn.execute(
                "INSERT OR IGNORE INTO session_turn_intents (session_id,turn_intent_id,client_message_id,org_run_id,source,status,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?7)",
                rusqlite::params![session,intent,client,run,source.as_str(),status.as_str(),chrono::Utc::now().to_rfc3339()],
            ).map(|_| ()).map_err(|e| e.to_string())
        },
    );
    let fixture = setup_wake_mode_fixture("build", TaskStatus::Pending);
    let conn = database::db::get_connection().unwrap();
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS session_turn_intents (
            session_id TEXT NOT NULL, turn_intent_id TEXT NOT NULL,
            client_message_id TEXT, org_run_id TEXT, source TEXT NOT NULL,
            status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            PRIMARY KEY(session_id,turn_intent_id)
        );",
    )
    .unwrap();
    let inbox = enqueue_task_assignment(&fixture);
    assert!(matches!(
        crate::coordination::agent_org_turn_contexts::accept_wake(
            &fixture.run_id,
            &fixture.session_id,
            "paused-execution",
            None,
            &fixture.member_id,
        )
        .unwrap(),
        crate::coordination::agent_org_turn_contexts::WakeAdmission::Ready(_)
    ));
    let conn = database::db::get_connection().unwrap();
    conn.execute(
        "UPDATE session_turn_intents SET status='running' WHERE turn_intent_id='paused-execution'",
        [],
    )
    .unwrap();
    materialize_task_assignment(&fixture, "paused-execution", inbox);
    crate::session::turn::start_task_execution_before_provider(
        &fixture.session_id,
        "paused-execution",
        &[inbox],
    )
    .unwrap();
    let paused = pause::pause_run(&fixture.run_id, &uuid::Uuid::new_v4().to_string()).unwrap();
    assert_eq!(paused.captured_turn_count, 1);
    pause::bind_runtime_and_request_yield(
        &paused.episode_id,
        &fixture.session_id,
        "paused-execution",
        "lease",
        "dialog",
    )
    .unwrap();
    pause::mark_released(&fixture.session_id, "paused-execution", "lease", "dialog").unwrap();
    fixture
}

#[tokio::test(flavor = "multi_thread")]
async fn released_pause_records_cancelled_execution_without_finishing_task() {
    let fixture = paused_running_task();
    crate::lifecycle::finalize_session(
        &fixture.session_id,
        &Err("paused by user".into()),
        None,
        None,
        false,
        Some(TerminalTurnSignal {
            turn_id: "dialog".into(),
            turn_intent_id: Some("paused-execution".into()),
            status: TurnTerminalStatus::Cancelled,
            completed_at: chrono::Utc::now().to_rfc3339(),
        }),
    )
    .await;
    let conn = database::db::get_connection().unwrap();
    let status: String = conn
        .query_row(
            "SELECT status FROM session_turn_intents WHERE turn_intent_id='paused-execution'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        status, "cancelled",
        "the released execution cannot keep blocking the Member FIFO"
    );
    assert_eq!(
        AgentOrgTaskStore::get(&fixture.run_id, &fixture.task_id)
            .unwrap()
            .unwrap()
            .status,
        TaskStatus::InProgress
    );
    let idle_notices: i64 = conn.query_row(
        "SELECT count(*) FROM agent_org_execution_inbox WHERE org_run_id=?1 AND payload_kind='member_idle'",
        [&fixture.run_id], |r| r.get(0),
    ).unwrap();
    assert_eq!(
        idle_notices, 0,
        "Pause does not publish a successful Member completion"
    );
    crate::coordination::agent_org_finality::finalize_turn(
        &fixture.session_id,
        "paused-execution",
        TurnTerminalStatus::Failed,
        "late_failure",
    )
    .unwrap();
    let after_replay: String = conn
        .query_row(
            "SELECT status FROM session_turn_intents WHERE turn_intent_id='paused-execution'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        after_replay, "cancelled",
        "late callbacks cannot rewrite Pause"
    );
}

#[test]
fn pause_terminal_authority_requires_exact_released_runtime() {
    for invalid in [
        "wrong_session",
        "wrong_intent",
        "unbound",
        "draining",
        "terminal",
    ] {
        let fixture = paused_running_task();
        let conn = database::db::get_connection().unwrap();
        match invalid {
            "unbound" => {
                conn.execute(
                    "UPDATE agent_org_execution_pause_handoffs SET runtime_lease_id=NULL,dialog_turn_generation=NULL",
                    [],
                )
                .unwrap();
            }
            "draining" => {
                conn.execute(
                    "UPDATE agent_org_execution_pause_handoffs SET drain_status='waiting'",
                    [],
                )
                .unwrap();
            }
            "terminal" => {
                conn.execute("UPDATE session_turn_intents SET status='cancelled' WHERE turn_intent_id='paused-execution'", []).unwrap();
            }
            _ => {}
        }
        assert!(
            !pause::released_execution_in_tx(
                &conn,
                if invalid == "wrong_session" {
                    "another-session"
                } else {
                    &fixture.session_id
                },
                if invalid == "wrong_intent" {
                    "another-execution"
                } else {
                    "paused-execution"
                },
            )
            .unwrap(),
            "{invalid} runtime cannot gain terminal authority"
        );
    }
}

#[test]
fn claimed_pause_continuation_passes_execution_admission_without_new_inbox_work() {
    let fixture = paused_running_task();
    let mut conn = database::db::get_connection().unwrap();
    // Isolate the execute-time admission check from terminal finalization,
    // which the separate real-finalizer regression covers above.
    conn.execute("UPDATE session_turn_intents SET status='cancelled' WHERE turn_intent_id='paused-execution'", []).unwrap();
    let resumed = pause::resume_run(&fixture.run_id, &uuid::Uuid::new_v4().to_string()).unwrap();
    assert_eq!(resumed.continuation_count, 1);
    let dispatch = pause::list_dispatchable_continuations(8)
        .unwrap()
        .pop()
        .unwrap();
    assert!(
        pause::claim_continuation_dispatch(&dispatch.episode_id, &dispatch.turn_intent_id).unwrap()
    );
    let tx = conn.transaction().unwrap();
    assert!(
        promote_turn_to_running_in_tx(
            &tx,
            &fixture.session_id,
            &dispatch.turn_intent_id,
            Some(&fixture.run_id),
            Some(&fixture.run_id),
            false,
        )
        .unwrap(),
        "an exact Resume receipt is work even without a new task assignment"
    );
}

#[test]
fn pause_continuation_rejects_unclaimed_draining_and_obsolete_receipts() {
    for invalid in ["unclaimed", "draining", "obsolete"] {
        let fixture = paused_running_task();
        let mut conn = database::db::get_connection().unwrap();
        conn.execute("UPDATE session_turn_intents SET status='cancelled' WHERE turn_intent_id='paused-execution'", []).unwrap();
        pause::resume_run(&fixture.run_id, &uuid::Uuid::new_v4().to_string()).unwrap();
        let dispatch = pause::list_dispatchable_continuations(8)
            .unwrap()
            .pop()
            .unwrap();
        if invalid != "unclaimed" {
            pause::claim_continuation_dispatch(&dispatch.episode_id, &dispatch.turn_intent_id)
                .unwrap();
        }
        if invalid == "draining" {
            conn.execute("UPDATE agent_org_execution_pause_handoffs SET drain_status='waiting' WHERE episode_id=?1", [&dispatch.episode_id]).unwrap();
        }
        if invalid == "obsolete" {
            conn.execute("UPDATE agent_org_execution_runs SET activation_generation=activation_generation+1 WHERE id=?1", [&fixture.run_id]).unwrap();
        }
        let tx = conn.transaction().unwrap();
        assert!(
            !promote_turn_to_running_in_tx(
                &tx,
                &fixture.session_id,
                &dispatch.turn_intent_id,
                Some(&fixture.run_id),
                Some(&fixture.run_id),
                false,
            )
            .unwrap(),
            "{invalid} continuation must remain unable to run"
        );
    }
}
