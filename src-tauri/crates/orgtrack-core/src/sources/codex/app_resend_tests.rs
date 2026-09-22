use super::{index, meta, CODEX_APP_METADATA_PARSER_VERSION};
use crate::sources::imported_history::{cache, metadata::SOURCE_CODEX_APP};
use crate::store::sqlite::SqliteRecordStore;
use rusqlite::Connection;
use std::path::PathBuf;

const THREAD: &str = "11111111-1111-4111-8111-111111111111";
const ROLLOUT: &str = "22222222-2222-4222-8222-222222222222";
const FORK: &str = "33333333-3333-4333-8333-333333333333";

struct Fixture(PathBuf);
impl Fixture {
    fn new(name: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "codex-resend-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(path.join("sessions")).unwrap();
        Self(path)
    }
    fn conn(&self) -> Connection {
        let conn = Connection::open(self.0.join("cache.sqlite")).unwrap();
        SqliteRecordStore::init_tables(&conn).unwrap();
        SqliteRecordStore::init_source_cache_tables(&conn).unwrap();
        conn
    }
    fn write(&self, stem: &str, id: &str, time: &str, fork: bool) {
        let header = serde_json::json!({"timestamp":time,"type":"session_meta","payload":{
            "id":id,"originator":"Codex Desktop","source":"vscode","cwd":"/tmp/project",
            "forked_from_id":if fork {Some(THREAD)} else {None}
        }});
        let user = serde_json::json!({"timestamp":time,"type":"event_msg","payload":{
            "type":"user_message","message":"same prompt"
        }});
        std::fs::write(
            self.0.join("sessions").join(format!("{stem}.jsonl")),
            format!("{header}\n{user}\n"),
        )
        .unwrap();
    }
    fn write_raw(&self, stem: &str, content: &str) {
        std::fs::write(
            self.0.join("sessions").join(format!("{stem}.jsonl")),
            content,
        )
        .unwrap();
    }
    fn sync(&self, conn: &mut Connection) {
        index::sync_codex_app_cache_from_dirs(conn, &[self.0.join("sessions")]).unwrap();
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn visible(conn: &Connection) -> Vec<String> {
    let mut stmt = conn.prepare("SELECT source_session_id FROM imported_history_session_cache WHERE source='codex_app' AND listable=1 AND COALESCE(parent_session_id,'')='' ORDER BY source_session_id").unwrap();
    stmt.query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

#[test]
fn resend_rollout_keeps_one_family_across_live_scan_restart_and_legacy_lookup() {
    let fixture = Fixture::new("lifecycle");
    let original = format!("rollout-2026-08-23T12-40-07-{THREAD}");
    let resend = format!("rollout-2026-08-25T06-19-04-{THREAD}_{ROLLOUT}");
    let fork = format!("rollout-2026-08-25T06-20-00-{FORK}");
    fixture.write(&original, THREAD, "2026-08-23T19:40:07Z", false);
    let mut conn = fixture.conn();
    fixture.sync(&mut conn);
    assert_eq!(visible(&conn), std::slice::from_ref(&original));
    let old_id = format!("codexapp-{original}");
    assert!(
        cache::query_cached_session_by_session_id_from_conn(&conn, &old_id)
            .unwrap()
            .is_some()
    );
    // An older build cached this file and its incremental watermark without
    // the identity field. Upgrade listability without reparsing its history.
    conn.execute(
        "UPDATE imported_history_session_cache SET source_metadata_json = ''",
        [],
    )
    .unwrap();
    let watermark = crate::sources::imported_history::watermark::read_parse_watermark_from_conn(
        &conn,
        SOURCE_CODEX_APP,
        &original,
    )
    .unwrap();
    fixture.write(&resend, THREAD, "2026-08-24T22:19:04Z", false);
    fixture.write(&fork, FORK, "2026-08-24T22:20:00Z", true);
    for _ in 0..2 {
        fixture.sync(&mut conn);
        assert_eq!(visible(&conn), [resend.clone(), fork.clone()]);
        assert!(
            cache::query_cached_session_by_session_id_from_conn(&conn, &old_id)
                .unwrap()
                .is_none()
        );
        let status = cache::cached_session_continuation_status_from_conn(&conn, &old_id)
            .unwrap()
            .unwrap();
        assert_eq!(status, (Some(THREAD.to_string()), true));
        // Historical replay remains available; no raw or cached record is deleted.
        assert!(
            cache::query_cached_session_by_session_id_including_superseded_from_conn(
                &conn, &old_id
            )
            .unwrap()
            .is_some()
        );
    }
    assert_eq!(
        crate::sources::imported_history::watermark::read_parse_watermark_from_conn(
            &conn,
            SOURCE_CODEX_APP,
            &original
        )
        .unwrap(),
        watermark
    );
    let before_warm_scan = conn.total_changes();
    fixture.sync(&mut conn);
    assert_eq!(
        conn.total_changes(),
        before_warm_scan,
        "an unchanged scan must not rewrite the repaired cache"
    );
    let resumed_path =
        cache::get_cached_source_path_by_suffix_from_conn(&conn, SOURCE_CODEX_APP, THREAD)
            .unwrap()
            .unwrap();
    assert!(resumed_path.ends_with(&format!("{resend}.jsonl")));
    let plan =
        crate::sources::cli_resume::cli_resume_plan(SOURCE_CODEX_APP, &resend, None, None).unwrap();
    assert_eq!(plan.native_session_id, THREAD);
    drop(conn);
    let mut conn = fixture.conn();
    fixture.sync(&mut conn);
    assert_eq!(visible(&conn), [resend, fork]);
    assert_eq!(
        conn.query_row(
            "SELECT count(*) FROM imported_history_session_cache",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        3
    );
}

#[test]
fn resend_filename_resolves_thread_and_preserves_managed_ownership() {
    let fixture = Fixture::new("managed");
    let stem = format!("rollout-2026-08-25T06-19-04-{THREAD}_{ROLLOUT}");
    assert_eq!(index::codex_thread_id_from_file_stem(&stem), Some(THREAD));
    assert_eq!(index::codex_thread_id_from_file_stem(THREAD), Some(THREAD));
    assert_eq!(
        index::codex_thread_id_from_file_stem(&format!("rollout-2026-08-23T12-40-07-{THREAD}")),
        Some(THREAD)
    );
    assert_eq!(
        index::codex_thread_id_from_file_stem(&"中".repeat(13)),
        None
    );
    fixture.write(&stem, THREAD, "2026-08-24T22:19:04Z", false);
    std::fs::write(
        fixture.0.join("session_index.jsonl"),
        format!("{{\"id\":\"{THREAD}\",\"thread_name\":\"Native title\"}}\n"),
    )
    .unwrap();
    let mut conn = fixture.conn();
    fixture.sync(&mut conn);
    assert_eq!(
        conn.query_row("SELECT name FROM imported_history_session_cache", [], |r| r
            .get::<_, String>(0))
            .unwrap(),
        "Native title"
    );
    conn.execute_batch(
        "CREATE TABLE code_session_native_transcript_ids (source TEXT, source_session_id TEXT)",
    )
    .unwrap();
    conn.execute(
        "INSERT INTO code_session_native_transcript_ids VALUES (?1, ?2)",
        [SOURCE_CODEX_APP, THREAD],
    )
    .unwrap();
    fixture.sync(&mut conn);
    assert!(visible(&conn).is_empty());
    assert_eq!(
        conn.query_row(
            "SELECT client_origin FROM imported_history_session_cache",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "org2"
    );
    assert_eq!(
        meta::resolve_codex_transcript_for_thread_id_near_path(
            &fixture.0.join("sessions").join(format!("{stem}.jsonl")),
            THREAD
        )
        .unwrap()
        .unwrap()
        .source_session_id,
        stem
    );
    assert_eq!(
        conn.query_row(
            "SELECT parser_version FROM imported_history_session_cache",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        CODEX_APP_METADATA_PARSER_VERSION
    );
}

#[test]
fn resend_pin_follows_native_thread_and_unpins_legacy_generations() {
    let fixture = Fixture::new("pins");
    let original = format!("rollout-2026-08-23T12-40-07-{THREAD}");
    let resend = format!("rollout-2026-08-25T06-19-04-{THREAD}_{ROLLOUT}");
    let fork = format!("rollout-2026-08-25T06-20-00-{FORK}");
    fixture.write(&original, THREAD, "2026-08-23T19:40:07Z", false);
    let mut conn = fixture.conn();
    fixture.sync(&mut conn);
    let old_id = format!("codexapp-{original}");
    let new_id = format!("codexapp-{resend}");
    // Existing builds persisted the physical ID. Read repair must preserve it
    // without writes, while the sidebar joins it to the new representative.
    conn.execute(
        "INSERT INTO imported_history_session_pin VALUES (?1, '2026-08-23')",
        [&old_id],
    )
    .unwrap();
    fixture.write(&resend, THREAD, "2026-08-24T22:19:04Z", false);
    fixture.write(&fork, FORK, "2026-08-24T22:20:00Z", true);
    fixture.sync(&mut conn);
    let before = conn.total_changes();
    let pins = cache::pinned_imported_session_ids_from_conn(&conn).unwrap();
    let pinned_visible: Vec<_> = visible(&conn)
        .into_iter()
        .filter(|stem| {
            pins.contains(&cache::imported_session_pin_identity(&format!(
                "codexapp-{stem}"
            )))
        })
        .collect();
    assert_eq!(pinned_visible, [resend]);
    assert_eq!(conn.total_changes(), before);
    cache::set_imported_session_pinned_from_conn(&conn, &new_id, false, "").unwrap();
    assert!(cache::pinned_imported_session_ids_from_conn(&conn)
        .unwrap()
        .is_empty());
    cache::set_imported_session_pinned_from_conn(&conn, &new_id, true, "2026-08-25").unwrap();
    assert_eq!(
        conn.query_row(
            "SELECT session_id FROM imported_history_session_pin",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        new_id
    );
    drop(conn);
    let mut conn = fixture.conn();
    fixture.sync(&mut conn);
    assert!(cache::pinned_imported_session_ids_from_conn(&conn)
        .unwrap()
        .contains(&cache::imported_session_pin_identity(&new_id)));
    // Intent survives a missing/rebuilt cache and can be cleared through an old tab.
    conn.execute("DELETE FROM imported_history_session_cache", [])
        .unwrap();
    assert_eq!(
        cache::pinned_imported_session_ids_from_conn(&conn)
            .unwrap()
            .len(),
        1
    );
    cache::set_imported_session_pinned_from_conn(&conn, &old_id, false, "").unwrap();
    assert!(cache::pinned_imported_session_ids_from_conn(&conn)
        .unwrap()
        .is_empty());
}

const CHILD: &str = "44444444-4444-4444-8444-444444444444";

fn parent_with_spawn(time: &str) -> String {
    let header = serde_json::json!({"timestamp":time,"type":"session_meta","payload":{
        "id":THREAD,"originator":"Codex Desktop","source":"vscode","cwd":"/tmp/project"
    }});
    let user = serde_json::json!({"timestamp":time,"type":"event_msg","payload":{
        "type":"user_message","message":"audit commits"
    }});
    let spawn = serde_json::json!({"timestamp":time,"type":"response_item","payload":{
        "type":"function_call","name":"spawn_agent","namespace":"collaboration",
        "arguments":"{\"task_name\":\"audit_commits\",\"message\":\"audit\"}","call_id":"call_spawn"
    }});
    let activity = serde_json::json!({"timestamp":time,"type":"event_msg","payload":{
        "type":"sub_agent_activity","event_id":"call_spawn","agent_thread_id":CHILD,
        "agent_path":"/root/audit_commits","kind":"started"
    }});
    format!("{header}\n{user}\n{spawn}\n{activity}\n")
}

fn child_of_parent(time: &str) -> String {
    let header = serde_json::json!({"timestamp":time,"type":"session_meta","payload":{
        "id":CHILD,"originator":"Codex Desktop","source":{"subagent":{"thread_spawn":{
            "parent_thread_id":THREAD,"depth":1,"agent_path":"/root/audit_commits",
            "agent_nickname":"Auditor"}}},
        "thread_source":"subagent","parent_thread_id":THREAD,"cwd":"/tmp/project"
    }});
    let user = serde_json::json!({"timestamp":time,"type":"event_msg","payload":{
        "type":"user_message","message":"audit"
    }});
    format!("{header}\n{user}\n")
}

fn linked_subagent_session_id(conn: &Connection, session_id: &str) -> Option<String> {
    index::load_codex_app_for_session(conn, session_id)
        .unwrap()
        .into_iter()
        .find(|chunk| chunk.function == "subagent")
        .and_then(|chunk| {
            chunk
                .args
                .get("subagentSessionId")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
        })
}

#[test]
fn resend_generation_keeps_subagent_links_and_resolves_newest_rollout() {
    let fixture = Fixture::new("subagent");
    let original = format!("rollout-2026-08-23T12-40-07-{THREAD}");
    let child = format!("rollout-2026-08-23T12-41-00-{CHILD}");
    let resend = format!("rollout-2026-08-25T06-19-04-{THREAD}_{ROLLOUT}");
    fixture.write_raw(&original, &parent_with_spawn("2026-08-23T19:40:07Z"));
    fixture.write_raw(&child, &child_of_parent("2026-08-23T19:41:00Z"));
    let mut conn = fixture.conn();
    fixture.sync(&mut conn);
    let original_id = format!("codexapp-{original}");
    let child_id = format!("codexapp-{child}");
    assert_eq!(visible(&conn), std::slice::from_ref(&original));
    assert_eq!(
        linked_subagent_session_id(&conn, &original_id).as_deref(),
        Some(child_id.as_str())
    );

    // The parent is resent: a rotated rollout replays the same spawn while the
    // child stays bound to the physical rollout it was parsed against.
    fixture.write_raw(&resend, &parent_with_spawn("2026-08-24T22:19:04Z"));
    fixture.sync(&mut conn);
    let resend_id = format!("codexapp-{resend}");
    assert_eq!(visible(&conn), std::slice::from_ref(&resend));
    assert_eq!(
        conn.query_row(
            "SELECT parent_session_id FROM imported_history_session_cache
             WHERE source_session_id = ?1",
            [&child],
            |row| row.get::<_, String>(0)
        )
        .unwrap(),
        original_id,
        "an unchanged child must not be reparsed just because its parent rotated"
    );
    assert_eq!(
        linked_subagent_session_id(&conn, &resend_id).as_deref(),
        Some(child_id.as_str()),
        "the current representative must link the child spawned by an older generation"
    );
    assert_eq!(
        linked_subagent_session_id(&conn, &original_id).as_deref(),
        Some(child_id.as_str()),
        "historical replay of the superseded generation keeps its child"
    );
    assert_eq!(
        meta::resolve_codex_transcript_for_thread_id_near_path(
            &fixture.0.join("sessions").join(format!("{child}.jsonl")),
            THREAD
        )
        .unwrap()
        .unwrap()
        .source_session_id,
        resend,
        "thread resolution near a child must pick the current generation"
    );

    // Codex archived the resend generation while the child, re-parsed against
    // it, stays bound to the pruned row. The surviving generation must still
    // link the child through the thread id in the child's own parent key.
    conn.execute(
        "UPDATE imported_history_session_cache SET parent_session_id = ?1 WHERE source_session_id = ?2",
        [&resend_id, &child],
    )
    .unwrap();
    std::fs::remove_file(fixture.0.join("sessions").join(format!("{resend}.jsonl"))).unwrap();
    fixture.sync(&mut conn);
    assert_eq!(
        linked_subagent_session_id(&conn, &original_id).as_deref(),
        Some(child_id.as_str()),
        "a child bound to a pruned generation still links through its thread id"
    );
}

#[test]
fn native_path_lookup_breaks_activity_ties_like_the_election() {
    let fixture = Fixture::new("tie");
    let original = format!("rollout-2026-08-23T12-40-07-{THREAD}");
    let resend = format!("rollout-2026-08-25T06-19-04-{THREAD}_{ROLLOUT}");
    fixture.write(&original, THREAD, "2026-08-23T19:40:07Z", false);
    fixture.write(&resend, THREAD, "2026-08-23T19:40:07Z", false);
    let mut conn = fixture.conn();
    fixture.sync(&mut conn);
    let winner = visible(&conn);
    assert_eq!(winner.len(), 1);
    let winner_path: String = conn
        .query_row(
            "SELECT source_path FROM imported_history_session_cache WHERE source_session_id = ?1",
            [&winner[0]],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        cache::get_cached_source_path_by_suffix_from_conn(&conn, SOURCE_CODEX_APP, THREAD)
            .unwrap()
            .as_deref(),
        Some(winner_path.as_str())
    );
}

#[test]
fn a_spawn_naming_an_absent_child_thread_stays_unlinked() {
    let fixture = Fixture::new("named-child");
    let original = format!("rollout-2026-08-23T12-40-07-{THREAD}");
    let child = format!("rollout-2026-08-23T12-41-00-{CHILD}");
    let resend = format!("rollout-2026-08-25T06-19-04-{THREAD}_{ROLLOUT}");
    fixture.write_raw(&original, &parent_with_spawn("2026-08-23T19:40:07Z"));
    fixture.write_raw(&child, &child_of_parent("2026-08-23T19:41:00Z"));
    // The resent generation names a child thread that is not cached (never
    // written, or its rollout removed). Same task name and close timestamps
    // as the first generation's child.
    let time = "2026-08-24T22:19:04Z";
    let header = serde_json::json!({"timestamp":time,"type":"session_meta","payload":{
        "id":THREAD,"originator":"Codex Desktop","source":"vscode","cwd":"/tmp/project"
    }});
    let spawn = serde_json::json!({"timestamp":time,"type":"response_item","payload":{
        "type":"function_call","name":"spawn_agent","namespace":"collaboration",
        "arguments":"{\"task_name\":\"audit_commits\",\"message\":\"audit\"}","call_id":"call_spawn2"
    }});
    let activity = serde_json::json!({"timestamp":time,"type":"event_msg","payload":{
        "type":"sub_agent_activity","event_id":"call_spawn2",
        "agent_thread_id":"55555555-5555-4555-8555-555555555555",
        "agent_path":"/root/audit_commits","kind":"started"
    }});
    fixture.write_raw(&resend, &format!("{header}\n{spawn}\n{activity}\n"));
    let mut conn = fixture.conn();
    fixture.sync(&mut conn);
    let resend_id = format!("codexapp-{resend}");
    assert_eq!(visible(&conn), std::slice::from_ref(&resend));
    assert_eq!(
        linked_subagent_session_id(&conn, &resend_id),
        None,
        "an explicit child thread id must not fall back to another generation's child"
    );
    assert_eq!(
        linked_subagent_session_id(&conn, &format!("codexapp-{original}")).as_deref(),
        Some(format!("codexapp-{child}").as_str())
    );
}
