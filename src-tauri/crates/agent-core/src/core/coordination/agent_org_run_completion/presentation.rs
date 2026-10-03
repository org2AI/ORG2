//! Evidence from the actual provider request, after tool-output truncation.
use super::*;
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct PresentedOutput {
    pub task_id: String,
    pub output_digest: String,
    pub tool_call_id: String,
    pub presentation_digest: String,
}

/// Copy only bounded actual task_get input records across the blocking boundary.
/// No prompt, user history or unrelated tool output is retained.
pub(crate) fn presentation_input(messages: &[Value]) -> Vec<Value> {
    let calls = messages
        .iter()
        .filter(|m| m["role"] == "assistant")
        .filter_map(|m| m["tool_calls"].as_array())
        .flatten()
        .filter(|call| call["function"]["name"] == crate::tools::names::TASK_GET)
        .filter_map(|call| Some((call["id"].as_str()?, call)))
        .collect::<HashMap<_, _>>();
    let mut selected = Vec::new();
    for message in messages.iter().rev().filter(|m| m["role"] == "tool") {
        let Some(call) = message["tool_call_id"]
            .as_str()
            .and_then(|id| calls.get(id))
        else {
            continue;
        };
        selected.push(serde_json::json!({"role":"assistant","tool_calls":[call]}));
        selected.push(message.clone());
        if selected.len() == 64 {
            break;
        }
    }
    selected
}

pub(crate) fn record_provider_presentation(
    session_id: &str,
    turn_intent_id: &str,
    messages: &[Value],
) -> Result<(), String> {
    // Match a real task_get result to its assistant tool call. Arbitrary JSON
    // in user text, list summaries, and truncated JSON are not evidence.
    let calls = messages
        .iter()
        .filter(|m| m["role"] == "assistant")
        .filter_map(|m| m["tool_calls"].as_array())
        .flatten()
        .filter(|call| call["function"]["name"] == crate::tools::names::TASK_GET)
        .filter_map(|call| call["id"].as_str())
        .collect::<HashSet<_>>();
    let outputs = messages
        .iter()
        .rev()
        .filter(|m| m["role"] == "tool")
        .filter_map(|m| Some((m["tool_call_id"].as_str()?, m["content"].as_str()?)))
        .filter(|(id, _)| calls.contains(id))
        .filter_map(|(id, text)| {
            let body: Value = serde_json::from_str(text).ok()?;
            let task_id = body["task"]["id"].as_str()?.to_owned();
            let output: super::super::agent_org_tasks::TaskOutput =
                serde_json::from_value(body["task"]["output"].clone()).ok()?;
            Some((id.to_owned(), task_id, output))
        })
        .take(32)
        .collect::<Vec<_>>();
    if outputs.is_empty() {
        return Ok(());
    }
    let presentation_digest = format!(
        "{:x}",
        sha2::Sha256::digest(serde_json::to_vec(messages).map_err(|e| e.to_string())?)
    );
    database::db::with_sessions_writer(|| {
        let conn = database::db::get_connection().map_err(|e| e.to_string())?;
        let tx = database::db::begin_immediate(&conn).map_err(|e| e.to_string())?;
        let context =
            crate::coordination::agent_org_turn_contexts::require_context_with_connection(
                &tx,
                session_id,
                turn_intent_id,
            )?;
        if context.participant_id != COORDINATOR_MEMBER_ID
            || !context.source_kind.is_coordinator_root()
        {
            return Ok(());
        }
        let current: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM session_turn_intents intent
             JOIN agent_org_runtime_runs run ON run.id=?3
             WHERE intent.session_id=?1 AND intent.turn_intent_id=?2 AND intent.status='running'
               AND run.activation_generation=?4 AND run.status='running')",
                params![
                    session_id,
                    turn_intent_id,
                    context.org_run_id,
                    context.activation_generation
                ],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !current {
            return Ok(());
        }
        let raw: String = tx.query_row(
            "SELECT coordinator_presented_outputs_json FROM agent_org_runtime_turn_contexts WHERE context_id=?1",
            [context.context_id], |row| row.get(0)).map_err(|e| e.to_string())?;
        let mut presented: Vec<PresentedOutput> =
            serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        let previous_count = presented.len();
        for (call_id, task_id, output) in outputs {
            let output_digest = super::super::agent_org_tasks::task_output_digest(&output)?;
            if presented
                .iter()
                .any(|p| p.task_id == task_id && p.output_digest == output_digest)
            {
                continue;
            }
            let stored: Option<String> = tx.query_row(
                "SELECT output_json FROM agent_org_runtime_tasks WHERE org_run_id=?1 AND id=?2 AND status='completed'",
                params![context.org_run_id,task_id], |row| row.get(0)).optional().map_err(|e| e.to_string())?.flatten();
            let stored = stored
                .map(|raw| serde_json::from_str::<super::super::agent_org_tasks::TaskOutput>(&raw))
                .transpose()
                .map_err(|e| e.to_string())?;
            if stored.as_ref() != Some(&output) {
                continue;
            }
            presented.push(PresentedOutput {
                task_id,
                output_digest,
                tool_call_id: call_id,
                presentation_digest: presentation_digest.clone(),
            });
        }
        if presented.len() == previous_count {
            return Ok(());
        }
        if presented.len() > 128 {
            presented.drain(..presented.len() - 128);
        }
        tx.execute("UPDATE agent_org_runtime_turn_contexts SET coordinator_presented_outputs_json=?2 WHERE context_id=?1",
            params![context.context_id,serde_json::to_string(&presented).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    })
}

/// A past successful Turn or the candidate's exact currently running Turn can
/// supply presentation evidence. Pending evidence never survives cancellation.
pub(super) fn presented_output_evidence(
    conn: &Connection,
    run_id: &str,
    episode_id: &str,
    task_id: &str,
    digest: &str,
    candidate_turn: &str,
) -> Result<Option<Value>, String> {
    conn.query_row(
        "SELECT context.session_id,context.turn_intent_id,output.value FROM agent_org_runtime_turn_contexts context
         JOIN session_turn_intents intent USING(session_id,turn_intent_id)
         JOIN agent_org_runtime_runs run ON run.id=context.org_run_id
         JOIN agent_org_runtime_work_episode_tasks episode_task ON episode_task.org_run_id=context.org_run_id AND episode_task.task_id=?3
         JOIN json_each(context.coordinator_presented_outputs_json) output
         WHERE context.org_run_id=?1 AND episode_task.work_episode_id=?2
           AND context.activation_generation=run.activation_generation
           AND (intent.status='completed' OR (intent.status='running' AND context.turn_intent_id=?5))
           AND json_extract(output.value,'$.task_id')=?3 AND json_extract(output.value,'$.output_digest')=?4
         ORDER BY context.context_id DESC LIMIT 1",
        params![run_id,episode_id,task_id,digest,candidate_turn], |row| Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?)))
        .optional().map_err(|e| e.to_string())?
        .map(|(session,intent,raw)|{
            let evidence:Value=serde_json::from_str(&raw).map_err(|e|e.to_string())?;
            Ok(serde_json::json!({"sessionId":session,"turnIntentId":intent,"output":evidence}))
        }).transpose()
}
