//! Narrow repair for an already-authorized Task assignment whose original
//! runtime doorbell was lost.
//!
//! This path never chooses an owner and never creates or mutates a Task. It
//! requires a ready, assigned Pending Task, no active/queued TaskExecution,
//! and no unread TaskAssigned envelope. One durable marker per latest Task
//! assignment event makes the replacement envelope idempotent.

use std::collections::HashMap;

use database::db::{get_connection, with_sessions_writer};
use rusqlite::{params, OptionalExtension};

use crate::coordination::agent_inbox::SYSTEM_SENDER_ID;

use super::super::helpers::list_tasks_with_conn;
use super::super::TaskAssignmentDoorbellRepair;
use super::AgentOrgTaskStore;

const REPAIR_ACTION_KIND: &str = "task_assignment_doorbell_repair_event";

#[derive(Debug)]
struct RepairCandidate {
    org_run_id: String,
    task_id: String,
    owner_member_id: String,
    assignment_event_id: String,
    owner_agent_id: String,
}

impl AgentOrgTaskStore {
    pub(crate) fn repair_lost_assignment_doorbells(
        limit: usize,
    ) -> Result<Vec<TaskAssignmentDoorbellRepair>, String> {
        if limit == 0 {
            return Ok(Vec::new());
        }
        let limit = i64::try_from(limit.min(100))
            .map_err(|_| "assignment repair limit is too large".to_string())?;
        with_sessions_writer(|| {
            let mut conn = get_connection().map_err(|error| error.to_string())?;
            let tx = conn
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(|error| error.to_string())?;
            let candidates = {
                let mut statement = tx
                    .prepare(
                        "SELECT task.org_run_id,task.id,task.owner,
                                latest.id,materialization.agent_id
                         FROM agent_org_runtime_tasks task
                         JOIN agent_org_runtime_runs run
                           ON run.id=task.org_run_id AND run.status='running'
                         JOIN agent_org_runtime_task_events latest
                           ON latest.rowid=(
                               SELECT MAX(event.rowid)
                               FROM agent_org_runtime_task_events event
                               WHERE event.org_run_id=task.org_run_id
                                 AND event.task_id=task.id
                           )
                         JOIN agent_org_runtime_member_materializations materialization
                           ON materialization.rowid=(
                               SELECT MAX(candidate.rowid)
                               FROM agent_org_runtime_member_materializations candidate
                               WHERE candidate.org_run_id=task.org_run_id
                                 AND candidate.member_id=task.owner
                                 AND candidate.status='succeeded'
                           )
                         WHERE task.status='pending' AND task.owner IS NOT NULL
                           AND NOT EXISTS (
                               SELECT 1 FROM json_each(task.blocked_by_json) dependency
                               LEFT JOIN agent_org_runtime_tasks blocker
                                 ON blocker.org_run_id=task.org_run_id
                                AND blocker.id=dependency.value
                               WHERE blocker.id IS NULL OR blocker.status<>'completed'
                           )
                           AND NOT EXISTS (
                               SELECT 1 FROM agent_org_task_execution_leases lease
                               WHERE lease.org_run_id=task.org_run_id
                                 AND lease.task_id=task.id AND lease.state='active'
                           )
                           AND NOT EXISTS (
                               SELECT 1
                               FROM agent_org_runtime_turn_contexts context
                               JOIN session_turn_intents intent
                                 ON intent.session_id=context.session_id
                                AND intent.turn_intent_id=context.turn_intent_id
                               WHERE context.org_run_id=task.org_run_id
                                 AND context.task_id=task.id
                                 AND context.turn_kind='task_execution'
                                 AND intent.status IN ('optimistic','queued','running')
                           )
                           AND NOT EXISTS (
                               SELECT 1 FROM agent_org_runtime_inbox inbox
                               WHERE inbox.org_run_id=task.org_run_id
                                 AND inbox.recipient_member_id=task.owner
                                 AND inbox.payload_kind='task_assigned'
                                 AND inbox.read_at IS NULL
                                 AND json_valid(inbox.payload_json)
                                 AND json_extract(inbox.payload_json,'$.task_id')=task.id
                                 AND NOT EXISTS (
                                     SELECT 1
                                     FROM agent_org_runtime_inbox_delivery_resolutions resolution
                                     WHERE resolution.inbox_id=inbox.id
                                 )
                           )
                           AND NOT EXISTS (
                               SELECT 1 FROM agent_org_runtime_recovery_attempts repaired
                               WHERE repaired.org_run_id=task.org_run_id
                                 AND repaired.action_kind=?1
                                 AND repaired.target_key=task.id
                                 AND repaired.reason_fingerprint=latest.id
                           )
                         ORDER BY task.org_run_id,task.created_at,task.id
                         LIMIT ?2",
                    )
                    .map_err(|error| error.to_string())?;
                let rows = statement
                    .query_map(params![REPAIR_ACTION_KIND, limit], |row| {
                        Ok(RepairCandidate {
                            org_run_id: row.get(0)?,
                            task_id: row.get(1)?,
                            owner_member_id: row.get(2)?,
                            assignment_event_id: row.get(3)?,
                            owner_agent_id: row.get(4)?,
                        })
                    })
                    .map_err(|error| error.to_string())?;
                rows.collect::<rusqlite::Result<Vec<_>>>()
                    .map_err(|error| error.to_string())?
            };

            let mut boards = HashMap::new();
            let mut repairs = Vec::with_capacity(candidates.len());
            for candidate in candidates {
                if !boards.contains_key(&candidate.org_run_id) {
                    boards.insert(
                        candidate.org_run_id.clone(),
                        list_tasks_with_conn(&tx, &candidate.org_run_id)?,
                    );
                }
                let board = boards
                    .get(&candidate.org_run_id)
                    .expect("board inserted for repair candidate");
                let task = board
                    .iter()
                    .find(|task| task.id == candidate.task_id)
                    .ok_or_else(|| {
                        format!(
                            "assignment repair Task disappeared: {}/{}",
                            candidate.org_run_id, candidate.task_id
                        )
                    })?;
                let owner_inbox_id = super::super::enqueue_task_assigned_to_with_tasks_in_tx(
                    &tx,
                    task,
                    board,
                    &candidate.owner_agent_id,
                    &candidate.owner_member_id,
                    SYSTEM_SENDER_ID,
                    None,
                    "System recovery",
                    None,
                )?;
                let coordinator_receipt_id = tx
                    .query_row(
                        "SELECT receipt.receipt_id
                         FROM agent_org_runtime_inbox observer
                         JOIN agent_org_runtime_formal_trigger_receipts receipt
                           ON receipt.inbox_id=observer.id
                         WHERE observer.causation_inbox_id=?1
                           AND observer.org_run_id=?2
                           AND receipt.source_kind='task_assignment'
                           AND receipt.task_id=?3
                           AND receipt.owner_member_id=?4
                         LIMIT 1",
                        params![
                            owner_inbox_id,
                            &candidate.org_run_id,
                            &candidate.task_id,
                            &candidate.owner_member_id,
                        ],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()
                    .map_err(|error| error.to_string())?
                    .ok_or_else(|| {
                        "assignment repair committed no Coordinator receipt".to_string()
                    })?;
                let now = chrono::Utc::now().to_rfc3339();
                tx.execute(
                    "INSERT INTO agent_org_runtime_recovery_attempts(
                         org_run_id,action_kind,target_key,reason_fingerprint,
                         attempts,next_allowed_at,updated_at,reservation_token
                     ) VALUES (?1,?2,?3,?4,1,?5,?5,NULL)
                     ON CONFLICT(org_run_id,action_kind,target_key) DO UPDATE SET
                         reason_fingerprint=excluded.reason_fingerprint,
                         attempts=1,next_allowed_at=excluded.next_allowed_at,
                         updated_at=excluded.updated_at,reservation_token=NULL
                     WHERE reason_fingerprint<>excluded.reason_fingerprint",
                    params![
                        &candidate.org_run_id,
                        REPAIR_ACTION_KIND,
                        &candidate.task_id,
                        &candidate.assignment_event_id,
                        &now,
                    ],
                )
                .map_err(|error| error.to_string())?;
                repairs.push(TaskAssignmentDoorbellRepair {
                    org_run_id: candidate.org_run_id,
                    task_id: candidate.task_id,
                    owner_member_id: candidate.owner_member_id,
                    assignment_event_id: candidate.assignment_event_id,
                    owner_inbox_id,
                    coordinator_receipt_id,
                });
            }
            tx.commit().map_err(|error| error.to_string())?;
            Ok(repairs)
        })
    }
}
