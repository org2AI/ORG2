//! Exact receipt authority at the execution and terminal boundaries.

use rusqlite::{params, Connection};

pub(crate) fn claimed_continuation_in_tx(
    conn: &Connection,
    session_id: &str,
    turn_intent_id: &str,
) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM agent_org_runtime_pause_handoffs handoff
            JOIN agent_org_runtime_pause_episodes episode USING(episode_id)
            JOIN agent_org_runtime_runs run ON run.id=handoff.org_run_id
            JOIN agent_org_runtime_turn_contexts context
              ON context.session_id=handoff.session_id
             AND context.turn_intent_id=handoff.continuation_turn_intent_id
            JOIN session_turn_intents intent
              ON intent.session_id=context.session_id AND intent.turn_intent_id=context.turn_intent_id
            WHERE handoff.session_id=?1 AND handoff.continuation_turn_intent_id=?2
              AND handoff.continuation_status='dispatched'
              AND handoff.drain_status IN ('released','runtime_absent')
              AND episode.status='consumed' AND run.status='running'
              AND run.activation_generation=episode.resume_generation
              AND context.activation_generation=episode.resume_generation
              AND context.org_run_id=handoff.org_run_id AND context.turn_kind=handoff.turn_kind
              AND context.participant_id=handoff.participant_id
              AND context.task_id IS handoff.task_id
              AND intent.status IN ('queued','running')
        )",
        params![session_id, turn_intent_id],
        |row| row.get(0),
    ).map_err(|error| error.to_string())
}

/// A generation fence suppresses old Task/member side effects, but an exact
/// released runtime still owns its immutable execution outcome. Never grant
/// this exception to an unbound, draining, or already-terminal execution.
pub(crate) fn released_execution_in_tx(
    conn: &Connection,
    session_id: &str,
    turn_intent_id: &str,
) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM agent_org_runtime_turn_contexts context
            JOIN session_turn_intents intent
              ON intent.session_id=context.session_id AND intent.turn_intent_id=context.turn_intent_id
            JOIN agent_org_runtime_pause_episodes episode
              ON episode.org_run_id=context.org_run_id
             AND episode.pause_generation=context.activation_generation+1
            JOIN agent_org_runtime_pause_handoffs handoff
              ON handoff.episode_id=episode.episode_id AND handoff.session_id=context.session_id
             AND handoff.original_turn_intent_id=context.turn_intent_id
            WHERE context.session_id=?1 AND context.turn_intent_id=?2
              AND handoff.drain_status='released'
              AND handoff.runtime_lease_id IS NOT NULL AND handoff.dialog_turn_generation IS NOT NULL
              AND handoff.original_activation_generation=context.activation_generation
              AND context.org_run_id=handoff.org_run_id AND context.turn_kind=handoff.turn_kind
              AND handoff.participant_id=context.participant_id
              AND handoff.task_id IS context.task_id
              AND intent.status='running'
        )",
        params![session_id, turn_intent_id],
        |row| row.get(0),
    ).map_err(|error| error.to_string())
}
