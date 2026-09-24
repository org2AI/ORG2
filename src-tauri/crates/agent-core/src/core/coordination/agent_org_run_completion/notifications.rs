//! One completion-owned decision for exact redundant inbox facts.
use super::*;
use crate::coordination::agent_inbox::{AgentMessage, MemberIdleReason, SYSTEM_SENDER_ID};
use serde_json::{json, Value};

#[derive(Debug)]
pub(super) enum NotificationDecision {
    NeedsModel,
    WaitingForExecution,
    Reconciliable(Value),
    Invalid,
}

pub(super) struct NotificationAssessment {
    pub reconciliable: Vec<(i64, Value)>,
    pub needs_model: bool,
    pub waiting_for_execution: bool,
    pub reconciliable_blocking_count: usize,
    pub needs_model_ids: Vec<i64>,
    pub invalid_ids: Vec<i64>,
}

pub(super) fn assess_notifications(
    conn: &Connection,
    run_id: &str,
    episode_id: &str,
    candidate: &RunCompletionCandidate<'_>,
) -> Result<NotificationAssessment, String> {
    let mut statement = conn.prepare(
        "SELECT inbox.id,CASE WHEN length(CAST(inbox.payload_json AS BLOB))<=?2 THEN inbox.payload_json ELSE 'null' END,inbox.sender_agent_id,inbox.payload_kind,
                receipt.source_kind,COALESCE(inbox.source_turn_intent_id,receipt.source_turn_intent_id),receipt.task_output_digest,
                COALESCE(receipt.status IN ('pending','materialized'),0)
         FROM agent_org_execution_inbox inbox
         LEFT JOIN agent_org_execution_formal_trigger_receipts receipt ON receipt.inbox_id=inbox.id
         WHERE inbox.org_run_id=?1 AND inbox.recipient_member_id='coordinator' AND inbox.read_at IS NULL
           AND NOT EXISTS(SELECT 1 FROM agent_org_execution_inbox_delivery_resolutions resolution WHERE resolution.inbox_id=inbox.id)
         ORDER BY inbox.id").map_err(|e| e.to_string())?;
    // Stream only this run's unresolved input, one bounded payload at a time.
    // A row-count cutoff must not manufacture model work or hide a later
    // substantive message in a dense batch of redundant notifications.
    let rows = statement
        .query_map(
            params![
                run_id,
                crate::coordination::agent_org_payload_limits::AGENT_INBOX_PAYLOAD_MAX_BYTES
            ],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, Option<String>>(6)?,
                    r.get::<_, bool>(7)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;
    let mut assessment = NotificationAssessment {
        reconciliable: Vec::new(),
        needs_model: false,
        waiting_for_execution: false,
        reconciliable_blocking_count: 0,
        needs_model_ids: Vec::new(),
        invalid_ids: Vec::new(),
    };
    for row in rows {
        let (id, payload, sender, kind, source_kind, source_turn, output_digest, blocking) =
            row.map_err(|e| e.to_string())?;
        if candidate.projected_inbox_ids.contains(&id) {
            let exact: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM agent_org_execution_inbox_materializations materialization
                     LEFT JOIN agent_org_execution_formal_trigger_receipts receipt ON receipt.inbox_id=materialization.inbox_id
                     LEFT JOIN agent_org_execution_formal_trigger_attempts attempt ON attempt.receipt_id=receipt.receipt_id AND attempt.attempt=receipt.current_attempt
                     WHERE materialization.inbox_id=?1 AND materialization.session_id=?2
                       AND (receipt.receipt_id IS NULL OR (attempt.session_id=?2 AND attempt.turn_intent_id=?3 AND attempt.status IN ('running','queued'))))",
                    params![
                        id,
                        candidate.coordinator_session_id,
                        candidate.coordinator_turn_intent_id
                    ],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            if exact {
                continue;
            }
        }
        let message = serde_json::from_str::<AgentMessage>(&payload);
        let decision = match message {
            Ok(message) if message.validate().is_ok() && message.kind_tag() == kind => {
                if sender != SYSTEM_SENDER_ID {
                    NotificationDecision::NeedsModel
                } else {
                    classify(
                        conn,
                        run_id,
                        episode_id,
                        candidate,
                        &message,
                        NotificationSource {
                            kind: source_kind.as_deref(),
                            turn: source_turn.as_deref(),
                            output_digest: output_digest.as_deref(),
                        },
                    )?
                }
            }
            _ => NotificationDecision::Invalid,
        };
        match decision {
            NotificationDecision::Reconciliable(evidence) => {
                assessment.reconciliable_blocking_count += usize::from(blocking);
                assessment.reconciliable.push((id, evidence));
            }
            NotificationDecision::WaitingForExecution => assessment.waiting_for_execution = true,
            NotificationDecision::NeedsModel => {
                assessment.needs_model = true;
                assessment.needs_model_ids.push(id);
            }
            NotificationDecision::Invalid => {
                assessment.needs_model = true;
                assessment.invalid_ids.push(id);
            }
        }
    }
    Ok(assessment)
}

pub(super) fn request_input_in_tx(
    conn: &Connection,
    run_id: &str,
    assessment: &NotificationAssessment,
) -> Result<(), String> {
    for inbox_id in &assessment.needs_model_ids {
        let exists:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM agent_org_execution_formal_trigger_receipts WHERE inbox_id=?1)",
            [inbox_id],|r|r.get(0)).map_err(|e|e.to_string())?;
        if exists {
            continue;
        }
        crate::coordination::agent_org_formal_triggers::record_inbox_trigger_in_tx(
            conn,
            run_id,
            *inbox_id,
            crate::coordination::agent_org_formal_triggers::InboxFormalTriggerSource {
                source_kind: "completion_input",
                task_id: None,
                owner_member_id: None,
                source_turn_intent_id: None,
                task_output_digest: None,
                plan_revision_id: None,
                suppress_self_wake: false,
            },
        )?;
    }
    Ok(())
}

struct NotificationSource<'a> {
    kind: Option<&'a str>,
    turn: Option<&'a str>,
    output_digest: Option<&'a str>,
}

fn classify(
    conn: &Connection,
    run_id: &str,
    episode_id: &str,
    candidate: &RunCompletionCandidate<'_>,
    message: &AgentMessage,
    source: NotificationSource<'_>,
) -> Result<NotificationDecision, String> {
    let NotificationSource {
        kind: source_kind,
        turn: source_turn,
        output_digest,
    } = source;
    let evidence = match message {
        AgentMessage::MemberIdle {
            member_id,
            reason: MemberIdleReason::Available,
            summary,
            failure_reason: None,
            unfinished_task_ids,
            ..
        } if summary.is_none() && unfinished_task_ids.is_empty() => {
            let Some(source_turn) = source_turn else {
                return Ok(NotificationDecision::NeedsModel);
            };
            // Exact producer Turn, completed task in this episode, and no newer
            // work for that member. An old idle can never settle a new execution.
            let status: Option<String> = conn.query_row(
                "SELECT intent.status FROM agent_org_execution_turn_contexts context
                 JOIN session_turn_intents intent USING(session_id,turn_intent_id)
                 JOIN agent_org_execution_runs run ON run.id=context.org_run_id
                 JOIN agent_org_execution_tasks task ON task.org_run_id=context.org_run_id AND task.id=context.task_id
                 JOIN agent_org_execution_work_episode_tasks episode_task ON episode_task.org_run_id=task.org_run_id AND episode_task.task_id=task.id
                 WHERE context.org_run_id=?1 AND context.turn_intent_id=?2 AND context.participant_id=?3
                   AND context.turn_kind='task_execution'
                   AND task.status='completed' AND episode_task.work_episode_id=?4
                   AND NOT EXISTS(SELECT 1 FROM agent_org_execution_turn_contexts newer
                     JOIN session_turn_intents next USING(session_id,turn_intent_id)
                     WHERE newer.org_run_id=context.org_run_id AND newer.participant_id=context.participant_id
                       AND newer.context_id>context.context_id
                       AND next.status IN ('optimistic','queued','running'))",
                params![run_id,source_turn,member_id,episode_id],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
            if status.as_deref() == Some("running") {
                return Ok(NotificationDecision::WaitingForExecution);
            }
            if status.as_deref() != Some("completed") {
                return Ok(NotificationDecision::NeedsModel);
            }
            json!({"reason":"exact_completed_member_turn","sourceTurnIntentId":source_turn,"memberId":member_id})
        }
        AgentMessage::TaskCompleted {
            task_id,
            output_summary,
            plan_revision_id,
            ..
        } => {
            let Some(digest) = output_digest else {
                return Ok(NotificationDecision::NeedsModel);
            };
            let raw: Option<String> = conn.query_row(
                "SELECT output_json FROM agent_org_execution_tasks WHERE org_run_id=?1 AND id=?2 AND status='completed'",
                params![run_id,task_id],|r|r.get(0)).optional().map_err(|e|e.to_string())?.flatten();
            let Some(raw) = raw else {
                return Ok(NotificationDecision::Invalid);
            };
            let output: super::super::agent_org_tasks::TaskOutput =
                serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            if super::super::agent_org_tasks::task_output_digest(&output)? != digest
                || output_summary
                    .as_deref()
                    .is_some_and(|s| s != output.summary)
                || plan_revision_id != &output.plan_revision_id
            {
                return Ok(NotificationDecision::NeedsModel);
            }
            let Some(presentation) = super::presentation::presented_output_evidence(
                conn,
                run_id,
                episode_id,
                task_id,
                digest,
                candidate.coordinator_turn_intent_id,
            )?
            else {
                return Ok(NotificationDecision::NeedsModel);
            };
            json!({"reason":"same_presented_output","taskId":task_id,"outputDigest":digest,"presentation":presentation})
        }
        AgentMessage::Plain { .. }
            if source_kind == Some("coordinator_completion_recheck")
                && source_turn == Some(candidate.coordinator_turn_intent_id) =>
        {
            json!({"reason":"authorized_completion_recheck","sourceTurnIntentId":source_turn})
        }
        _ => return Ok(NotificationDecision::NeedsModel),
    };
    Ok(NotificationDecision::Reconciliable(evidence))
}

pub(super) fn reconcile_in_tx(
    conn: &Connection,
    run_id: &str,
    episode_id: &str,
    candidate: &RunCompletionCandidate<'_>,
    assessment: &NotificationAssessment,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    for (inbox_id, evidence) in &assessment.reconciliable {
        let reason=json!({"workEpisodeId":episode_id,"requestId":candidate.request_id,
            "coordinatorSessionId":candidate.coordinator_session_id,"coordinatorTurnIntentId":candidate.coordinator_turn_intent_id,
            "evidence":evidence}).to_string();
        conn.execute(
            "INSERT INTO agent_org_execution_inbox_delivery_resolutions
            (inbox_id,org_run_id,resolution_kind,resolved_by_member_id,reason,created_at)
            SELECT id,org_run_id,'system_reconciled','system:completion',?3,?4
            FROM agent_org_execution_inbox WHERE id=?1 AND org_run_id=?2 AND read_at IS NULL
            ON CONFLICT(inbox_id) DO NOTHING",
            params![inbox_id, run_id, reason, now],
        )
        .map_err(|e| e.to_string())?;
        conn.execute("UPDATE agent_org_execution_formal_trigger_attempts SET status='resolved',terminal_at=?2,updated_at=?2
            WHERE receipt_id IN(SELECT receipt_id FROM agent_org_execution_formal_trigger_receipts WHERE inbox_id=?1)
              AND status IN ('queued','running')",params![inbox_id,now]).map_err(|e|e.to_string())?;
        conn.execute("UPDATE agent_org_execution_formal_trigger_receipts SET status='resolved',doorbell_status='suppressed',resolved_at=?2,updated_at=?2
            WHERE inbox_id=?1 AND status<>'resolved'",params![inbox_id,now]).map_err(|e|e.to_string())?;
        conn.execute(
            "DELETE FROM agent_org_execution_inbox_materializations WHERE inbox_id=?1",
            [inbox_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate<'a>() -> RunCompletionCandidate<'a> {
        RunCompletionCandidate {
            request_id: "request",
            request_digest: "digest",
            outcome: RunCompletionOutcome::Delivered,
            summary: "done",
            evidence_task_ids: &[],
            coordinator_session_id: "root-session",
            coordinator_turn_intent_id: "coordinator-turn",
            projected_inbox_ids: &[],
        }
    }

    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database");
        conn.execute_batch(
            "CREATE TABLE agent_org_execution_runs(
                 id TEXT PRIMARY KEY,activation_generation INTEGER NOT NULL
             );
             CREATE TABLE session_turn_intents(
                 session_id TEXT NOT NULL,turn_intent_id TEXT NOT NULL,status TEXT NOT NULL,
                 PRIMARY KEY(session_id,turn_intent_id)
             );
             CREATE TABLE agent_org_execution_turn_contexts(
                 context_id INTEGER PRIMARY KEY AUTOINCREMENT,
                 session_id TEXT NOT NULL,turn_intent_id TEXT NOT NULL,
                 org_run_id TEXT NOT NULL,participant_id TEXT NOT NULL,
                 turn_kind TEXT NOT NULL,task_id TEXT,activation_generation INTEGER
             );
             CREATE TABLE agent_org_execution_tasks(
                 org_run_id TEXT NOT NULL,id TEXT NOT NULL,status TEXT NOT NULL,
                 activation_generation INTEGER NOT NULL,PRIMARY KEY(org_run_id,id)
             );
             CREATE TABLE agent_org_execution_work_episode_tasks(
                 org_run_id TEXT NOT NULL,work_episode_id TEXT NOT NULL,task_id TEXT NOT NULL
             );
             INSERT INTO agent_org_execution_runs VALUES('run',4);
             INSERT INTO session_turn_intents VALUES(
                 'member-session','turn-before-pause','completed'
             );
             INSERT INTO agent_org_execution_turn_contexts(
                 session_id,turn_intent_id,org_run_id,participant_id,turn_kind,
                 task_id,activation_generation
             ) VALUES(
                 'member-session','turn-before-pause','run','member','task_execution',
                 'task',2
             );
             INSERT INTO agent_org_execution_tasks VALUES('run','task','completed',2);
             INSERT INTO agent_org_execution_work_episode_tasks VALUES(
                 'run','episode','task'
             );",
        )
        .expect("notification fixture");
        conn
    }

    #[test]
    fn completed_member_idle_from_before_resume_is_reconciliable() {
        let conn = fixture();
        let message = AgentMessage::MemberIdle {
            member_id: "member".to_string(),
            member_name: "Worker".to_string(),
            reason: MemberIdleReason::Available,
            current_mode: None,
            summary: None,
            failure_reason: None,
            unfinished_task_ids: Vec::new(),
        };

        let decision = classify(
            &conn,
            "run",
            "episode",
            &candidate(),
            &message,
            NotificationSource {
                kind: Some("formal_lifecycle"),
                turn: Some("turn-before-pause"),
                output_digest: None,
            },
        )
        .expect("classify old-generation idle");

        assert!(matches!(decision, NotificationDecision::Reconciliable(_)));
    }

    #[test]
    fn completed_member_idle_does_not_hide_newer_active_work() {
        let conn = fixture();
        conn.execute_batch(
            "INSERT INTO session_turn_intents VALUES(
                 'member-session','turn-after-resume','running'
             );
             INSERT INTO agent_org_execution_turn_contexts(
                 session_id,turn_intent_id,org_run_id,participant_id,turn_kind,
                 task_id,activation_generation
             ) VALUES(
                 'member-session','turn-after-resume','run','member','task_execution',
                 'task',4
             );",
        )
        .expect("newer execution");
        let message = AgentMessage::MemberIdle {
            member_id: "member".to_string(),
            member_name: "Worker".to_string(),
            reason: MemberIdleReason::Available,
            current_mode: None,
            summary: None,
            failure_reason: None,
            unfinished_task_ids: Vec::new(),
        };

        let decision = classify(
            &conn,
            "run",
            "episode",
            &candidate(),
            &message,
            NotificationSource {
                kind: Some("formal_lifecycle"),
                turn: Some("turn-before-pause"),
                output_digest: None,
            },
        )
        .expect("classify idle with newer work");

        assert!(matches!(decision, NotificationDecision::NeedsModel));
    }
}
