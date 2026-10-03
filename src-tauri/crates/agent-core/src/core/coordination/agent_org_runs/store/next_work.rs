//! Carry only accepted, unexecuted user requests into the next formal graph.
use rusqlite::{params, Connection};

use super::super::AgentOrgQuiescenceBlocker;
use super::AgentOrgRunStore;

pub(super) fn accepted_user_turns(
    conn: &Connection,
    run_id: &str,
    session_id: &str,
    turn_intent_id: &str,
    generation: i64,
) -> Result<Vec<String>, String> {
    let mut statement = conn
        .prepare(
            "SELECT context.turn_intent_id FROM agent_org_execution_turn_contexts context
         JOIN session_turn_intents intent USING(session_id,turn_intent_id)
         JOIN agent_org_execution_runs run ON run.id=context.org_run_id
         WHERE run.id=?1 AND run.root_session_id=?2 AND context.session_id=?2
           AND context.activation_generation=?4 AND intent.org_run_id=?1
           AND context.participant_id='coordinator' AND context.turn_kind='coordinator'
           AND context.actor_version IS NULL AND context.root_authority_turn_id IS NULL
           AND (context.source_kind='group_root' OR
                (context.source_kind='root_turn' AND context.source_id=context.turn_intent_id))
           AND intent.source='user_submit'
           AND ((context.turn_intent_id=?3 AND intent.status='running') OR
                (context.turn_intent_id<>?3 AND intent.status='queued'))",
        )
        .map_err(|error| error.to_string())?;
    let turns = statement
        .query_map(
            params![run_id, session_id, turn_intent_id, generation],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    if !turns.iter().any(|turn| turn == turn_intent_id) {
        return Ok(Vec::new());
    }
    for turn in &turns {
        // Reuse admission's canonical root, materialization and persisted
        // GroupRoot user-event checks; a source tag alone is not authority.
        crate::coordination::agent_org_turn_contexts::revalidate_context_with_connection(
            conn, session_id, turn,
        )?;
    }
    Ok(turns)
}

pub(super) fn publication_allows_new_work(
    conn: &Connection,
    run_id: &str,
    session_id: &str,
    generation: i64,
    user_turns: &[String],
) -> Result<bool, String> {
    if user_turns.is_empty() {
        return Ok(false);
    }
    let assessment = AgentOrgRunStore::quiescence_assessment_with_connection(conn, run_id)?;
    Ok(assessment.facts.completion_publication_complete
        && assessment
            .facts
            .completion_certificate
            .as_ref()
            .is_some_and(|certificate| certificate.activation_generation == generation)
        && assessment.blockers.iter().all(|blocker| match blocker {
            AgentOrgQuiescenceBlocker::SessionsActive { session_ids } => {
                session_ids.iter().all(|active| active == session_id)
            }
            AgentOrgQuiescenceBlocker::InFlightTurnIntents { count } => *count == user_turns.len(),
            _ => false,
        }))
}
