//! Production task tools, provider-input evidence, completion and finality.
use super::*;
use crate::coordination::agent_inbox::{
    AgentInboxStore, AgentMessage, InsertInboxParams, MemberIdleReason, SYSTEM_SENDER_ID,
};
use crate::coordination::agent_org_run_completion as completion;
use crate::coordination::agent_org_runs::AgentOrgRunStore;
use crate::lifecycle::TurnTerminalStatus;

pub(super) const OWNER_TURN: &str = "turn-result-producer";

pub(super) async fn completed_task() -> String {
    let created = create_owned("completion-evidence", ALICE).await;
    let id = created["task"]["id"].as_str().unwrap().to_owned();
    let conn = database::db::get_connection().unwrap();
    insert_owner_context(&conn, OWNER_TURN, &id);
    let tool = TaskUpdateTool::new(tools_context(ALICE));
    tool.execute_text(
        json!({"operation":"start","id":id}),
        &owner_call(OWNER_TURN),
    )
    .await
    .unwrap();
    tool.execute_text(json!({"operation":"complete","id":id,"output":{"summary":"checked","content":"Complete result with limits: offline only","artifact_ids":[]}}), &owner_call(OWNER_TURN)).await.unwrap();
    AgentOrgRunStore::stage_coordinator_work_revision_and_load_tasks(
        RUN_ID,
        ROOT_SESSION,
        COORDINATOR_TURN,
        &[],
    )
    .unwrap();
    id
}

pub(super) async fn present(id: &str, mode: &str) {
    let output = TaskGetTool::new(tools_context(COORDINATOR_MEMBER_ID))
        .execute_text(json!({"id":id}), &coordinator_call())
        .await
        .unwrap();
    let content = match mode {
        "truncated" => format!("[output truncated]{}", &output[output.len() / 2..]),
        "summary" => json!({"task":{"id":id,"output":{"summary":"checked"}}}).to_string(),
        _ => output,
    };
    let name = if mode == "forged" {
        "run_shell"
    } else {
        "task_get"
    };
    let messages = vec![
        json!({"role":"assistant","tool_calls":[{"id":"get-output","function":{"name":name,"arguments":json!({"id":id}).to_string()}}]}),
        json!({"role":"tool","tool_call_id":"get-output","content":content}),
    ];
    completion::record_provider_presentation(ROOT_SESSION, COORDINATOR_TURN, &messages).unwrap();
}

pub(super) async fn request(summary: &str) -> crate::tools::traits::ToolExecuteResult {
    OrgRunCompleteTool::new(tools_context(COORDINATOR_MEMBER_ID))
        .execute(
            json!({"candidate_outcome":"delivered","summary":summary}),
            &coordinator_call(),
        )
        .await
        .unwrap()
}

pub(super) fn finish(session: &str, turn: &str, status: TurnTerminalStatus) -> Result<(), String> {
    crate::coordination::agent_org_finality::finalize_turn(session, turn, status, status.as_str())?;
    crate::session::persistence::update_status(session, crate::session::SessionStatus::Idle)
        .map_err(|e| e.to_string())?;
    completion::recheck_after_turn(session, turn)?;
    Ok(())
}

fn count(table: &str) -> i64 {
    let conn = database::db::get_connection().unwrap();
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}
fn certificates() -> i64 {
    count("agent_org_runtime_run_completion_certificates")
}
fn resolutions() -> i64 {
    database::db::get_connection().unwrap().query_row("SELECT COUNT(*) FROM agent_org_runtime_inbox_delivery_resolutions WHERE resolution_kind='system_reconciled'",[],|r|r.get(0)).unwrap()
}
fn candidate() -> Option<String> {
    database::db::get_connection().unwrap().query_row("SELECT completion_candidate_json FROM agent_org_runtime_run_progress WHERE org_run_id=?1",[RUN_ID],|r|r.get(0)).unwrap()
}
fn idle(
    reason: MemberIdleReason,
    summary: Option<&str>,
    unfinished: Vec<String>,
    source_turn: &str,
) -> i64 {
    let failure_reason =
        matches!(reason, MemberIdleReason::Failed).then(|| "execution failed".into());
    AgentInboxStore::insert_member_idle_if_run_running(
        InsertInboxParams {
            recipient_agent_id: "agent-coordinator".into(),
            recipient_member_id: Some(COORDINATOR_MEMBER_ID.into()),
            sender_agent_id: SYSTEM_SENDER_ID.into(),
            sender_member_id: None,
            org_run_id: Some(RUN_ID.into()),
            message: AgentMessage::MemberIdle {
                member_id: ALICE.into(),
                member_name: "Alice".into(),
                reason,
                current_mode: None,
                summary: summary.map(str::to_owned),
                failure_reason,
                unfinished_task_ids: unfinished,
            },
        },
        Some(source_turn),
    )
    .unwrap()
    .unwrap()
    .0
    .id
}

#[tokio::test]
async fn completion_waits_for_exact_success_and_settles_only_redundant_rows() {
    let _sandbox = sandbox();
    let id = completed_task().await;
    present(&id, "full").await;
    let result = request("Ready when the member ends").await;
    assert_eq!(result.turn_directive, Some(ToolTurnDirective::EndTurn));
    assert!(candidate().is_some());
    assert_eq!(certificates(), 0);
    assert_eq!(resolutions(), 0);
    let idle_id = idle(MemberIdleReason::Available, None, vec![], OWNER_TURN);
    assert!(completion::recheck_pending(RUN_ID).unwrap());
    finish(
        ROOT_SESSION,
        COORDINATOR_TURN,
        TurnTerminalStatus::Completed,
    )
    .unwrap();
    assert_eq!(certificates(), 0);
    finish(ALICE_SESSION, OWNER_TURN, TurnTerminalStatus::Completed).unwrap();
    assert_eq!(certificates(), 1);
    assert!(candidate().is_none());
    let conn = database::db::get_connection().unwrap();
    let (read_at,kind,reason):(Option<String>,String,String)=conn.query_row(
        "SELECT inbox.read_at,resolution.resolution_kind,resolution.reason FROM agent_org_runtime_inbox inbox JOIN agent_org_runtime_inbox_delivery_resolutions resolution ON resolution.inbox_id=inbox.id WHERE inbox.id=?1",
        [idle_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
    assert!(read_at.is_none());
    assert_eq!(kind, "system_reconciled");
    assert!(reason.contains(OWNER_TURN));
    assert!(reason.contains(COORDINATOR_TURN));
    let output_evidence:String=conn.query_row("SELECT resolution.reason FROM agent_org_runtime_inbox_delivery_resolutions resolution JOIN agent_org_runtime_inbox inbox ON inbox.id=resolution.inbox_id WHERE inbox.payload_kind='task_completed' AND resolution.resolution_kind='system_reconciled'",[],|r|r.get(0)).unwrap();
    let evidence: Value = serde_json::from_str(&output_evidence).unwrap();
    assert_eq!(
        evidence["evidence"]["presentation"]["turnIntentId"],
        COORDINATOR_TURN
    );
    assert_eq!(
        evidence["evidence"]["presentation"]["output"]["tool_call_id"],
        "get-output"
    );
    // A concurrent late normal drain cannot turn a system disposition into
    // a claim that the model read it.
    assert_eq!(
        AgentInboxStore::mark_many_read_for_session(&[idle_id], ROOT_SESSION).unwrap(),
        0
    );
    let pending:i64=conn.query_row("SELECT COUNT(*) FROM agent_org_runtime_formal_trigger_receipts WHERE trigger_kind<>'final_summary' AND status<>'resolved'",[],|r|r.get(0)).unwrap();
    assert_eq!(pending, 0);
    for _ in 0..3 {
        assert!(!completion::recheck_pending(RUN_ID).unwrap());
    }
    assert_eq!(certificates(), 1);
    assert_eq!(count("agent_org_runtime_final_summary_receipts"), 1);
}

#[tokio::test]
async fn member_already_ended_before_registration_is_not_a_lost_wake() {
    let _sandbox = sandbox();
    let id = completed_task().await;
    present(&id, "full").await;
    idle(MemberIdleReason::Available, None, vec![], OWNER_TURN);
    finish(ALICE_SESSION, OWNER_TURN, TurnTerminalStatus::Completed).unwrap();
    assert_eq!(certificates(), 0, "no candidate cannot authorize delivery");
    request("Complete after prior member end").await;
    finish(
        ROOT_SESSION,
        COORDINATOR_TURN,
        TurnTerminalStatus::Completed,
    )
    .unwrap();
    assert_eq!(certificates(), 1);
}

#[tokio::test]
async fn dense_redundant_notifications_do_not_require_a_model_turn() {
    let _sandbox = sandbox();
    let id = completed_task().await;
    present(&id, "full").await;
    let ids: Vec<_> = (0..205)
        .map(|_| idle(MemberIdleReason::Available, None, vec![], OWNER_TURN))
        .collect();
    finish(ALICE_SESSION, OWNER_TURN, TurnTerminalStatus::Completed).unwrap();
    request("Reviewed result with repeated idle deliveries").await;
    assert!(
        candidate().is_some(),
        "notification count cannot require model review"
    );
    finish(
        ROOT_SESSION,
        COORDINATOR_TURN,
        TurnTerminalStatus::Completed,
    )
    .unwrap();
    assert_eq!(certificates(), 1);
    let conn = database::db::get_connection().unwrap();
    for id in ids {
        let disposed: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM agent_org_runtime_inbox_delivery_resolutions WHERE inbox_id=?1 AND resolution_kind='system_reconciled')", [id], |r| r.get(0)).unwrap();
        assert!(disposed);
    }
}

#[tokio::test]
async fn coordinator_cancel_discards_authority_and_preserves_unread_outputs() {
    let _sandbox = sandbox();
    let id = completed_task().await;
    present(&id, "full").await;
    request("Potential delivery").await;
    finish(
        ROOT_SESSION,
        COORDINATOR_TURN,
        TurnTerminalStatus::Cancelled,
    )
    .unwrap();
    finish(ALICE_SESSION, OWNER_TURN, TurnTerminalStatus::Completed).unwrap();
    assert_eq!(certificates(), 0);
    assert_eq!(resolutions(), 0);
    assert!(candidate().is_none());
    assert!(
        AgentInboxStore::list_unread_for_member(COORDINATOR_MEMBER_ID, RUN_ID)
            .unwrap()
            .iter()
            .any(|r| r.payload_kind == "task_completed")
    );
}

#[tokio::test]
async fn incomplete_or_forged_tool_presentation_requires_real_input() {
    for mode in ["none", "truncated", "summary", "forged"] {
        let _sandbox = sandbox();
        let id = completed_task().await;
        if mode != "none" {
            present(&id, mode).await;
        }
        let result = request("Results need review").await;
        assert_eq!(result.turn_directive, Some(ToolTurnDirective::EndTurn));
        assert!(
            candidate().is_none(),
            "{mode} must not prove full result presentation"
        );
        finish(
            ROOT_SESSION,
            COORDINATOR_TURN,
            TurnTerminalStatus::Completed,
        )
        .unwrap();
        finish(ALICE_SESSION, OWNER_TURN, TurnTerminalStatus::Completed).unwrap();
        assert_eq!(certificates(), 0);
        assert_eq!(resolutions(), 0);
    }
}

#[tokio::test]
async fn new_request_invalidates_waiting_candidate_without_clearing_any_message() {
    let _sandbox = sandbox();
    let id = completed_task().await;
    present(&id, "full").await;
    request("Existing scope").await;
    let message = AgentInboxStore::insert(InsertInboxParams {
        recipient_agent_id: "agent-coordinator".into(),
        recipient_member_id: Some(COORDINATOR_MEMBER_ID.into()),
        sender_agent_id: crate::coordination::agent_inbox::USER_SENDER_ID.into(),
        sender_member_id: None,
        org_run_id: Some(RUN_ID.into()),
        message: AgentMessage::Plain {
            summary: "New requirement".into(),
            text: "Also verify the additional input".into(),
        },
    })
    .unwrap();
    assert!(!completion::recheck_pending(RUN_ID).unwrap());
    assert!(candidate().is_none());
    finish(ALICE_SESSION, OWNER_TURN, TurnTerminalStatus::Completed).unwrap();
    finish(
        ROOT_SESSION,
        COORDINATOR_TURN,
        TurnTerminalStatus::Completed,
    )
    .unwrap();
    assert_eq!(certificates(), 0);
    assert_eq!(resolutions(), 0);
    assert!(
        AgentInboxStore::list_unread_for_member(COORDINATOR_MEMBER_ID, RUN_ID)
            .unwrap()
            .iter()
            .any(|r| r.id == message.id)
    );
}

#[tokio::test]
async fn idle_with_failure_interruption_or_extra_information_stays_actionable() {
    for (reason, summary, unfinished) in [
        (MemberIdleReason::Failed, None, vec![]),
        (MemberIdleReason::Interrupted, None, vec![]),
        (MemberIdleReason::Available, Some("Need a decision"), vec![]),
        (MemberIdleReason::Available, None, vec!["unfinished".into()]),
    ] {
        let _sandbox = sandbox();
        let id = completed_task().await;
        present(&id, "full").await;
        idle(reason, summary, unfinished, OWNER_TURN);
        request("Cannot ignore new information").await;
        assert!(candidate().is_none());
        assert_eq!(resolutions(), 0);
    }
}

#[tokio::test]
async fn repeated_summary_or_call_id_cannot_replace_waiting_authority() {
    let _sandbox = sandbox();
    let id = completed_task().await;
    present(&id, "full").await;
    request("First authorized conclusion").await;
    let first = candidate().unwrap();
    request("Same facts with different words").await;
    assert_eq!(candidate().unwrap(), first);
    assert_eq!(certificates(), 0);
}

#[tokio::test]
async fn disposition_and_certificate_rollback_together_on_storage_failure() {
    let _sandbox = sandbox();
    let id = completed_task().await;
    present(&id, "full").await;
    request("Atomic completion").await;
    finish(
        ROOT_SESSION,
        COORDINATOR_TURN,
        TurnTerminalStatus::Completed,
    )
    .unwrap();
    let conn = database::db::get_connection().unwrap();
    conn.execute_batch("CREATE TRIGGER reject_completion BEFORE INSERT ON agent_org_runtime_run_completion_certificates BEGIN SELECT RAISE(ABORT,'injected completion storage failure'); END;").unwrap();
    // Session and formal-turn finality have different persistence boundaries;
    // the post-status recheck is where this fixture becomes quiescent.
    assert!(
        finish(ALICE_SESSION, OWNER_TURN, TurnTerminalStatus::Completed)
            .unwrap_err()
            .contains("injected completion storage failure")
    );
    assert_eq!(certificates(), 0);
    assert_eq!(resolutions(), 0);
    assert!(candidate().is_some());
    conn.execute_batch("DROP TRIGGER reject_completion;")
        .unwrap();
    finish(ALICE_SESSION, OWNER_TURN, TurnTerminalStatus::Completed).unwrap();
    assert_eq!(certificates(), 1);
}

#[tokio::test]
async fn failed_coordinator_and_cancelled_member_cannot_certify_saved_candidate() {
    for (session, turn, status) in [
        (ROOT_SESSION, COORDINATOR_TURN, TurnTerminalStatus::Failed),
        (ALICE_SESSION, OWNER_TURN, TurnTerminalStatus::Cancelled),
    ] {
        let _sandbox = sandbox();
        let id = completed_task().await;
        present(&id, "full").await;
        request("Provisional authority").await;
        finish(session, turn, status).unwrap();
        assert!(candidate().is_none());
        assert_eq!(certificates(), 0);
        assert_eq!(resolutions(), 0);
    }
}

#[tokio::test]
async fn pause_generation_change_and_new_root_invalidate_candidate() {
    for event in ["pause", "generation", "root", "new_task"] {
        let _sandbox = sandbox();
        let id = completed_task().await;
        present(&id, "full").await;
        request("Original scope").await;
        let conn = database::db::get_connection().unwrap();
        match event {
            "pause" => {
                crate::coordination::agent_org_pause::pause_run(
                    RUN_ID,
                    "00000000-0000-4000-8000-000000000212",
                )
                .unwrap();
            }
            "generation" => {
                conn.execute("UPDATE agent_org_runtime_runs SET activation_generation=activation_generation+1 WHERE id=?1",[RUN_ID]).unwrap();
            }
            "root" => insert_coordinator_context_for_turn(&conn, "new-root"),
            _ => {
                create_owned("new-work", BOB).await;
            }
        }
        assert!(!completion::recheck_pending(RUN_ID).unwrap());
        assert!(candidate().is_none(), "{event}");
        assert_eq!(certificates(), 0);
        assert_eq!(resolutions(), 0);
    }
}

#[tokio::test]
async fn restart_invalidates_wait_and_never_commits_unfinished_authority() {
    let _sandbox = sandbox();
    let id = completed_task().await;
    present(&id, "full").await;
    request("Interrupted application").await;
    let conn = database::db::get_connection().unwrap();
    crate::coordination::reconcile_agent_org_turns_after_restart(&conn).unwrap();
    assert!(candidate().is_none());
    assert_eq!(certificates(), 0);
    assert_eq!(resolutions(), 0);
    assert_eq!(completion::reconcile_after_restart(&conn).unwrap(), 0);
}

#[tokio::test]
async fn late_redundant_idle_is_disposed_but_new_message_keeps_its_wake() {
    let _sandbox = sandbox();
    let id = completed_task().await;
    present(&id, "full").await;
    request("Finished work").await;
    finish(
        ROOT_SESSION,
        COORDINATOR_TURN,
        TurnTerminalStatus::Completed,
    )
    .unwrap();
    finish(ALICE_SESSION, OWNER_TURN, TurnTerminalStatus::Completed).unwrap();
    assert_eq!(certificates(), 1);
    for _ in 0..205 {
        idle(MemberIdleReason::Available, None, vec![], OWNER_TURN);
    }
    let late_id = idle(MemberIdleReason::Available, None, vec![], OWNER_TURN);
    let substantive = AgentInboxStore::insert(InsertInboxParams {
        recipient_agent_id: "agent-coordinator".into(),
        recipient_member_id: Some(COORDINATOR_MEMBER_ID.into()),
        sender_agent_id: crate::coordination::agent_inbox::USER_SENDER_ID.into(),
        sender_member_id: None,
        org_run_id: Some(RUN_ID.into()),
        message: AgentMessage::Plain {
            summary: "Additional review".into(),
            text: "Check the input limits too".into(),
        },
    })
    .unwrap();
    assert!(!completion::completion_handles_wake(RUN_ID).unwrap());
    let conn = database::db::get_connection().unwrap();
    let (kind,read):(String,Option<String>)=conn.query_row("SELECT resolution.resolution_kind,inbox.read_at FROM agent_org_runtime_inbox inbox JOIN agent_org_runtime_inbox_delivery_resolutions resolution ON resolution.inbox_id=inbox.id WHERE inbox.id=?1",[late_id],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
    assert_eq!(kind, "system_reconciled");
    assert!(read.is_none());
    let pending:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM agent_org_runtime_formal_trigger_receipts WHERE inbox_id=?1 AND status='pending')",[substantive.id],|r|r.get(0)).unwrap();
    assert!(pending);
    assert!(
        AgentInboxStore::list_unread_for_member(COORDINATOR_MEMBER_ID, RUN_ID)
            .unwrap()
            .iter()
            .any(|row| row.id == substantive.id)
    );
    assert_eq!(certificates(), 1);
}

#[tokio::test]
async fn old_idle_and_new_output_version_are_not_reconciled() {
    for change in ["new_execution", "output_version"] {
        let _sandbox = sandbox();
        let id = completed_task().await;
        present(&id, "full").await;
        request("Original result").await;
        idle(MemberIdleReason::Available, None, vec![], OWNER_TURN);
        let conn = database::db::get_connection().unwrap();
        if change == "new_execution" {
            insert_owner_context(&conn, "replacement-member-turn", &id);
        } else {
            // Inject an inconsistent producer version without a revision bump;
            // even corrupted storage must not reuse the old output proof.
            conn.execute("UPDATE agent_org_runtime_tasks SET output_json=json_set(output_json,'$.content','New result and limits') WHERE id=?1",[&id]).unwrap();
        }
        assert!(!completion::recheck_pending(RUN_ID).unwrap());
        assert!(candidate().is_none());
        assert_eq!(resolutions(), 0);
        assert_eq!(certificates(), 0);
    }
}

#[tokio::test]
async fn same_invalid_facts_end_turn_even_with_changed_summary_and_call_id() {
    let _sandbox = sandbox();
    let id = completed_task().await;
    present(&id, "full").await;
    let tool = OrgRunCompleteTool::new(tools_context(COORDINATOR_MEMBER_ID));
    let first=tool.execute(json!({"candidate_outcome":"delivered","summary":"first","evidence_task_ids":["unknown-task"]}),&coordinator_call()).await.unwrap();
    assert!(first.turn_directive.is_none());
    let again=tool.execute(json!({"candidate_outcome":"delivered","summary":"second phrasing","evidence_task_ids":["unknown-task"]}),&coordinator_call()).await.unwrap();
    assert_eq!(again.turn_directive, Some(ToolTurnDirective::EndTurn));
    assert!(serde_json::from_str::<Value>(&again.text).unwrap()["blockers"].is_array());
    assert_eq!(certificates(), 0);
}

#[tokio::test]
async fn queued_completion_doorbell_is_absorbed_but_same_batch_new_input_runs() {
    for new_input in [false, true] {
        let _sandbox = sandbox();
        let id = completed_task().await;
        present(&id, "full").await;
        request("Queued doorbell race").await;
        finish(
            ROOT_SESSION,
            COORDINATOR_TURN,
            TurnTerminalStatus::Completed,
        )
        .unwrap();
        // Prepared scheduler input; the fixture never writes completion,
        // disposition or a certificate. Task work above uses production tools.
        let conn = database::db::get_connection().unwrap();
        insert_coordinator_context_for_turn(&conn, "queued-completion-wake");
        conn.execute("UPDATE session_turn_intents SET source='resume',status='queued' WHERE session_id=?1 AND turn_intent_id='queued-completion-wake'",[ROOT_SESSION]).unwrap();
        if new_input {
            AgentInboxStore::insert(InsertInboxParams {
                recipient_agent_id: "agent-coordinator".into(),
                recipient_member_id: Some(COORDINATOR_MEMBER_ID.into()),
                sender_agent_id: crate::coordination::agent_inbox::USER_SENDER_ID.into(),
                sender_member_id: None,
                org_run_id: Some(RUN_ID.into()),
                message: AgentMessage::Plain {
                    summary: "Fresh user question".into(),
                    text: "Please check a new requirement".into(),
                },
            })
            .unwrap();
        }
        finish(ALICE_SESSION, OWNER_TURN, TurnTerminalStatus::Completed).unwrap();
        assert_eq!(
            certificates(),
            0,
            "queued intent still blocks certification"
        );
        let absorbed =
            completion::settle_completion_only_wake(ROOT_SESSION, "queued-completion-wake")
                .unwrap();
        assert_eq!(absorbed, !new_input);
        assert_eq!(certificates(), i64::from(!new_input));
        let status:String=database::db::get_connection().unwrap().query_row("SELECT status FROM session_turn_intents WHERE session_id=?1 AND turn_intent_id='queued-completion-wake'",[ROOT_SESSION],|r|r.get(0)).unwrap();
        assert_eq!(status, if new_input { "queued" } else { "cancelled" });
    }
}

#[tokio::test]
async fn reservation_commit_and_refund_recheck_the_wait_without_another_message() {
    use crate::coordination::agent_org_watchdog as watchdog;
    for refund in [false, true] {
        let _sandbox = sandbox();
        let id = completed_task().await;
        present(&id, "full").await;
        request("Waiting for final wake accounting").await;
        let watchdog::MemberRewakeReservationOutcome::Reserved(reservation) =
            watchdog::reserve_member_rewake_dispatch(
                RUN_ID,
                COORDINATOR_MEMBER_ID,
                "completion-race",
            )
            .unwrap()
        else {
            panic!("new wake budget must reserve")
        };
        finish(
            ROOT_SESSION,
            COORDINATOR_TURN,
            TurnTerminalStatus::Completed,
        )
        .unwrap();
        finish(ALICE_SESSION, OWNER_TURN, TurnTerminalStatus::Completed).unwrap();
        assert_eq!(certificates(), 0);
        if refund {
            watchdog::refund_member_rewake_reservation(&reservation).unwrap();
        } else {
            watchdog::commit_member_rewake_reservation(&reservation).unwrap();
        }
        assert_eq!(completion::recheck_after_wake(RUN_ID).unwrap().len(), 1);
        assert_eq!(certificates(), 1);
        assert!(completion::recheck_after_wake(RUN_ID).unwrap().is_empty());
    }
}
