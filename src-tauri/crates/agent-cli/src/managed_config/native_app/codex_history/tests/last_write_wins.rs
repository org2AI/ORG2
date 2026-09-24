//! Exercise the production reconciler, raw native records, projection keys,
//! and durable recovery together. Native GUI evidence remains separate.
use super::*;

fn initialized() -> Fixture {
    let fixture = Fixture::new();
    fixture.seed();
    let report = fixture.run(|| Ok(())).unwrap();
    assert_eq!((report.copied, report.busy, report.conflicts), (1, 0, 0));
    assert!(read_ledger(&fixture.journal).unwrap().pairs[THREAD]
        .revisions
        .is_some());
    fixture
}

fn current(home: &Path) -> PathBuf {
    current_for(home, THREAD)
}

fn current_for(home: &Path, id: &str) -> PathBuf {
    store::list_threads(home, Some(&[id.into()]))
        .unwrap()
        .pop()
        .unwrap()
        .rollout_path
}

fn physical(path: &Path) -> String {
    let name = path.file_stem().unwrap().to_str().unwrap();
    name[name.len() - 36..].to_owned()
}

fn next(path: &Path) -> u64 {
    files::tail(path).unwrap()["ordinal"].as_u64().unwrap() + 1
}

fn checkpoint(home: &Path, path: &Path, ordinal: u64) {
    assert_eq!(
        Connection::open(home.join("thread_history_1.sqlite"))
            .unwrap()
            .execute(
                "UPDATE thread_history_projection_state SET next_rollout_byte_offset=?1,next_rollout_ordinal=?2 WHERE thread_id=?3",
                rusqlite::params![fs::metadata(path).unwrap().len() as i64, ordinal as i64, physical(path)],
            )
            .unwrap(),
        1
    );
}

pub(super) fn append_settings(home: &Path) {
    let path = current(home);
    let ordinal = next(&path);
    fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .unwrap()
        .write_all(&native_settings_line("permission_profile", ordinal))
        .unwrap();
    checkpoint(home, &path, ordinal + 1);
}

/// Model a completed native turn in BOTH owning stores, not just a synthetic
/// filesystem notification or an isolated helper result.
pub(super) fn append_content(home: &Path, marker: &str) {
    append_content_for(home, THREAD, marker);
}

fn append_content_for(home: &Path, id: &str, marker: &str) {
    let path = current_for(home, id);
    let start = fs::metadata(&path).unwrap().len();
    let ordinal = next(&path);
    let user = format!("{marker}-user");
    let assistant = format!("{marker}-assistant");
    let events = [
        json!({"ordinal":ordinal,"type":"response_item","payload":{"type":"message","id":user,"role":"user","content":[{"type":"input_text","text":marker}]}}),
        json!({"ordinal":ordinal+1,"type":"response_item","payload":{"type":"message","id":assistant,"role":"assistant","content":[{"type":"output_text","text":marker}]}}),
        json!({"ordinal":ordinal+2,"type":"event_msg","payload":{"type":"task_complete","turn_id":marker}}),
    ];
    let mut output = fs::OpenOptions::new().append(true).open(&path).unwrap();
    for event in events {
        writeln!(output, "{event}").unwrap();
    }
    output.sync_all().unwrap();
    let end = fs::metadata(&path).unwrap().len();
    let history = Connection::open(home.join("thread_history_1.sqlite")).unwrap();
    history
        .execute(
            "INSERT INTO thread_turns VALUES (?1,?2,?3,'completed',NULL,3,4,1,?4,?5,?6,?7,?8)",
            rusqlite::params![
                physical(&path),
                marker,
                ordinal as i64,
                user,
                assistant,
                start as i64,
                (ordinal + 3) as i64,
                end as i64
            ],
        )
        .unwrap();
    for (item, offset, kind, value) in [
        (
            &user,
            0,
            "userMessage",
            json!({"type":"userMessage","text":marker}),
        ),
        (
            &assistant,
            1,
            "agentMessage",
            json!({"type":"agentMessage","text":marker}),
        ),
    ] {
        history
            .execute(
                "INSERT INTO thread_items VALUES (?1,?2,?3,?4,12,?5,?6,?4)",
                rusqlite::params![
                    physical(&path),
                    marker,
                    item,
                    (ordinal + offset) as i64,
                    value.to_string(),
                    kind
                ],
            )
            .unwrap();
    }
    checkpoint(home, &path, ordinal + 3);
    Connection::open(home.join("state_5.sqlite"))
        .unwrap()
        .execute(
            "UPDATE threads SET title=?1 WHERE id=?2",
            rusqlite::params![marker, id],
        )
        .unwrap();
}

fn dated(home: &Path, seconds: u64) {
    let file = fs::OpenOptions::new()
        .write(true)
        .open(current(home))
        .unwrap();
    file.set_times(
        std::fs::FileTimes::new()
            .set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(seconds)),
    )
    .unwrap();
}

fn assert_route(home: &Path, provider: &str, model: &str) {
    let row = Connection::open(home.join("state_5.sqlite"))
        .unwrap()
        .query_row(
            "SELECT model_provider,model FROM threads WHERE id=?1",
            [THREAD],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .unwrap();
    assert_eq!(row, (provider.into(), model.into()));
}

#[test]
fn later_native_revision_wins_both_directions_and_does_not_rebound() {
    for primary_wins in [true, false] {
        let fixture = initialized();
        append_content(&fixture.primary, "primary-independent-turn");
        append_content(&fixture.package, "package-independent-turn");
        dated(
            &fixture.primary,
            if primary_wins {
                1_700_000_002
            } else {
                1_700_000_001
            },
        );
        dated(
            &fixture.package,
            if primary_wins {
                1_700_000_001
            } else {
                1_700_000_002
            },
        );
        let (winner, loser) = if primary_wins {
            (&fixture.primary, &fixture.package)
        } else {
            (&fixture.package, &fixture.primary)
        };
        let winning = fs::read(current(winner)).unwrap();
        let old_loser = current(loser);
        let frozen = fs::read(&old_loser).unwrap();
        let report = fixture.run(|| Ok(())).unwrap();
        assert_eq!((report.copied, report.conflicts, report.pending), (1, 0, 0));
        assert!(fs::read(current(loser)).unwrap().starts_with(&winning));
        assert_eq!(fs::read(&old_loser).unwrap(), frozen);
        assert_ne!(current(loser), old_loser);
        assert!(!fixture.journal.parent().unwrap().join("backups").exists());
        let recorded = fs::read(&fixture.journal).unwrap();
        for _ in 0..3 {
            let repeat = fixture.run(|| Ok(())).unwrap();
            assert_eq!((repeat.copied, repeat.busy, repeat.conflicts), (0, 0, 0));
            assert_eq!(fs::read(&fixture.journal).unwrap(), recorded);
        }
        assert_route(&fixture.primary, "openai", "source-model");
        assert_route(&fixture.package, "orgii", "market-model");
    }
}

#[test]
fn tied_different_native_revisions_choose_primary_once() {
    let fixture = initialized();
    append_content(&fixture.primary, "primary-tie");
    append_content(&fixture.package, "package-tie");
    dated(&fixture.primary, 1_700_000_000);
    dated(&fixture.package, 1_700_000_000);
    let expected = fs::read(current(&fixture.primary)).unwrap();
    assert_eq!(fixture.run(|| Ok(())).unwrap().copied, 1);
    assert!(fs::read(current(&fixture.package))
        .unwrap()
        .starts_with(&expected));
    assert_eq!(fixture.run(|| Ok(())).unwrap().copied, 0);
}

#[test]
fn unchanged_raw_hash_ignores_mtime_and_does_not_defeat_a_real_edit() {
    let fixture = initialized();
    let previous = read_ledger(&fixture.journal).unwrap().pairs[THREAD]
        .revisions
        .clone()
        .unwrap();
    dated(&fixture.package, 1_710_000_000);
    assert_eq!(fixture.run(|| Ok(())).unwrap().copied, 0);
    let observed = read_ledger(&fixture.journal).unwrap().pairs[THREAD]
        .revisions
        .clone()
        .unwrap();
    assert_eq!(observed, previous);
    append_content(&fixture.primary, "real-content-older-than-touch");
    dated(&fixture.primary, 1_700_000_000);
    let expected = fs::read(current(&fixture.primary)).unwrap();
    assert_eq!(fixture.run(|| Ok(())).unwrap().copied, 1);
    assert!(fs::read(current(&fixture.package))
        .unwrap()
        .starts_with(&expected));
}

#[test]
fn opening_a_thread_later_is_a_native_raw_revision_not_a_special_case() {
    let fixture = initialized();
    append_content(&fixture.primary, "earlier-unique-message");
    dated(&fixture.primary, 1_700_000_000);
    append_settings(&fixture.package);
    dated(&fixture.package, 1_700_000_001);
    let winner = fs::read(current(&fixture.package)).unwrap();
    assert_eq!(fixture.run(|| Ok(())).unwrap().copied, 1);
    let current = fs::read(current(&fixture.primary)).unwrap();
    assert!(current.starts_with(&winner));
    assert!(!String::from_utf8_lossy(&current).contains("earlier-unique-message"));
    assert_eq!(fixture.run(|| Ok(())).unwrap().copied, 0);
}

#[test]
fn metadata_only_revision_uses_the_thread_clock_and_keeps_destination_route() {
    let fixture = initialized();
    for (home, title, time) in [
        (&fixture.primary, "earlier-title", 1_700_000_000),
        (&fixture.package, "later-title", 1_700_000_001),
    ] {
        Connection::open(home.join("state_5.sqlite"))
            .unwrap()
            .execute(
                "UPDATE threads SET title=?1,updated_at=?2,updated_at_ms=?3 WHERE id=?4",
                rusqlite::params![title, time, time * 1000i64, THREAD],
            )
            .unwrap();
    }
    assert_eq!(fixture.run(|| Ok(())).unwrap().copied, 1);
    let title: String = Connection::open(fixture.primary.join("state_5.sqlite"))
        .unwrap()
        .query_row("SELECT title FROM threads WHERE id=?1", [THREAD], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(title, "later-title");
    assert_route(&fixture.primary, "openai", "source-model");
    assert_eq!(fixture.run(|| Ok(())).unwrap().copied, 0);
}

#[test]
fn new_opaque_native_fields_and_rewrites_are_preserved_without_field_admission() {
    let fixture = initialized();
    let path = current(&fixture.package);
    let ordinal = next(&path);
    let event = json!({"ordinal":ordinal,"type":"future_native_record","extra_envelope":{"v":9},"payload":{"new_tool":{"nested":[true,null,"raw"]}}});
    writeln!(
        fs::OpenOptions::new().append(true).open(&path).unwrap(),
        "{event}"
    )
    .unwrap();
    checkpoint(&fixture.package, &path, ordinal + 1);
    let expected = fs::read(&path).unwrap();
    assert_eq!(fixture.run(|| Ok(())).unwrap().copied, 1);
    assert!(fs::read(current(&fixture.primary))
        .unwrap()
        .starts_with(&expected));
    let path = current(&fixture.package);
    let original = fs::read_to_string(&path).unwrap();
    let rewritten = original.replace("fixture request", "rewrite request");
    assert_ne!(original, rewritten);
    fs::write(&path, &rewritten).unwrap();
    checkpoint(&fixture.package, &path, next(&path));
    assert_eq!(fixture.run(|| Ok(())).unwrap().copied, 1);
    assert!(fs::read(current(&fixture.primary))
        .unwrap()
        .starts_with(rewritten.as_bytes()));
}

#[test]
fn target_writer_defers_then_reselects_both_latest_revisions() {
    let fixture = initialized();
    append_content(&fixture.primary, "initial-winner");
    dated(&fixture.primary, 1_700_000_001);
    let lock = WriterLock::acquire(&fixture.package, THREAD).unwrap();
    let waiting = fixture.run(|| Ok(())).unwrap();
    assert_eq!((waiting.copied, waiting.busy, waiting.conflicts), (0, 1, 0));
    append_content(&fixture.package, "newer-while-waiting");
    dated(&fixture.package, 1_700_000_002);
    drop(lock);
    let winner = fs::read(current(&fixture.package)).unwrap();
    assert_eq!(fixture.run(|| Ok(())).unwrap().copied, 1);
    assert!(fs::read(current(&fixture.primary))
        .unwrap()
        .starts_with(&winner));
}

#[test]
fn legacy_pairs_migrate_without_old_settings_classification() {
    for version in [2, 3] {
        for diverged in [false, true] {
            let fixture = initialized();
            let mut ledger: serde_json::Value =
                serde_json::from_slice(&fs::read(&fixture.journal).unwrap()).unwrap();
            ledger["version"] = json!(version);
            ledger["pairs"][THREAD]
                .as_object_mut()
                .unwrap()
                .remove("revisions");
            ledger["pairs"][THREAD]["proofs"] = json!({"old":"ignored bounded migration field"});
            ledger.as_object_mut().unwrap().remove("observations");
            fs::write(&fixture.journal, serde_json::to_vec(&ledger).unwrap()).unwrap();
            if diverged {
                append_content(&fixture.primary, "legacy-left");
                append_content(&fixture.package, "legacy-right");
                dated(&fixture.primary, 1_700_000_000);
                dated(&fixture.package, 1_700_000_001);
            }
            let result = fixture.run(|| Ok(())).unwrap();
            assert_eq!(
                (result.copied, result.conflicts),
                (usize::from(diverged), 0)
            );
            let ledger = read_ledger(&fixture.journal).unwrap();
            assert_eq!(ledger.version, 4);
            assert!(ledger.pairs[THREAD].revisions.is_some());
            assert_eq!(fixture.run(|| Ok(())).unwrap().copied, 0);
        }
    }
}

#[test]
fn future_clock_and_incomplete_native_record_do_not_guess_a_winner() {
    for incomplete in [false, true] {
        let fixture = initialized();
        append_content(&fixture.primary, "unverified");
        if incomplete {
            fs::OpenOptions::new()
                .append(true)
                .open(current(&fixture.primary))
                .unwrap()
                .write_all(b"{\"partial\":")
                .unwrap();
        } else {
            dated(&fixture.primary, 4_000_000_000);
        }
        let before = fs::read(current(&fixture.package)).unwrap();
        let report = fixture.run(|| Ok(())).unwrap();
        assert_eq!(report.copied, 0);
        assert!(report.conflicts + report.busy > 0);
        assert_eq!(fs::read(current(&fixture.package)).unwrap(), before);
    }
}

#[test]
fn busy_destination_and_both_loaded_sides_do_not_hash_repeated_growth() {
    for both_busy in [false, true] {
        let fixture = initialized();
        let _target = WriterLock::acquire(&fixture.package, THREAD).unwrap();
        let source = both_busy.then(|| WriterLock::acquire(&fixture.primary, THREAD).unwrap());
        revision::HASH_READS.with(|value| value.set(0));
        for index in 0..4 {
            append_content(&fixture.primary, &format!("busy-{index}"));
            let report = fixture.run(|| Ok(())).unwrap();
            assert_eq!(
                (report.copied, report.busy, report.conflicts, report.more),
                (0, 1, 0, false)
            );
        }
        assert_eq!(revision::HASH_READS.with(|value| value.get()), 0);
        drop(source);
        drop(_target);
        assert_eq!(fixture.run(|| Ok(())).unwrap().copied, 1);
        revision::HASH_READS.with(|value| value.set(0));
        for _ in 0..3 {
            assert_eq!(fixture.run(|| Ok(())).unwrap().copied, 0);
        }
        assert_eq!(revision::HASH_READS.with(|value| value.get()), 0);
    }
}

#[test]
fn loaded_unfinished_source_does_not_hash_its_growing_rollout() {
    let fixture = initialized();
    let _source = WriterLock::acquire(&fixture.primary, THREAD).unwrap();
    Connection::open(fixture.primary.join("thread_history_1.sqlite"))
        .unwrap()
        .execute("UPDATE thread_turns SET status='inProgress'", [])
        .unwrap();
    revision::HASH_READS.with(|value| value.set(0));
    for _ in 0..3 {
        append_settings(&fixture.primary);
        let report = fixture.run(|| Ok(())).unwrap();
        assert_eq!((report.copied, report.busy, report.conflicts), (0, 1, 0));
    }
    assert_eq!(revision::HASH_READS.with(|value| value.get()), 0);
}

#[test]
fn raw_revision_hash_and_budget_are_bounded_and_owner_cancellable() {
    let fixture = initialized();
    let mut budget = revision::Budget::default();
    for _ in 0..16 {
        assert!(budget.take(1).unwrap());
    }
    assert!(!budget.take(1).unwrap());
    let mut bytes = revision::Budget::default();
    assert!(bytes.take(revision::MAX_BYTES).unwrap());
    assert!(!bytes.take(1).unwrap());
    assert!(revision::Budget::default()
        .take(revision::MAX_BYTES + 1)
        .is_err());
    let path = current(&fixture.primary);
    let before = fs::read(&path).unwrap();
    let calls = Cell::new(0);
    let error = revision::hash(&path, before.len() as u64, &|| {
        calls.set(calls.get() + 1);
        if calls.get() >= 2 {
            Err("owner retired".into())
        } else {
            Ok(())
        }
    })
    .unwrap_err();
    assert_eq!(error, "owner retired");
    assert_eq!(fs::read(&path).unwrap(), before);
}

#[test]
fn old_pending_snapshot_recovers_and_new_opaque_fields_continue_normally() {
    for version in [2, 3] {
        let fixture = Fixture::new();
        fixture.seed_without_settings();
        interrupt_before_sql(&fixture);
        let mut journal: serde_json::Value =
            serde_json::from_slice(&fs::read(&fixture.journal).unwrap()).unwrap();
        journal["version"] = json!(version);
        journal["pending"][THREAD]
            .as_object_mut()
            .unwrap()
            .remove("revisions");
        journal["pending"][THREAD]["proofs"] = json!({"old":"opaque migration input"});
        fs::write(&fixture.journal, serde_json::to_vec(&journal).unwrap()).unwrap();
        let path = current(&fixture.primary);
        let ordinal = next(&path);
        let event = json!({"ordinal":ordinal,"type":"new_native_record","payload":{"unknown_field":{"keep":"verbatim"}}});
        writeln!(
            fs::OpenOptions::new().append(true).open(&path).unwrap(),
            "{event}"
        )
        .unwrap();
        checkpoint(&fixture.primary, &path, ordinal + 1);
        let bytes = fs::read(&path).unwrap();
        let report = fixture.run(|| Ok(())).unwrap();
        assert_eq!((report.copied, report.conflicts, report.pending), (2, 0, 0));
        assert!(fs::read(current(&fixture.package))
            .unwrap()
            .starts_with(&bytes));
        assert_eq!(read_ledger(&fixture.journal).unwrap().version, 4);
        assert_eq!(fixture.run(|| Ok(())).unwrap().copied, 0);
    }
}

#[test]
fn persisted_revision_inputs_are_validated_before_selection() {
    let fixture = initialized();
    let saved: serde_json::Value =
        serde_json::from_slice(&fs::read(&fixture.journal).unwrap()).unwrap();
    for malformed in [json!(0), json!(u64::MAX), json!("not-a-clock")] {
        let mut journal = saved.clone();
        journal["observations"][THREAD] = json!([
            {"version":journal["pairs"][THREAD]["primary"],"revision":journal["pairs"][THREAD]["revisions"][0]}, null
        ]);
        journal["observations"][THREAD][0]["revision"]["written_ns"] = malformed;
        fs::write(&fixture.journal, serde_json::to_vec(&journal).unwrap()).unwrap();
        assert!(read_ledger(&fixture.journal).is_err());
    }
    for field in ["raw", "metadata"] {
        let mut journal = saved.clone();
        journal["pairs"][THREAD]["revisions"][0][field] = json!("not-a-digest");
        fs::write(&fixture.journal, serde_json::to_vec(&journal).unwrap()).unwrap();
        assert!(read_ledger(&fixture.journal).is_err());
    }
    let mut journal = saved.clone();
    journal["pairs"][THREAD]["primary"]["path"] = json!("../escape.jsonl");
    fs::write(&fixture.journal, serde_json::to_vec(&journal).unwrap()).unwrap();
    assert!(read_ledger(&fixture.journal).is_err());
    let mut journal = saved;
    journal["waits"][THREAD] =
        json!({"target":journal["pairs"][THREAD]["package"],"to_package":true,"writers":4});
    fs::write(&fixture.journal, serde_json::to_vec(&journal).unwrap()).unwrap();
    assert!(read_ledger(&fixture.journal).is_err());
}

#[test]
fn first_observation_and_combined_edits_include_later_metadata_time() {
    for first in [false, true] {
        let fixture = initialized();
        append_content(&fixture.primary, "earlier-raw-later-title");
        append_content(&fixture.package, "middle-raw");
        dated(&fixture.primary, 1_700_000_001);
        dated(&fixture.package, 1_700_000_002);
        Connection::open(fixture.primary.join("state_5.sqlite")).unwrap()
            .execute("UPDATE threads SET title='last-title', updated_at=1700000003, updated_at_ms=1700000003000", []).unwrap();
        if first {
            fs::remove_file(&fixture.journal).unwrap();
        }
        let expected = fs::read(current(&fixture.primary)).unwrap();
        let report = fixture.run(|| Ok(())).unwrap();
        assert_eq!((report.copied, report.conflicts), (1, 0));
        assert!(fs::read(current(&fixture.package))
            .unwrap()
            .starts_with(&expected));
        assert_eq!(fixture.run(|| Ok(())).unwrap().copied, 0);
    }
}

#[test]
fn stale_unpublished_selection_cancellation_survives_interruption() {
    for interrupt in [false, true] {
        let fixture = Fixture::new();
        fixture.seed();
        let mutated = Cell::new(false);
        let blocked = Cell::new(false);
        let artifacts = std::cell::RefCell::new(None);
        let result = fixture.run(|| {
            if blocked.get() {
                return Err("cancel interrupted".into());
            }
            if fixture.journal.exists() {
                let ledger = read_ledger(&fixture.journal)?;
                if let Some(pending) = ledger.pending.get(THREAD) {
                    if pending.cancelling && interrupt {
                        blocked.set(true);
                        return Err("cancel interrupted".into());
                    }
                    if !mutated.replace(true) {
                        *artifacts.borrow_mut() = Some(pending.clone());
                        append_settings(&fixture.primary);
                    }
                }
            }
            Ok(())
        });
        assert!(mutated.get());
        assert!(!fixture.row_visible());
        if interrupt {
            assert_eq!(result.unwrap_err(), "cancel interrupted");
            assert!(read_ledger(&fixture.journal).unwrap().pending[THREAD].cancelling);
        } else {
            let report = result.unwrap();
            assert_eq!((report.copied, report.busy, report.pending), (0, 1, 0));
            assert!(report.more);
        }
        let recovered = fixture.run(|| Ok(())).unwrap();
        assert_eq!(
            (recovered.copied, recovered.conflicts, recovered.pending),
            (1, 0, 0)
        );
        let old = artifacts.borrow();
        let old = old.as_ref().unwrap();
        assert!(!old.snapshot.exists());
        assert!(old.files.iter().all(|entry| !entry.staged.exists()));
        assert_eq!(fixture.run(|| Ok(())).unwrap().copied, 0);
    }
}

#[test]
fn deleted_unpaired_side_cannot_be_selected_from_a_stale_observation() {
    let fixture = initialized();
    let mut ledger = read_ledger(&fixture.journal).unwrap();
    let pair = ledger.pairs.remove(THREAD).unwrap();
    ledger.observations.insert(
        THREAD.into(),
        [
            Some(Observation {
                version: pair.primary,
                revision: pair.revisions.unwrap()[0].clone(),
            }),
            None,
        ],
    );
    save(&fixture.journal, &ledger).unwrap();
    Connection::open(fixture.primary.join("state_5.sqlite"))
        .unwrap()
        .execute("DELETE FROM threads WHERE id=?1", [THREAD])
        .unwrap();
    let retained = fs::read(fixture.rollout(false)).unwrap();
    let report = fixture.run(|| Ok(())).unwrap();
    // The row was deleted but its file remains. Existing missing-row safety
    // refuses to resurrect this unregistered history; stale cache cannot win.
    assert_eq!((report.conflicts, report.copied), (1, 0));
    assert!(read_ledger(&fixture.journal).unwrap().observations[THREAD][0].is_none());
    assert!(
        store::list_threads(&fixture.primary, Some(&[THREAD.into()]))
            .unwrap()
            .is_empty()
    );
    assert_eq!(fs::read(fixture.rollout(false)).unwrap(), retained);
}
