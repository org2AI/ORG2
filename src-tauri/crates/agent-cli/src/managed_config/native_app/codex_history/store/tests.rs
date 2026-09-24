//! Isolated native-schema fixtures and persistence regression tests.
use super::schema::{Column, HISTORY_TRIGGERS, STATE_TABLES, STATE_TRIGGERS};
use super::*;

fn create_table(connection: &Connection, name: &str, columns: &[Column]) {
    let mut parts = columns
        .iter()
        .map(|column| {
            format!(
                "{} {}{}",
                column.0,
                column.1,
                if column.2 != 0 { " NOT NULL" } else { "" }
            )
        })
        .collect::<Vec<_>>();
    let mut key = columns
        .iter()
        .filter(|column| column.3 != 0)
        .collect::<Vec<_>>();
    key.sort_by_key(|column| column.3);
    parts.push(format!(
        "PRIMARY KEY ({})",
        key.iter()
            .map(|column| column.0)
            .collect::<Vec<_>>()
            .join(",")
    ));
    if name == "threads" {
        parts.push("FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL".into());
        parts.push(
            "FOREIGN KEY(thread_section_id) REFERENCES thread_sections(id) ON DELETE SET NULL"
                .into(),
        );
    }
    connection
        .execute_batch(&format!("CREATE TABLE {name} ({})", parts.join(",")))
        .unwrap();
}

pub(super) fn home() -> tempfile::TempDir {
    let home = tempfile::tempdir().unwrap();
    let state = Connection::open(home.path().join(STATE_FILE)).unwrap();
    state.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE _sqlx_migrations(version INTEGER PRIMARY KEY, success BOOLEAN NOT NULL); CREATE TABLE sequence_fixture(id INTEGER PRIMARY KEY AUTOINCREMENT); DROP TABLE sequence_fixture;").unwrap();
    for version in 1..=55 {
        state
            .execute("INSERT INTO _sqlx_migrations VALUES (?1,1)", [version])
            .unwrap();
    }
    create_table(&state, "threads", THREAD_COLUMNS);
    for name in STATE_TABLES
        .iter()
        .filter(|name| !matches!(**name, "threads" | "_sqlx_migrations" | "sqlite_sequence"))
    {
        state
            .execute_batch(&format!("CREATE TABLE {name}(id TEXT PRIMARY KEY)"))
            .unwrap();
    }
    for (_, sql) in STATE_TRIGGERS {
        state.execute_batch(sql).unwrap();
    }
    let history = Connection::open(home.path().join(HISTORY_FILE)).unwrap();
    history.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE _sqlx_migrations(version INTEGER PRIMARY KEY, success BOOLEAN NOT NULL)").unwrap();
    for version in 1..=6 {
        history
            .execute("INSERT INTO _sqlx_migrations VALUES (?1,1)", [version])
            .unwrap();
    }
    for (table, columns) in HISTORY_TABLES {
        create_table(&history, table, columns);
    }
    for (_, sql) in HISTORY_TRIGGERS {
        history.execute_batch(sql).unwrap();
    }
    home
}

pub(super) fn seed(home: &Path, id: &str, rollout: &str) {
    let state = Connection::open(home.join(STATE_FILE)).unwrap();
    let mut values = THREAD_COLUMNS
        .iter()
        .map(|column| match (column.1, column.2) {
            (_, 0) => Value::Null,
            ("TEXT", _) => Value::Text(String::new()),
            _ => Value::Integer(0),
        })
        .collect::<Vec<_>>();
    for (column, value) in [
        ("id", id),
        (
            "rollout_path",
            home.join(format!("sessions/{rollout}.jsonl"))
                .to_str()
                .unwrap(),
        ),
        ("model_provider", "openai"),
        ("model", "source-model"),
        ("title", "Conversation"),
        ("source", "cli"),
        ("cwd", "/test"),
        ("history_mode", "paginated"),
        ("sandbox_policy", "{\"type\":\"danger-full-access\"}"),
        ("approval_mode", "never"),
        ("memory_mode", "enabled"),
    ] {
        values[column_index(column)] = Value::Text(value.to_string());
    }
    values[column_index("updated_at")] = Value::Integer(1);
    values[column_index("updated_at_ms")] = Value::Integer(1000);
    state
        .execute(
            &format!(
                "INSERT INTO threads ({}) VALUES ({})",
                columns_sql(THREAD_COLUMNS),
                vec!["?"; THREAD_COLUMNS.len()].join(",")
            ),
            params_from_iter(values.iter()),
        )
        .unwrap();
    seed_projection(home, rollout);
}

fn seed_projection(home: &Path, rollout: &str) {
    let history = Connection::open(home.join(HISTORY_FILE)).unwrap();
    history
        .execute(
            "INSERT INTO thread_history_projection_state VALUES (?1,321,9)",
            [rollout],
        )
        .unwrap();
    history.execute("INSERT INTO thread_items VALUES (?1,'turn','tool',4,10,'{\"type\":\"commandExecution\",\"raw\":\"unchanged\"}','commandExecution',8)", [rollout]).unwrap();
    history.execute("INSERT INTO thread_turns VALUES (?1,'turn',2,'completed',NULL,1,2,1,'user','assistant',123,9,321)", [rollout]).unwrap();
    history.execute("INSERT INTO thread_realtime_items VALUES (?1,'audio',5,11,'audio','{\"raw\":\"voice\"}')", [rollout]).unwrap();
}

#[test]
fn completed_gate_uses_its_held_snapshot_and_requires_every_selected_rollout() {
    let source = home();
    seed(source.path(), "thread", "current");
    seed_projection(source.path(), "ancestor");
    let ids = ["ancestor".into(), "current".into()];
    let before = prepare(source.path(), "thread", &ids).unwrap();
    assert!(before.completed_rollouts().unwrap());
    let history = Connection::open(source.path().join(HISTORY_FILE)).unwrap();
    history
        .execute(
            "UPDATE thread_turns SET status='inProgress' WHERE thread_id='ancestor'",
            [],
        )
        .unwrap();
    assert!(
        before.completed_rollouts().unwrap(),
        "a prepared snapshot must not drift with the live source"
    );
    let fresh = prepare(source.path(), "thread", &ids).unwrap();
    assert!(!fresh.completed_rollouts().unwrap());
    assert_eq!(before.projections(), fresh.projections());
    drop(fresh);
    history
        .execute("UPDATE thread_turns SET status='completed'", [])
        .unwrap();
    history.execute("UPDATE thread_history_projection_state SET next_rollout_ordinal=10 WHERE thread_id='current'", []).unwrap();
    let progressed = prepare(source.path(), "thread", &ids).unwrap();
    assert!(progressed.completed_rollouts().unwrap());
    assert_ne!(before.projections(), progressed.projections());
    drop(progressed);
    history
        .execute("DELETE FROM thread_turns WHERE thread_id='ancestor'", [])
        .unwrap();
    assert!(!prepare(source.path(), "thread", &ids)
        .unwrap()
        .completed_rollouts()
        .unwrap());
}

#[test]
fn completed_gate_rejects_noncompleted_empty_null_and_legacy_turns() {
    let source = home();
    seed(source.path(), "thread", "current");
    let ids = ["current".into()];
    let history = Connection::open(source.path().join(HISTORY_FILE)).unwrap();
    for status in [
        "inProgress",
        "failed",
        "interrupted",
        "",
        "COMPLETED",
        "completed ",
    ] {
        history
            .execute("UPDATE thread_turns SET status=?1", [status])
            .unwrap();
        assert!(
            !prepare(source.path(), "thread", &ids)
                .unwrap()
                .completed_rollouts()
                .unwrap(),
            "accepted {status:?}"
        );
    }
    history
        .execute("UPDATE thread_turns SET status='completed'", [])
        .unwrap();
    let completed = prepare(source.path(), "thread", &ids).unwrap();
    // Native schema already forbids NULL. Exercise the defensive query against
    // a malformed row without weakening the native schema gate for imports.
    let malformed = Connection::open_in_memory().unwrap();
    malformed.execute_batch("CREATE TABLE thread_turns(thread_id TEXT,status TEXT); INSERT INTO thread_turns VALUES ('current','completed'),('current',NULL)").unwrap();
    let malformed = PreparedThread {
        source: malformed,
        history_schema: "main",
        record: completed.record.clone(),
        projections: completed.projections.clone(),
        projection_columns: completed.projection_columns.clone(),
    };
    assert!(!malformed.completed_rollouts().unwrap());
    drop(completed);
    history.execute("DELETE FROM thread_turns", []).unwrap();
    assert!(!prepare(source.path(), "thread", &ids)
        .unwrap()
        .completed_rollouts()
        .unwrap());
    Connection::open(source.path().join(STATE_FILE))
        .unwrap()
        .execute("UPDATE threads SET history_mode='legacy'", [])
        .unwrap();
    assert!(!prepare(source.path(), "thread", &ids)
        .unwrap()
        .completed_rollouts()
        .unwrap());
}

#[test]
fn durable_snapshot_restores_complete_projection_without_original_databases() {
    let source = home();
    let target = home();
    let journal = tempfile::tempdir().unwrap();
    let snapshot = journal
        .path()
        .canonicalize()
        .unwrap()
        .join("snapshot.sqlite");
    seed(source.path(), "thread", "replacement");
    seed_projection(source.path(), "ancestor");
    let prepared = prepare(
        source.path(),
        "thread",
        &["replacement".into(), "ancestor".into()],
    )
    .unwrap();
    let original_path = prepared.record().rollout_path.clone();
    prepared.persist_snapshot(&snapshot, || Ok(())).unwrap();
    drop(prepared);
    // Native source progress or even removal cannot invalidate recovery.
    drop(source);
    let restored = PreparedThread::from_snapshot(&snapshot).unwrap();
    assert_eq!(restored.record().rollout_path, original_path);
    assert_eq!(restored.projections().len(), 2);
    restored
        .apply_with_alias(
            target.path(),
            &target.path().join("sessions/replacement.jsonl"),
            &["replacement".into(), "ancestor".into()],
            "orgii",
            "target-model",
            None,
            None,
            || Ok(()),
        )
        .unwrap();
    let history = Connection::open(target.path().join(HISTORY_FILE)).unwrap();
    for (table, _) in HISTORY_TABLES {
        let count: i64 = history
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 2, "{table}");
    }
    let voice: String = history
        .query_row(
            "SELECT item_json FROM thread_realtime_items WHERE thread_id='replacement'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(voice, "{\"raw\":\"voice\"}");
    let snapshot_connection = Connection::open(&snapshot).unwrap();
    let names: Vec<String> = snapshot_connection
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(names.len(), 7);
    assert!(!names
        .iter()
        .any(|name| name == "remote_control_enrollments" || name == "projects"));
}

#[test]
fn snapshot_owner_cancellation_leaves_no_publish_and_existing_snapshot_is_immutable() {
    let source = home();
    let journal = tempfile::tempdir().unwrap();
    let root = journal.path().canonicalize().unwrap();
    let snapshot = root.join("snapshot.sqlite");
    seed(source.path(), "thread", "replacement");
    let prepared = prepare(source.path(), "thread", &["replacement".into()]).unwrap();
    let mut checks = 0;
    let result = prepared.persist_snapshot(&snapshot, || {
        checks += 1;
        if checks >= 2 {
            Err("owner revoked".into())
        } else {
            Ok(())
        }
    });
    assert_eq!(result.unwrap_err(), "owner revoked");
    assert!(!snapshot.exists());
    assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
    prepared.persist_snapshot(&snapshot, || Ok(())).unwrap();
    let original = std::fs::read(&snapshot).unwrap();
    assert!(prepared.persist_snapshot(&snapshot, || Ok(())).is_err());
    assert_eq!(std::fs::read(&snapshot).unwrap(), original);
}

#[test]
fn snapshot_rejects_unknown_schema_unrelated_rollouts_and_sidecars() {
    let source = home();
    let journal = tempfile::tempdir().unwrap();
    let root = journal.path().canonicalize().unwrap();
    seed(source.path(), "thread", "replacement");
    let prepared = prepare(source.path(), "thread", &["replacement".into()]).unwrap();
    let unknown = root.join("unknown.sqlite");
    prepared.persist_snapshot(&unknown, || Ok(())).unwrap();
    Connection::open(&unknown)
        .unwrap()
        .execute_batch("CREATE TABLE future_semantics(id TEXT)")
        .unwrap();
    assert!(PreparedThread::from_snapshot(&unknown).is_err());
    let unrelated = root.join("unrelated.sqlite");
    prepared.persist_snapshot(&unrelated, || Ok(())).unwrap();
    Connection::open(&unrelated)
        .unwrap()
        .execute(
            "INSERT INTO thread_realtime_items VALUES ('other','audio',1,1,'audio','{}')",
            [],
        )
        .unwrap();
    assert!(PreparedThread::from_snapshot(&unrelated).is_err());
    let sidecar = root.join("sidecar.sqlite");
    prepared.persist_snapshot(&sidecar, || Ok(())).unwrap();
    std::fs::write(root.join("sidecar.sqlite-wal"), []).unwrap();
    assert!(PreparedThread::from_snapshot(&sidecar).is_err());
}

#[test]
fn publishes_raw_projections_and_conservative_new_route_without_other_state() {
    let source = home();
    let target = home();
    seed(source.path(), "thread", "replacement");
    seed_projection(source.path(), "ancestor");
    let prepared = prepare(
        source.path(),
        "thread",
        &["replacement".into(), "ancestor".into()],
    )
    .unwrap();
    assert_eq!(prepared.projections()[0].next_byte_offset, Some(321));
    let published = prepared
        .apply_with_alias(
            target.path(),
            &target.path().join("sessions/replacement.jsonl"),
            &["replacement".into(), "ancestor".into()],
            "orgii",
            "market-model",
            None,
            None,
            || Ok(()),
        )
        .unwrap();
    assert_eq!(published.metadata_hash, prepared.record().metadata_hash);
    assert_eq!(
        text_value(&published.columns, &published.values, "model_provider").unwrap(),
        "orgii"
    );
    let (_, _, permissions, _) = published.routing_settings().unwrap();
    assert_eq!(permissions["type"], "managed");
    assert_eq!(permissions["network"], "restricted");
    assert_eq!(permissions["file_system"]["entries"][0]["access"], "read");
    assert_eq!(
        text_value(&published.columns, &published.values, "approval_mode").unwrap(),
        "on-request"
    );
    assert_eq!(
        text_value(&published.columns, &published.values, "memory_mode").unwrap(),
        "disabled"
    );
    let copied = open(target.path(), false, true).unwrap();
    assert_eq!(
        copied
            .query_row(
                "SELECT count(*) FROM history.thread_realtime_items",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        2
    );
    assert_eq!(copied.query_row("SELECT rollout_end_byte_offset FROM history.thread_turns WHERE thread_id='ancestor'", [], |row| row.get::<_, i64>(0)).unwrap(), 321);
    assert_eq!(
        copied
            .query_row(
                "SELECT count(*) FROM remote_control_enrollments",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
}

#[test]
fn publishes_selected_route_and_preserves_permissions_and_grouping() {
    let source = home();
    let target = home();
    seed(source.path(), "thread", "replacement");
    seed(target.path(), "thread", "replacement");
    let target_db = Connection::open(target.path().join(STATE_FILE)).unwrap();
    target_db
        .execute("INSERT INTO projects VALUES ('local-project')", [])
        .unwrap();
    target_db
        .execute("INSERT INTO thread_sections VALUES ('local-section')", [])
        .unwrap();
    target_db.execute("UPDATE threads SET model_provider='outdated-provider',model='outdated-model',approval_mode='untrusted',sandbox_policy='local-policy',project_id='local-project',thread_section_id='local-section',is_pinned=1", []).unwrap();
    let before = list_threads(target.path(), None).unwrap().remove(0);
    let prepared = prepare(source.path(), "thread", &["replacement".into()]).unwrap();
    let record = prepared
        .apply_with_alias(
            target.path(),
            &target.path().join("sessions/replacement.jsonl"),
            &["replacement".into()],
            "orgii",
            "chosen",
            Some(&before.metadata_hash),
            None,
            || Ok(()),
        )
        .unwrap();
    for (field, expected) in [
        ("model_provider", "orgii"),
        ("model", "chosen"),
        ("approval_mode", "untrusted"),
        ("sandbox_policy", "local-policy"),
        ("project_id", "local-project"),
        ("thread_section_id", "local-section"),
    ] {
        assert_eq!(
            text_value(&record.columns, &record.values, field).unwrap(),
            expected
        );
    }
    let history = Connection::open(target.path().join(HISTORY_FILE)).unwrap();
    assert_eq!(
        history
            .query_row("SELECT count(*) FROM thread_realtime_items", [], |row| row
                .get::<_, i64>(
                0
            ))
            .unwrap(),
        1
    );
}

#[test]
fn source_snapshot_does_not_mix_later_metadata_or_projection_writes() {
    let source = home();
    let target = home();
    seed(source.path(), "thread", "rollout");
    let prepared = prepare(source.path(), "thread", &["rollout".into()]).unwrap();
    Connection::open(source.path().join(STATE_FILE))
        .unwrap()
        .execute("UPDATE threads SET title='later'", [])
        .unwrap();
    Connection::open(source.path().join(HISTORY_FILE))
        .unwrap()
        .execute("UPDATE thread_items SET item_json='later'", [])
        .unwrap();
    let record = prepared
        .apply_with_alias(
            target.path(),
            &target.path().join("sessions/rollout.jsonl"),
            &["rollout".into()],
            "orgii",
            "chosen",
            None,
            None,
            || Ok(()),
        )
        .unwrap();
    assert_eq!(
        text_value(&record.columns, &record.values, "title").unwrap(),
        "Conversation"
    );
    let history = Connection::open(target.path().join(HISTORY_FILE)).unwrap();
    assert_ne!(
        history
            .query_row("SELECT item_json FROM thread_items", [], |row| row
                .get::<_, String>(0))
            .unwrap(),
        "later"
    );
}

#[test]
fn identity_change_rolls_back_both_databases() {
    let source = home();
    let target = home();
    seed(source.path(), "thread", "rollout");
    let prepared = prepare(source.path(), "thread", &["rollout".into()]).unwrap();
    let mut checks = 0;
    let result = prepared.apply_with_alias(
        target.path(),
        &target.path().join("sessions/rollout.jsonl"),
        &["rollout".into()],
        "orgii",
        "chosen",
        None,
        None,
        || {
            checks += 1;
            if checks == 3 {
                Err("owner changed".into())
            } else {
                Ok(())
            }
        },
    );
    assert!(result.is_err());
    assert!(list_threads(target.path(), None).unwrap().is_empty());
    let history = Connection::open(target.path().join(HISTORY_FILE)).unwrap();
    assert_eq!(
        history
            .query_row("SELECT count(*) FROM thread_items", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn refuses_relevant_unknown_triggers_or_missing_checkpoint() {
    {
        let mutation =
            "CREATE TRIGGER surprise AFTER UPDATE ON threads BEGIN DELETE FROM projects; END";
        let source = home();
        seed(source.path(), "thread", "rollout");
        Connection::open(source.path().join(STATE_FILE))
            .unwrap()
            .execute_batch(mutation)
            .unwrap();
        assert!(
            prepare(source.path(), "thread", &["rollout".into()]).is_err(),
            "{mutation}"
        );
    }
    let source = home();
    seed(source.path(), "thread", "rollout");
    Connection::open(source.path().join(HISTORY_FILE))
        .unwrap()
        .execute("DELETE FROM thread_history_projection_state", [])
        .unwrap();
    assert!(prepare(source.path(), "thread", &["rollout".into()]).is_err());
}

#[test]
fn refuses_target_conflict_without_changing_history() {
    let source = home();
    let target = home();
    seed(source.path(), "thread", "rollout");
    seed(target.path(), "thread", "rollout");
    let before = list_threads(target.path(), None).unwrap().remove(0);
    Connection::open(target.path().join(STATE_FILE))
        .unwrap()
        .execute("UPDATE threads SET title='renamed'", [])
        .unwrap();
    let prepared = prepare(source.path(), "thread", &["rollout".into()]).unwrap();
    assert!(prepared
        .apply_with_alias(
            target.path(),
            &target.path().join("sessions/rollout.jsonl"),
            &["rollout".into()],
            "orgii",
            "chosen",
            Some(&before.metadata_hash),
            None,
            || Ok(())
        )
        .is_err());
    assert_eq!(
        list_threads(target.path(), None).unwrap()[0]
            .column("title")
            .unwrap()
            .clone(),
        Value::Text("renamed".into())
    );
}

#[test]
fn does_not_replace_projection_for_an_existing_unimported_ancestor() {
    let source = home();
    let target = home();
    seed(source.path(), "thread", "replacement");
    seed_projection(source.path(), "ancestor");
    seed_projection(target.path(), "ancestor");
    let history = Connection::open(target.path().join(HISTORY_FILE)).unwrap();
    history.execute("UPDATE thread_history_projection_state SET next_rollout_byte_offset=999,next_rollout_ordinal=20", []).unwrap();
    history
        .execute(
            "UPDATE thread_items SET item_json='target later history'",
            [],
        )
        .unwrap();
    let prepared = prepare(
        source.path(),
        "thread",
        &["replacement".into(), "ancestor".into()],
    )
    .unwrap();
    prepared
        .apply_with_alias(
            target.path(),
            &target.path().join("sessions/replacement.jsonl"),
            &["replacement".into()],
            "orgii",
            "chosen",
            None,
            None,
            || Ok(()),
        )
        .unwrap();
    let checkpoint = checkpoints(target.path(), &["ancestor".into()])
        .unwrap()
        .remove(0);
    assert_eq!(checkpoint.next_byte_offset, Some(999));
    assert_eq!(checkpoint.next_ordinal, Some(20));
    assert_eq!(
        history
            .query_row(
                "SELECT item_json FROM thread_items WHERE thread_id='ancestor'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
        "target later history"
    );
}

#[cfg(unix)]
#[test]
fn refuses_database_sidecar_symlinks_before_opening_the_target() {
    let source = home();
    let target = home();
    seed(source.path(), "thread", "rollout");
    let prepared = prepare(source.path(), "thread", &["rollout".into()]).unwrap();
    let outside = target.path().join("outside");
    std::fs::write(&outside, b"untouched").unwrap();
    std::os::unix::fs::symlink(&outside, target.path().join(format!("{STATE_FILE}-wal"))).unwrap();
    assert!(prepared
        .apply_with_alias(
            target.path(),
            &target.path().join("sessions/rollout.jsonl"),
            &["rollout".into()],
            "orgii",
            "chosen",
            None,
            None,
            || Ok(())
        )
        .is_err());
    assert_eq!(std::fs::read(outside).unwrap(), b"untouched");
}

fn publish_for_test(
    prepared: &PreparedThread,
    target: &Path,
    expected: Option<&str>,
) -> Result<ThreadRecord, String> {
    prepared.apply_with_alias(
        target,
        &target.join("sessions/replacement.jsonl"),
        &["replacement".into()],
        "orgii",
        "market-model",
        expected,
        None,
        || Ok(()),
    )
}

fn add_opaque_columns(home: &Path, reverse: bool) {
    let state = Connection::open(home.join(STATE_FILE)).unwrap();
    let statements = [
        "ALTER TABLE threads ADD COLUMN \"future\"\"payload\" BLOB",
        "ALTER TABLE threads ADD COLUMN future_text TEXT",
    ];
    for sql in if reverse {
        [statements[1], statements[0]]
    } else {
        statements
    } {
        state.execute_batch(sql).unwrap();
    }
    state
        .execute(
            "UPDATE threads SET \"future\"\"payload\"=?1,future_text='opaque'",
            [vec![0u8, 255, 1]],
        )
        .unwrap();
    Connection::open(home.join(HISTORY_FILE)).unwrap().execute_batch("ALTER TABLE thread_items ADD COLUMN future_blob BLOB; UPDATE thread_items SET future_blob=x'00ff02'; ALTER TABLE thread_turns ADD COLUMN future_status TEXT; UPDATE thread_turns SET future_status='native-extra';").unwrap();
}

#[test]
fn opaque_native_columns_survive_direct_and_recovered_publication() {
    let source = home();
    seed(source.path(), "thread", "replacement");
    add_opaque_columns(source.path(), false);
    let prepared = prepare(source.path(), "thread", &["replacement".into()]).unwrap();
    let journal = tempfile::tempdir().unwrap();
    let path = journal
        .path()
        .canonicalize()
        .unwrap()
        .join("prepared.sqlite");
    prepared.persist_snapshot(&path, || Ok(())).unwrap();
    let recovered = PreparedThread::from_snapshot(&path).unwrap();
    assert_eq!(
        prepared.record().metadata_hash,
        recovered.record().metadata_hash
    );
    assert_eq!(
        prepared.record().revision_metadata_hash().unwrap(),
        recovered.record().revision_metadata_hash().unwrap()
    );
    for copy in [&prepared, &recovered] {
        let target = home();
        add_opaque_columns(target.path(), true);
        let result = publish_for_test(copy, target.path(), None).unwrap();
        assert_eq!(
            result.column("future\"payload"),
            Some(&Value::Blob(vec![0, 255, 1]))
        );
        assert_eq!(
            result.column("future_text"),
            Some(&Value::Text("opaque".into()))
        );
        let history = Connection::open(target.path().join(HISTORY_FILE)).unwrap();
        assert_eq!(
            history
                .query_row("SELECT future_blob FROM thread_items", [], |row| row
                    .get::<_, Vec<u8>>(0))
                .unwrap(),
            vec![0, 255, 2]
        );
        assert_eq!(
            history
                .query_row("SELECT future_status FROM thread_turns", [], |row| row
                    .get::<_, String>(
                    0
                ))
                .unwrap(),
            "native-extra"
        );
    }
}

#[test]
fn opaque_only_revision_changes_are_hashed_and_reject_stale_target_cas() {
    let source = home();
    let target = home();
    for side in [source.path(), target.path()] {
        seed(side, "thread", "replacement");
        add_opaque_columns(side, false);
    }
    let before = list_threads(target.path(), None).unwrap().remove(0);
    let prepared = prepare(source.path(), "thread", &["replacement".into()]).unwrap();
    Connection::open(target.path().join(STATE_FILE))
        .unwrap()
        .execute("UPDATE threads SET future_text='later'", [])
        .unwrap();
    let after = list_threads(target.path(), None).unwrap().remove(0);
    assert_ne!(before.metadata_hash, after.metadata_hash);
    assert_ne!(
        before.revision_metadata_hash().unwrap(),
        after.revision_metadata_hash().unwrap()
    );
    assert!(publish_for_test(&prepared, target.path(), Some(&before.metadata_hash)).is_err());
    assert_eq!(
        list_threads(target.path(), None).unwrap()[0].column("future_text"),
        Some(&Value::Text("later".into()))
    );
}

#[test]
fn unrelated_tables_triggers_migrations_and_optional_column_removal_do_not_gate_copy() {
    let source = home();
    let target = home();
    seed(source.path(), "thread", "replacement");
    for side in [source.path(), target.path()] {
        Connection::open(side.join(STATE_FILE)).unwrap().execute_batch("ALTER TABLE threads DROP COLUMN agent_nickname; CREATE TABLE unrelated(id TEXT PRIMARY KEY, value BLOB); INSERT INTO unrelated VALUES ('sentinel',x'00ff'); CREATE TRIGGER unrelated_only AFTER UPDATE ON unrelated BEGIN UPDATE unrelated SET value=x'01' WHERE id=NEW.id; END; INSERT INTO _sqlx_migrations VALUES(999,1);").unwrap();
    }
    let prepared = prepare(source.path(), "thread", &["replacement".into()]).unwrap();
    publish_for_test(&prepared, target.path(), None).unwrap();
    assert_eq!(
        Connection::open(target.path().join(STATE_FILE))
            .unwrap()
            .query_row(
                "SELECT value FROM unrelated WHERE id='sentinel'",
                [],
                |row| row.get::<_, Vec<u8>>(0)
            )
            .unwrap(),
        vec![0, 255]
    );
}

#[test]
fn cross_side_column_difference_preserves_destination_and_pending_snapshot() {
    let source = home();
    let target = home();
    seed(source.path(), "thread", "replacement");
    seed(target.path(), "thread", "replacement");
    let before = list_threads(target.path(), None).unwrap().remove(0);
    Connection::open(source.path().join(STATE_FILE)).unwrap().execute_batch("ALTER TABLE threads ADD COLUMN source_only BLOB; UPDATE threads SET source_only=x'ff';").unwrap();
    let prepared = prepare(source.path(), "thread", &["replacement".into()]).unwrap();
    let journal = tempfile::tempdir().unwrap();
    let snapshot = journal
        .path()
        .canonicalize()
        .unwrap()
        .join("pending.sqlite");
    prepared.persist_snapshot(&snapshot, || Ok(())).unwrap();
    let bytes = std::fs::read(&snapshot).unwrap();
    let recovered = PreparedThread::from_snapshot(&snapshot).unwrap();
    assert!(
        publish_for_test(&recovered, target.path(), Some(&before.metadata_hash))
            .unwrap_err()
            .contains("contracts differ")
    );
    assert_eq!(
        list_threads(target.path(), None).unwrap()[0].metadata_hash,
        before.metadata_hash
    );
    assert_eq!(std::fs::read(snapshot).unwrap(), bytes);
}

#[test]
fn unknown_projection_incoming_foreign_key_is_rejected_without_cascade() {
    let source = home();
    let target = home();
    seed(source.path(), "thread", "replacement");
    seed(target.path(), "thread", "replacement");
    let before = list_threads(target.path(), None).unwrap().remove(0);
    let history = Connection::open(target.path().join(HISTORY_FILE)).unwrap();
    history.execute_batch("CREATE TABLE native_future(thread_id TEXT PRIMARY KEY REFERENCES thread_history_projection_state(thread_id) ON DELETE CASCADE,payload TEXT); INSERT INTO native_future VALUES('replacement','keep');").unwrap();
    let prepared = prepare(source.path(), "thread", &["replacement".into()]).unwrap();
    assert!(
        publish_for_test(&prepared, target.path(), Some(&before.metadata_hash))
            .unwrap_err()
            .contains("foreign-key")
    );
    assert_eq!(
        history
            .query_row("SELECT payload FROM native_future", [], |row| row
                .get::<_, String>(0))
            .unwrap(),
        "keep"
    );
    assert_eq!(
        history
            .query_row("SELECT count(*) FROM thread_items", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        list_threads(target.path(), None).unwrap()[0].metadata_hash,
        before.metadata_hash
    );
}

#[test]
fn unknown_trigger_in_projection_cleanup_chain_cannot_change_unrelated_rows() {
    let source = home();
    let target = home();
    seed(source.path(), "thread", "replacement");
    seed(target.path(), "thread", "replacement");
    let before = list_threads(target.path(), None).unwrap().remove(0);
    let history = Connection::open(target.path().join(HISTORY_FILE)).unwrap();
    history.execute_batch("CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES('keep'); CREATE TRIGGER cascade_surprise AFTER DELETE ON thread_realtime_items BEGIN DELETE FROM sentinel; END;").unwrap();
    let prepared = prepare(source.path(), "thread", &["replacement".into()]).unwrap();
    assert!(
        publish_for_test(&prepared, target.path(), Some(&before.metadata_hash))
            .unwrap_err()
            .contains("trigger")
    );
    assert_eq!(
        history
            .query_row("SELECT value FROM sentinel", [], |row| row
                .get::<_, String>(0))
            .unwrap(),
        "keep"
    );
    assert_eq!(
        history
            .query_row("SELECT count(*) FROM thread_realtime_items", [], |row| row
                .get::<_, i64>(
                0
            ))
            .unwrap(),
        1
    );
}

#[test]
fn unique_replace_policy_cannot_delete_an_unrelated_thread() {
    let source = home();
    let target = home();
    seed(source.path(), "thread", "replacement");
    seed(target.path(), "other", "other-rollout");
    for side in [source.path(), target.path()] {
        let db = Connection::open(side.join(STATE_FILE)).unwrap();
        // The inline policy is preserved by a table rebuild, not an index.
        let sql: String = db
            .query_row(
                "SELECT sql FROM sqlite_master WHERE name='threads'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let sql = sql.replacen(
            "CREATE TABLE threads",
            "CREATE TABLE replacement_threads",
            1,
        );
        let sql = sql.replacen(
            "title TEXT NOT NULL",
            "title TEXT NOT NULL UNIQUE ON CONFLICT REPLACE",
            1,
        );
        db.execute_batch(&format!("{sql}; INSERT INTO replacement_threads SELECT * FROM threads; DROP TABLE threads; ALTER TABLE replacement_threads RENAME TO threads;")).unwrap();
    }
    let prepared = prepare(source.path(), "thread", &["replacement".into()]).unwrap();
    assert!(publish_for_test(&prepared, target.path(), None).is_err());
    let rows = list_threads(target.path(), None).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, "other");
    assert_eq!(
        Connection::open(target.path().join(HISTORY_FILE))
            .unwrap()
            .query_row(
                "SELECT count(*) FROM thread_items WHERE thread_id='replacement'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
}

#[test]
fn pending_legacy_snapshot_still_recovers_without_rewriting_its_bytes() {
    let source = home();
    let target = home();
    seed(source.path(), "thread", "replacement");
    let prepared = prepare(source.path(), "thread", &["replacement".into()]).unwrap();
    let journal = tempfile::tempdir().unwrap();
    let file = tempfile::NamedTempFile::new_in(journal.path().canonicalize().unwrap()).unwrap();
    let legacy = Connection::open(file.path()).unwrap();
    legacy
        .pragma_update(None, "application_id", 0x4f524748_i64)
        .unwrap();
    legacy.pragma_update(None, "user_version", 1_i64).unwrap();
    let meta: &[Column] = &[
        ("singleton", "INTEGER", 1, 1),
        ("version", "INTEGER", 1, 0),
        ("thread_id", "TEXT", 1, 0),
    ];
    let rollouts: &[Column] = &[("position", "INTEGER", 1, 1), ("rollout_id", "TEXT", 1, 0)];
    let tables: Vec<_> = [
        ("snapshot_meta", meta),
        ("snapshot_rollouts", rollouts),
        ("thread_record", THREAD_COLUMNS),
    ]
    .into_iter()
    .chain(HISTORY_TABLES.iter().copied())
    .collect();
    for (name, columns) in &tables {
        let mut definitions = columns
            .iter()
            .map(|column| {
                format!(
                    "{} {}{}",
                    column.0,
                    column.1,
                    if column.2 != 0 { " NOT NULL" } else { "" }
                )
            })
            .collect::<Vec<_>>();
        let mut key = columns
            .iter()
            .filter(|column| column.3 != 0)
            .collect::<Vec<_>>();
        key.sort_by_key(|column| column.3);
        definitions.push(format!(
            "PRIMARY KEY ({})",
            key.iter()
                .map(|column| column.0)
                .collect::<Vec<_>>()
                .join(",")
        ));
        // The v1 writer emitted commas without spaces, and its sealed schema
        // receipt compared normalized DDL exactly. Reproduce that old format.
        legacy
            .execute_batch(&format!("CREATE TABLE {name} ({})", definitions.join(",")))
            .unwrap();
    }
    legacy
        .execute("INSERT INTO snapshot_meta VALUES(1,1,'thread')", [])
        .unwrap();
    legacy
        .execute("INSERT INTO snapshot_rollouts VALUES(0,'replacement')", [])
        .unwrap();
    let source_db = open(source.path(), false, true).unwrap();
    for (name, columns) in tables.into_iter().skip(2) {
        let table = if name == "thread_record" {
            "main.threads".to_string()
        } else {
            format!("history.{name}")
        };
        let mut statement = source_db
            .prepare(&format!("SELECT {} FROM {table}", columns_sql(columns)))
            .unwrap();
        let mut rows = statement.query([]).unwrap();
        while let Some(row) = rows.next().unwrap() {
            let values = row_values(row, columns.len()).unwrap();
            legacy
                .execute(
                    &format!(
                        "INSERT INTO {name} VALUES ({})",
                        vec!["?"; columns.len()].join(",")
                    ),
                    params_from_iter(values.iter()),
                )
                .unwrap();
        }
    }
    drop(legacy);
    let original = std::fs::read(file.path()).unwrap();
    let recovered = PreparedThread::from_snapshot(file.path()).unwrap();
    assert_eq!(
        recovered.record().metadata_hash,
        prepared.record().metadata_hash
    );
    publish_for_test(&recovered, target.path(), None).unwrap();
    assert_eq!(std::fs::read(file.path()).unwrap(), original);
}
