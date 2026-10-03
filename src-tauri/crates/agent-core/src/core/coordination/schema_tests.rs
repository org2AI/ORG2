use std::sync::{Arc, Barrier};
use std::time::{Duration, Instant};

use super::*;

const LEGACY_TABLES: [&str; 11] = [
    "agent_org_runs",
    "agent_org_run_progress",
    "agent_org_plan_approvals",
    "agent_org_recovery_attempts",
    "agent_org_tasks",
    "agent_org_task_events",
    "agent_org_task_run_schema_migrations",
    "agent_inbox",
    "agent_inbox_materializations",
    "agent_inbox_delivery_resolutions",
    "agent_member_interventions",
];

fn count_known_tables(conn: &Connection, names: &[&str]) -> SqliteResult<usize> {
    Ok(names
        .iter()
        .filter(|name| object_exists(conn, "table", name))
        .count())
}

fn connection() -> Connection {
    let conn = Connection::open_in_memory().expect("in-memory SQLite");
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .expect("enable foreign keys");
    conn
}

fn object_exists(conn: &Connection, object_type: &str, name: &str) -> bool {
    conn.query_row(
        "SELECT EXISTS(
             SELECT 1 FROM sqlite_master WHERE type=?1 AND name=?2
         )",
        rusqlite::params![object_type, name],
        |row| row.get(0),
    )
    .expect("inspect schema object")
}

fn row_count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
        row.get(0)
    })
    .unwrap_or_else(|error| panic!("count {table}: {error}"))
}

fn create_official_v1_3_0_fixture(conn: &Connection) {
    conn.execute_batch(include_str!("fixtures/official_v1_3_0_agent_org.sql"))
        .expect("create exact official v1.3.0 Agent Org fixture");
}

fn seed_shared_sentinels(conn: &Connection) {
    crate::persistence::session_snapshots::ensure_tables_with(conn)
        .expect("create production Session/message schema");
    conn.execute_batch(
        "CREATE TABLE code_sessions (
             id TEXT PRIMARY KEY, session_id TEXT UNIQUE, payload BLOB, org_member_id TEXT
         );
         CREATE TABLE session_turn_intents (id TEXT PRIMARY KEY, payload BLOB, org_run_id TEXT);
         CREATE TABLE projects (id TEXT PRIMARY KEY, payload BLOB);
         CREATE TABLE work_items (id TEXT PRIMARY KEY, payload BLOB);
         CREATE TABLE routines (id TEXT PRIMARY KEY, payload BLOB);
         CREATE TABLE usage_events (id TEXT PRIMARY KEY, payload BLOB);
         INSERT INTO agent_sessions (
             session_id,name,status,user_input,created_at,updated_at
         ) VALUES (
             'ordinary-session','Ordinary SDE','idle','ordinary sentinel',
             '2026-08-01T00:00:00Z','2026-08-01T00:00:00Z'
         );
         INSERT INTO agent_messages (
             id,session_id,role,content,sequence,created_at
         ) VALUES (
             'ordinary-message','ordinary-session','assistant',
             'ordinary message sentinel',1,'2026-08-01T00:00:00Z'
         );
         INSERT INTO code_sessions VALUES ('cli', 'cli-session', x'060708', 'member-b');
         INSERT INTO session_turn_intents VALUES ('intent', x'090A0B', 'run-a');
         INSERT INTO projects VALUES ('project', x'0C0D0E');
         INSERT INTO work_items VALUES ('work-item', x'0F1011');
         INSERT INTO routines VALUES ('routine', x'121314');
         INSERT INTO usage_events VALUES ('usage', x'151617');",
    )
    .expect("shared sentinels");
}

fn shared_sentinel_fingerprint(conn: &Connection) -> Vec<(String, String)> {
    [
        (
            "agent_sessions",
            "SELECT session_id || '|' || name || '|' || status || '|' || user_input
             FROM agent_sessions WHERE session_id='ordinary-session'",
        ),
        (
            "agent_messages",
            "SELECT id || '|' || session_id || '|' || role || '|' || content || '|' || sequence
             FROM agent_messages WHERE id='ordinary-message'",
        ),
        ("code_sessions", "SELECT hex(payload) FROM code_sessions"),
        (
            "session_turn_intents",
            "SELECT hex(payload) FROM session_turn_intents",
        ),
        ("projects", "SELECT hex(payload) FROM projects"),
        ("work_items", "SELECT hex(payload) FROM work_items"),
        ("routines", "SELECT hex(payload) FROM routines"),
        ("usage_events", "SELECT hex(payload) FROM usage_events"),
    ]
    .into_iter()
    .map(|(table, query)| {
        let fingerprint = conn
            .query_row(query, [], |row| row.get::<_, String>(0))
            .unwrap_or_else(|error| panic!("fingerprint {table}: {error}"));
        (table.to_string(), fingerprint)
    })
    .collect()
}

#[test]
fn final_runtime_manifest_matches_the_frozen_release_contract() {
    let manifest = expected_manifest().expect("final manifest");
    assert_eq!(manifest.len(), 119);
    verify_frozen_runtime_contract(&manifest).expect("frozen final runtime contract");
}

#[test]
fn run_ddl_allows_cancelled_outcome_but_rejects_cancelled_team_status() {
    let conn = connection();
    initialize(&conn).expect("initialize runtime schema");

    conn.execute(
        "INSERT INTO agent_org_execution_runs (
             id, org_id, coordinator_agent_id, entry_mode, status,
             last_activity_outcome, created_at, updated_at
         ) VALUES (
             'outcome-cancelled', 'org-a', 'coordinator-a',
             'standalone_session', 'idle', 'cancelled',
             '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'
         )",
        [],
    )
    .expect("cancelled is a valid last_activity_outcome");

    let error = conn
        .execute(
            "INSERT INTO agent_org_execution_runs (
                 id, org_id, coordinator_agent_id, entry_mode, status,
                 last_activity_outcome, created_at, updated_at
             ) VALUES (
                 'status-cancelled', 'org-a', 'coordinator-a',
                 'standalone_session', 'cancelled', 'completed',
                 '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'
             )",
            [],
        )
        .expect_err("cancelled must not become an Agent Org Team status");
    assert!(
        matches!(
            error,
            SqliteError::SqliteFailure(ref code, _)
                if code.code == rusqlite::ErrorCode::ConstraintViolation
        ),
        "unexpected SQLite error: {error}"
    );
}

#[test]
fn exact_official_v1_3_0_home_initializes_final_without_touching_shared_data() {
    let conn = connection();
    create_official_v1_3_0_fixture(&conn);
    seed_shared_sentinels(&conn);
    let shared_before = shared_sentinel_fingerprint(&conn);
    assert_eq!(count_known_tables(&conn, &LEGACY_TABLES).unwrap(), 11);
    for table in LEGACY_TABLES {
        assert_eq!(row_count(&conn, table), 1, "fixture row missing in {table}");
    }

    initialize(&conn).expect("upgrade exact official v1.3.0 home");

    for table in LEGACY_TABLES {
        assert!(!object_exists(&conn, "table", table), "retained {table}");
    }
    for table in RUNTIME_TABLES {
        assert!(object_exists(&conn, "table", table), "missing {table}");
        assert_eq!(row_count(&conn, table), 0, "fresh {table} not empty");
    }
    verify_manifest(&conn, &expected_manifest().expect("final manifest"))
        .expect("exact final manifest");
    assert_eq!(shared_sentinel_fingerprint(&conn), shared_before);
}

#[test]
fn repeated_downgrade_cleanup_preserves_the_complete_canonical_runtime() {
    let conn = connection();
    initialize(&conn).expect("fresh runtime");
    conn.execute_batch(
        "INSERT INTO agent_org_execution_runs (
            id, org_id, coordinator_agent_id, root_session_id,
            org_snapshot_json, entry_mode, status, created_at, updated_at
         ) VALUES (
            'team-a', 'org-a', 'coordinator-a', 'root-a', '{\"team\":\"A\"}',
            'standalone_session', 'idle', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'
         );
         INSERT INTO agent_org_execution_run_progress
            (org_run_id, work_revision, completion_requested, updated_at)
         VALUES ('team-a', 7, 1, '2026-08-01T00:00:00Z');
         INSERT INTO agent_org_execution_member_materializations
            (org_run_id, member_id, agent_id, generation, session_id,
             authority_class, status, created_at, updated_at)
         VALUES ('team-a', 'member-a', 'agent-a', 1, 'session-a',
                 'starting', 'succeeded', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
         INSERT INTO agent_org_execution_initial_inputs
            (org_run_id, turn_intent_id, message_id, content, payload_json,
             status, created_at, updated_at)
         VALUES ('team-a', 'turn-a', 'message-a', 'hello', '{}',
                 'dispatched', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
         INSERT INTO agent_org_execution_tasks
            (id, org_run_id, activation_generation, subject, status, execution_mode,
             created_by_participant_id, source_turn_intent_id, created_at, updated_at)
         VALUES ('task-a', 'team-a', 1, 'Task A', 'pending', 'build',
                 'coordinator', 'turn-a',
                 '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
         INSERT INTO agent_org_execution_task_events
            (id, org_run_id, task_id, event_type, actor_member_id, actor_kind, created_at)
         VALUES ('event-a', 'team-a', 'task-a', 'created', 'coordinator', 'graph_writer',
                 '2026-08-01T00:00:00Z');
         INSERT INTO agent_org_execution_task_annotations
            (id, org_run_id, task_id, kind, body, actor_kind,
             actor_participant_id, created_at)
         VALUES ('annotation-a', 'team-a', 'task-a', 'audit_note', 'fixture',
                 'graph_writer', 'coordinator', '2026-08-01T00:00:00Z');
         INSERT INTO agent_org_execution_inbox
            (recipient_agent_id, recipient_member_id, sender_agent_id,
             sender_member_id, org_run_id, payload_kind, payload_json, created_at, read_at)
         VALUES ('agent-a', 'member-a', 'coordinator-a', 'coordinator', 'team-a',
                 'message', '{}', '2026-08-01T00:00:00Z', '2026-08-01T00:00:01Z');
         INSERT INTO agent_org_execution_inbox_materializations
            (inbox_id, session_id, transcript_message_id, transcript_intent_id, materialized_at)
         VALUES (1, 'session-a', 'message-a', 'turn-a', '2026-08-01T00:00:01Z');
         INSERT INTO agent_org_execution_inbox_delivery_resolutions
            (inbox_id, org_run_id, resolution_kind, resolved_by_member_id,
             reason, created_at)
         VALUES (2, 'team-a', 'cancelled', 'coordinator', 'done', '2026-08-01T00:00:02Z');
         INSERT INTO agent_org_execution_plan_revisions
            (plan_revision_id, org_run_id, source_task_id, source_member_id,
             source_session_id, source_turn_intent_id, root_session_id,
             revision_number, plan_title, plan_path, plan_content,
             content_digest, created_at)
         VALUES ('revision-a', 'team-a', 'task-a', 'member-a',
                 'session-a', 'turn-a', 'root-a', 1, 'Plan', '/tmp/plan-a',
                 '# plan',
                 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                 '2026-08-01T00:00:00Z');
         INSERT INTO agent_org_execution_plan_decisions
            (approval_id, plan_revision_id, request_id, policy, status,
             decision_by, created_at, resolved_at)
         VALUES ('approval-a', 'revision-a', 'request-a', 'coordinator',
                 'approved', 'coordinator', '2026-08-01T00:00:00Z',
                 '2026-08-01T00:00:01Z');
         INSERT INTO agent_org_execution_recovery_attempts
            (org_run_id, action_kind, target_key, reason_fingerprint, attempts,
             next_allowed_at, updated_at)
         VALUES ('team-a', 'member_rewake', 'member-a', 'fingerprint', 1,
                 '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z');
         INSERT INTO agent_org_execution_member_interventions
            (intervention_receipt_id,org_run_id,member_id,agent_id,session_id,
             status,source_event_id,entered_at,last_user_activity_at,updated_at)
         VALUES ('intervention-a','team-a','member-a','agent-a','session-a','active',
                 'message-a','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z',
                 '2026-08-01T00:00:00Z');",
    )
    .expect("canonical Team A fixture");
    let before = RUNTIME_TABLES
        .into_iter()
        .map(|table| (table, row_count(&conn, table)))
        .collect::<Vec<_>>();

    for _ in 0..2 {
        create_official_v1_3_0_fixture(&conn);
        initialize(&conn).expect("re-upgrade cleanup");
        assert_eq!(
            RUNTIME_TABLES
                .into_iter()
                .map(|table| (table, row_count(&conn, table)))
                .collect::<Vec<_>>(),
            before
        );
        for table in LEGACY_TABLES {
            assert!(!object_exists(&conn, "table", table));
        }
    }

    let snapshot: String = conn
        .query_row(
            "SELECT org_snapshot_json FROM agent_org_execution_runs WHERE id='team-a'",
            [],
            |row| row.get(0),
        )
        .expect("preserved snapshot");
    assert_eq!(snapshot, "{\"team\":\"A\"}");
}

#[test]
fn unpublished_runtime_without_history_index_is_rejected_without_touching_data() {
    let conn = connection();
    initialize(&conn).expect("create current runtime");
    conn.execute_batch(
        "INSERT INTO agent_org_execution_runs (
             id,org_id,coordinator_agent_id,entry_mode,status,created_at,updated_at
         ) VALUES (
             'run-history-index-upgrade','org-a','coordinator-agent',
             'standalone_session','running',
             '2026-08-30T00:00:00Z','2026-08-30T00:00:00Z'
         );
         INSERT INTO agent_org_execution_tasks (
             id,org_run_id,activation_generation,subject,status,execution_mode,
             created_by_participant_id,source_turn_intent_id,created_at,updated_at
         ) VALUES (
             'task-history-index-upgrade','run-history-index-upgrade',1,
             'Preserve this Task','pending','build','coordinator','turn-a',
             '2026-08-30T00:00:00Z','2026-08-30T00:00:00Z'
         );
         DROP INDEX idx_agent_org_execution_tasks_history_page;",
    )
    .expect("simulate unpublished runtime without the final history index");

    let error = initialize(&conn).expect_err("intermediate runtime must be rejected");
    assert!(error.to_string().contains("Agent Org runtime schema"));
    assert_eq!(row_count(&conn, "agent_org_execution_tasks"), 1);
}

#[test]
fn unpublished_runtime_without_task_bindings_is_rejected_without_backfill() {
    let conn = connection();
    conn.execute_batch(
        "CREATE TABLE session_turn_intents (
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
    .expect("shared Turn intent schema");
    initialize(&conn).expect("create current runtime");
    let now = "2026-08-29T00:00:00Z";
    conn.execute_batch(
        "INSERT INTO agent_org_execution_runs (
             id,org_id,coordinator_agent_id,root_session_id,entry_mode,status,
             activation_generation,created_at,updated_at
         ) VALUES (
             'run-binding-upgrade','org-a','coordinator-agent','root-session',
             'standalone_session','running',2,
             '2026-08-29T00:00:00Z','2026-08-29T00:00:00Z'
         );
         INSERT INTO session_turn_intents (
             session_id,turn_intent_id,org_run_id,source,status,created_at,updated_at
         ) VALUES (
             'root-session','root-reply-turn','run-binding-upgrade',
             'resume','completed','2026-08-29T00:00:00Z','2026-08-29T00:00:00Z'
         );
         INSERT INTO agent_org_execution_turn_contexts (
             session_id,turn_intent_id,org_run_id,participant_id,turn_kind,
             source_kind,source_id,activation_generation,created_at
         ) VALUES (
             'root-session','root-reply-turn','run-binding-upgrade','coordinator',
             'coordinator','root_turn','root-reply-turn',2,
             '2026-08-29T00:00:00Z'
         );
         INSERT INTO agent_org_execution_tasks (
             id,org_run_id,activation_generation,subject,owner,status,execution_mode,
             created_by_participant_id,source_turn_intent_id,created_at,updated_at
         ) VALUES (
             'task-upgrade','run-binding-upgrade',2,'Upgrade task','member-a',
             'in_progress','build','coordinator','root-reply-turn',
             '2026-08-29T00:00:00Z','2026-08-29T00:00:00Z'
         );
         INSERT INTO agent_org_execution_inbox (
             recipient_agent_id,recipient_member_id,sender_agent_id,sender_member_id,
             org_run_id,payload_kind,payload_json,created_at
         ) VALUES (
             'member-agent','member-a','coordinator-agent','coordinator',
             'run-binding-upgrade','plain',
             '{\"kind\":\"plain\",\"summary\":\"reply\",\"text\":\"continue\"}',
             '2026-08-29T00:00:00Z'
         );",
    )
    .expect("seed previous-release reply facts");
    let inbox_id = conn.last_insert_rowid();
    let result = serde_json::json!({
        "delivered": [{
            "inbox_id": inbox_id,
            "recipient_member_id": "member-a"
        }],
        "kind": "plain",
        "org_run_id": "run-binding-upgrade",
        "related_task_id": "task-upgrade",
        "sender_member_id": "coordinator"
    })
    .to_string();
    conn.execute(
        "INSERT INTO agent_org_execution_tool_call_receipts (
             org_run_id,session_id,turn_intent_id,call_id,tool_name,operation,
             canonical_digest,result_text,created_at
         ) VALUES (
             'run-binding-upgrade','root-session','root-reply-turn','call-reply',
             'org_send_message','plain',?1,?2,?3
         )",
        rusqlite::params!["a".repeat(64), result, now],
    )
    .expect("seed exactly-once send receipt");

    conn.execute_batch(
        "DROP TABLE agent_org_execution_inbox_task_bindings;
         DROP INDEX idx_agent_org_execution_tasks_history_page;",
    )
    .expect("simulate unpublished runtime without final task bindings");
    assert_eq!(
        count_known_tables(&conn, &RUNTIME_TABLES).unwrap(),
        RUNTIME_TABLES.len() - 1
    );

    let error = initialize(&conn).expect_err("intermediate runtime must be rejected");
    assert!(error
        .to_string()
        .contains("unknown Agent Org runtime schema"));
    assert_eq!(
        row_count(&conn, "agent_org_execution_tool_call_receipts"),
        1
    );
}

#[test]
fn partial_or_unknown_runtime_schema_fails_closed_before_legacy_cleanup() {
    for mutate in ["partial", "changed", "extra_index"] {
        let conn = connection();
        initialize(&conn).expect("canonical runtime");
        conn.execute_batch("CREATE TABLE agent_org_runs (sentinel TEXT); INSERT INTO agent_org_runs VALUES ('legacy');")
            .expect("legacy sentinel");
        match mutate {
            "partial" => {
                conn.execute_batch(
                    "DROP TABLE agent_org_execution_turn_contexts;
                     DROP TABLE agent_org_execution_member_dispatch_allocators;",
                )
                .expect("make partial schema");
                assert_eq!(
                    count_known_tables(&conn, &RUNTIME_TABLES).unwrap(),
                    RUNTIME_TABLES.len() - 2
                );
            }
            "changed" => {
                conn.execute_batch(
                    "DROP TABLE agent_org_execution_member_intervention_turns;
                     DROP TABLE agent_org_execution_member_interventions;
                     CREATE TABLE agent_org_execution_member_interventions (sentinel TEXT);",
                )
                .expect("make changed schema");
            }
            "extra_index" => conn
                .execute_batch(
                    "CREATE INDEX idx_agent_org_runtime_unknown
                     ON agent_org_execution_runs(updated_at);",
                )
                .expect("make unknown index"),
            _ => unreachable!(),
        }

        let error = initialize(&conn).expect_err("unknown runtime must fail closed");
        assert!(
            error.to_string().contains("Agent Org runtime schema"),
            "{error}"
        );
        assert_eq!(row_count(&conn, "agent_org_runs"), 1);
    }
}

#[test]
fn incomplete_runtime_manifest_requires_an_isolated_database() {
    let conn = connection();
    initialize(&conn).expect("canonical pause runtime");
    conn.execute_batch(
        "DROP TABLE agent_org_execution_pause_handoffs;
         DROP TABLE agent_org_execution_pause_episodes;",
    )
    .expect("simulate an incomplete strict runtime manifest");
    assert_eq!(
        count_known_tables(&conn, &RUNTIME_TABLES).unwrap(),
        RUNTIME_TABLES.len() - 2
    );

    let error = initialize(&conn).expect_err("previous runtime must not be migrated in place");
    assert!(error.to_string().contains("missing="), "{error}");
}

#[test]
fn create_failure_rolls_back_every_legacy_drop() {
    let conn = connection();
    create_official_v1_3_0_fixture(&conn);
    conn.execute_batch("CREATE VIEW agent_org_execution_runs AS SELECT 1 AS id;")
        .expect("runtime name conflict");

    initialize(&conn).expect_err("runtime create must fail");

    for table in LEGACY_TABLES {
        assert!(
            object_exists(&conn, "table", table),
            "rollback lost {table}"
        );
        assert_eq!(row_count(&conn, table), 1);
    }
    assert!(object_exists(&conn, "view", "agent_org_execution_runs"));
}

#[test]
fn unknown_agent_org_objects_are_preserved() {
    let conn = connection();
    conn.execute_batch(
        "CREATE TABLE agent_org_local_experiment (sentinel TEXT);
         INSERT INTO agent_org_local_experiment VALUES ('keep');",
    )
    .expect("unknown table");

    initialize(&conn).expect("initialize around unknown object");

    assert_eq!(row_count(&conn, "agent_org_local_experiment"), 1);
}

#[test]
fn concurrent_initializers_serialize_to_one_canonical_schema() {
    let directory = tempfile::tempdir().expect("temporary database directory");
    let path = directory.path().join("sessions.db");
    let barrier = Arc::new(Barrier::new(2));
    let handles = (0..2)
        .map(|_| {
            let path = path.clone();
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                let conn = Connection::open(path).expect("open shared SQLite database");
                conn.busy_timeout(Duration::from_secs(5))
                    .expect("set busy timeout");
                conn.execute_batch("PRAGMA foreign_keys=ON;")
                    .expect("enable foreign keys");
                barrier.wait();
                initialize(&conn)
            })
        })
        .collect::<Vec<_>>();

    for handle in handles {
        handle
            .join()
            .expect("initializer thread")
            .expect("initialize");
    }

    let conn = Connection::open(path).expect("reopen shared database");
    verify_manifest(&conn, &expected_manifest().expect("expected manifest"))
        .expect("canonical manifest after concurrent init");
    assert_eq!(
        count_known_tables(&conn, &RUNTIME_TABLES).unwrap(),
        RUNTIME_TABLES.len()
    );
}

#[test]
fn measures_constant_scale_startup_paths() {
    const SAMPLES: usize = 25;
    let mut fresh = Vec::with_capacity(SAMPLES);
    let mut no_op = Vec::with_capacity(SAMPLES);
    let mut cleanup = Vec::with_capacity(SAMPLES);

    for _ in 0..SAMPLES {
        let conn = connection();
        let started = Instant::now();
        initialize(&conn).expect("fresh init");
        fresh.push(started.elapsed());

        let started = Instant::now();
        initialize(&conn).expect("canonical no-op init");
        no_op.push(started.elapsed());

        create_official_v1_3_0_fixture(&conn);
        let started = Instant::now();
        initialize(&conn).expect("legacy cleanup init");
        cleanup.push(started.elapsed());
    }

    fn summary(samples: &mut [Duration]) -> (Duration, Duration) {
        samples.sort_unstable();
        (samples[samples.len() / 2], *samples.last().unwrap())
    }
    let (fresh_median, fresh_max) = summary(&mut fresh);
    let (no_op_median, no_op_max) = summary(&mut no_op);
    let (cleanup_median, cleanup_max) = summary(&mut cleanup);
    eprintln!(
        "Agent Org schema init, {SAMPLES} samples: fresh median={fresh_median:?} max={fresh_max:?}; canonical no-op median={no_op_median:?} max={no_op_max:?}; official-v1.3.0 cleanup median={cleanup_median:?} max={cleanup_max:?}"
    );
}
