use super::*;

#[derive(Debug)]
pub(crate) enum WakeAdmission<T> {
    Ready(T),
    NoReadyWork,
    Deferred,
}

impl<T> WakeAdmission<T> {
    pub(crate) fn into_ready(self) -> Result<T, String> {
        match self {
            Self::Ready(value) => Ok(value),
            Self::NoReadyWork | Self::Deferred => {
                Err("formal wake result reached an ordinary send caller".into())
            }
        }
    }
}

pub(super) fn assess_wake(
    conn: &Connection,
    request: &AgentOrgTurnAdmission,
    member_id: &str,
) -> Result<WakeAdmission<Option<TaskWakeBinding>>, String> {
    validate_non_empty(request)?;
    let (root, snapshot, status): (Option<String>, String, String) = conn.query_row(
        "SELECT root_session_id,org_snapshot_json,status FROM agent_org_runtime_runs WHERE id=?1",
        [&request.org_run_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).map_err(|error| error.to_string())?;
    let snapshot: AgentOrgLaunchSnapshot =
        serde_json::from_str(&snapshot).map_err(|error| invariant_error(error.to_string()))?;
    validate_launch_snapshot(&snapshot).map_err(invariant_error)?;
    let coordinator = member_id == COORDINATOR_MEMBER_ID;
    let agent_id = if coordinator {
        if root.as_deref() != Some(&request.session_id) {
            return Err(invariant_error(
                "wake session is not the canonical Root".into(),
            ));
        }
        &snapshot.coordinator_agent_id
    } else {
        snapshot_member_agent_id(&snapshot, member_id)?
    };
    resolve_materialization_version(conn, request, member_id, agent_id)?;
    let status = AgentOrgRunStatus::parse(&status)
        .ok_or_else(|| invariant_error(format!("unknown run status {status}")))?;
    if status != AgentOrgRunStatus::Running
        || has_live_pause_continuation(conn, &request.org_run_id, member_id)?
    {
        return Ok(WakeAdmission::Deferred);
    }
    let intervention: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM agent_org_runtime_member_interventions
         WHERE org_run_id=?1 AND member_id=?2 AND status IN ('yield_requested','active','return_requested'))",
        params![request.org_run_id, member_id], |row| row.get(0),
    ).map_err(|error| error.to_string())?;
    if intervention {
        return Ok(WakeAdmission::Deferred);
    }
    if coordinator {
        return Ok(if coordinator_has_input(conn, request)? {
            WakeAdmission::Ready(None)
        } else {
            WakeAdmission::NoReadyWork
        });
    }
    let Some(binding) =
        resolve_next_task_wake_binding(conn, &request.org_run_id, &request.session_id, member_id)?
    else {
        return Ok(WakeAdmission::NoReadyWork);
    };
    let busy: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM agent_org_task_execution_leases lease
         JOIN session_turn_intents intent USING(session_id,turn_intent_id)
         WHERE lease.org_run_id=?1 AND lease.task_id=?2 AND lease.activation_generation=?3
           AND lease.state='active' AND intent.status IN ('queued','running','optimistic')
           AND NOT (lease.session_id=?4 AND lease.turn_intent_id=?5))",
            params![
                request.org_run_id,
                binding.task_id,
                binding.activation_generation,
                request.session_id,
                request.turn_intent_id
            ],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    Ok(if busy {
        WakeAdmission::Deferred
    } else {
        WakeAdmission::Ready(Some(binding))
    })
}

fn coordinator_has_input(
    conn: &Connection,
    request: &AgentOrgTurnAdmission,
) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM agent_org_runtime_inbox inbox
         LEFT JOIN agent_org_runtime_formal_trigger_receipts receipt ON receipt.inbox_id=inbox.id
         WHERE inbox.org_run_id=?1 AND inbox.recipient_member_id='coordinator'
           AND inbox.delivery_class='formal_work' AND inbox.read_at IS NULL
           AND NOT EXISTS(SELECT 1 FROM agent_org_runtime_inbox_delivery_resolutions resolution WHERE resolution.inbox_id=inbox.id)
           AND (receipt.receipt_id IS NULL OR receipt.status IN ('pending','materialized'))
           AND NOT EXISTS(SELECT 1 FROM agent_org_runtime_formal_trigger_attempts attempt
             WHERE attempt.receipt_id=receipt.receipt_id AND attempt.status IN ('queued','running')
               AND NOT (attempt.session_id=?2 AND attempt.turn_intent_id=?3)))
         OR EXISTS(SELECT 1 FROM agent_org_runtime_final_summary_receipts summary
           WHERE summary.org_run_id=?1 AND (summary.status='pending'
             OR (summary.coordinator_session_id=?2 AND summary.turn_intent_id=?3 AND summary.status IN ('running','persisting'))))",
        params![request.org_run_id,request.session_id,request.turn_intent_id], |row| row.get(0),
    ).map_err(|error| error.to_string())
}

pub(crate) fn revalidate_wake_in_tx(
    conn: &Connection,
    session_id: &str,
    turn_id: &str,
) -> Result<bool, String> {
    let context = require_context_with_connection(conn, session_id, turn_id)?;
    let request = AgentOrgTurnAdmission::coordinator(
        &context.org_run_id,
        session_id,
        turn_id,
        None,
        TurnIntentBridgeSource::Resume,
    );
    let current: bool = conn
        .query_row(
            "SELECT activation_generation=?2 FROM agent_org_runtime_runs WHERE id=?1",
            params![context.org_run_id, context.activation_generation],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let ready = match assess_wake(conn, &request, &context.participant_id)? {
        WakeAdmission::Ready(binding) => {
            current && binding.as_ref().map(|b| b.task_id.as_str()) == context.task_id.as_deref()
        }
        WakeAdmission::NoReadyWork | WakeAdmission::Deferred => false,
    };
    if !ready {
        crate::foundation::session_bridge::update_turn_intent_status_with_connection(
            conn,
            session_id,
            turn_id,
            TurnIntentBridgeStatus::Cancelled,
        )?;
        super::super::agent_org_finality::release_turn_lease_in_tx(
            conn,
            session_id,
            turn_id,
            "released",
            "wake_no_ready_work",
        )?;
    }
    Ok(ready)
}
