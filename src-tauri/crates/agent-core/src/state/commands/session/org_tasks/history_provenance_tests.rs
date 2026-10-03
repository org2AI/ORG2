use super::*;
use crate::coordination::agent_org_history::{execution, inbox_execution};
use core_types::agent_org_history::AgentOrgInputSource;

fn prepare() -> AgentOrgRunContext {
    let context = prepare_command_run("running");
    let conn = get_connection().unwrap();
    configure_pause_resume_authority(&conn, &context);
    for (session, intent, kind) in [
        ("root-shared-agent", "root", "coordinator"),
        ("planner-session", "worker", "task_execution"),
    ] {
        seed_pause_turn_context(
            &conn,
            &context,
            PauseTurnSeed {
                session_id: session,
                turn_intent_id: intent,
                turn_kind: kind,
                intent_status: "running",
                task_id: Some("task"),
                activation_generation: Some(1),
                member_sequence: (kind != "coordinator").then_some(1),
            },
        );
    }
    context
}
fn mail(context: &AgentOrgRunContext, sender: &str, recipient: &str) -> i64 {
    AgentInboxStore::insert(InsertInboxParams {
        recipient_agent_id: "builtin:sde".into(),
        recipient_member_id: Some(recipient.into()),
        sender_agent_id: "builtin:sde".into(),
        sender_member_id: Some(sender.into()),
        org_run_id: Some(context.run_id.clone()),
        message: AgentMessage::Plain {
            summary: "result".into(),
            text: "finished".into(),
        },
    })
    .unwrap()
    .id
}
fn materialize(id: i64, session: &str, message: &str) {
    get_connection()
        .unwrap()
        .execute(
            "INSERT INTO agent_org_runtime_inbox_materializations
        (inbox_id,session_id,transcript_message_id,transcript_intent_id,materialized_at)
        VALUES (?1,?2,?3,'stable-message-identity',?4)",
            params![id, session, message, chrono::Utc::now().to_rfc3339()],
        )
        .unwrap();
}
#[test]
fn history_counts_only_exact_materialized_inputs_and_preserves_formal_owner() {
    let _sandbox = test_helpers::test_env::sandbox();
    let context = prepare();
    for _ in 0..2 {
        materialize(
            mail(&context, "member-builder", "member-planner"),
            "planner-session",
            "batch",
        );
    }
    // Persisted but not presented input must not become a model-read message.
    mail(&context, "coordinator", "member-planner");
    let input = inbox_execution("planner-session", "worker", "batch").unwrap();
    assert_eq!(input.turn_intent_id, "worker");
    assert_eq!(input.participant_id, "member-planner");
    assert_eq!(input.participant_name, "Planner");
    assert_eq!(input.source_kind, AgentOrgInputSource::TaskDispatch);
    assert_eq!(input.inbox_count, Some(2));
    assert_eq!(input.senders.len(), 1);
    assert_eq!(input.senders[0].name.as_deref(), Some("Builder"));
    assert_eq!(input.senders[0].count, 2);
    assert_eq!(
        input,
        inbox_execution("planner-session", "worker", "batch").unwrap()
    );
    assert!(inbox_execution("root-shared-agent", "root", "batch").is_err());
    assert!(execution("planner-session", "root").is_err());
}
#[test]
fn missing_sender_names_stay_unknown_instead_of_guessing_from_shared_agent() {
    let _sandbox = test_helpers::test_env::sandbox();
    let context = prepare();
    materialize(
        mail(&context, "historical-member", "member-planner"),
        "planner-session",
        "batch",
    );
    let input = inbox_execution("planner-session", "worker", "batch").unwrap();
    assert_eq!(
        input.senders[0].member_id.as_deref(),
        Some("historical-member")
    );
    assert_eq!(input.senders[0].name, None);
}

#[test]
fn known_system_sender_is_not_merged_with_unidentified_senders() {
    let _sandbox = test_helpers::test_env::sandbox();
    let context = prepare();
    for sender in [
        crate::coordination::agent_inbox::SYSTEM_SENDER_ID,
        "legacy-agent",
    ] {
        let message = AgentInboxStore::insert(InsertInboxParams {
            recipient_agent_id: "builtin:sde".into(),
            recipient_member_id: Some("member-planner".into()),
            sender_agent_id: sender.into(),
            sender_member_id: None,
            org_run_id: Some(context.run_id.clone()),
            message: AgentMessage::Plain {
                summary: "notice".into(),
                text: "input".into(),
            },
        })
        .unwrap();
        materialize(message.id, "planner-session", "mixed-batch");
    }
    let input = inbox_execution("planner-session", "worker", "mixed-batch").unwrap();
    assert_eq!(input.inbox_count, Some(2));
    assert_eq!(input.senders.len(), 2);
    assert_eq!(input.senders[0].name, None);
    assert_eq!(input.senders[1].name.as_deref(), Some("System"));
    assert!(input
        .senders
        .iter()
        .all(|sender| sender.member_id.is_none() && sender.count == 1));
}
#[test]
fn summary_source_requires_its_real_receipt_and_survives_terminal_status() {
    let _sandbox = test_helpers::test_env::sandbox();
    let context = prepare();
    assert_eq!(
        execution("root-shared-agent", "root").unwrap().source_kind,
        AgentOrgInputSource::UserInput
    );
    let conn = get_connection().unwrap();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute("INSERT INTO agent_org_runtime_run_completion_certificates(
        id,org_run_id,activation_generation,work_revision,request_id,request_digest,outcome,summary,
        coordinator_session_id,coordinator_turn_intent_id,evidence_task_ids_json,closure_task_ids_json,
        task_output_refs_json,resolution_links_json,validator_version,created_at)
        VALUES ('certificate',?1,1,1,'request',?2,'delivered','done','root-shared-agent','root','[]','[]','[]','[]',1,?3)", params![context.run_id, "a".repeat(64), now]).unwrap();
    conn.execute("INSERT INTO agent_org_runtime_final_summary_receipts(
        receipt_id,org_run_id,activation_generation,certificate_id,evidence_digest,attempt,status,
        coordinator_session_id,turn_intent_id,started_at,terminal_at,typed_error,created_at,updated_at)
        VALUES ('summary',?1,1,'certificate',?2,1,'failed','root-shared-agent','root',?3,?3,'stopped',?3,?3)", params![context.run_id, "b".repeat(64), now]).unwrap();
    assert_eq!(
        execution("root-shared-agent", "root").unwrap().source_kind,
        AgentOrgInputSource::FinalSummary
    );
}

#[test]
fn coordinator_mail_wake_uses_its_trigger_receipt_without_relabeling_user_input() {
    let _sandbox = test_helpers::test_env::sandbox();
    let context = prepare();
    let message = AgentInboxStore::insert(InsertInboxParams {
        recipient_agent_id: context.coordinator_agent_id.clone(),
        recipient_member_id: Some(COORDINATOR_MEMBER_ID.into()),
        sender_agent_id: "builtin:sde".into(),
        sender_member_id: Some("member-builder".into()),
        org_run_id: Some(context.run_id.clone()),
        message: AgentMessage::TaskCompleted {
            task_id: "completed-task".into(),
            subject: "Delivered work".into(),
            completed_by_member_id: "member-builder".into(),
            output_summary: Some("Verified result".into()),
            plan_revision_id: None,
            remaining_open_task_count: 0,
        },
    })
    .unwrap();
    let batch = crate::coordination::agent_org_formal_triggers::claim_for_coordinator_turn(
        &context.run_id,
        "root-shared-agent",
        "root",
    )
    .unwrap()
    .unwrap();
    assert_eq!(batch.inbox_ids, vec![message.id]);
    materialize(message.id, "root-shared-agent", "mail-batch");
    assert_eq!(
        execution("root-shared-agent", "root").unwrap().source_kind,
        AgentOrgInputSource::MemberMessages
    );
    assert_eq!(
        inbox_execution("root-shared-agent", "root", "mail-batch")
            .unwrap()
            .source_kind,
        AgentOrgInputSource::MemberMessages
    );
    let conn = get_connection().unwrap();
    // A real user submission may consume the same pending mail in its own turn.
    conn.execute(
        "UPDATE session_turn_intents SET source='user_submit' WHERE turn_intent_id='root'",
        [],
    )
    .unwrap();
    assert_eq!(
        inbox_execution("root-shared-agent", "root", "mail-batch")
            .unwrap()
            .source_kind,
        AgentOrgInputSource::UserInput
    );
    conn.execute("UPDATE session_turn_intents SET source='resume',status='completed' WHERE turn_intent_id='root'", []).unwrap();
    conn.execute("UPDATE agent_org_runtime_formal_trigger_attempts SET status='resolved' WHERE turn_intent_id='root'", []).unwrap();
    assert_eq!(
        execution("root-shared-agent", "root").unwrap().source_kind,
        AgentOrgInputSource::MemberMessages
    );
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO agent_org_runtime_initial_inputs (
        org_run_id,turn_intent_id,message_id,content,payload_json,status,created_at,updated_at)
        VALUES (?1,'root','initial-input','User request','{}','dispatched',?2,?2)",
        params![context.run_id, now],
    )
    .unwrap();
    assert_eq!(
        execution("root-shared-agent", "root").unwrap().source_kind,
        AgentOrgInputSource::UserInput
    );
}
