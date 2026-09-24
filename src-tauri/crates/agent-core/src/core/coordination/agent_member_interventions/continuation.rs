use super::*;

/// Project the explicit Return receipt into provider input without inventing
/// another user message or replaying the stopped direct conversation.
pub(crate) fn continuation_nudge_for_turn(
    session_id: &str,
    turn_intent_id: &str,
) -> Result<Option<String>, String> {
    let conn = get_connection().map_err(|error| error.to_string())?;
    let returned: Option<(String, String, String)> = conn
        .query_row(
            "SELECT intervention.org_run_id,intervention.member_id,intervention.original_task_id
             FROM agent_org_execution_member_interventions intervention
             JOIN session_turn_intents intent
               ON intent.session_id=intervention.session_id
              AND intent.turn_intent_id=intervention.continuation_turn_intent_id
             WHERE intervention.session_id=?1 AND intervention.continuation_turn_intent_id=?2
               AND intervention.status='cleared' AND intervention.return_outcome='restored_task'
               AND intent.status IN ('queued','running')",
            params![session_id, turn_intent_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some((run_id, member_id, task_id)) = returned else {
        return Ok(None);
    };
    let context = agent_org_turn_contexts::revalidate_context_with_connection(
        &conn,
        session_id,
        turn_intent_id,
    )?;
    if context.org_run_id != run_id
        || context.participant_id != member_id
        || context.task_id.as_deref() != Some(task_id.as_str())
    {
        return Err("Return receipt does not match its formal execution context".to_string());
    }
    let task_id = serde_json::to_string(&task_id).map_err(|error| error.to_string())?;
    Ok(Some(format!(
        "<system-reminder>The user explicitly selected Return to Work. The direct conversation has ended; its latest request is history, not a request to repeat or continue it. Resume your existing formal Agent Org task with task_id={task_id}. First use task_get with this exact task_id to read its current requirements and progress, then continue that task. Do not create a replacement task or restart terminal work.</system-reminder>"
    )))
}
