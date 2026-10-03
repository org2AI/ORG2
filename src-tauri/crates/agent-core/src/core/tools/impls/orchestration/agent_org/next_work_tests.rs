//! New user requests queued behind publication keep their own task authority.
use super::completion_wait_tests::finish;
use super::summary_terminal_tests::{
    inject_event_commit_before_receipt_update, start_report, SUMMARY_TURN,
};
use super::*;
use crate::coordination::agent_org_final_summary as summary;
use crate::coordination::agent_org_runs::AgentOrgRunStore;
use crate::coordination::agent_org_turn_contexts::{self as turns, AgentOrgTurnAdmission};
use crate::foundation::session_bridge::{self, TurnIntentBridgeSource};
use crate::lifecycle::TurnTerminalStatus;

fn accept_user(turn: &str, group: bool) -> Result<(), String> {
    session_bridge::register_upsert_turn_intent_with_connection(
        |conn, session, turn, client, run, source, status| {
            conn.execute(
                "INSERT OR IGNORE INTO session_turn_intents
                 (session_id,turn_intent_id,client_message_id,org_run_id,source,status,created_at,updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?7)",
                rusqlite::params![session,turn,client,run,source.as_str(),status.as_str(),chrono::Utc::now().to_rfc3339()],
            ).map(|_| ()).map_err(|error| error.to_string())
        },
    );
    let conn = database::db::get_connection().unwrap();
    let request = if group {
        let event = format!("user-{turn}");
        conn.execute(
            "INSERT INTO events(id,session_id,event_type,function_name,result_json,created_at)
            VALUES (?1,?2,'user_message','user_message',?3,?4)",
            rusqlite::params![
                event,
                ROOT_SESSION,
                json!({"turnIntentId":turn}).to_string(),
                chrono::Utc::now().to_rfc3339()
            ],
        )
        .unwrap();
        AgentOrgTurnAdmission::group_root(RUN_ID, ROOT_SESSION, turn, None, event)
    } else {
        AgentOrgTurnAdmission::coordinator(
            RUN_ID,
            ROOT_SESSION,
            turn,
            None,
            TurnIntentBridgeSource::UserSubmit,
        )
    };
    turns::accept_with_connection(&conn, &request).map(|_| ())
}

fn dispatch(turn: &str) {
    let conn = database::db::get_connection().unwrap();
    turns::revalidate_context_with_connection(&conn, ROOT_SESSION, turn).unwrap();
    // The scheduler adapter marks the accepted request running before its tools execute.
    conn.execute("UPDATE session_turn_intents SET status='running' WHERE session_id=?1 AND turn_intent_id=?2", [ROOT_SESSION,turn]).unwrap();
    crate::session::persistence::update_status(
        ROOT_SESSION,
        crate::session::SessionStatus::Running,
    )
    .unwrap();
}

async fn report() -> summary::FinalSummaryReceipt {
    start_report().await
}

fn publish(receipt: &summary::FinalSummaryReceipt, failed: bool) {
    if !failed {
        let event = summary::stable_event_id_for_turn(ROOT_SESSION, SUMMARY_TURN)
            .unwrap()
            .unwrap();
        inject_event_commit_before_receipt_update(&event, &receipt.certificate_id);
    }
    finish(
        ROOT_SESSION,
        SUMMARY_TURN,
        if failed {
            TurnTerminalStatus::Cancelled
        } else {
            TurnTerminalStatus::Completed
        },
    )
    .unwrap();
}

async fn create_next(graph: bool, call_id: &str) -> Result<String, ToolError> {
    let call = coordinator_call_for_turn(call_id, "new-request");
    if graph {
        TaskGraphCreateTool::new(tools_context(COORDINATOR_MEMBER_ID))
            .execute_text(
                json!({"tasks":[{"key":"next","subject":"New user deliverable",
                "owner_member_id":ALICE,"execution_mode":"build"}]}),
                &call,
            )
            .await
    } else {
        TaskCreateTool::new(tools_context(COORDINATOR_MEMBER_ID))
            .execute_text(
                json!({"subject":"New user deliverable","owner_member_id":ALICE,
                "dispatch_policy":"immediate","execution_mode":"build"}),
                &call,
            )
            .await
    }
}

fn generation() -> i64 {
    AgentOrgRunStore::load(RUN_ID)
        .unwrap()
        .unwrap()
        .activation_generation
}

#[tokio::test]
async fn publication_follow_up_activates_both_writers_and_keeps_later_user_authority() {
    for (group, graph, failed) in [(true, true, false), (false, false, true)] {
        let _sandbox = sandbox();
        let receipt = report().await;
        publish(&receipt, failed);
        accept_user("new-request", group).expect("post-publication user request");
        accept_user("later-request", group).expect("later post-publication user request");
        assert_eq!(
            AgentOrgRunStore::load(RUN_ID)
                .unwrap()
                .unwrap()
                .status
                .as_str(),
            "running"
        );
        dispatch("new-request");
        let before = AgentOrgTaskStore::list(RUN_ID).unwrap();
        let result = create_next(graph, "new-call")
            .await
            .expect("new user work after publication");
        assert_eq!(generation(), 2);
        assert_eq!(create_next(graph, "new-call").await.unwrap(), result);
        assert_eq!(
            AgentOrgTaskStore::list(RUN_ID).unwrap().len(),
            before.len() + 1
        );
        assert_eq!(
            serde_json::to_value(
                AgentOrgTaskStore::get(RUN_ID, &before[0].id)
                    .unwrap()
                    .unwrap()
            )
            .unwrap(),
            serde_json::to_value(&before[0]).unwrap()
        );
        dispatch("later-request");
        TaskGetTool::new(tools_context(COORDINATOR_MEMBER_ID))
            .execute_text(
                json!({"id":before[0].id}),
                &coordinator_call_for_turn("read", "later-request"),
            )
            .await
            .expect("queued real user remains executable after generation changes");
        let conn = database::db::get_connection().unwrap();
        assert!(
            turns::revalidate_context_with_connection(&conn, ROOT_SESSION, SUMMARY_TURN).is_err()
        );
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM agent_org_execution_run_completion_certificates",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
    }
}

#[tokio::test]
async fn publication_follow_up_rolls_back_generation_and_queued_authority_on_write_failure() {
    let _sandbox = sandbox();
    let receipt = report().await;
    publish(&receipt, false);
    accept_user("new-request", true).expect("post-publication user request");
    accept_user("later-request", true).expect("later post-publication user request");
    dispatch("new-request");
    let conn = database::db::get_connection().unwrap();
    conn.execute_batch(
        "CREATE TRIGGER fail_new_task BEFORE INSERT ON agent_org_execution_tasks
        BEGIN SELECT RAISE(ABORT,'disk I/O error: injected new task'); END;",
    )
    .unwrap();
    let error = create_next(true, "rolled-back").await.unwrap_err();
    assert!(error.to_string().contains("injected new task"), "{error}");
    assert_eq!(generation(), 1);
    for turn in ["new-request", "later-request"] {
        assert_eq!(
            turns::revalidate_context_with_connection(&conn, ROOT_SESSION, turn)
                .unwrap()
                .activation_generation,
            Some(1)
        );
    }
    conn.execute_batch("DROP TRIGGER fail_new_task").unwrap();
    create_next(true, "rolled-back")
        .await
        .expect("same request succeeds after rollback");
    assert_eq!(generation(), 2);
}

#[tokio::test]
async fn publication_follow_up_never_promotes_unfinished_or_invalid_authority() {
    for fault in [
        "active-report",
        "active-worker",
        "paused",
        "cancelled",
        "non-user",
        "missing-source",
        "stale",
        "other-turn",
        "database",
    ] {
        let _sandbox = sandbox();
        let receipt = report().await;
        if fault == "active-report" {
            let error = accept_user("new-request", true)
                .expect_err("active report must reject new user work");
            assert!(
                error.contains(summary::FINALIZING_INPUT_NOT_ACCEPTED),
                "{error}"
            );
            let conn = database::db::get_connection().unwrap();
            assert_eq!(
                conn.query_row(
                    "SELECT COUNT(*) FROM agent_org_execution_turn_contexts
                     WHERE turn_intent_id='new-request'",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
                0
            );
            assert_eq!(generation(), 1);
            assert_eq!(AgentOrgTaskStore::list(RUN_ID).unwrap().len(), 1);
            continue;
        }
        publish(&receipt, false);
        accept_user("new-request", true).expect("post-publication user request");
        accept_user("later-request", true).expect("later post-publication user request");
        dispatch("new-request");
        let conn = database::db::get_connection().unwrap();
        match fault {
            "active-worker" => {
                // A warm session alone is deliberately not formal work.
                let task = AgentOrgTaskStore::list(RUN_ID).unwrap().remove(0);
                insert_owner_context(&conn, "unsettled-member", &task.id);
                crate::session::persistence::update_status(
                    ALICE_SESSION,
                    crate::session::SessionStatus::Running,
                )
                .unwrap();
            }
            "paused" => {
                conn.execute(
                    "UPDATE agent_org_execution_runs SET status='paused' WHERE id=?1",
                    [RUN_ID],
                )
                .unwrap();
            }
            "cancelled" => {
                conn.execute("UPDATE session_turn_intents SET status='cancelled' WHERE turn_intent_id='new-request'", []).unwrap();
            }
            "non-user" => {
                conn.execute("UPDATE session_turn_intents SET source='resume' WHERE turn_intent_id='new-request'", []).unwrap();
            }
            "missing-source" => {
                conn.execute("DELETE FROM events WHERE id='user-new-request'", [])
                    .unwrap();
            }
            "stale" => {
                conn.execute("UPDATE agent_org_execution_turn_contexts SET activation_generation=2 WHERE turn_intent_id='new-request'", []).unwrap();
            }
            "other-turn" => insert_coordinator_context_for_turn(&conn, "unsettled-old-wake"),
            "database" => {
                conn.execute_batch("DROP TABLE agent_org_execution_run_progress")
                    .unwrap();
            }
            _ => unreachable!(),
        }
        assert!(
            create_next(true, fault).await.is_err(),
            "must not activate for {fault}"
        );
        assert_eq!(generation(), 1, "{fault}");
        assert_eq!(AgentOrgTaskStore::list(RUN_ID).unwrap().len(), 1, "{fault}");
    }
}
