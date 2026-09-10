use std::sync::Mutex;

use database::db::get_connection;

use crate::coordination::agent_org_formal_triggers::{
    FormalTriggerDoorbellStatus, FormalTriggerSource,
};
use crate::coordination::agent_org_runs::{
    AgentOrgRunEntryMode, AgentOrgRunStatus, AgentOrgRunStore, CreateAgentOrgRunParams,
};
use crate::coordination::agent_org_tasks::{
    AgentOrgTaskStore, CreateTaskParams, TaskStatus, TASK_METADATA_ELIGIBLE_MEMBER_IDS,
};
use crate::definitions::orgs::{FlatOrgMember, OrgDefinition, PlanApprovalPolicy};
use crate::tools::impls::orchestration::org_send_message::InboxWakeHook;

pub(super) struct WatchdogFixture {
    _sandbox: test_helpers::test_env::SandboxGuard,
    pub(super) run_id: String,
}

impl WatchdogFixture {
    pub(super) fn new() -> Self {
        let sandbox = test_helpers::test_env::sandbox();
        let conn = get_connection().expect("watchdog fixture database");
        crate::persistence::test_schema::ensure_agent_sessions_schema(&conn);
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS session_turn_intents (
                 session_id TEXT NOT NULL,
                 turn_intent_id TEXT NOT NULL,
                 client_message_id TEXT,
                 org_run_id TEXT,
                 source TEXT NOT NULL,
                 status TEXT NOT NULL,
                 created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL,
                 PRIMARY KEY(session_id,turn_intent_id)
             );",
        )
        .expect("Turn-intent fixture schema");
        crate::coordination::init_agent_org_schemas(&conn).expect("Agent Org schemas");
        let org = OrgDefinition {
            id: "watchdog-org".into(),
            name: "Watchdog Org".into(),
            role: "lead".into(),
            agent_id: "coordinator-agent".into(),
            description: None,
            plan_approval_policy: PlanApprovalPolicy::Coordinator,
            members: vec![FlatOrgMember {
                member_id: "worker".into(),
                name: "Worker".into(),
                role: "build".into(),
                agent_id: "worker-agent".into(),
                runtime_config: None,
            }],
            additional_task_graph_writer_member_ids: Vec::new(),
            member_communication_links: Vec::new(),
        };
        let run = AgentOrgRunStore::create(CreateAgentOrgRunParams {
            org_id: org.id.clone(),
            coordinator_agent_id: org.agent_id.clone(),
            root_session_id: Some("watchdog-root".into()),
            org_snapshot: (&org).into(),
            entry_mode: AgentOrgRunEntryMode::StandaloneSession,
            status: AgentOrgRunStatus::Running,
            work_item_id: None,
            project_slug: None,
            routine_fire_id: None,
        })
        .expect("watchdog run");
        Self {
            _sandbox: sandbox,
            run_id: run.id,
        }
    }

    pub(super) fn insert_missing_receipt(&self, suffix: &str) -> String {
        let conn = get_connection().expect("watchdog fixture database");
        super::super::super::agent_org_formal_triggers::record_trigger_in_tx(
            &conn,
            &self.run_id,
            FormalTriggerSource {
                trigger_kind: "task_output",
                trigger_id: suffix,
                trigger_revision: 1,
                source_kind: "task_output",
                inbox_id: None,
                task_id: Some(suffix),
                owner_member_id: Some("worker"),
                source_turn_intent_id: Some("worker-turn"),
                task_output_digest: Some(&"a".repeat(64)),
                plan_revision_id: None,
                doorbell_status: FormalTriggerDoorbellStatus::Missing,
                initially_resolved: false,
            },
        )
        .expect("missing formal doorbell")
        .receipt_id
    }

    pub(super) fn seed_lost_assignment_doorbell(&self, task_id: &str) {
        let conn = get_connection().expect("watchdog fixture database");
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO agent_org_runtime_member_materializations(
                 org_run_id,member_id,agent_id,generation,session_id,
                 authority_class,status,created_at,updated_at
             ) VALUES (?1,'worker','worker-agent',1,'watchdog-worker-session',
                       'formal','succeeded',?2,?2)",
            rusqlite::params![&self.run_id, &now],
        )
        .expect("worker materialization");
        AgentOrgTaskStore::create(CreateTaskParams {
            id: task_id.to_string(),
            org_run_id: self.run_id.clone(),
            subject: "Repair existing assignment".to_string(),
            description: "The original TaskAssigned envelope was lost".to_string(),
            active_form: None,
            owner: Some("worker".to_string()),
            status: TaskStatus::Pending,
            blocks: Vec::new(),
            blocked_by: Vec::new(),
            metadata: Some(serde_json::json!({
                TASK_METADATA_ELIGIBLE_MEMBER_IDS: ["worker"],
            })),
        })
        .expect("assigned pending Task without its doorbell");
    }

    pub(super) fn set_run_status(&self, status: AgentOrgRunStatus) {
        let conn = get_connection().expect("watchdog fixture database");
        conn.execute(
            "UPDATE agent_org_runtime_runs
             SET status=?2,
                 archived_at=CASE WHEN ?2='archived' THEN ?3 ELSE NULL END,
                 archive_receipt_id=CASE WHEN ?2='archived' THEN 'watchdog-archive-receipt' ELSE NULL END
             WHERE id=?1",
            rusqlite::params![&self.run_id, status.as_str(), chrono::Utc::now().to_rfc3339()],
        )
        .expect("change watchdog fixture lifecycle state");
    }
}

#[derive(Default)]
pub(super) struct RecordingWake {
    calls: Mutex<Vec<(String, String)>>,
}

impl RecordingWake {
    pub(super) fn calls(&self) -> Vec<(String, String)> {
        self.calls.lock().unwrap().clone()
    }
}

impl InboxWakeHook for RecordingWake {
    fn wake_member(&self, member_id: &str, org_run_id: &str) {
        self.calls
            .lock()
            .unwrap()
            .push((member_id.to_string(), org_run_id.to_string()));
    }

    fn wake_member_for_formal_receipts(
        &self,
        member_id: &str,
        org_run_id: &str,
        receipt_ids: &[String],
    ) {
        self.wake_member(member_id, org_run_id);
        crate::coordination::agent_org_formal_triggers::mark_doorbells_delivered(receipt_ids)
            .expect("accepted test wake acknowledges exact receipts");
    }
}

#[derive(Default)]
pub(super) struct UnacceptedWake {
    calls: Mutex<Vec<(String, String)>>,
}

impl UnacceptedWake {
    pub(super) fn calls(&self) -> Vec<(String, String)> {
        self.calls.lock().unwrap().clone()
    }
}

impl InboxWakeHook for UnacceptedWake {
    fn wake_member(&self, member_id: &str, org_run_id: &str) {
        self.calls
            .lock()
            .unwrap()
            .push((member_id.to_string(), org_run_id.to_string()));
    }
}
