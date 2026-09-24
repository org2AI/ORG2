//! Recovery tests run the real reconciliation engine over isolated native
//! schema fixtures. Native GUI acceptance is a separate, required check.
use super::*;
use rusqlite::Connection;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::cell::Cell;
use std::io::Write;

mod last_write_wins;
mod retained_generation;

const THREAD: &str = "01960000-0000-7000-8000-000000000001";
const OTHER: &str = "01960000-0000-7000-8000-000000000002";

struct Fixture {
    _primary: tempfile::TempDir,
    _package: tempfile::TempDir,
    _journal: tempfile::TempDir,
    primary: PathBuf,
    package: PathBuf,
    journal: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let left = store::fixture_home();
        let right = store::fixture_home();
        let journal = tempfile::tempdir().unwrap();
        // macOS /var is a symlink; production intentionally rejects symlinks.
        let primary = left.path().canonicalize().unwrap();
        let package = right.path().canonicalize().unwrap();
        let journal_path = journal.path().canonicalize().unwrap().join("state.json");
        fs::write(
            primary.join("config.toml"),
            "model_provider = 'openai'\nmodel = 'source-model'\n",
        )
        .unwrap();
        fs::write(
            package.join("config.toml"),
            "model_provider = 'orgii'\nmodel = 'market-model'\n",
        )
        .unwrap();
        Self {
            _primary: left,
            _package: right,
            _journal: journal,
            primary,
            package,
            journal: journal_path,
        }
    }

    fn rollout(&self, package: bool) -> PathBuf {
        (if package {
            &self.package
        } else {
            &self.primary
        })
        .join(format!("sessions/{THREAD}.jsonl"))
    }

    fn seed(&self) -> Vec<u8> {
        store::fixture_seed(&self.primary, THREAD, THREAD);
        fs::create_dir_all(self.primary.join("sessions")).unwrap();
        // Keep the original records, ordinals, tool/realtime payloads and
        // compaction record. The engine must not normalize this raw history.
        let records = [
            json!({"ordinal":0,"type":"session_meta","payload":{"id":THREAD,"cwd":"/test","model_provider":"openai","history_mode":"paginated"}}),
            json!({"ordinal":1,"type":"event_msg","payload":{"type":"task_started","turn_id":"turn"}}),
            json!({"ordinal":2,"type":"response_item","payload":{"type":"message","id":"user","role":"user","content":[{"type":"input_text","text":"fixture request"}]}}),
            json!({"ordinal":3,"type":"response_item","payload":{"type":"function_call","name":"fixture","call_id":"call","arguments":"{}"}}),
            json!({"ordinal":4,"type":"response_item","payload":{"type":"function_call_output","call_id":"call","output":"fixture output"}}),
            json!({"ordinal":5,"type":"event_msg","payload":{"type":"realtime_item","id":"audio","raw":"fixture audio"}}),
            json!({"ordinal":6,"type":"compacted","payload":{"message":"fixture compaction","replacement_history":[]}}),
            json!({"ordinal":7,"type":"response_item","payload":{"type":"message","id":"assistant","role":"assistant","content":[{"type":"output_text","text":"fixture reply"}]}}),
            json!({"ordinal":8,"type":"event_msg","payload":{"type":"task_complete","turn_id":"turn"}}),
        ];
        let mut bytes = Vec::new();
        for record in records {
            bytes.extend(serde_json::to_vec(&record).unwrap());
            bytes.push(b'\n');
        }
        bytes.extend(native_settings_line("permission_profile", 9));
        fs::write(self.rollout(false), &bytes).unwrap();
        Connection::open(self.primary.join("thread_history_1.sqlite"))
            .unwrap()
            .execute(
                "UPDATE thread_history_projection_state SET next_rollout_byte_offset=?1,next_rollout_ordinal=10",
                [bytes.len() as i64],
            )
            .unwrap();
        bytes
    }

    /// Native thread/start + its first completed turn need not emit settings.
    /// Keep the projection frontier consistent with that genuine empty case.
    fn seed_without_settings(&self) -> Vec<u8> {
        let bytes = self
            .seed()
            .split_inclusive(|byte| *byte == b'\n')
            .filter(|line| {
                let event: serde_json::Value = serde_json::from_slice(line).unwrap();
                event["payload"]["type"] != "thread_settings_applied"
            })
            .flatten()
            .copied()
            .collect::<Vec<_>>();
        fs::write(self.rollout(false), &bytes).unwrap();
        Connection::open(self.primary.join("thread_history_1.sqlite"))
            .unwrap()
            .execute(
                "UPDATE thread_history_projection_state SET next_rollout_byte_offset=?1,next_rollout_ordinal=9",
                [bytes.len() as i64],
            )
            .unwrap();
        bytes
    }

    fn row_visible(&self) -> bool {
        Connection::open(self.package.join("state_5.sqlite"))
            .unwrap()
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM threads WHERE id=?1)",
                [THREAD],
                |row| row.get(0),
            )
            .unwrap()
    }

    fn run(&self, check: impl Fn() -> Result<(), String>) -> Result<Report, String> {
        reconcile_at(&self.primary, &self.package, &self.journal, None, check)
    }

    fn assert_recovered(&self, original: &[u8]) {
        self.run(|| Ok(())).unwrap();
        assert!(self.row_visible());
        let current = store::list_threads(&self.package, Some(&[THREAD.into()]))
            .unwrap()
            .pop()
            .unwrap()
            .rollout_path;
        let published = fs::read(&current).unwrap();
        assert!(published.starts_with(original));
        let settings: serde_json::Value =
            serde_json::from_slice(&published[original.len()..]).unwrap();
        assert_eq!(settings["payload"]["type"], "thread_settings_applied");
        let route: (String, String) = Connection::open(self.package.join("state_5.sqlite"))
            .unwrap()
            .query_row(
                "SELECT model_provider,model FROM threads WHERE id=?1",
                [THREAD],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(route, ("orgii".into(), "market-model".into()));
        let repeat = self.run(|| Ok(())).unwrap();
        assert_eq!(repeat.copied, 0);
        assert_eq!(repeat.conflicts, 0);
        assert_eq!(fs::read(&current).unwrap(), published);
    }
}

#[test]
fn resumes_pending_publication_after_rename_without_duplicating_settings() {
    let fixture = Fixture::new();
    let original = fixture.seed();
    let injected = Cell::new(false);
    let result = fixture.run(|| {
        if fixture.rollout(true).exists() && !fixture.row_visible() {
            injected.set(true);
        }
        if injected.get() {
            Err("injected after rename".into())
        } else {
            Ok(())
        }
    });
    assert!(
        injected.get(),
        "test never reached the durable rename boundary"
    );
    assert!(result.is_err());
    fixture.assert_recovered(&original);
}

#[test]
fn resumes_pending_publication_after_sql_commit_and_before_ledger_commit() {
    for fail_on_check in [1, 2] {
        let fixture = Fixture::new();
        let original = fixture.seed();
        let observed = Cell::new(0);
        let result = fixture.run(|| {
            if fixture.row_visible() {
                observed.set(observed.get() + 1);
            }
            if observed.get() >= fail_on_check {
                Err("injected after SQL commit".into())
            } else {
                Ok(())
            }
        });
        assert!(
            observed.get() >= fail_on_check,
            "missing owner fence after SQL / before ledger publication"
        );
        assert!(result.is_err());
        fixture.assert_recovered(&original);
    }
}

#[test]
fn recovery_uses_durable_snapshot_when_source_continues_after_interruption() {
    let fixture = Fixture::new();
    fixture.seed();
    let injected = Cell::new(false);
    let result = fixture.run(|| {
        if fixture.rollout(true).exists() && !fixture.row_visible() {
            injected.set(true);
        }
        if injected.get() {
            Err("injected before SQL".into())
        } else {
            Ok(())
        }
    });
    assert!(injected.get());
    assert!(result.is_err());
    let continuation = json!({"ordinal":10,"type":"event_msg","payload":{"type":"task_complete","turn_id":"later"}});
    let mut source = fs::OpenOptions::new()
        .append(true)
        .open(fixture.rollout(false))
        .unwrap();
    writeln!(source, "{continuation}").unwrap();
    source.sync_all().unwrap();
    let current = fs::read(fixture.rollout(false)).unwrap();
    Connection::open(fixture.primary.join("thread_history_1.sqlite")).unwrap().execute("UPDATE thread_history_projection_state SET next_rollout_byte_offset=?1,next_rollout_ordinal=11", [current.len() as i64]).unwrap();
    fixture.assert_recovered(&current);
}

#[test]
fn holds_off_when_native_writer_has_the_destination_and_quiesces_after_copy() {
    let fixture = Fixture::new();
    let original = fixture.seed();
    let lock = WriterLock::acquire(&fixture.package, THREAD).unwrap();
    let busy = fixture.run(|| Ok(())).unwrap();
    assert_eq!(busy.busy, 1);
    assert_eq!(busy.copied, 0);
    assert!(!fixture.rollout(true).exists());
    drop(lock);
    fixture.assert_recovered(&original);
}

#[test]
fn completed_loaded_source_exports_a_fixed_snapshot_without_releasing_its_writer() {
    let fixture = Fixture::new();
    let original = fixture.seed();
    let _source_writer = WriterLock::acquire(&fixture.primary, THREAD).unwrap();
    let copied = fixture.run(|| Ok(())).unwrap();
    assert_eq!(copied.copied, 1);
    assert_eq!(copied.busy, 0);
    assert_eq!(copied.conflicts, 0);
    assert_eq!(
        WriterLock::acquire(&fixture.primary, THREAD)
            .err()
            .as_deref(),
        Some("busy")
    );
    assert_eq!(fs::read(fixture.rollout(false)).unwrap(), original);
    fixture.assert_recovered(&original);
}

#[test]
fn loaded_noncompleted_unprojected_and_legacy_sources_remain_busy() {
    let fixture = Fixture::new();
    let original = fixture.seed();
    let _source_writer = WriterLock::acquire(&fixture.primary, THREAD).unwrap();
    let history = Connection::open(fixture.primary.join("thread_history_1.sqlite")).unwrap();
    let assert_busy = || {
        let report = fixture.run(|| Ok(())).unwrap();
        assert_eq!(report.copied, 0);
        assert_eq!(report.busy, 1);
        assert_eq!(report.conflicts, 0);
        assert!(!fixture.rollout(true).exists());
    };
    history
        .execute("UPDATE thread_turns SET status='inProgress'", [])
        .unwrap();
    assert_busy();
    history
        .execute("UPDATE thread_turns SET status='completed'", [])
        .unwrap();
    history
        .execute(
            "UPDATE thread_history_projection_state SET next_rollout_byte_offset=?1",
            [original.len() as i64 - 1],
        )
        .unwrap();
    assert_busy();
    history.execute("UPDATE thread_history_projection_state SET next_rollout_byte_offset=?1,next_rollout_ordinal=9", [original.len() as i64]).unwrap();
    assert_busy();
    history
        .execute(
            "UPDATE thread_history_projection_state SET next_rollout_ordinal=10",
            [],
        )
        .unwrap();
    Connection::open(fixture.primary.join("state_5.sqlite"))
        .unwrap()
        .execute("UPDATE threads SET history_mode='legacy'", [])
        .unwrap();
    assert_busy();
}

#[test]
fn loaded_source_append_during_staging_discards_the_unpublished_copy() {
    let fixture = Fixture::new();
    let original = fixture.seed();
    let _source_writer = WriterLock::acquire(&fixture.primary, THREAD).unwrap();
    let appended = Cell::new(false);
    let report = fixture.run(|| {
        let staging = fs::read_dir(fixture.package.join("sessions")).ok().is_some_and(|entries| {
            entries.filter_map(Result::ok).any(|entry| entry.file_name().to_str().is_some_and(|name| name.starts_with(".tmp")))
        });
        if staging && !appended.replace(true) {
            let event = json!({"ordinal":10,"type":"event_msg","payload":{"type":"task_started","turn_id":"new-turn"}});
            writeln!(fs::OpenOptions::new().append(true).open(fixture.rollout(false)).unwrap(), "{event}").unwrap();
        }
        Ok(())
    }).unwrap();
    assert!(appended.get(), "test must race with the staging phase");
    assert_eq!(report.copied, 0);
    assert_eq!(report.busy + report.conflicts, 1);
    assert!(!fixture.row_visible());
    assert!(!fixture.rollout(true).exists());
    assert_eq!(
        fs::read_dir(fixture.package.join("sessions"))
            .unwrap()
            .count(),
        0
    );
    assert!(fs::read(fixture.rollout(false))
        .unwrap()
        .starts_with(&original));
    assert!(read_ledger(&fixture.journal).unwrap().pending.is_empty());
}

#[test]
fn a_divergent_pending_target_does_not_block_an_unrelated_thread() {
    let fixture = Fixture::new();
    let original = fixture.seed();
    let injected = Cell::new(false);
    assert!(fixture
        .run(|| {
            if fixture.rollout(true).exists() && !fixture.row_visible() {
                injected.set(true);
            }
            if injected.get() {
                Err("injected after rename".into())
            } else {
                Ok(())
            }
        })
        .is_err());
    assert!(injected.get());
    let external = json!({"ordinal":11,"type":"event_msg","payload":{"type":"task_complete","turn_id":"external"}});
    writeln!(
        fs::OpenOptions::new()
            .append(true)
            .open(fixture.rollout(true))
            .unwrap(),
        "{external}"
    )
    .unwrap();
    let divergent = fs::read(fixture.rollout(true)).unwrap();
    store::fixture_seed(&fixture.primary, OTHER, OTHER);
    let other_bytes = String::from_utf8(original.clone())
        .unwrap()
        .replace(THREAD, OTHER)
        .into_bytes();
    let other_path = fixture.primary.join(format!("sessions/{OTHER}.jsonl"));
    fs::write(&other_path, &other_bytes).unwrap();
    Connection::open(fixture.primary.join("thread_history_1.sqlite")).unwrap().execute("UPDATE thread_history_projection_state SET next_rollout_byte_offset=?1,next_rollout_ordinal=10 WHERE thread_id=?2", rusqlite::params![other_bytes.len() as i64, OTHER]).unwrap();
    let report = fixture.run(|| Ok(())).unwrap();
    assert_eq!(report.copied, 1);
    assert!(report.conflicts >= 1);
    assert_eq!(fs::read(fixture.rollout(true)).unwrap(), divergent);
    assert_eq!(fs::read(fixture.rollout(false)).unwrap(), original);
    let copied = fixture.package.join(format!("sessions/{OTHER}.jsonl"));
    assert!(fs::read(copied).unwrap().starts_with(&other_bytes));
    let ledger = read_ledger(&fixture.journal).unwrap();
    assert!(ledger.pending.contains_key(THREAD));
    assert!(ledger.pairs.contains_key(OTHER));
}

#[test]
fn archive_and_unarchive_preserve_frozen_generations_and_one_catalog_row() {
    let fixture = Fixture::new();
    fixture.seed();
    fixture.run(|| Ok(())).unwrap();
    let source_archived = fixture
        .primary
        .join(format!("archived_sessions/{THREAD}.jsonl"));
    let target_original = fs::read(fixture.rollout(true)).unwrap();
    fs::create_dir_all(source_archived.parent().unwrap()).unwrap();
    fs::rename(fixture.rollout(false), &source_archived).unwrap();
    let state = Connection::open(fixture.primary.join("state_5.sqlite")).unwrap();
    state
        .execute(
            "UPDATE threads SET rollout_path=?1,archived=1,archived_at=123 WHERE id=?2",
            rusqlite::params![source_archived.to_str().unwrap(), THREAD],
        )
        .unwrap();
    let archived = fixture.run(|| Ok(())).unwrap();
    assert_eq!(archived.copied, 1);
    assert_eq!(archived.conflicts, 0);
    assert_eq!(fs::read(fixture.rollout(true)).unwrap(), target_original);
    let target = store::list_threads(&fixture.package, None)
        .unwrap()
        .remove(0);
    let target_archived = target.rollout_path;
    assert!(target_archived.starts_with(fixture.package.join("archived_sessions")));
    assert_ne!(
        target_archived.file_name(),
        fixture.rollout(true).file_name()
    );
    let archived_bytes = fs::read(&target_archived).unwrap();
    assert_eq!(files::inventory(&fixture.package).unwrap().len(), 2);
    fs::rename(&source_archived, fixture.rollout(false)).unwrap();
    state
        .execute(
            "UPDATE threads SET rollout_path=?1,archived=0,archived_at=NULL WHERE id=?2",
            rusqlite::params![fixture.rollout(false).to_str().unwrap(), THREAD],
        )
        .unwrap();
    let restored = fixture.run(|| Ok(())).unwrap();
    assert_eq!(restored.copied, 1);
    assert_eq!(restored.conflicts, 0);
    assert!(fixture.rollout(true).exists());
    assert_eq!(fs::read(&target_archived).unwrap(), archived_bytes);
    assert_eq!(fs::read(fixture.rollout(true)).unwrap(), target_original);
    assert_eq!(files::inventory(&fixture.package).unwrap().len(), 3);
    let rows = store::list_threads(&fixture.package, None).unwrap();
    assert_eq!(rows.len(), 1);
    assert!(rows[0]
        .rollout_path
        .starts_with(fixture.package.join("sessions")));
    assert_eq!(fixture.run(|| Ok(())).unwrap().copied, 0);
}

#[test]
fn pending_fork_cannot_publish_when_its_existing_ancestor_disappeared() {
    let fixture = Fixture::new();
    let original = fixture.seed();
    fixture.run(|| Ok(())).unwrap();
    store::fixture_seed(&fixture.primary, OTHER, OTHER);
    let child = [
        json!({"ordinal":10,"type":"session_meta","payload":{"id":OTHER,"cwd":"/test","model_provider":"openai","history_mode":"paginated","history_base":{"thread_id":THREAD,"end_byte_offset":original.len(),"end_ordinal_exclusive":10}}}),
        json!({"ordinal":11,"type":"event_msg","payload":{"type":"task_complete","turn_id":"child"}}),
    ];
    let mut child_bytes = Vec::new();
    for line in child {
        child_bytes.extend(serde_json::to_vec(&line).unwrap());
        child_bytes.push(b'\n');
    }
    let source_child = fixture.primary.join(format!("sessions/{OTHER}.jsonl"));
    let target_child = fixture.package.join(format!("sessions/{OTHER}.jsonl"));
    fs::write(&source_child, &child_bytes).unwrap();
    Connection::open(fixture.primary.join("thread_history_1.sqlite")).unwrap().execute("UPDATE thread_history_projection_state SET next_rollout_byte_offset=?1,next_rollout_ordinal=12 WHERE thread_id=?2", rusqlite::params![child_bytes.len() as i64, OTHER]).unwrap();
    let child_visible = || -> bool {
        Connection::open(fixture.package.join("state_5.sqlite"))
            .unwrap()
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM threads WHERE id=?1)",
                [OTHER],
                |row| row.get(0),
            )
            .unwrap()
    };
    let injected = Cell::new(false);
    assert!(fixture
        .run(|| {
            if target_child.exists() && !child_visible() {
                injected.set(true);
            }
            if injected.get() {
                Err("injected fork after rename".into())
            } else {
                Ok(())
            }
        })
        .is_err());
    assert!(injected.get());
    assert!(!child_visible());
    let child_before = fs::read(&target_child).unwrap();
    // A native delete during downtime cannot see the not-yet-published child
    // catalog row and may legitimately remove its otherwise unreferenced base.
    fs::remove_file(fixture.rollout(true)).unwrap();
    let recovered = fixture.run(|| Ok(())).unwrap();
    assert_eq!(recovered.copied, 0);
    assert!(recovered.conflicts >= 1);
    assert!(!child_visible());
    assert_eq!(fs::read(&target_child).unwrap(), child_before);
    assert_eq!(fs::read(&source_child).unwrap(), child_bytes);
    assert!(read_ledger(&fixture.journal)
        .unwrap()
        .pending
        .contains_key(OTHER));
}

#[test]
fn revert_preserves_ancestor_and_exports_raw_append_by_immutable_rollout_id() {
    let fixture = Fixture::new();
    let original = fixture.seed();
    fixture.run(|| Ok(())).unwrap();
    let target_ancestor_before = fs::read(fixture.rollout(true)).unwrap();
    // Native revert uses a new immutable rollout ID for the same stable thread.
    store::fixture_seed(&fixture.primary, OTHER, OTHER);
    let state = Connection::open(fixture.primary.join("state_5.sqlite")).unwrap();
    state
        .execute("DELETE FROM threads WHERE id=?1", [OTHER])
        .unwrap();
    let source_replacement = fixture.primary.join(format!("sessions/{OTHER}.jsonl"));
    state
        .execute(
            "UPDATE threads SET rollout_path=?1 WHERE id=?2",
            rusqlite::params![source_replacement.to_str().unwrap(), THREAD],
        )
        .unwrap();
    let records = [
        json!({"ordinal":10,"type":"session_meta","payload":{"id":THREAD,"cwd":"/test","model_provider":"openai","history_mode":"paginated","history_base":{"thread_id":THREAD,"end_byte_offset":original.len(),"end_ordinal_exclusive":10}}}),
        json!({"ordinal":11,"type":"event_msg","payload":{"type":"task_complete","turn_id":"replacement"}}),
    ];
    let mut replacement = Vec::new();
    for record in records {
        replacement.extend(serde_json::to_vec(&record).unwrap());
        replacement.push(b'\n');
    }
    fs::write(&source_replacement, &replacement).unwrap();
    Connection::open(fixture.primary.join("thread_history_1.sqlite")).unwrap().execute("UPDATE thread_history_projection_state SET next_rollout_byte_offset=?1,next_rollout_ordinal=12 WHERE thread_id=?2", rusqlite::params![replacement.len() as i64, OTHER]).unwrap();
    let result = fixture.run(|| Ok(())).unwrap();
    assert_eq!(result.copied, 1);
    assert_eq!(result.conflicts, 0);
    let target_replacement = fixture.package.join(format!("sessions/{OTHER}.jsonl"));
    assert!(fs::read(&target_replacement)
        .unwrap()
        .starts_with(&replacement));
    assert_eq!(
        fs::read(fixture.rollout(true)).unwrap(),
        target_ancestor_before
    );
    let rows = store::list_threads(&fixture.package, None).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, THREAD);
    assert_eq!(rows[0].rollout_path, target_replacement);
    assert_eq!(files::inventory(&fixture.package).unwrap().len(), 2);
    let repeat = fixture.run(|| Ok(())).unwrap();
    assert_eq!(repeat.copied, 0);
    assert_eq!(repeat.conflicts, 0);

    // File invalidation supplies OTHER, while the catalog row retains THREAD.
    // Deliberately do not update portable SQL metadata: this must be driven by
    // the immutable filename identity, not an incidental updated_at change.
    let metadata_before = store::list_threads(&fixture.primary, None).unwrap()[0]
        .metadata_hash
        .clone();
    let raw_append = json!({"ordinal":12,"type":"event_msg","payload":{"type":"user_message","message":"incremental fixture append"}});
    writeln!(
        fs::OpenOptions::new()
            .append(true)
            .open(&source_replacement)
            .unwrap(),
        "{raw_append}"
    )
    .unwrap();
    let current = fs::read(&source_replacement).unwrap();
    let raw_ids = [OTHER.to_owned()];
    let incremental = reconcile_at_with_models(
        &fixture.primary,
        &fixture.package,
        &fixture.journal,
        None,
        ["", ""],
        Some(&raw_ids),
        || Ok(()),
    )
    .unwrap();
    assert_eq!(incremental.copied, 1);
    assert_eq!(incremental.conflicts, 0);
    assert_eq!(
        store::list_threads(&fixture.primary, None).unwrap()[0].metadata_hash,
        metadata_before
    );
    let current_target = store::list_threads(&fixture.package, None)
        .unwrap()
        .remove(0)
        .rollout_path;
    assert_ne!(current_target, target_replacement);
    assert!(fs::read(&current_target).unwrap().starts_with(&current));
    assert!(fs::read(&target_replacement)
        .unwrap()
        .starts_with(&replacement));
    assert_eq!(
        fs::read(fixture.rollout(true)).unwrap(),
        target_ancestor_before
    );
}

#[test]
fn metadata_invalidation_copies_another_threads_title_alongside_raw_file_events() {
    let fixture = Fixture::new();
    let original = fixture.seed();
    store::fixture_seed(&fixture.primary, OTHER, OTHER);
    let other_bytes = String::from_utf8(original)
        .unwrap()
        .replace(THREAD, OTHER)
        .into_bytes();
    fs::write(
        fixture.primary.join(format!("sessions/{OTHER}.jsonl")),
        &other_bytes,
    )
    .unwrap();
    Connection::open(fixture.primary.join("thread_history_1.sqlite")).unwrap().execute("UPDATE thread_history_projection_state SET next_rollout_byte_offset=?1,next_rollout_ordinal=10 WHERE thread_id=?2", rusqlite::params![other_bytes.len() as i64, OTHER]).unwrap();
    assert_eq!(fixture.run(|| Ok(())).unwrap().copied, 2);
    Connection::open(fixture.primary.join("state_5.sqlite"))
        .unwrap()
        .execute(
            "UPDATE threads SET title='renamed only in SQLite' WHERE id=?1",
            [OTHER],
        )
        .unwrap();
    // A's file event and B's WAL-only rename can arrive in the same batch.
    let raw_ids = [THREAD.to_owned()];
    let incremental = reconcile_at_with_models(
        &fixture.primary,
        &fixture.package,
        &fixture.journal,
        None,
        ["", ""],
        Some(&raw_ids),
        || Ok(()),
    )
    .unwrap();
    assert_eq!(incremental.copied, 1);
    assert_eq!(incremental.conflicts, 0);
    let title: String = Connection::open(fixture.package.join("state_5.sqlite"))
        .unwrap()
        .query_row("SELECT title FROM threads WHERE id=?1", [OTHER], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(title, "renamed only in SQLite");
    let quiet = reconcile_at_with_models(
        &fixture.primary,
        &fixture.package,
        &fixture.journal,
        None,
        ["", ""],
        Some(&[]),
        || Ok(()),
    )
    .unwrap();
    assert_eq!(quiet.copied, 0);
    assert_eq!(quiet.conflicts, 0);
}

#[test]
fn pending_recovery_cannot_apply_a_route_chosen_before_target_configuration_changed() {
    let fixture = Fixture::new();
    let source_before = fixture.seed();
    let injected = Cell::new(false);
    assert!(fixture
        .run(|| {
            if fixture.rollout(true).exists() && !fixture.row_visible() {
                injected.set(true);
            }
            if injected.get() {
                Err("injected before SQL".into())
            } else {
                Ok(())
            }
        })
        .is_err());
    assert!(injected.get());
    let target_before = fs::read(fixture.rollout(true)).unwrap();
    let config = b"model_provider = 'other-provider'\nmodel = 'other-model'\n";
    fs::write(fixture.package.join("config.toml"), config).unwrap();
    let recovered = fixture.run(|| Ok(())).unwrap();
    assert_eq!(recovered.copied, 0);
    assert_eq!(recovered.conflicts, 1);
    assert!(!fixture.row_visible());
    assert_eq!(fs::read(fixture.rollout(false)).unwrap(), source_before);
    assert_eq!(fs::read(fixture.rollout(true)).unwrap(), target_before);
    assert_eq!(
        fs::read(fixture.package.join("config.toml")).unwrap(),
        config
    );
    assert!(read_ledger(&fixture.journal)
        .unwrap()
        .pending
        .contains_key(THREAD));
}

#[test]
fn return_direction_waits_for_an_explicit_primary_model_without_probing_it() {
    let fixture = Fixture::new();
    let original = fixture.seed();
    fs::write(
        fixture.primary.join("config.toml"),
        "model_provider = 'openai'\n",
    )
    .unwrap();
    let forward = fixture.run(|| Ok(())).unwrap();
    assert_eq!((forward.copied, forward.busy, forward.conflicts), (1, 0, 0));
    assert!(forward.target_route_pending);
    assert!(fixture.row_visible());
    let published = fs::read(fixture.rollout(true)).unwrap();
    assert!(published.starts_with(&original));
    let mut file = fs::OpenOptions::new()
        .append(true)
        .open(fixture.rollout(true))
        .unwrap();
    std::io::Write::write_all(
        &mut file,
        b"{\"ordinal\":11,\"type\":\"event_msg\",\"payload\":{\"type\":\"task_complete\",\"turn_id\":\"market\"}}\n",
    )
    .unwrap();
    let appended = fs::read(fixture.rollout(true)).unwrap();
    Connection::open(fixture.package.join("thread_history_1.sqlite"))
        .unwrap()
        .execute(
            "UPDATE thread_history_projection_state SET next_rollout_byte_offset=?1,next_rollout_ordinal=12",
            [appended.len() as i64],
        )
        .unwrap();
    Connection::open(fixture.package.join("state_5.sqlite"))
        .unwrap()
        .execute(
            "UPDATE threads SET updated_at=updated_at+1 WHERE id=?1",
            [THREAD],
        )
        .unwrap();
    let deferred = fixture.run(|| Ok(())).unwrap();
    assert_eq!(
        (deferred.copied, deferred.busy, deferred.conflicts),
        (0, 1, 0)
    );
    assert!(deferred.target_route_pending);
    assert_eq!(fs::read(fixture.rollout(false)).unwrap(), original);
    assert!(!fixture
        .primary
        .join(".org2-history-bootstrap.json")
        .exists());
    fs::write(
        fixture.primary.join("config.toml"),
        "model_provider = 'openai'\nmodel = 'source-model'\n",
    )
    .unwrap();
    let returned = fixture.run(|| Ok(())).unwrap();
    assert!(!returned.target_route_pending);
    assert_eq!(
        (returned.copied, returned.busy, returned.conflicts),
        (1, 0, 0)
    );
    assert!(fs::read(fixture.rollout(false))
        .unwrap()
        .starts_with(&appended));
}

#[test]
fn only_recent_primary_conversations_start_crossing_but_shared_and_fork_bases_keep_flowing() {
    let fixture = Fixture::new();
    let original = fixture.seed();
    let state = || Connection::open(fixture.primary.join("state_5.sqlite")).unwrap();
    // THREAD is the oldest conversation; it becomes the base of the newest fork.
    state()
        .execute("UPDATE threads SET updated_at=1 WHERE id=?1", [THREAD])
        .unwrap();
    let id = |index: usize| format!("01960000-0000-7000-8000-0000000001{index:02}");
    let mut ids = Vec::new();
    for index in 0..RECENT_CONVERSATIONS + 2 {
        let id = id(index);
        store::fixture_seed(&fixture.primary, &id, &id);
        let bytes = String::from_utf8(original.clone())
            .unwrap()
            .replace(THREAD, &id)
            .into_bytes();
        fs::write(fixture.primary.join(format!("sessions/{id}.jsonl")), &bytes).unwrap();
        Connection::open(fixture.primary.join("thread_history_1.sqlite")).unwrap().execute("UPDATE thread_history_projection_state SET next_rollout_byte_offset=?1,next_rollout_ordinal=10 WHERE thread_id=?2", rusqlite::params![bytes.len() as i64, id]).unwrap();
        state()
            .execute(
                "UPDATE threads SET updated_at=?1 WHERE id=?2",
                rusqlite::params![100 + index as i64, id],
            )
            .unwrap();
        ids.push(id);
    }
    // The newest conversation is archived and must not count as recent.
    state()
        .execute(
            "UPDATE threads SET archived=1 WHERE id=?1",
            [ids.last().unwrap()],
        )
        .unwrap();
    // The second newest is a fork of the oldest conversation.
    let fork = &ids[ids.len() - 2];
    let child = [
        json!({"ordinal":10,"type":"session_meta","payload":{"id":fork,"cwd":"/test","model_provider":"openai","history_mode":"paginated","history_base":{"thread_id":THREAD,"end_byte_offset":original.len(),"end_ordinal_exclusive":10}}}),
        json!({"ordinal":11,"type":"event_msg","payload":{"type":"task_complete","turn_id":"child"}}),
    ];
    let mut child_bytes = Vec::new();
    for line in child {
        child_bytes.extend(serde_json::to_vec(&line).unwrap());
        child_bytes.push(b'\n');
    }
    fs::write(
        fixture.primary.join(format!("sessions/{fork}.jsonl")),
        &child_bytes,
    )
    .unwrap();
    Connection::open(fixture.primary.join("thread_history_1.sqlite")).unwrap().execute("UPDATE thread_history_projection_state SET next_rollout_byte_offset=?1,next_rollout_ordinal=12 WHERE thread_id=?2", rusqlite::params![child_bytes.len() as i64, fork]).unwrap();

    let mut copied = 0;
    loop {
        let report = fixture.run(|| Ok(())).unwrap();
        assert_eq!(report.conflicts, 0);
        copied += report.copied;
        if !report.more {
            break;
        }
    }
    let package: Vec<String> = Connection::open(fixture.package.join("state_5.sqlite"))
        .unwrap()
        .prepare("SELECT id FROM threads ORDER BY id")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    // 50 recent ones (indices 1..=50, the fork among them) plus the fork base.
    assert_eq!(copied, RECENT_CONVERSATIONS + 1);
    assert_eq!(package.len(), RECENT_CONVERSATIONS + 1);
    assert!(package.contains(&THREAD.to_owned()));
    assert!(package.contains(fork));
    assert!(!package.contains(&ids[0]));
    assert!(!package.contains(ids.last().unwrap()));
    // An already shared conversation keeps syncing even after newer ones push it
    // out of the window, while an unshared old one still does not start.
    state()
        .execute(
            "UPDATE threads SET title='renamed base' WHERE id=?1",
            [THREAD],
        )
        .unwrap();
    let follow_up = fixture.run(|| Ok(())).unwrap();
    assert_eq!((follow_up.copied, follow_up.conflicts), (1, 0));
    assert!(!Connection::open(fixture.package.join("state_5.sqlite"))
        .unwrap()
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM threads WHERE id=?1)",
            [&ids[0]],
            |row| row.get::<_, bool>(0),
        )
        .unwrap());
}

#[test]
fn recovery_accepts_a_target_the_native_app_projected_after_our_rename() {
    let fixture = Fixture::new();
    fixture.seed();
    let injected = Cell::new(false);
    assert!(fixture
        .run(|| {
            if fixture.rollout(true).exists() && !fixture.row_visible() {
                injected.set(true);
            }
            if injected.get() {
                Err("injected before SQL".into())
            } else {
                Ok(())
            }
        })
        .is_err());
    assert!(injected.get());
    let published = fs::read(fixture.rollout(true)).unwrap();
    // The native app opened the conversation before recovery: it listed the
    // file we placed with its own metadata and projected it to the end.
    store::fixture_seed(&fixture.package, THREAD, THREAD);
    Connection::open(fixture.package.join("thread_history_1.sqlite"))
        .unwrap()
        .execute(
            "UPDATE thread_history_projection_state SET next_rollout_byte_offset=?1,next_rollout_ordinal=12 WHERE thread_id=?2",
            rusqlite::params![published.len() as i64, THREAD],
        )
        .unwrap();
    Connection::open(fixture.package.join("state_5.sqlite"))
        .unwrap()
        .execute(
            "UPDATE threads SET updated_at=42, tokens_used=7, model_provider='openai', model='resumed-elsewhere' WHERE id=?1",
            [THREAD],
        )
        .unwrap();
    let recovered = fixture.run(|| Ok(())).unwrap();
    assert_eq!(
        (recovered.copied, recovered.busy, recovered.conflicts),
        (1, 0, 0)
    );
    assert_eq!(fs::read(fixture.rollout(true)).unwrap(), published);
    let (provider, model, updated_at): (String, String, i64) =
        Connection::open(fixture.package.join("state_5.sqlite"))
            .unwrap()
            .query_row(
                "SELECT model_provider,model,updated_at FROM threads WHERE id=?1",
                [THREAD],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
    assert_eq!(
        (provider.as_str(), model.as_str(), updated_at),
        ("orgii", "market-model", 42)
    );
    let ledger = read_ledger(&fixture.journal).unwrap();
    assert!(ledger.pending.is_empty());
    assert!(ledger.pairs.contains_key(THREAD));
    let repeat = fixture.run(|| Ok(())).unwrap();
    assert_eq!((repeat.copied, repeat.conflicts), (0, 0));

    // Recovery accepted native's tokens_used=7 in its portable metadata. A
    // later settings-only open must compare against that accepted row, rather
    // than the older metadata saved in the pre-publication snapshot.
    last_write_wins::append_settings(&fixture.package);
    last_write_wins::append_content(&fixture.primary, "after-native-recovery");
    let source_bytes = fs::read(fixture.rollout(false)).unwrap();
    let continued = fixture.run(|| Ok(())).unwrap();
    assert_eq!(
        (continued.copied, continued.busy, continued.conflicts),
        (1, 0, 0)
    );
    let target = store::list_threads(&fixture.package, Some(&[THREAD.into()]))
        .unwrap()
        .pop()
        .unwrap();
    assert!(fs::read(target.rollout_path)
        .unwrap()
        .starts_with(&source_bytes));
}

#[test]
fn recovery_still_refuses_a_target_the_native_app_continued() {
    let fixture = Fixture::new();
    fixture.seed();
    let injected = Cell::new(false);
    assert!(fixture
        .run(|| {
            if fixture.rollout(true).exists() && !fixture.row_visible() {
                injected.set(true);
            }
            if injected.get() {
                Err("injected before SQL".into())
            } else {
                Ok(())
            }
        })
        .is_err());
    store::fixture_seed(&fixture.package, THREAD, THREAD);
    files::append(
        &fixture.rollout(true),
        &json!({"ordinal":21,"type":"event_msg","payload":{"type":"task_complete","turn_id":"native"}}),
    )
    .unwrap();
    let continued = fs::read(fixture.rollout(true)).unwrap();
    Connection::open(fixture.package.join("thread_history_1.sqlite"))
        .unwrap()
        .execute(
            "UPDATE thread_history_projection_state SET next_rollout_byte_offset=?1,next_rollout_ordinal=22 WHERE thread_id=?2",
            rusqlite::params![continued.len() as i64, THREAD],
        )
        .unwrap();
    Connection::open(fixture.package.join("state_5.sqlite"))
        .unwrap()
        .execute("UPDATE threads SET updated_at=43 WHERE id=?1", [THREAD])
        .unwrap();
    let refused = fixture.run(|| Ok(())).unwrap();
    assert_eq!((refused.copied, refused.conflicts), (0, 1));
    assert_eq!(fs::read(fixture.rollout(true)).unwrap(), continued);
    assert!(read_ledger(&fixture.journal)
        .unwrap()
        .pending
        .contains_key(THREAD));
}

fn native_settings_line(permission_key: &str, ordinal: u64) -> Vec<u8> {
    let mut settings = json!({
        "model":"gpt","model_provider_id":"openai","approval_policy":"on-request",
        "approvals_reviewer":"user","cwd":"/test","collaboration_mode":{"mode":"default","settings":{"model":"gpt","reasoning_effort":null,"developer_instructions":null}},
        "personality":"pragmatic","reasoning_effort":"low","service_tier":"default"
    });
    settings[permission_key] = routing::conservative_permission_profile();
    let mut line = serde_json::to_vec(&json!({"ordinal":ordinal,"type":"event_msg","payload":{
        "type":"thread_settings_applied","thread_id":THREAD,"thread_settings":settings}}))
    .unwrap();
    line.push(b'\n');
    line
}

#[test]
fn authorized_first_turn_without_settings_reconciles_on_full_and_targeted_passes() {
    for changed_files in [None, Some(vec![]), Some(vec![THREAD.into()])] {
        let fixture = Fixture::new();
        let original = fixture.seed_without_settings();
        let report = reconcile_at_with_models(
            &fixture.primary,
            &fixture.package,
            &fixture.journal,
            None,
            ["", ""],
            changed_files.as_deref(),
            || Ok(()),
        )
        .unwrap();
        assert_eq!((report.copied, report.conflicts, report.pending), (1, 0, 0));
        fixture.assert_recovered(&original);
    }
}

#[derive(Debug, PartialEq, Eq)]
struct FixtureFile {
    size: u64,
    sha256: String,
}
type FixtureTree = BTreeMap<PathBuf, Option<FixtureFile>>;
type FixtureSnapshot = [FixtureTree; 3];

fn fixture_tree(path: &Path) -> FixtureTree {
    fn visit(root: &Path, path: &Path, tree: &mut FixtureTree) {
        for entry in fs::read_dir(path).unwrap() {
            let path = entry.unwrap().path();
            let metadata = fs::symlink_metadata(&path).unwrap();
            assert!(!metadata.file_type().is_symlink());
            let relative = path.strip_prefix(root).unwrap().to_owned();
            if metadata.is_dir() {
                tree.insert(relative, None);
                visit(root, &path, tree);
            } else {
                let bytes = fs::read(path).unwrap();
                tree.insert(
                    relative,
                    Some(FixtureFile {
                        size: bytes.len() as u64,
                        sha256: format!("{:x}", Sha256::digest(bytes)),
                    }),
                );
            }
        }
    }
    let mut tree = BTreeMap::new();
    visit(path, path, &mut tree);
    tree
}

fn snapshot(fixture: &Fixture) -> FixtureSnapshot {
    [
        fixture_tree(&fixture.primary),
        fixture_tree(&fixture.package),
        fixture_tree(fixture.journal.parent().unwrap()),
    ]
}

fn assert_snapshot_unchanged(fixture: &Fixture, before: &FixtureSnapshot) {
    let after = snapshot(fixture);
    for (scope, (before, after)) in ["primary", "package", "journal"]
        .into_iter()
        .zip(before.iter().zip(&after))
    {
        let paths = before.keys().chain(after.keys()).collect::<BTreeSet<_>>();
        for path in paths {
            // Report only the differing path, size and digest. Never dump
            // database bytes or transcript contents on assertion failure.
            assert_eq!(
                before.get(path),
                after.get(path),
                "fixture changed: {scope}/{}",
                path.display()
            );
        }
    }
}

fn interrupt_before_sql(fixture: &Fixture) {
    let interrupted = Cell::new(false);
    let result = fixture.run(|| {
        if fixture.rollout(true).exists() && !fixture.row_visible() {
            interrupted.set(true);
        }
        if interrupted.get() {
            Err("fixture authority retired before SQL".into())
        } else {
            Ok(())
        }
    });
    assert!(interrupted.get());
    assert!(result.is_err());
    assert!(read_ledger(&fixture.journal)
        .unwrap()
        .pending
        .contains_key(THREAD));
}

#[test]
fn denied_authority_never_mutates_first_turn_or_pending_recovery() {
    for pending in [false, true] {
        for changed_files in [None, Some(vec![]), Some(vec![THREAD.into()])] {
            let fixture = Fixture::new();
            let original = fixture.seed_without_settings();
            if pending {
                interrupt_before_sql(&fixture);
            }
            let before = snapshot(&fixture);
            let error = reconcile_at_with_models(
                &fixture.primary,
                &fixture.package,
                &fixture.journal,
                None,
                ["", ""],
                changed_files.as_deref(),
                || Err("fixture binary/owner/config authority denied".into()),
            )
            .unwrap_err();
            assert_eq!(error, "fixture binary/owner/config authority denied");
            assert_snapshot_unchanged(&fixture, &before);
            assert!(!fixture.row_visible());
            // Restored authority can recover the same no-sample publication;
            // neither startup nor recovery needs a fabricated settings event.
            fixture.assert_recovered(&original);
        }
    }
}
