//! Retained physical generations are global to both discovery directories,
//! even after another generation becomes the logical thread's current head.
use super::*;

fn current(home: &Path, id: &str) -> PathBuf {
    store::list_threads(home, Some(&[id.into()]))
        .unwrap()
        .pop()
        .unwrap()
        .rollout_path
}

fn projection_rows(home: &Path, id: &str) -> Vec<Vec<Vec<rusqlite::types::Value>>> {
    let database = Connection::open(home.join("thread_history_1.sqlite")).unwrap();
    [
        "thread_history_projection_state",
        "thread_turns",
        "thread_items",
        "thread_realtime_items",
    ]
    .into_iter()
    .map(|table| {
        let mut query = database
            .prepare(&format!(
                "SELECT * FROM {table} WHERE thread_id=?1 ORDER BY 1,2"
            ))
            .unwrap();
        let columns = query.column_count();
        query
            .query_map([id], |row| {
                (0..columns)
                    .map(|column| row.get(column))
                    .collect::<rusqlite::Result<Vec<_>>>()
            })
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
    })
    .collect()
}

#[test]
fn archive_after_alias_retains_old_physical_uuid_and_its_frozen_projections() {
    let fixture = Fixture::new();
    fixture.seed();
    assert_eq!(fixture.run(|| Ok(())).unwrap().copied, 1);
    let retained = fixture.rollout(true);
    let retained_bytes = fs::read(&retained).unwrap();
    let retained_rows = projection_rows(&fixture.package, THREAD);

    // A native source settings append differs from the destination's local
    // settings suffix and therefore publishes the first immutable alias.
    fs::OpenOptions::new()
        .append(true)
        .open(fixture.rollout(false))
        .unwrap()
        .write_all(&native_settings_line("permission_profile", 10))
        .unwrap();
    Connection::open(fixture.primary.join("thread_history_1.sqlite"))
        .unwrap()
        .execute(
            "UPDATE thread_history_projection_state SET next_rollout_byte_offset=?1,next_rollout_ordinal=11 WHERE thread_id=?2",
            rusqlite::params![fs::metadata(fixture.rollout(false)).unwrap().len() as i64, THREAD],
        )
        .unwrap();
    let aliased = fixture.run(|| Ok(())).unwrap();
    assert_eq!((aliased.copied, aliased.conflicts), (1, 0));
    let first_alias = current(&fixture.package, THREAD);
    assert_ne!(first_alias, retained);
    let alias_bytes = fs::read(&first_alias).unwrap();
    assert_eq!(projection_rows(&fixture.package, THREAD), retained_rows);

    let archived = fixture
        .primary
        .join(format!("archived_sessions/{THREAD}.jsonl"));
    fs::create_dir_all(archived.parent().unwrap()).unwrap();
    fs::rename(fixture.rollout(false), &archived).unwrap();
    Connection::open(fixture.primary.join("state_5.sqlite"))
        .unwrap()
        .execute(
            "UPDATE threads SET rollout_path=?1,archived=1,archived_at=123 WHERE id=?2",
            rusqlite::params![archived.to_str().unwrap(), THREAD],
        )
        .unwrap();
    let report = fixture.run(|| Ok(())).unwrap();
    assert_eq!((report.copied, report.busy, report.conflicts), (1, 0, 0));
    let latest = current(&fixture.package, THREAD);
    assert!(latest.starts_with(fixture.package.join("archived_sessions")));
    assert_ne!(latest.file_name(), retained.file_name());
    assert_ne!(latest, first_alias);
    assert!(!fixture
        .package
        .join(format!("archived_sessions/{THREAD}.jsonl"))
        .exists());
    assert_eq!(fs::read(&retained).unwrap(), retained_bytes);
    assert_eq!(fs::read(first_alias).unwrap(), alias_bytes);
    assert_eq!(projection_rows(&fixture.package, THREAD), retained_rows);
    assert_eq!(files::inventory(&fixture.package).unwrap().len(), 3);
    assert_eq!(
        store::list_threads(&fixture.package, None).unwrap().len(),
        1
    );
    let repeat = fixture.run(|| Ok(())).unwrap();
    assert_eq!((repeat.copied, repeat.conflicts, repeat.pending), (0, 0, 0));
}

#[test]
fn fork_reuses_frozen_ancestor_retained_at_another_discovery_path() {
    let fixture = Fixture::new();
    let original = fixture.seed();
    assert_eq!(fixture.run(|| Ok(())).unwrap().copied, 1);
    let retained = fixture
        .package
        .join(format!("archived_sessions/{THREAD}.jsonl"));
    fs::create_dir_all(retained.parent().unwrap()).unwrap();
    fs::rename(fixture.rollout(true), &retained).unwrap();
    Connection::open(fixture.package.join("state_5.sqlite"))
        .unwrap()
        .execute(
            "UPDATE threads SET rollout_path=?1,archived=1,archived_at=123 WHERE id=?2",
            rusqlite::params![retained.to_str().unwrap(), THREAD],
        )
        .unwrap();
    let retained_bytes = fs::read(&retained).unwrap();
    let retained_rows = projection_rows(&fixture.package, THREAD);

    store::fixture_seed(&fixture.primary, OTHER, OTHER);
    let child = fixture.primary.join(format!("sessions/{OTHER}.jsonl"));
    let records = [
        json!({"ordinal":10,"type":"session_meta","payload":{"id":OTHER,"cwd":"/test","model_provider":"openai","history_mode":"paginated","history_base":{"thread_id":THREAD,"end_byte_offset":original.len(),"end_ordinal_exclusive":10}}}),
        json!({"ordinal":11,"type":"event_msg","payload":{"type":"task_complete","turn_id":"child"}}),
    ];
    let bytes = records
        .iter()
        .map(|record| format!("{record}\n"))
        .collect::<String>();
    fs::write(&child, &bytes).unwrap();
    Connection::open(fixture.primary.join("thread_history_1.sqlite"))
        .unwrap()
        .execute(
            "UPDATE thread_history_projection_state SET next_rollout_byte_offset=?1,next_rollout_ordinal=12 WHERE thread_id=?2",
            rusqlite::params![bytes.len() as i64, OTHER],
        )
        .unwrap();

    let report = reconcile_at(
        &fixture.primary,
        &fixture.package,
        &fixture.journal,
        Some(&[OTHER.into()]),
        || Ok(()),
    )
    .unwrap();
    assert_eq!((report.copied, report.busy, report.conflicts), (1, 0, 0));
    assert!(!fixture.rollout(true).exists());
    assert_eq!(fs::read(&retained).unwrap(), retained_bytes);
    assert_eq!(projection_rows(&fixture.package, THREAD), retained_rows);
    assert_eq!(files::inventory(&fixture.package).unwrap().len(), 2);
    assert_eq!(current(&fixture.package, THREAD), retained);
    let child = store::list_threads(&fixture.package, Some(&[OTHER.into()]))
        .unwrap()
        .pop()
        .unwrap();
    let segments = lineage(&fixture.package, &child).unwrap();
    assert_eq!(segments.len(), 2);
    assert_eq!(segments[0].path, retained);
    assert_eq!(segments[0].cutoff, Some(original.len() as u64));
}
