//! Durable, explicitly authorized completion candidates; advanced by events.
use super::notifications::{assess_notifications, reconcile_in_tx, request_input_in_tx};
use super::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PendingCompletion {
    episode_id: String,
    generation: i64,
    work_revision: i64,
    request_id: String,
    request_digest: String,
    outcome: RunCompletionOutcome,
    summary: String,
    evidence_task_ids: Vec<String>,
    session_id: String,
    turn_intent_id: String,
    projected_inbox_ids: Vec<i64>,
    output_refs: Vec<RunCompletionTaskOutputRef>,
    waiting_turns: Vec<(String, String)>,
}

impl PendingCompletion {
    fn candidate(&self) -> RunCompletionCandidate<'_> {
        RunCompletionCandidate {
            request_id: &self.request_id,
            request_digest: &self.request_digest,
            outcome: self.outcome,
            summary: &self.summary,
            evidence_task_ids: &self.evidence_task_ids,
            coordinator_session_id: &self.session_id,
            coordinator_turn_intent_id: &self.turn_intent_id,
            projected_inbox_ids: &self.projected_inbox_ids,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub(crate) enum CompletionSubmission {
    Waiting {
        guidance: String,
    },
    RequiresInput {
        guidance: String,
    },
    Blocked {
        reason_code: String,
        blockers: serde_json::Value,
        end_turn: bool,
        facts_fingerprint: String,
    },
}

impl CompletionSubmission {
    pub(crate) fn ends_turn(&self) -> bool {
        !matches!(
            self,
            Self::Blocked {
                end_turn: false,
                ..
            }
        )
    }
}

fn blocked(
    conn: &Connection,
    run_id: &str,
    candidate: &RunCompletionCandidate<'_>,
    reason: String,
) -> Result<CompletionSubmission, String> {
    let quiescence = AgentOrgRunStore::quiescence_assessment_with_connection(conn, run_id)?;
    let assessment = assess_delivered_candidate_from_quiescence_with_connection(
        conn,
        run_id,
        candidate.coordinator_session_id,
        candidate.coordinator_turn_intent_id,
        candidate.projected_inbox_ids,
        &quiescence,
    );
    let mut blockers =
        crate::coordination::agent_org_run_blockers::build_from_candidate_with_connection(
            conn,
            run_id,
            &assessment,
        )?;
    crate::coordination::agent_org_run_blockers::append_completion_failure(&mut blockers, &reason);
    let blockers = serde_json::to_value(blockers).map_err(|e| e.to_string())?;
    // Ignore summary/tool-call wording: only changed facts allow another
    // correction attempt in this Turn. Repeated blockers yield execution.
    let facts = serde_json::json!([
        reason,
        blockers,
        quiescence.facts.progress.as_ref().map(|p| p.work_revision)
    ]);
    let fingerprint = format!(
        "completion_blocked:{:x}",
        sha2::Sha256::digest(facts.to_string())
    );
    let repeated:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM agent_org_execution_tool_call_receipts
        WHERE org_run_id=?1 AND session_id=?2 AND turn_intent_id=?3 AND tool_name='org_run_complete'
          AND CASE WHEN json_valid(result_text) THEN json_extract(result_text,'$.facts_fingerprint')=?4 ELSE 0 END)",
        params![run_id,candidate.coordinator_session_id,candidate.coordinator_turn_intent_id,fingerprint],|r|r.get(0)).map_err(|e|e.to_string())?;
    Ok(CompletionSubmission::Blocked {
        reason_code: reason,
        blockers,
        end_turn: repeated,
        facts_fingerprint: fingerprint,
    })
}

fn clear(conn: &Connection, run_id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE agent_org_execution_run_progress SET completion_candidate_json=NULL,
        completion_requested=0,completion_requested_at=NULL,completion_requested_work_revision=NULL,
        completion_summary=NULL WHERE org_run_id=?1 AND completion_candidate_json IS NOT NULL",
        [run_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn submit_in_tx(
    conn: &Connection,
    run_id: &str,
    candidate: RunCompletionCandidate<'_>,
) -> Result<CompletionSubmission, String> {
    if let Err(error) = validate_candidate_shape(&candidate) {
        return blocked(conn, run_id, &candidate, error);
    }
    let context = crate::coordination::agent_org_turn_contexts::revalidate_context_with_connection(
        conn,
        candidate.coordinator_session_id,
        candidate.coordinator_turn_intent_id,
    )?;
    let revision = crate::coordination::agent_org_runs::current_work_revision_in_tx(conn, run_id)?;
    let episode =
        crate::coordination::agent_org_work_episodes::active_with_connection(conn, run_id)?
            .ok_or("run_completion_no_active_work_episode")?;
    if context.org_run_id != run_id
        || context.participant_id != COORDINATOR_MEMBER_ID
        || !context.source_kind.is_coordinator_root()
        || context.coordinator_work_revision != Some(revision)
    {
        return Ok(CompletionSubmission::RequiresInput {
            guidance: "New work arrived. End this Turn and read the next committed Team input."
                .into(),
        });
    }
    let ids = crate::coordination::agent_org_work_episodes::task_ids_with_connection(
        conn,
        run_id,
        &episode.id,
    )?;
    let tasks = AgentOrgTaskStore::list_for_episode_with_connection(conn, run_id, &episode.id)?;
    let assessment = AgentOrgRunStore::quiescence_assessment_with_connection(conn, run_id)?;
    if tasks.iter().any(|task| task.status.is_open()) {
        return Ok(CompletionSubmission::Waiting { guidance:"Formal tasks are still open. End this Turn and wait for their committed results before proposing completion.".into() });
    }
    let proof = match validate_outcome_closure(
        conn,
        run_id,
        candidate.outcome,
        &tasks,
        assessment.facts.unresolved_handoff_count as i64,
    ) {
        Ok(proof) => proof,
        Err(error) => return blocked(conn, run_id, &candidate, error),
    };
    if tasks.is_empty()
        || candidate
            .evidence_task_ids
            .iter()
            .any(|id| !ids.contains(id))
    {
        return blocked(
            conn,
            run_id,
            &candidate,
            "run_completion_invalid_evidence_tasks".into(),
        );
    }
    let notices = assess_notifications(conn, run_id, &episode.id, &candidate)?;
    if !notices.invalid_ids.is_empty() {
        clear(conn, run_id)?;
        return blocked(
            conn,
            run_id,
            &candidate,
            format!("run_completion_invalid_inbox:{:?}", notices.invalid_ids),
        );
    }
    if notices.needs_model {
        clear(conn, run_id)?;
        request_input_in_tx(conn, run_id, &notices)?;
        return Ok(CompletionSubmission::RequiresInput { guidance:"New results or messages require review. End this Turn; the pending input will be delivered once.".into() });
    }
    let mut statement=conn.prepare("SELECT context.session_id,context.turn_intent_id FROM agent_org_execution_turn_contexts context
        JOIN session_turn_intents intent USING(session_id,turn_intent_id)
        WHERE context.org_run_id=?1 AND context.turn_kind='task_execution' AND intent.status IN ('optimistic','queued','running')").map_err(|e|e.to_string())?;
    let waiting_turns = statement
        .query_map([run_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let pending = PendingCompletion {
        episode_id: episode.id,
        generation: context
            .activation_generation
            .ok_or("completion_generation_missing")?,
        work_revision: revision,
        request_id: candidate.request_id.into(),
        request_digest: candidate.request_digest.into(),
        outcome: candidate.outcome,
        summary: candidate.summary.into(),
        evidence_task_ids: candidate.evidence_task_ids.to_vec(),
        session_id: candidate.coordinator_session_id.into(),
        turn_intent_id: candidate.coordinator_turn_intent_id.into(),
        projected_inbox_ids: candidate.projected_inbox_ids.to_vec(),
        output_refs: proof.task_output_refs,
        waiting_turns,
    };
    // Keep the first authorization for this Turn/version, even if tool-call ID
    // or summary wording changes. A new fact invalidates it through its owner.
    let existing = load(conn, run_id)?;
    if !existing
        .as_ref()
        .is_some_and(|p| p.turn_intent_id == pending.turn_intent_id && p.work_revision == revision)
    {
        conn.execute(
            "UPDATE agent_org_execution_run_progress SET completion_candidate_json=?2,
            completion_requested=1,completion_requested_at=?3,completion_requested_work_revision=?4,
            completion_summary=?5,updated_at=?3 WHERE org_run_id=?1",
            params![
                run_id,
                serde_json::to_string(&pending).map_err(|e| e.to_string())?,
                chrono::Utc::now().to_rfc3339(),
                revision,
                pending.summary
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    conn.execute(
        "UPDATE agent_org_execution_turn_contexts SET terminal_reason='waiting_for_org_event'
        WHERE session_id=?1 AND turn_intent_id=?2",
        params![pending.session_id, pending.turn_intent_id],
    )
    .map_err(|e| e.to_string())?;
    // Registration and the immediate re-read share this transaction. There is
    // no gap in which a member end can be missed while waiting is installed.
    recheck_pending_in_tx(conn, run_id)?;
    Ok(CompletionSubmission::Waiting { guidance:"Completion candidate saved. End this Turn now. After this Turn succeeds, committed member-end events will finish validation; do not poll or resubmit.".into() })
}

fn load(conn: &Connection, run_id: &str) -> Result<Option<PendingCompletion>, String> {
    let raw:Option<String>=conn.query_row("SELECT completion_candidate_json FROM agent_org_execution_run_progress WHERE org_run_id=?1",
        [run_id],|r|r.get(0)).optional().map_err(|e|e.to_string())?.flatten();
    raw.map(|raw| serde_json::from_str(&raw).map_err(|e| e.to_string()))
        .transpose()
}

/// True means an unchanged authorized candidate is waiting; callers must not
/// start another model Turn merely to consume its redundant notifications.
pub(crate) fn recheck_pending_in_tx(conn: &Connection, run_id: &str) -> Result<bool, String> {
    let Some(pending) = load(conn, run_id)? else {
        reconcile_certified_notifications(conn, run_id)?;
        return Ok(false);
    };
    let valid: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM agent_org_execution_runs run
        JOIN agent_org_execution_run_progress progress ON progress.org_run_id=run.id
        JOIN agent_org_execution_work_episodes episode ON episode.org_run_id=run.id
        WHERE run.id=?1 AND run.status='running' AND run.activation_generation=?2
          AND progress.work_revision=?3 AND episode.id=?4 AND episode.status='active')",
            params![
                run_id,
                pending.generation,
                pending.work_revision,
                pending.episode_id
            ],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let status: Option<String> = conn
        .query_row(
            "SELECT status FROM session_turn_intents WHERE session_id=?1 AND turn_intent_id=?2",
            params![pending.session_id, pending.turn_intent_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if !valid || !matches!(status.as_deref(), Some("running" | "completed")) {
        clear(conn, run_id)?;
        return Ok(false);
    }
    let newer_root:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM agent_org_execution_turn_contexts newer
        JOIN agent_org_execution_turn_contexts original ON original.session_id=?2 AND original.turn_intent_id=?3
        JOIN session_turn_intents intent ON intent.session_id=newer.session_id AND intent.turn_intent_id=newer.turn_intent_id
        WHERE newer.org_run_id=?1 AND newer.source_kind IN ('root_turn','group_root')
          AND newer.context_id>original.context_id AND intent.source<>'resume' AND intent.status NOT IN ('cancelled','rejected','stale','coalesced'))",
        params![run_id,pending.session_id,pending.turn_intent_id],|r|r.get(0)).map_err(|e|e.to_string())?;
    if newer_root {
        clear(conn, run_id)?;
        return Ok(false);
    }
    for (session, turn) in &pending.waiting_turns {
        let status: Option<String> = conn
            .query_row(
                "SELECT status FROM session_turn_intents WHERE session_id=?1 AND turn_intent_id=?2",
                params![session, turn],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if !matches!(
            status.as_deref(),
            Some("optimistic" | "queued" | "running" | "completed")
        ) {
            clear(conn, run_id)?;
            return Ok(false);
        }
    }
    for expected in &pending.output_refs {
        let raw:Option<String>=conn.query_row("SELECT output_json FROM agent_org_execution_tasks WHERE org_run_id=?1 AND id=?2 AND status='completed'",params![run_id,expected.task_id],|r|r.get(0)).optional().map_err(|e|e.to_string())?.flatten();
        let output = raw
            .map(|raw| serde_json::from_str::<super::super::agent_org_tasks::TaskOutput>(&raw))
            .transpose()
            .map_err(|e| e.to_string())?;
        let current = output
            .as_ref()
            .map(super::super::agent_org_tasks::task_output_digest)
            .transpose()?;
        if current.as_deref() != Some(&expected.output_digest) {
            clear(conn, run_id)?;
            return Ok(false);
        }
    }
    let notices = assess_notifications(conn, run_id, &pending.episode_id, &pending.candidate())?;
    if notices.needs_model {
        clear(conn, run_id)?;
        request_input_in_tx(conn, run_id, &notices)?;
        return Ok(false);
    }
    if status.as_deref() != Some("completed") || notices.waiting_for_execution {
        return Ok(true);
    }
    // Temporary projections are only used to decide whether to wait. Actual
    // dispositions and certification below either commit together or roll back.
    let mut assessment = AgentOrgRunStore::quiescence_assessment_with_connection(conn, run_id)?;
    assessment.facts.blocking_unread_inbox_count = assessment
        .facts
        .blocking_unread_inbox_count
        .saturating_sub(notices.reconciliable_blocking_count);
    if !completion_non_task_blockers(&assessment, Default::default()).is_empty() {
        return Ok(true);
    }
    reconcile_in_tx(
        conn,
        run_id,
        &pending.episode_id,
        &pending.candidate(),
        &notices,
    )?;
    certify_in_tx(conn, run_id, pending.candidate())?;
    conn.execute("UPDATE agent_org_execution_run_progress SET completion_candidate_json=NULL WHERE org_run_id=?1",[run_id]).map_err(|e|e.to_string())?;
    Ok(false)
}

fn current_authority_certificate(
    conn: &Connection,
    run_id: &str,
) -> Result<Option<RunCompletionCertificate>, String> {
    let Some(certificate) = load_current_episode_with_connection(conn, run_id)? else {
        return Ok(None);
    };
    let valid: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM agent_org_execution_runs run
        JOIN agent_org_execution_run_progress progress ON progress.org_run_id=run.id
        JOIN session_turn_intents intent ON intent.session_id=?4 AND intent.turn_intent_id=?5
        WHERE run.id=?1 AND run.status IN ('running','idle') AND run.activation_generation=?2
          AND progress.work_revision=?3 AND intent.status='completed')",
            params![
                run_id,
                certificate.activation_generation,
                certificate.work_revision,
                certificate.coordinator_session_id,
                certificate.coordinator_turn_intent_id
            ],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !valid {
        return Ok(None);
    }
    Ok(Some(certificate))
}

fn reconcile_certified_notifications(conn: &Connection, run_id: &str) -> Result<(), String> {
    let Some(certificate) = current_authority_certificate(conn, run_id)? else {
        return Ok(());
    };
    let episode =
        crate::coordination::agent_org_work_episodes::current_with_connection(conn, run_id)?
            .ok_or("completion_episode_missing")?;
    let candidate = RunCompletionCandidate {
        request_id: &certificate.request_id,
        request_digest: &certificate.request_digest,
        outcome: certificate.outcome,
        summary: &certificate.summary,
        evidence_task_ids: &certificate.evidence_task_ids,
        coordinator_session_id: &certificate.coordinator_session_id,
        coordinator_turn_intent_id: &certificate.coordinator_turn_intent_id,
        projected_inbox_ids: &[],
    };
    let notices = assess_notifications(conn, run_id, &episode.id, &candidate)?;
    // The immutable certificate already supplies committed authority. A late
    // redundant row can be disposed independently of a different new message.
    reconcile_in_tx(conn, run_id, &episode.id, &candidate, &notices)?;
    request_input_in_tx(conn, run_id, &notices)
}

pub(crate) fn completion_handles_wake(run_id: &str) -> Result<bool, String> {
    database::db::with_sessions_writer(|| {
        let conn = database::db::get_connection().map_err(|e| e.to_string())?;
        let tx = database::db::begin_immediate(&conn).map_err(|e| e.to_string())?;
        let waiting = recheck_pending_in_tx(&tx, run_id)?;
        let certified = current_authority_certificate(&tx, run_id)?.is_some();
        let pending:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM agent_org_execution_formal_trigger_receipts WHERE org_run_id=?1 AND status IN ('pending','materialized'))",[run_id],|r|r.get(0)).map_err(|e|e.to_string())?;
        let unread: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM agent_org_execution_inbox inbox
            WHERE inbox.org_run_id=?1 AND inbox.recipient_member_id='coordinator' AND inbox.read_at IS NULL
              AND NOT EXISTS(SELECT 1 FROM agent_org_execution_inbox_delivery_resolutions resolution WHERE resolution.inbox_id=inbox.id))",
            [run_id], |r|r.get(0)).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(waiting || (certified && !pending && !unread))
    })
}

#[cfg(test)]
pub(crate) fn recheck_pending(run_id: &str) -> Result<bool, String> {
    database::db::with_sessions_writer(|| {
        let conn = database::db::get_connection().map_err(|e| e.to_string())?;
        let tx = database::db::begin_immediate(&conn).map_err(|e| e.to_string())?;
        let waiting = recheck_pending_in_tx(&tx, run_id)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(waiting)
    })
}

pub(crate) fn recheck_after_turn(
    session_id: &str,
    turn_intent_id: &str,
) -> Result<(String, Vec<String>), String> {
    database::db::with_sessions_writer(|| {
        let conn = database::db::get_connection().map_err(|e| e.to_string())?;
        let tx = database::db::begin_immediate(&conn).map_err(|e| e.to_string())?;
        let context =
            crate::coordination::agent_org_turn_contexts::require_context_with_connection(
                &tx,
                session_id,
                turn_intent_id,
            )?;
        recheck_pending_in_tx(&tx, &context.org_run_id)?;
        let ids = {
            let mut stmt=tx.prepare("SELECT receipt_id FROM agent_org_execution_formal_trigger_receipts
                WHERE org_run_id=?1 AND status='pending' AND doorbell_status='missing'
                  AND (trigger_kind='final_summary' OR EXISTS(SELECT 1 FROM agent_org_execution_inbox inbox WHERE inbox.id=agent_org_execution_formal_trigger_receipts.inbox_id AND inbox.recipient_member_id='coordinator'))
                ORDER BY created_at,receipt_id LIMIT 100").map_err(|e|e.to_string())?;
            let ids = stmt
                .query_map([&context.org_run_id], |r| r.get(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<String>, _>>()
                .map_err(|e| e.to_string())?;
            ids
        };
        tx.commit().map_err(|e| e.to_string())?;
        Ok((context.org_run_id, ids))
    })
}

/// Startup already reconciled interrupted Turns and paused absent runtimes.
/// Revisit only saved candidates; stale authority must not survive recovery.
pub(crate) fn reconcile_after_restart(conn: &Connection) -> Result<usize, String> {
    let mut stmt=conn.prepare("SELECT org_run_id FROM agent_org_execution_run_progress WHERE completion_candidate_json IS NOT NULL").map_err(|e|e.to_string())?;
    let run_ids = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    for run_id in &run_ids {
        let tx = database::db::begin_immediate(conn).map_err(|e| e.to_string())?;
        recheck_pending_in_tx(&tx, run_id)?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    Ok(run_ids.len())
}

/// A doorbell can already be in the scheduler when the completion owner
/// disposes its input. Only an authorized completion may absorb that Resume.
/// Real new input keeps the original intent and normal delivery opportunity.
pub(crate) fn settle_completion_only_wake(
    session_id: &str,
    turn_intent_id: &str,
) -> Result<bool, String> {
    database::db::with_sessions_writer(|| {
        let conn = database::db::get_connection().map_err(|e| e.to_string())?;
        let tx = database::db::begin_immediate(&conn).map_err(|e| e.to_string())?;
        let identity:Option<(String,String)>=tx.query_row("SELECT context.org_run_id,intent.status
            FROM agent_org_execution_turn_contexts context JOIN session_turn_intents intent USING(session_id,turn_intent_id)
            JOIN agent_org_execution_runs run ON run.id=context.org_run_id
            WHERE context.session_id=?1 AND context.turn_intent_id=?2 AND context.participant_id='coordinator'
              AND context.source_kind='root_turn' AND intent.source='resume' AND intent.status IN ('queued','running')
              AND context.activation_generation=run.activation_generation AND run.status='running'
              AND NOT EXISTS(SELECT 1 FROM agent_org_execution_final_summary_receipts summary
                WHERE summary.coordinator_session_id=?1 AND summary.turn_intent_id=?2)",
            params![session_id,turn_intent_id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(|e|e.to_string())?;
        let Some((run_id, _status)) = identity else {
            return Ok(false);
        };
        let candidate = load(&tx, &run_id)?;
        if candidate
            .as_ref()
            .is_some_and(|p| p.turn_intent_id == turn_intent_id)
        {
            return Ok(false);
        }
        if candidate.is_none() && current_authority_certificate(&tx, &run_id)?.is_none() {
            return Ok(false);
        }
        tx.execute_batch("SAVEPOINT completion_wake")
            .map_err(|e| e.to_string())?;
        crate::foundation::session_bridge::update_turn_intent_status_with_connection(
            &tx,
            session_id,
            turn_intent_id,
            crate::foundation::session_bridge::TurnIntentBridgeStatus::Cancelled,
        )?;
        let waiting = recheck_pending_in_tx(&tx, &run_id)?;
        let certified = current_authority_certificate(&tx, &run_id)?.is_some();
        let needs_input:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM agent_org_execution_inbox inbox WHERE inbox.org_run_id=?1 AND inbox.recipient_member_id='coordinator' AND inbox.read_at IS NULL
            AND NOT EXISTS(SELECT 1 FROM agent_org_execution_inbox_delivery_resolutions resolution WHERE resolution.inbox_id=inbox.id))",[&run_id],|r|r.get(0)).map_err(|e|e.to_string())?;
        let handled = waiting || (certified && !needs_input);
        if !handled {
            tx.execute_batch("ROLLBACK TO completion_wake")
                .map_err(|e| e.to_string())?;
            recheck_pending_in_tx(&tx, &run_id)?;
        }
        tx.execute_batch("RELEASE completion_wake")
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(handled)
    })
}

/// Releasing a wake reservation may be the last fact a candidate awaits.
/// Return only a newly authorized report doorbell, never ordinary pending work.
pub(crate) fn recheck_after_wake(run_id: &str) -> Result<Vec<String>, String> {
    database::db::with_sessions_writer(|| {
        let conn = database::db::get_connection().map_err(|e| e.to_string())?;
        let tx = database::db::begin_immediate(&conn).map_err(|e| e.to_string())?;
        if load(&tx, run_id)?.is_none() {
            return Ok(Vec::new());
        }
        recheck_pending_in_tx(&tx, run_id)?;
        let ids = if let Some(certificate) = current_authority_certificate(&tx, run_id)? {
            let mut stmt=tx.prepare("SELECT trigger.receipt_id FROM agent_org_execution_formal_trigger_receipts trigger
                JOIN agent_org_execution_final_summary_receipts summary ON trigger.trigger_id=summary.receipt_id
                WHERE trigger.org_run_id=?1 AND trigger.trigger_kind='final_summary' AND trigger.status='pending'
                  AND trigger.doorbell_status='missing' AND summary.certificate_id=?2 LIMIT 1").map_err(|e|e.to_string())?;
            let ids = stmt
                .query_map(params![run_id, certificate.id], |r| r.get(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<String>, _>>()
                .map_err(|e| e.to_string())?;
            ids
        } else {
            Vec::new()
        };
        tx.commit().map_err(|e| e.to_string())?;
        Ok(ids)
    })
}
