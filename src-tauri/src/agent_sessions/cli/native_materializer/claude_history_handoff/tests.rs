use super::*;
use serde_json::json;
#[path = "native_canary.rs"]
mod native_canary;

const SESSION: &str = "e174ae0a-129b-4410-8c88-ae429738d2e9";
const FIRST: &str = "a174ae0a-129b-4410-8c88-ae429738d2e9";
const SECOND: &str = "b174ae0a-129b-4410-8c88-ae429738d2e9";
const THIRD: &str = "c174ae0a-129b-4410-8c88-ae429738d2e9";
fn line(value: Value) -> Vec<u8> {
    let mut bytes = serde_json::to_vec(&value).unwrap();
    bytes.push(b'\n');
    bytes
}
fn message(id: &str, parent: Option<&str>) -> Vec<u8> {
    line(
        json!({"type":"user", "uuid":id, "parentUuid":parent, "sessionId":SESSION, "message":{"role":"user", "content":"fixture"}}),
    )
}
fn append(mut base: Vec<u8>, suffix: Vec<u8>) -> Vec<u8> {
    base.extend(suffix);
    base
}
struct Pair {
    _temp: tempfile::TempDir,
    primary: PathBuf,
    package: PathBuf,
    state: PathBuf,
}
impl Pair {
    fn new(a: &[u8], b: &[u8]) -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        let primary = root.join("primary.jsonl");
        let package = root.join("package.jsonl");
        let state = root.join("state");
        fs::write(&primary, a).unwrap();
        fs::write(&package, b).unwrap();
        Self {
            _temp: temp,
            primary,
            package,
            state,
        }
    }
    fn run(&self) -> Result<Status, Status> {
        self.guarded(|| Ok(()), &Budget::new())
    }
    fn guarded(
        &self,
        guard: impl Fn() -> Result<(), Status>,
        budget: &Budget,
    ) -> Result<Status, Status> {
        storage::reconcile(
            self.primary.parent().unwrap(),
            &self.primary,
            self.package.parent().unwrap(),
            &self.package,
            &self.state,
            SESSION,
            budget,
            &guard,
        )
    }
}
fn mtime(path: &Path, seconds: u64) {
    fs::File::options()
        .write(true)
        .open(path)
        .unwrap()
        .set_times(
            fs::FileTimes::new()
                .set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(seconds)),
        )
        .unwrap();
}
fn raw(label: &str) -> Vec<u8> {
    line(
        json!({"sessionId":SESSION,"type":"future-vendor-record","newField":{"mode":label},
        "message":{"role":"assistant","content":[{"type":"tool_use","name":"FutureTool","input":{"nested":[1,2,3]}}]},
        "permissionMode":"bypassPermissions","parentUuid":"vendor-owned-parent"}),
    )
}
fn metadata_file(pair: &Pair, suffix: &str) -> PathBuf {
    fs::read_dir(&pair.state)
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|path| {
            path.file_name()
                .unwrap()
                .to_string_lossy()
                .ends_with(suffix)
        })
        .unwrap()
}
#[test]
fn raw_unknown_records_survive_bidirectional_handoff_byte_for_byte() {
    let base = message(FIRST, None);
    let pair = Pair::new(&base, &base);
    assert_eq!(pair.run(), Ok(Status::Clean));
    for (to_primary, raw) in [
        (true, append(base, raw("package"))),
        (false, raw("rewritten-primary")),
    ] {
        let (source, target, status) = if to_primary {
            (&pair.package, &pair.primary, Status::SyncedToPrimary)
        } else {
            (&pair.primary, &pair.package, Status::SyncedToPackage)
        };
        fs::write(source, &raw).unwrap();
        assert_eq!(pair.run(), Ok(status));
        assert_eq!(fs::read(target).unwrap(), raw);
        assert_eq!(fs::read(source).unwrap(), raw);
        assert_eq!(pair.run(), Ok(Status::Clean));
        assert!(
            !fs::read_dir(&pair.state).unwrap().any(|e| e
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains("backup"))
        );
    }
}
#[test]
fn one_content_edit_wins_even_when_other_side_only_touched_with_later_mtime() {
    let base = raw("base");
    let pair = Pair::new(&base, &base);
    pair.run().unwrap();
    let changed = raw("package edit");
    fs::write(&pair.package, &changed).unwrap();
    mtime(&pair.package, 10);
    mtime(&pair.primary, 100);
    assert_eq!(pair.run(), Ok(Status::SyncedToPrimary));
    assert_eq!(fs::read(&pair.primary).unwrap(), changed);
    mtime(&pair.primary, 200);
    mtime(&pair.package, 300);
    let receipt_path = metadata_file(&pair, ".json");
    let receipt = fs::read(&receipt_path).unwrap();
    mtime(&receipt_path, 500);
    let receipt_modified = fs::metadata(&receipt_path).unwrap().modified().unwrap();
    assert_eq!(pair.run(), Ok(Status::Clean));
    assert_eq!(fs::read(&receipt_path).unwrap(), receipt);
    assert_eq!(
        fs::metadata(receipt_path).unwrap().modified().unwrap(),
        receipt_modified
    );
}
#[test]
fn simultaneous_edits_choose_newer_native_revision_and_ties_choose_primary() {
    for (left_time, right_time, to_primary) in [(10, 11, true), (11, 10, false), (10, 10, false)] {
        let base = raw("base");
        let pair = Pair::new(&base, &base);
        pair.run().unwrap();
        let left = raw("left");
        let right = raw("right");
        fs::write(&pair.primary, &left).unwrap();
        fs::write(&pair.package, &right).unwrap();
        mtime(&pair.primary, left_time);
        mtime(&pair.package, right_time);
        assert_eq!(
            pair.run(),
            Ok(if to_primary {
                Status::SyncedToPrimary
            } else {
                Status::SyncedToPackage
            })
        );
        let winner = if to_primary { right } else { left };
        assert_eq!(fs::read(&pair.primary).unwrap(), winner);
        assert_eq!(fs::read(&pair.package).unwrap(), winner);
        assert_eq!(pair.run(), Ok(Status::Clean));
    }
}
#[test]
fn rewritten_or_shorter_complete_session_replaces_whole_destination() {
    let base = append(message(FIRST, None), message(SECOND, Some(FIRST)));
    let pair = Pair::new(&base, &base);
    pair.run().unwrap();
    let compact = message(THIRD, None);
    fs::write(&pair.package, &compact).unwrap();
    assert_eq!(pair.run(), Ok(Status::SyncedToPrimary));
    assert_eq!(fs::read(&pair.primary).unwrap(), compact);
}
#[test]
fn malformed_or_foreign_session_never_publishes() {
    for invalid in [
        b"{\"sessionId\":\"unfinished".to_vec(),
        line(json!({"sessionId":FIRST,"new":true})),
        b"[]\n".to_vec(),
        line(json!({"noIdentity":true})),
    ] {
        let base = raw("base");
        let pair = Pair::new(&base, &invalid);
        assert!(pair.run().is_err());
        assert_eq!(fs::read(&pair.primary).unwrap(), base);
        assert_eq!(fs::read(&pair.package).unwrap(), invalid);
    }
}
#[test]
fn writer_and_resource_guards_prevent_publication() {
    let base = raw("base");
    let pair = Pair::new(&base, &raw("new"));
    assert_eq!(
        pair.guarded(|| Err(Status::Busy), &Budget::new()),
        Err(Status::Busy)
    );
    let lock = storage::try_lock(&pair.primary).unwrap();
    assert_eq!(pair.run(), Err(Status::Busy));
    drop(lock);
    let budget = Budget {
        remaining: std::cell::Cell::new(1),
        deadline: std::time::Instant::now() + std::time::Duration::from_secs(1),
    };
    assert_eq!(pair.guarded(|| Ok(()), &budget), Err(Status::Limit));
    assert_eq!(fs::read(&pair.primary).unwrap(), base);
}
#[test]
fn first_import_can_create_a_missing_side_but_receipts_do_not_resurrect_deletions() {
    let base = raw("base");
    let pair = Pair::new(&base, &base);
    fs::remove_file(&pair.package).unwrap();
    assert_eq!(pair.run(), Ok(Status::SyncedToPackage));
    assert_eq!(fs::read(&pair.package).unwrap(), base);
    fs::remove_file(&pair.package).unwrap();
    assert_eq!(pair.run(), Err(Status::Changed));
    assert!(!pair.package.exists());
}
fn interrupt_publication(pair: &Pair, after: bool) {
    let result = pair.guarded(
        || {
            let pending = pair.state.exists()
                && fs::read_dir(&pair.state).unwrap().any(|entry| {
                    entry
                        .unwrap()
                        .file_name()
                        .to_string_lossy()
                        .ends_with(".pending.json")
                });
            let published = fs::read(&pair.primary).unwrap() == fs::read(&pair.package).unwrap();
            if pending && (!after || published) {
                Err(Status::Failed)
            } else {
                Ok(())
            }
        },
        &Budget::new(),
    );
    assert_eq!(result, Err(Status::Failed));
}
#[test]
fn interrupted_publication_before_and_after_commit_recovers_without_backup() {
    for after in [false, true] {
        let base = raw("base");
        let pair = Pair::new(&base, &base);
        pair.run().unwrap();
        let newer = raw("next");
        fs::write(&pair.package, &newer).unwrap();
        interrupt_publication(&pair, after);
        assert_eq!(
            pair.run(),
            Ok(if after {
                Status::Clean
            } else {
                Status::SyncedToPrimary
            })
        );
        assert_eq!(fs::read(&pair.primary).unwrap(), newer);
        assert_eq!(pair.run(), Ok(Status::Clean));
        assert!(!fs::read_dir(&pair.state).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains("pending")
        }));
        assert!(
            !fs::read_dir(pair.primary.parent().unwrap())
                .unwrap()
                .any(|entry| entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .contains("lww-new"))
        );
    }
}
#[test]
fn changed_source_invalidates_unpublished_winner_and_is_observed_again() {
    let base = raw("base");
    let pair = Pair::new(&base, &base);
    pair.run().unwrap();
    fs::write(&pair.package, raw("first")).unwrap();
    interrupt_publication(&pair, false);
    let final_bytes = raw("second");
    fs::write(&pair.package, &final_bytes).unwrap();
    assert_eq!(pair.run(), Ok(Status::SyncedToPrimary));
    assert_eq!(fs::read(&pair.primary).unwrap(), final_bytes);
}
#[test]
fn newer_native_target_or_both_sides_supersede_interrupted_choice() {
    for (after_publish, update_source) in
        [(false, false), (true, false), (false, true), (true, true)]
    {
        let base = raw("base");
        let pair = Pair::new(&base, &base);
        pair.run().unwrap();
        fs::write(&pair.package, raw("first source edit")).unwrap();
        mtime(&pair.package, 10);
        interrupt_publication(&pair, after_publish);
        let target_edit = raw("native target edit");
        fs::write(&pair.primary, &target_edit).unwrap();
        mtime(&pair.primary, 20);
        let source_edit = raw("second source edit");
        if update_source {
            fs::write(&pair.package, &source_edit).unwrap();
            mtime(&pair.package, 30);
        }
        assert_eq!(
            pair.run(),
            Ok(if update_source {
                Status::SyncedToPrimary
            } else {
                Status::SyncedToPackage
            })
        );
        let expected = if update_source {
            source_edit
        } else {
            target_edit
        };
        assert_eq!(fs::read(&pair.primary).unwrap(), expected);
        assert_eq!(fs::read(&pair.package).unwrap(), expected);
        let receipt: Value =
            serde_json::from_slice(&fs::read(metadata_file(&pair, ".json")).unwrap()).unwrap();
        assert_eq!(
            receipt["primary"]["native_ns"],
            if update_source {
                30_000_000_000_u64
            } else {
                20_000_000_000_u64
            }
        );
        assert_eq!(pair.run(), Ok(Status::Clean));
    }
}

#[test]
fn full_stamp_recheck_rejects_same_size_and_restored_mtime_change() {
    let base = raw("base");
    let pair = Pair::new(&base, &base);
    pair.run().unwrap();
    fs::write(&pair.package, raw("aaaa")).unwrap();
    mtime(&pair.package, 10);
    let mutated = std::cell::Cell::new(false);
    let result = pair.guarded(
        || {
            if !mutated.get()
                && pair.state.exists()
                && fs::read_dir(&pair.state).unwrap().any(|entry| {
                    entry
                        .unwrap()
                        .file_name()
                        .to_string_lossy()
                        .ends_with(".pending.json")
                })
            {
                fs::write(&pair.package, raw("bbbb")).unwrap();
                mtime(&pair.package, 10);
                mutated.set(true);
            }
            Ok(())
        },
        &Budget::new(),
    );
    assert_eq!(result, Err(Status::Changed));
    assert_eq!(fs::read(&pair.primary).unwrap(), base);
}
fn fingerprint(bytes: &[u8]) -> Value {
    use sha2::{Digest, Sha256};
    json!({"len":bytes.len(),"hash":format!("{:x}",Sha256::digest(bytes))})
}
fn old_receipt(binding: &Value, a: &[u8], b: &[u8]) -> Value {
    json!({"version":2,"binding":binding,"generation":4,"primary":fingerprint(a),"package":fingerprint(b),"ledger":[{"oldProjection":"opaque migration data"}]})
}
#[test]
fn legacy_projection_receipt_migrates_without_inventing_native_edit() {
    let base = raw("base");
    let pair = Pair::new(&base, &base);
    pair.run().unwrap();
    let path = metadata_file(&pair, ".json");
    let current: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    let other = raw("legacy-projected-view");
    fs::write(&pair.package, &other).unwrap();
    fs::write(
        &path,
        serde_json::to_vec(&old_receipt(&current["binding"], &base, &other)).unwrap(),
    )
    .unwrap();
    assert_eq!(pair.run(), Ok(Status::Clean));
    assert_eq!(fs::read(&pair.primary).unwrap(), base);
    assert_eq!(fs::read(&pair.package).unwrap(), other);
    let receipt: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
    assert_eq!(receipt["version"], 3);
    assert!(receipt.get("ledger").is_none());
    let revised = raw("new native");
    fs::write(&pair.package, &revised).unwrap();
    assert_eq!(pair.run(), Ok(Status::SyncedToPrimary));
    assert_eq!(fs::read(&pair.primary).unwrap(), revised);
}
#[test]
fn legacy_pending_is_only_consumed_with_proven_before_or_after_state() {
    for published in [false, true] {
        let base = raw("base");
        let newer = append(base.clone(), raw("newer"));
        let pair = Pair::new(&base, &base);
        pair.run().unwrap();
        let path = metadata_file(&pair, ".json");
        let current: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        fs::write(
            &path,
            serde_json::to_vec(&old_receipt(&current["binding"], &base, &base)).unwrap(),
        )
        .unwrap();
        fs::write(&pair.package, &newer).unwrap();
        if published {
            fs::write(&pair.primary, &newer).unwrap();
        }
        let pending = path.with_file_name(format!(
            "{}.pending.json",
            current["binding"].as_str().unwrap()
        ));
        let journal = json!({"to_primary":true,"before":fingerprint(&base),"after":fingerprint(&newer),"next":old_receipt(&current["binding"],&newer,&newer)});
        fs::write(&pending, serde_json::to_vec(&journal).unwrap()).unwrap();
        assert_eq!(
            pair.run(),
            Ok(if published {
                Status::Clean
            } else {
                Status::SyncedToPrimary
            })
        );
        assert!(!pending.exists());
        assert_eq!(fs::read(&pair.primary).unwrap(), newer);
    }
}
#[test]
fn scoped_sync_preserves_unknown_runtime_fields() {
    let a = raw("left");
    let b = raw("right");
    let pair = Pair::new(&a, &b);
    mtime(&pair.primary, 10);
    mtime(&pair.package, 11);
    let run = || {
        storage::reconcile_scoped(
            pair.primary.parent().unwrap(),
            &pair.primary,
            pair.package.parent().unwrap(),
            &pair.package,
            &pair.state,
            SESSION,
            &Budget::new(),
            &|| Ok(()),
            storage::Scope {
                binding: "scope",
                cwd: Path::new("/tmp/fixture"),
            },
        )
    };
    assert_eq!(run(), Ok(Status::SyncedToPrimary));
    assert_eq!(fs::read(&pair.primary).unwrap(), b);
    assert_eq!(run(), Ok(Status::Clean));
}
#[test]
fn paths_cannot_escape_scope_via_links_or_parent_components() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    assert_eq!(
        storage::safe(&root, &root.join("child/../escape")),
        Err(Status::Changed)
    );
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&root, root.join("link")).unwrap();
        assert_eq!(
            storage::safe(&root, &root.join("link/session")),
            Err(Status::Changed)
        );
    }
}
struct CatalogFixture {
    _temp: tempfile::TempDir,
    profile: NativeAppProfile,
    roots: Roots,
    cwd: PathBuf,
}
impl CatalogFixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().canonicalize().unwrap();
        let roots = Roots {
            official: home.join("official/sessions"),
            isolated: home.join("package/sessions"),
            primary: home.join("primary-history"),
            package: home.join("package-history"),
            state: home.join("state"),
        };
        let cwd = home.join("project");
        for root in [&roots.official, &roots.isolated] {
            let account = root.join(FIRST);
            fs::create_dir_all(account.join(SECOND)).unwrap();
            fs::write(
                root.parent().unwrap().join("config.json"),
                serde_json::to_vec(&json!({"lastKnownAccountUuid": FIRST})).unwrap(),
            )
            .unwrap();
            if root == &roots.isolated {
                fs::write(
                    account.join(format!("{SECOND}.profile-origin.json")),
                    serde_json::to_vec(&json!({"mode":"local", "org":SECOND})).unwrap(),
                )
                .unwrap();
            }
            for id in [SESSION, THIRD] {
                fs::write(account.join(SECOND).join(format!("{id}.json")), serde_json::to_vec(&json!({"cliSessionId":id,"sessionId":format!("local_{id}"),"cwd":cwd,"title":"Existing history"})).unwrap()).unwrap();
            }
        }
        for root in [&roots.primary, &roots.package] {
            let project = root
                .join("projects")
                .join(sanitize_claude_project_name(&cwd));
            fs::create_dir_all(&project).unwrap();
            for id in [SESSION, THIRD] {
                let first = json!({"type":"user","uuid":FIRST,"parentUuid":null,"sessionId":id,"cwd":cwd,"message":{"role":"user","content":"context"}});
                let second = json!({"type":"user","uuid":SECOND,"parentUuid":FIRST,"sessionId":id,"cwd":cwd,"message":{"role":"user","content":"continuation"}});
                let data = if root == &roots.package {
                    append(line(first), line(second))
                } else {
                    line(first)
                };
                fs::write(project.join(format!("{id}.jsonl")), data).unwrap();
            }
        }
        Self {
            _temp: temp,
            profile: NativeAppProfile::new(
                "claude_desktop",
                "https://example.invalid",
                "history-test",
            )
            .unwrap(),
            roots,
            cwd,
        }
    }
    fn transcript(&self, root: &Path, id: &str) -> PathBuf {
        root.join("projects")
            .join(sanitize_claude_project_name(&self.cwd))
            .join(format!("{id}.jsonl"))
    }
}
impl CatalogFixture {
    fn new_package_session(&self) -> PathBuf {
        let catalog = self
            .roots
            .official
            .join(FIRST)
            .join(SECOND)
            .join(format!("{SESSION}.json"));
        fs::remove_file(catalog).unwrap();
        let primary = self.transcript(&self.roots.primary, SESSION);
        fs::remove_file(primary).unwrap();
        self.roots
            .official
            .join(FIRST)
            .join(SECOND)
            .join(format!("local_{SESSION}.json"))
    }
    fn automatic(
        &self,
        dirty: Option<&HashSet<String>>,
        guard: impl Fn() -> Result<(), Status>,
    ) -> Report {
        automatic::run_at_automatic(
            &self.profile,
            "test-owner",
            dirty,
            guard,
            || Ok(()),
            &self.roots,
        )
    }
}

#[test]
fn automatic_registers_new_conversation_last_and_is_idempotent() {
    let fixture = CatalogFixture::new();
    let catalog = fixture.new_package_session();
    let dirty = HashSet::from([SESSION.to_owned()]);
    let local = fixture
        .roots
        .isolated
        .join(FIRST)
        .join(SECOND)
        .join(format!("{SESSION}.json"));
    let mut row: Value = serde_json::from_slice(&fs::read(&local).unwrap()).unwrap();
    row["permissionMode"] = json!("bypassPermissions");
    row["cuAllowedApps"] = json!(["Finder"]);
    fs::write(&local, serde_json::to_vec(&row).unwrap()).unwrap();
    let first = fixture.automatic(Some(&dirty), || Ok(()));
    assert_eq!(first.status, Status::Clean);
    assert_eq!(first.items[0].status, Status::SyncedToPrimary);
    let published: Value = serde_json::from_slice(&fs::read(&catalog).unwrap()).unwrap();
    assert_eq!(published["permissionMode"], "default");
    assert!(published.get("cuAllowedApps").is_none());
    assert_eq!(published["alwaysAllowedReasons"], json!([]));
    let bytes = fs::read(fixture.transcript(&fixture.roots.primary, SESSION)).unwrap();
    assert_eq!(
        fixture.automatic(Some(&dirty), || Ok(())).status,
        Status::Clean
    );
    assert_eq!(
        fs::read(fixture.transcript(&fixture.roots.primary, SESSION)).unwrap(),
        bytes
    );
}

#[test]
fn automatic_dirty_filter_never_parses_unrelated_transcript_and_empty_is_idle() {
    let fixture = CatalogFixture::new();
    fixture.new_package_session();
    fs::write(
        fixture.transcript(&fixture.roots.package, THIRD),
        b"unknown or unfinished",
    )
    .unwrap();
    assert_eq!(
        fixture.automatic(Some(&HashSet::new()), || Ok(())).status,
        Status::Clean
    );
    assert_eq!(
        fixture
            .automatic(Some(&HashSet::from([SESSION.to_owned()])), || Ok(()))
            .status,
        Status::Clean
    );
}

#[test]
fn automatic_owner_change_after_transcript_publish_recovers_before_catalog() {
    let fixture = CatalogFixture::new();
    let catalog = fixture.new_package_session();
    let primary = fixture.transcript(&fixture.roots.primary, SESSION);
    let dirty = HashSet::from([SESSION.to_owned()]);
    let failed = fixture.automatic(Some(&dirty), || {
        if primary.exists() {
            Err(Status::ScopeChanged)
        } else {
            Ok(())
        }
    });
    assert_eq!(failed.status, Status::ScopeChanged);
    assert!(primary.exists());
    assert!(!catalog.exists());
    assert_eq!(
        fixture.automatic(Some(&dirty), || Ok(())).status,
        Status::Clean
    );
    assert!(catalog.exists());
}

#[test]
fn automatic_registration_never_overwrites_an_interrupted_result_that_changed() {
    let fixture = CatalogFixture::new();
    let catalog = fixture.new_package_session();
    let primary = fixture.transcript(&fixture.roots.primary, SESSION);
    let dirty = HashSet::from([SESSION.to_owned()]);
    assert_eq!(
        fixture
            .automatic(Some(&dirty), || if primary.exists() {
                Err(Status::ScopeChanged)
            } else {
                Ok(())
            })
            .status,
        Status::ScopeChanged
    );
    fs::write(&primary, b"external edit must survive").unwrap();
    assert_eq!(
        fixture.automatic(Some(&dirty), || Ok(())).status,
        Status::Conflict
    );
    assert_eq!(fs::read(&primary).unwrap(), b"external edit must survive");
    assert!(!catalog.exists());
}

#[test]
fn automatic_rejects_archived_uuid_in_inactive_account_and_busy_writer() {
    let fixture = CatalogFixture::new();
    let catalog = fixture.new_package_session();
    let inactive = fixture.roots.official.join(THIRD).join(SECOND);
    fs::create_dir_all(&inactive).unwrap();
    let local = fixture
        .roots
        .isolated
        .join(FIRST)
        .join(SECOND)
        .join(format!("{SESSION}.json"));
    let mut row: Value = serde_json::from_slice(&fs::read(local).unwrap()).unwrap();
    row["isArchived"] = json!(true);
    fs::write(
        inactive.join("archived.json"),
        serde_json::to_vec(&row).unwrap(),
    )
    .unwrap();
    assert_eq!(
        fixture
            .automatic(Some(&HashSet::from([SESSION.to_owned()])), || Ok(()))
            .status,
        Status::Conflict
    );
    assert!(!catalog.exists());
    let blocked = automatic::run_at_automatic(
        &fixture.profile,
        "test-owner",
        None,
        || Ok(()),
        || Err(Status::Busy),
        &fixture.roots,
    );
    assert_eq!(blocked.status, Status::Busy);
    assert!(!fixture.transcript(&fixture.roots.primary, SESSION).exists());
}

#[test]
fn automatic_account_switch_after_publication_keeps_catalog_unpublished() {
    let fixture = CatalogFixture::new();
    let catalog = fixture.new_package_session();
    let primary = fixture.transcript(&fixture.roots.primary, SESSION);
    let report = fixture.automatic(Some(&HashSet::from([SESSION.to_owned()])), || {
        if primary.exists() {
            fs::write(
                fixture.roots.official.parent().unwrap().join("config.json"),
                json!({"lastKnownAccountUuid":THIRD}).to_string(),
            )
            .unwrap();
        }
        Ok(())
    });
    assert_eq!(report.status, Status::ScopeChanged);
    assert!(!catalog.exists());
}

#[test]
fn automatic_registration_preserves_deliberate_title_provenance() {
    for (source, expected) in [
        ("user", "user"),
        ("tool", "tool"),
        ("auto", "auto"),
        ("future-source", "auto"),
    ] {
        let fixture = CatalogFixture::new();
        let target = fixture.new_package_session();
        let local = fixture
            .roots
            .isolated
            .join(FIRST)
            .join(SECOND)
            .join(format!("{SESSION}.json"));
        let mut row: Value = serde_json::from_slice(&fs::read(&local).unwrap()).unwrap();
        row["titleSource"] = json!(source);
        fs::write(&local, serde_json::to_vec(&row).unwrap()).unwrap();
        assert_eq!(fixture.automatic(None, || Ok(())).status, Status::Clean);
        let registered: Value = serde_json::from_slice(&fs::read(target).unwrap()).unwrap();
        assert_eq!(registered["titleSource"], expected);
        // Official updateSession protects user/tool titles from auto generation.
        assert_eq!(
            matches!(registered["titleSource"].as_str(), Some("user" | "tool")),
            matches!(source, "user" | "tool")
        );
    }
}

#[test]
fn registration_keeps_unknown_catalog_fields_local_and_copies_raw_transcript() {
    let fixture = CatalogFixture::new();
    let catalog = fixture.new_package_session();
    let local = fixture
        .roots
        .isolated
        .join(FIRST)
        .join(SECOND)
        .join(format!("{SESSION}.json"));
    let mut row: Value = serde_json::from_slice(&fs::read(&local).unwrap()).unwrap();
    row["futurePermission"] = json!({"allowEverything":true});
    row["permissionMode"] = json!("bypassPermissions");
    fs::write(&local, serde_json::to_vec(&row).unwrap()).unwrap();
    let bytes = raw("unknown native runtime");
    fs::write(fixture.transcript(&fixture.roots.package, SESSION), &bytes).unwrap();
    assert_eq!(
        fixture
            .automatic(Some(&HashSet::from([SESSION.to_owned()])), || Ok(()))
            .status,
        Status::Clean
    );
    assert_eq!(
        fs::read(fixture.transcript(&fixture.roots.primary, SESSION)).unwrap(),
        bytes
    );
    let published: Value = serde_json::from_slice(&fs::read(catalog).unwrap()).unwrap();
    assert!(published.get("futurePermission").is_none());
    assert_eq!(published["permissionMode"], "default");
}

/// Invoked only by an opted-in native canary subprocess, on its two disposable
/// homes. It is the production storage boundary, not a fixture copy operation.
#[test]
#[ignore = "requires explicit disposable native canary handoff request"]
fn native_storage_bridge() {
    let request =
        PathBuf::from(std::env::var_os("ORG2_CLAUDE_HANDOFF_REQUEST").expect("canary request"));
    let input: Value = serde_json::from_slice(&fs::read(&request).unwrap()).unwrap();
    let path = |key: &str| PathBuf::from(input[key].as_str().unwrap());
    let primary = path("primary");
    let package = path("package");
    let state = path("state");
    let cwd = path("cwd");
    let session = input["session"].as_str().unwrap();
    let source = path("source");
    let destination = path("destination");
    assert!(source == primary || source == package);
    assert!(destination == primary || destination == package);
    assert_ne!(source, destination);
    let bytes = fs::read(&source).unwrap();
    let outcome = storage::reconcile_scoped(
        primary.parent().unwrap(),
        &primary,
        package.parent().unwrap(),
        &package,
        &state,
        session,
        &Budget::new(),
        &|| Ok(()),
        storage::Scope {
            binding: "native-raw-roundtrip",
            cwd: &cwd,
        },
    );
    let (status, engine_rejected) = match outcome {
        Ok(status) => (status, false),
        Err(status) => (status, true),
    };
    let target = fs::read(&destination).ok();
    let published =
        !engine_rejected && matches!(status, Status::SyncedToPrimary | Status::SyncedToPackage);
    fs::write(
        path("result"),
        serde_json::to_vec(&json!({"status":status,"engineRejected":engine_rejected,
        "published":published,"rawBytesPreserved":published && target.as_ref()==Some(&bytes),
        "source":fingerprint(&bytes),"target":target.as_deref().map(fingerprint)}))
        .unwrap(),
    )
    .unwrap();
}

#[test]
#[ignore = "requires installed Claude CLI and macOS sandbox-exec; no upstream calls"]
fn native_offline_raw_history_roundtrip_uses_target_configuration() {
    let native = |mut row: Value| {
        row["cwd"] = json!("/tmp/offline-fixture-cwd");
        row["timestamp"] = json!("2026-09-21T00:00:00.000Z");
        row["isSidechain"] = json!(false);
        row
    };
    let bytes:Vec<u8>=[
        native(json!({"type":"user","uuid":FIRST,"parentUuid":null,"sessionId":SESSION,"message":{"role":"user","content":"PACKAGE_USER_CONTEXT_MARKER"}})),
        native(json!({"type":"attachment","uuid":SECOND,"parentUuid":FIRST,"sessionId":SESSION,
            "attachment":{"type":"prompt_snapshot","systemPrompt":["SOURCE_PACKAGE_PROMPT_MARKER"],"tools":[{"name":"Read","description":"SOURCE_PACKAGE_TOOL_MARKER","schema":{"type":"object","properties":{}}}]}})),
        native(json!({"type":"assistant","uuid":THIRD,"parentUuid":SECOND,"sessionId":SESSION,"message":{"role":"assistant","type":"message","id":"msg_fixture","model":"claude-sonnet-4-6","content":[{"type":"text","text":"PACKAGE_ASSISTANT_CONTEXT_MARKER"}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1}}})),
    ].into_iter().flat_map(line).collect();
    let temp = tempfile::tempdir().unwrap();
    let fixture = temp.path().join("raw-resume.jsonl");
    fs::write(&fixture, bytes).unwrap();
    native_canary::run("resume", "offline_resume_fixture.py", Some(&fixture));
}
#[test]
#[ignore = "requires installed Claude CLI and macOS sandbox-exec; no upstream calls"]
fn native_offline_completed_tools_do_not_execute_when_resumed() {
    // The Python fixture creates each completed tool transcript natively shaped;
    // every resume first crosses the real storage bridge to the other home.
    native_canary::run(
        "completed-tools",
        "offline_completed_tools_fixture.py",
        None,
    );
}
#[test]
#[ignore = "requires explicit read-only real transcript paths"]
fn real_transcript_raw_handoff_on_temporary_copies() {
    let a =
        fs::read(std::env::var_os("ORG2_AUDIT_PRIMARY_TRANSCRIPT").expect("primary path")).unwrap();
    let b =
        fs::read(std::env::var_os("ORG2_AUDIT_PACKAGE_TRANSCRIPT").expect("package path")).unwrap();
    let rows = records::rows(&b, &Budget::new()).unwrap();
    let session = rows
        .iter()
        .find_map(|row| row["sessionId"].as_str())
        .unwrap();
    let pair = Pair::new(&a, &b);
    mtime(&pair.primary, 1);
    mtime(&pair.package, 2);
    let run = || {
        storage::reconcile(
            pair.primary.parent().unwrap(),
            &pair.primary,
            pair.package.parent().unwrap(),
            &pair.package,
            &pair.state,
            session,
            &Budget::new(),
            &|| Ok(()),
        )
    };
    assert_eq!(
        run(),
        Ok(if a == b {
            Status::Clean
        } else {
            Status::SyncedToPrimary
        })
    );
    assert_eq!(fs::read(&pair.primary).unwrap(), b);
    assert_eq!(run(), Ok(Status::Clean));
}

#[test]
fn duplicate_session_identity_and_invalid_native_clocks_are_refused() {
    let duplicate =
        format!("{{\"sessionId\":\"{FIRST}\",\"sessionId\":\"{SESSION}\",\"future\":1}}\n");
    let base = raw("base");
    let pair = Pair::new(&base, duplicate.as_bytes());
    assert!(pair.run().is_err());
    for timestamp in [
        0,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
            + 3600,
    ] {
        let pair = Pair::new(&base, &base);
        pair.run().unwrap();
        fs::write(&pair.package, raw("changed")).unwrap();
        mtime(&pair.package, timestamp);
        assert_eq!(pair.run(), Err(Status::Changed));
        assert_eq!(fs::read(&pair.primary).unwrap(), base);
    }
}
#[test]
fn replaced_or_preexisting_stage_is_not_deleted_or_overwritten() {
    for pending in [false, true] {
        let base = raw("base");
        let pair = Pair::new(&base, &base);
        pair.run().unwrap();
        let value: Value =
            serde_json::from_slice(&fs::read(metadata_file(&pair, ".json")).unwrap()).unwrap();
        let stage = pair.primary.with_file_name(format!(
            ".primary.jsonl.{}.lww-new.jsonl",
            value["binding"].as_str().unwrap()
        ));
        fs::write(&pair.package, raw("changed")).unwrap();
        if pending {
            interrupt_publication(&pair, false);
        }
        let unknown = b"unknown existing staging data";
        fs::write(&stage, unknown).unwrap();
        assert_eq!(pair.run(), Err(Status::Conflict));
        assert_eq!(fs::read(stage).unwrap(), unknown);
        assert_eq!(fs::read(&pair.primary).unwrap(), base);
        if pending {
            assert!(metadata_file(&pair, ".pending.json").exists());
        }
    }
}
#[test]
fn malformed_receipt_hash_cannot_be_used_as_publication_evidence() {
    let base = raw("base");
    let pair = Pair::new(&base, &base);
    pair.run().unwrap();
    let path = metadata_file(&pair, ".json");
    let mut value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    value["primary"]["content"]["hash"] = json!("not-a-hash");
    fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();
    assert_eq!(pair.run(), Err(Status::Unsupported));
    assert_eq!(fs::read(&pair.primary).unwrap(), base);
}

#[cfg(unix)]
#[test]
fn initial_publication_recovers_crash_between_link_and_stage_unlink() {
    let bytes = raw("new raw session");
    let pair = Pair::new(&bytes, &bytes);
    fs::remove_file(&pair.primary).unwrap();
    assert_eq!(
        pair.guarded(
            || {
                if pair.state.exists()
                    && fs::read_dir(&pair.state).unwrap().any(|entry| {
                        entry
                            .unwrap()
                            .file_name()
                            .to_string_lossy()
                            .ends_with(".pending.json")
                    })
                {
                    Err(Status::Failed)
                } else {
                    Ok(())
                }
            },
            &Budget::new()
        ),
        Err(Status::Failed)
    );
    let pending = metadata_file(&pair, ".pending.json");
    let value: Value = serde_json::from_slice(&fs::read(&pending).unwrap()).unwrap();
    let stage = pair.primary.with_file_name(format!(
        ".primary.jsonl.{}.lww-new.jsonl",
        value["binding"].as_str().unwrap()
    ));
    fs::write(&stage, &bytes).unwrap();
    fs::hard_link(&stage, &pair.primary).unwrap();
    assert_eq!(pair.run(), Ok(Status::Clean));
    assert_eq!(fs::read(&pair.primary).unwrap(), bytes);
    assert!(!stage.exists());
    assert!(!pending.exists());
}
