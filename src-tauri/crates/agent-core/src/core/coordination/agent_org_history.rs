//! Capture display provenance at the input boundary, without changing message
//! deduplication identities or creating another execution state store.
use super::agent_org_runs::{AgentOrgRunContext, AgentOrgRunStore, COORDINATOR_MEMBER_ID};
use super::agent_org_turn_contexts::{self, AgentOrgTurnSourceKind};
use core_types::agent_org_history::{
    AgentOrgExecution, AgentOrgHistorySender, AgentOrgInputSource,
};

fn participant_name(context: &AgentOrgRunContext, id: &str) -> Option<String> {
    if id == COORDINATOR_MEMBER_ID {
        Some(context.coordinator_name.clone())
    } else {
        context
            .members
            .iter()
            .find(|member| member.member_id == id)
            .map(|member| member.name.clone())
    }
}

pub fn execution(session_id: &str, intent: &str) -> Result<AgentOrgExecution, String> {
    let context =
        agent_org_turn_contexts::require_existing_context_for_session(session_id, intent)?;
    let run = AgentOrgRunStore::context_for_run(&context.org_run_id)?
        .ok_or("history execution run missing")?;
    let conn = database::db::get_connection().map_err(|error| error.to_string())?;
    let source_kind =
        if super::agent_org_final_summary::has_summary_receipt_for_turn_with_connection(
            &conn, session_id, intent,
        )? {
            AgentOrgInputSource::FinalSummary
        } else {
            match context.source_kind {
                AgentOrgTurnSourceKind::MemberInbox => AgentOrgInputSource::MemberMessages,
                AgentOrgTurnSourceKind::Task => AgentOrgInputSource::TaskDispatch,
                AgentOrgTurnSourceKind::RootTurn
                    if coordinator_mail_wake(&conn, &context.org_run_id, session_id, intent)? =>
                {
                    AgentOrgInputSource::MemberMessages
                }
                AgentOrgTurnSourceKind::RootTurn
                | AgentOrgTurnSourceKind::GroupRoot
                | AgentOrgTurnSourceKind::DirectMember
                | AgentOrgTurnSourceKind::GroupMention => AgentOrgInputSource::UserInput,
            }
        };
    Ok(AgentOrgExecution {
        turn_intent_id: intent.to_string(),
        source_kind,
        participant_name: participant_name(&run, &context.participant_id)
            .ok_or("history participant missing")?,
        participant_id: context.participant_id,
        inbox_count: None,
        senders: Vec::new(),
    })
}

fn coordinator_mail_wake(
    conn: &rusqlite::Connection,
    run: &str,
    session: &str,
    intent: &str,
) -> Result<bool, String> {
    // RootTurn describes authority, not why execution started. Keep explicit
    // user input primary when it consumes mail; otherwise the durable trigger
    // attempt proves this is an inbox wake, including after it has resolved.
    conn.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM agent_org_execution_formal_trigger_attempts attempt
            JOIN agent_org_execution_formal_trigger_receipts receipt USING(receipt_id)
            WHERE attempt.session_id=?1 AND attempt.turn_intent_id=?2
              AND receipt.org_run_id=?3
        ) AND NOT EXISTS(
            SELECT 1 FROM agent_org_execution_initial_inputs
            WHERE org_run_id=?3 AND turn_intent_id=?2
        ) AND NOT EXISTS(
            SELECT 1 FROM session_turn_intents
            WHERE session_id=?1 AND turn_intent_id=?2
              AND source IN ('user_submit','queue','force_send','mobile_remote')
        )",
        rusqlite::params![session, intent, run],
        |row| row.get(0),
    )
    .map_err(|error| error.to_string())
}

pub fn inbox_execution(
    session_id: &str,
    intent: &str,
    message_id: &str,
) -> Result<AgentOrgExecution, String> {
    let mut result = execution(session_id, intent)?;
    let context =
        agent_org_turn_contexts::require_existing_context_for_session(session_id, intent)?;
    let run =
        AgentOrgRunStore::context_for_run(&context.org_run_id)?.ok_or("history run missing")?;
    let conn = database::db::get_connection().map_err(|error| error.to_string())?;
    // Only materialized source rows are counted. System disposition records
    // never pass this boundary and must not be presented as model-read mail.
    let mut stmt = conn
        .prepare(
            "SELECT inbox.sender_member_id, COUNT(*),
                (inbox.sender_member_id IS NULL AND inbox.sender_agent_id=?5) AS system_sender
         FROM agent_org_execution_inbox_materializations receipt
         JOIN agent_org_execution_inbox inbox ON inbox.id=receipt.inbox_id
         WHERE receipt.session_id=?1 AND receipt.transcript_message_id=?2
           AND inbox.org_run_id=?3 AND inbox.recipient_member_id=?4
         GROUP BY inbox.sender_member_id, system_sender
         ORDER BY inbox.sender_member_id, system_sender",
        )
        .map_err(|error| error.to_string())?;
    let senders = stmt
        .query_map(
            rusqlite::params![
                session_id,
                message_id,
                context.org_run_id,
                context.participant_id,
                super::agent_inbox::SYSTEM_SENDER_ID
            ],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, usize>(1)?,
                    row.get::<_, bool>(2)?,
                ))
            },
        )
        .map_err(|error| error.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| error.to_string())?;
    if senders.is_empty() {
        return Err("history inbox materialization missing for participant".to_string());
    }
    result.inbox_count = Some(senders.iter().map(|(_, count, _)| count).sum());
    result.senders = senders
        .into_iter()
        .map(|(member_id, count, system_sender)| AgentOrgHistorySender {
            name: member_id
                .as_deref()
                .and_then(|id| participant_name(&run, id))
                .or_else(|| system_sender.then(|| "System".to_string())),
            member_id,
            count,
        })
        .collect();
    Ok(result)
}
