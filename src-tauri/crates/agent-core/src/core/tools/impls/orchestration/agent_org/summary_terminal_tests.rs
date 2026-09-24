//! Report terminal contracts with certificates produced by real task tools.
use super::completion_wait_tests::{completed_task, finish, present, request, OWNER_TURN};
use super::*;
use crate::coordination::agent_org_final_summary as summary;
use crate::lifecycle::TurnTerminalStatus;

pub(super) const SUMMARY_TURN: &str = "exact-report-attempt";

pub(super) async fn start_report() -> summary::FinalSummaryReceipt {
    database::db::get_connection()
        .unwrap()
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,session_id TEXT NOT NULL,event_type TEXT NOT NULL,
          result_json TEXT NOT NULL DEFAULT '{}',content TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,UNIQUE(id,session_id));",
        )
        .unwrap();
    let id = completed_task().await;
    present(&id, "full").await;
    request("Ready to publish the certified results").await;
    finish(
        ROOT_SESSION,
        COORDINATOR_TURN,
        TurnTerminalStatus::Completed,
    )
    .unwrap();
    finish(ALICE_SESSION, OWNER_TURN, TurnTerminalStatus::Completed).unwrap();
    let conn = database::db::get_connection().unwrap();
    // Prepared scheduler input only. Tasks, output and certificate above
    // were produced through the production tools and finality transaction.
    insert_coordinator_context_for_turn(&conn, SUMMARY_TURN);
    summary::claim_pending_for_coordinator_turn_in_tx(&conn, RUN_ID, ROOT_SESSION, SUMMARY_TURN)
        .unwrap()
        .unwrap()
}

#[tokio::test]
async fn every_report_terminal_closes_active_receipt_and_retains_specific_failure() {
    for (terminal, prior_error, expected) in [
        (TurnTerminalStatus::Failed, None, "provider_error"),
        (TurnTerminalStatus::Completed, None, "event_store_missing"),
        (
            TurnTerminalStatus::Failed,
            Some("event_store_error"),
            "event_store_error",
        ),
        (TurnTerminalStatus::Cancelled, Some("stopped"), "stopped"),
    ] {
        let _sandbox = sandbox();
        start_report().await;
        if let Some(error) = prior_error {
            summary::mark_failed_for_turn(ROOT_SESSION, SUMMARY_TURN, error).unwrap();
        }
        finish(ROOT_SESSION, SUMMARY_TURN, terminal).unwrap();
        let result = receipt();
        assert_eq!(result.status, summary::FinalSummaryStatus::Failed);
        assert_eq!(result.typed_error.as_deref(), Some(expected));
        assert!(result.terminal_at.is_some());
        assert!(result.event_id.is_none());
    }
}

#[tokio::test]
async fn stop_winning_publication_boundary_prevents_late_report_binding_and_restart_revival() {
    let _sandbox = sandbox();
    start_report().await;
    let event_id = summary::stable_event_id_for_turn(ROOT_SESSION, SUMMARY_TURN)
        .unwrap()
        .unwrap();
    assert!(summary::mark_persisting_for_turn(ROOT_SESSION, SUMMARY_TURN).unwrap());
    finish(ROOT_SESSION, SUMMARY_TURN, TurnTerminalStatus::Cancelled).unwrap();
    assert!(!summary::mark_persisted_for_turn(ROOT_SESSION, SUMMARY_TURN, &event_id).unwrap());
    assert!(!summary::mark_persisting_for_turn(ROOT_SESSION, SUMMARY_TURN).unwrap());
    let conn = database::db::get_connection().unwrap();
    assert_eq!(summary::reconcile_after_restart(&conn).unwrap(), 0);
    assert_eq!(receipt().typed_error.as_deref(), Some("stopped"));
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM events WHERE session_id=?1",
            [ROOT_SESSION],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
}

pub(super) fn inject_event_commit_before_receipt_update(event_id: &str, certificate_id: &str) {
    // Fault boundary: emulate the app EventStore adapter's committed write
    // followed by an interrupted receipt update. No Task, certificate or
    // report receipt terminal state is written by this adapter fixture.
    database::db::get_connection().unwrap().execute(
        "INSERT INTO events(id,session_id,event_type,result_json,content,created_at)
         VALUES (?1,?2,'assistant',?3,'Complete report',?4)",
        rusqlite::params![event_id, ROOT_SESSION,
            json!({"agent_org_completion_certificate":{"id":certificate_id},"content":"Complete report"}).to_string(),
            chrono::Utc::now().to_rfc3339()]).unwrap();
}

#[tokio::test]
async fn committed_event_wins_later_stop_or_binding_error_and_never_allows_second_report() {
    for binding_error in [false, true] {
        let _sandbox = sandbox();
        let original = start_report().await;
        summary::mark_persisting_for_turn(ROOT_SESSION, SUMMARY_TURN).unwrap();
        let event_id = summary::stable_event_id_for_turn(ROOT_SESSION, SUMMARY_TURN)
            .unwrap()
            .unwrap();
        inject_event_commit_before_receipt_update(&event_id, &original.certificate_id);
        if binding_error {
            summary::mark_failed_for_turn(ROOT_SESSION, SUMMARY_TURN, "event_store_binding_error")
                .unwrap();
        }
        finish(ROOT_SESSION, SUMMARY_TURN, TurnTerminalStatus::Cancelled).unwrap();
        let saved = receipt();
        assert_eq!(saved.status, summary::FinalSummaryStatus::Persisted);
        assert_eq!(saved.event_id.as_deref(), Some(event_id.as_str()));
        assert!(!saved.can_retry);
        assert!(saved.typed_error.is_none());
        assert!(
            summary::retry_failed(RUN_ID, &original.certificate_id, 1, "must-not-retry").is_err()
        );
        assert_eq!(
            summary::reconcile_after_restart(&database::db::get_connection().unwrap()).unwrap(),
            0
        );
    }
}

#[tokio::test]
async fn interrupted_receipt_write_rolls_back_turn_and_recovers_from_stable_event() {
    let _sandbox = sandbox();
    let original = start_report().await;
    summary::mark_persisting_for_turn(ROOT_SESSION, SUMMARY_TURN).unwrap();
    let event_id = summary::stable_event_id_for_turn(ROOT_SESSION, SUMMARY_TURN)
        .unwrap()
        .unwrap();
    inject_event_commit_before_receipt_update(&event_id, &original.certificate_id);
    let conn = database::db::get_connection().unwrap();
    conn.execute_batch("CREATE TRIGGER fail_report_binding BEFORE UPDATE ON agent_org_execution_final_summary_receipts WHEN NEW.status='persisted' BEGIN SELECT RAISE(FAIL,'injected_receipt_write'); END;").unwrap();
    assert!(
        finish(ROOT_SESSION, SUMMARY_TURN, TurnTerminalStatus::Cancelled)
            .unwrap_err()
            .contains("injected_receipt_write")
    );
    assert_eq!(receipt().status, summary::FinalSummaryStatus::Persisting);
    let terminal: String = conn
        .query_row(
            "SELECT status FROM session_turn_intents WHERE session_id=?1 AND turn_intent_id=?2",
            rusqlite::params![ROOT_SESSION, SUMMARY_TURN],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        terminal, "running",
        "receipt and exact Turn settlement roll back together"
    );
    conn.execute_batch("DROP TRIGGER fail_report_binding")
        .unwrap();
    assert_eq!(summary::reconcile_after_restart(&conn).unwrap(), 1);
    assert_eq!(summary::reconcile_after_restart(&conn).unwrap(), 0);
    assert_eq!(receipt().event_id.as_deref(), Some(event_id.as_str()));
}

#[tokio::test]
async fn explicit_retry_waits_for_idle_and_duplicate_clicks_create_only_one_attempt() {
    let _sandbox = sandbox();
    let original = start_report().await;
    finish(ROOT_SESSION, SUMMARY_TURN, TurnTerminalStatus::Cancelled).unwrap();
    assert_eq!(
        summary::retry_failed(RUN_ID, &original.certificate_id, 1, "retry").unwrap_err(),
        "final_summary_retry_requires_idle_current_generation"
    );
    let before = AgentOrgTaskStore::list(RUN_ID).unwrap();
    let assessment =
        crate::coordination::agent_org_runs::AgentOrgRunStore::assess_run_quiescence(RUN_ID)
            .unwrap();
    assert_eq!(
        assessment.decision,
        crate::coordination::agent_org_runs::AgentOrgQuiescenceDecision::Quiescent
    );
    crate::coordination::agent_org_runs::AgentOrgRunStore::try_transition_working_to_idle(
        RUN_ID,
        assessment.facts.activation_generation.unwrap(),
        assessment.facts.progress.unwrap().work_revision,
    )
    .unwrap();
    let next = summary::retry_failed(RUN_ID, &original.certificate_id, 1, "retry").unwrap();
    assert_eq!(next.attempt, 2);
    assert_eq!(
        summary::retry_failed(RUN_ID, &original.certificate_id, 1, "retry").unwrap(),
        next
    );
    assert_eq!(
        summary::retry_failed(RUN_ID, &original.certificate_id, 1, "second-click").unwrap_err(),
        "final_summary_retry_attempt_is_stale"
    );
    finish(ROOT_SESSION, SUMMARY_TURN, TurnTerminalStatus::Cancelled).unwrap();
    assert_eq!(
        receipt(),
        next,
        "late first-attempt callback cannot settle the retry"
    );
    assert_eq!(
        serde_json::to_value(AgentOrgTaskStore::list(RUN_ID).unwrap()).unwrap(),
        serde_json::to_value(before).unwrap()
    );
}

fn receipt() -> summary::FinalSummaryReceipt {
    summary::active_for_run_with_connection(&database::db::get_connection().unwrap(), RUN_ID, 1)
        .unwrap()
        .unwrap()
}

#[tokio::test]
async fn successful_execution_without_report_preserves_the_storage_failure_reason() {
    use crate::core::session::turn::event_handler::{EventHandlerConfig, UnifiedEventHandler};
    let _sandbox = sandbox();
    start_report().await;
    let handler = UnifiedEventHandler::new(EventHandlerConfig {
        agent_org_turn_intent_id: Some(SUMMARY_TURN.into()),
        require_durable_assistant_event: true,
        ..Default::default()
    });
    handler.verify_agent_org_completion_publication(ROOT_SESSION);
    assert!(handler
        .take_assistant_persistence_error()
        .unwrap()
        .contains("no persisted EventStore row"));
    finish(ROOT_SESSION, SUMMARY_TURN, TurnTerminalStatus::Failed).unwrap();
    assert_eq!(
        receipt().typed_error.as_deref(),
        Some("event_store_missing")
    );
}

#[tokio::test]
async fn stopped_report_turn_closes_attempt_without_reversing_certified_work() {
    let _sandbox = sandbox();
    let original = start_report().await;
    // Cancellation may return Ok from the provider executor. The explicit
    // terminal signal, rather than the function Result, owns settlement.
    finish(ROOT_SESSION, SUMMARY_TURN, TurnTerminalStatus::Cancelled).unwrap();
    let stopped = receipt();
    assert_eq!(stopped.status, summary::FinalSummaryStatus::Failed);
    assert_eq!(stopped.typed_error.as_deref(), Some("stopped"));
    assert!(stopped.can_retry);
    assert_eq!(stopped.certificate_id, original.certificate_id);
    assert_eq!(stopped.attempt, 1);
    assert!(stopped.event_id.is_none());
    finish(ROOT_SESSION, SUMMARY_TURN, TurnTerminalStatus::Cancelled).unwrap();
    assert_eq!(receipt(), stopped);
    assert_eq!(
        AgentOrgTaskStore::list(RUN_ID).unwrap()[0].status,
        TaskStatus::Completed
    );
}
