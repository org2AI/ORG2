use super::*;
use std::{fs, path::PathBuf};

struct Fixture(PathBuf);
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
impl Fixture {
    fn new() -> Self {
        let f =
            Self(std::env::temp_dir().join(format!("orgii-switch-test-{}", uuid::Uuid::new_v4())));
        fs::create_dir_all(&f.0).unwrap();
        git(&f.0, &["init", "-b", "main"]).unwrap();
        git(&f.0, &["config", "user.email", "test@example.invalid"]).unwrap();
        git(&f.0, &["config", "user.name", "Test"]).unwrap();
        git(&f.0, &["config", "commit.gpgsign", "false"]).unwrap();
        f.write("file.txt", "base\n");
        f.commit();
        git(&f.0, &["branch", "develop"]).unwrap();
        f
    }
    fn write(&self, p: &str, s: &str) {
        fs::write(self.0.join(p), s).unwrap();
    }
    fn commit(&self) {
        git(&self.0, &["add", "."]).unwrap();
        git(&self.0, &["commit", "-m", "test"]).unwrap();
    }
    fn target(&self) -> SwitchTarget {
        SwitchTarget {
            branch: "develop".into(),
            create: false,
            start_point: None,
        }
    }
    fn execute(&self, strategy: Strategy) -> SwitchResult {
        let target = self.target();
        let p = prepare(&self.0, &target).unwrap();
        assert!(p.blocked.is_none(), "{:?}", p.blocked);
        execute(
            &self.0,
            ExecuteRequest {
                target,
                fingerprint: p.fingerprint,
                strategy,
            },
        )
        .unwrap()
    }
}

#[test]
fn clean_switch_and_same_branch_do_not_create_snapshots() {
    let f = Fixture::new();
    let result = f.execute(Strategy::Leave);
    assert_eq!(result.outcome, Outcome::Switched);
    assert_eq!(result.code, "");
    assert!(result.snapshot_id.is_none());
    assert_eq!(branch(&open(&f.0).unwrap()), "develop");
    assert_eq!(git(&f.0, &["stash", "list"]).unwrap(), "");
    assert!(prepare(&f.0, &f.target()).unwrap().same_branch);
}

#[test]
fn leave_preserves_staged_unstaged_and_untracked_in_the_recovery_snapshot() {
    let f = Fixture::new();
    f.write("file.txt", "staged\n");
    git(&f.0, &["add", "file.txt"]).unwrap();
    f.write("file.txt", "working\n");
    f.write("new.txt", "new\n");
    let r = f.execute(Strategy::Leave);
    let id = r.snapshot_id.unwrap();
    assert_eq!(fs::read_to_string(f.0.join("file.txt")).unwrap(), "base\n");
    assert!(!f.0.join("new.txt").exists());
    let snapshot = load(&open(&f.0).unwrap(), &id).unwrap();
    let oid = snapshot.oid.unwrap();
    assert_eq!(
        git(&f.0, &["show", &format!("{oid}^2:file.txt")]).unwrap(),
        "staged"
    );
    assert_eq!(
        git(&f.0, &["show", &format!("{oid}:file.txt")]).unwrap(),
        "working"
    );
    assert_eq!(
        git(&f.0, &["show", &format!("{oid}^3:new.txt")]).unwrap(),
        "new"
    );
}
#[test]
fn bring_preserves_index_and_new_files() {
    let f = Fixture::new();
    f.write("file.txt", "staged\n");
    git(&f.0, &["add", "file.txt"]).unwrap();
    f.write("new.txt", "new\n");
    let r = f.execute(Strategy::Bring);
    assert_eq!(r.outcome, Outcome::Switched);
    assert_eq!(r.current_branch, "develop");
    assert_eq!(git(&f.0, &["show", ":file.txt"]).unwrap(), "staged");
    assert_eq!(fs::read_to_string(f.0.join("new.txt")).unwrap(), "new\n");
}
#[test]
fn compatible_edits_are_detected_before_checkout() {
    let f = Fixture::new();
    f.write("file.txt", "edit\n");
    let p = prepare(&f.0, &f.target()).unwrap();
    assert_eq!(p.changed_files, vec!["file.txt"]);
    assert_eq!(branch(&open(&f.0).unwrap()), "main");
    assert_eq!(git(&f.0, &["stash", "list"]).unwrap(), "");
}
#[test]
fn same_status_new_content_invalidates_preparation() {
    let f = Fixture::new();
    f.write("file.txt", "first\n");
    let p = prepare(&f.0, &f.target()).unwrap();
    f.write("file.txt", "second\n");
    let r = execute(
        &f.0,
        ExecuteRequest {
            target: f.target(),
            fingerprint: p.fingerprint,
            strategy: Strategy::Leave,
        },
    )
    .unwrap();
    assert_eq!(r.outcome, Outcome::Blocked);
    assert_eq!(r.code, "stale");
    assert_eq!(
        fs::read_to_string(f.0.join("file.txt")).unwrap(),
        "second\n"
    );
    assert_eq!(git(&f.0, &["stash", "list"]).unwrap(), "");
}
#[test]
fn bring_conflicts_reports_destination_and_retains_original() {
    let f = Fixture::new();
    git(&f.0, &["checkout", "develop"]).unwrap();
    f.write("file.txt", "target\n");
    f.commit();
    git(&f.0, &["checkout", "main"]).unwrap();
    f.write("file.txt", "mine\n");
    let r = f.execute(Strategy::Bring);
    assert_eq!(r.outcome, Outcome::SwitchedWithConflicts);
    assert_eq!(r.current_branch, "develop");
    let s = load(&open(&f.0).unwrap(), &r.snapshot_id.unwrap()).unwrap();
    assert_eq!(
        git(&f.0, &["show", &format!("{}:file.txt", s.oid.unwrap())]).unwrap(),
        "mine"
    );
    assert_eq!(r.conflicts, vec!["file.txt"]);
}
#[test]
fn repeated_leave_keeps_existing_snapshots() {
    let f = Fixture::new();
    f.write("file.txt", "first\n");
    let a = f.execute(Strategy::Leave).snapshot_id.unwrap();
    git(&f.0, &["checkout", "main"]).unwrap();
    f.write("file.txt", "second\n");
    let b = f.execute(Strategy::Leave).snapshot_id.unwrap();
    assert_ne!(a, b);
    let repo = open(&f.0).unwrap();
    assert_eq!(load(&repo, &a).unwrap().id, a);
    assert_eq!(load(&repo, &b).unwrap().id, b);
}
#[test]
fn branch_in_another_worktree_blocks_before_stashing() {
    let f = Fixture::new();
    let other = f.0.join("linked");
    git(
        &f.0,
        &["worktree", "add", other.to_str().unwrap(), "develop"],
    )
    .unwrap();
    f.write("file.txt", "edit\n");
    let p = prepare(&f.0, &f.target()).unwrap();
    assert_eq!(p.blocked.unwrap().code, "worktree_branch_in_use");
    assert_eq!(git(&f.0, &["stash", "list"]).unwrap(), "");
}
#[test]
fn shared_repository_lock_releases_on_drop() {
    let f = Fixture::new();
    let repo = open(&f.0).unwrap();
    let guard = lock(&repo).unwrap();
    assert!(lock(&repo).is_err());
    drop(guard);
    assert!(lock(&repo).is_ok());
}
#[test]
fn ignored_collision_is_blocked_before_mutation() {
    let f = Fixture::new();
    git(&f.0, &["checkout", "develop"]).unwrap();
    f.write("ignored.txt", "tracked target\n");
    f.commit();
    git(&f.0, &["checkout", "main"]).unwrap();
    f.write(".gitignore", "ignored.txt\n");
    f.commit();
    f.write("ignored.txt", "precious ignored\n");
    let p = prepare(&f.0, &f.target()).unwrap();
    assert_eq!(p.blocked.unwrap().code, "ignored_collision");
    assert_eq!(
        fs::read_to_string(f.0.join("ignored.txt")).unwrap(),
        "precious ignored\n"
    );
}
#[test]
fn create_defaults_to_bring_and_creates_exactly_once() {
    let f = Fixture::new();
    f.write("file.txt", "edit\n");
    let target = SwitchTarget {
        branch: "new-feature".into(),
        create: true,
        start_point: None,
    };
    let p = prepare(&f.0, &target).unwrap();
    assert_eq!(p.default_strategy, Strategy::Bring);
    let req = ExecuteRequest {
        target,
        fingerprint: p.fingerprint,
        strategy: Strategy::Bring,
    };
    assert_eq!(
        execute(&f.0, req.clone()).unwrap().current_branch,
        "new-feature"
    );
    assert_eq!(execute(&f.0, req).unwrap().outcome, Outcome::Blocked);
}
#[test]
fn interrupted_save_is_recovered_by_operation_id() {
    let f = Fixture::new();
    f.write("file.txt", "edit\n");
    let r = f.execute(Strategy::Leave);
    let repo = open(&f.0).unwrap();
    let mut s = load(&repo, &r.snapshot_id.unwrap()).unwrap();
    s.oid = None;
    s.phase = SnapshotPhase::Saving;
    save(&repo, &s).unwrap();
    assert!(load(&repo, &s.id).unwrap().oid.is_some());
}
#[test]
fn missing_ref_blocks_before_stashing() {
    let f = Fixture::new();
    f.write("file.txt", "edit\n");
    let p = prepare(
        &f.0,
        &SwitchTarget {
            branch: "missing".into(),
            create: false,
            start_point: None,
        },
    )
    .unwrap();
    assert_eq!(p.blocked.unwrap().code, "branch_not_found");
    assert_eq!(git(&f.0, &["stash", "list"]).unwrap(), "");
}
#[test]
fn serialized_contract_has_explicit_strategy_and_actual_branch() {
    let f = Fixture::new();
    let value = serde_json::to_value(prepare(&f.0, &f.target()).unwrap()).unwrap();
    assert_eq!(value["default_strategy"], "leave");
    assert_eq!(value["current_branch"], "main");
    assert!(value["fingerprint"].is_string());
}

#[test]
fn explicit_detached_checkout_preserves_dirty_work() {
    let f = Fixture::new();
    f.write("file.txt", "mine\n");
    let target = SwitchTarget {
        branch: "HEAD".into(),
        create: false,
        start_point: None,
    };
    let p = prepare(&f.0, &target).unwrap();
    assert!(p.blocked.is_none());
    assert!(!p.same_branch);
    let r = execute(
        &f.0,
        ExecuteRequest {
            target,
            fingerprint: p.fingerprint,
            strategy: Strategy::Bring,
        },
    )
    .unwrap();
    assert_eq!(r.outcome, Outcome::Switched);
    assert!(open(&f.0).unwrap().head_detached().unwrap());
    assert_eq!(fs::read_to_string(f.0.join("file.txt")).unwrap(), "mine\n");
}
#[test]
fn explicit_remote_creates_tracking_branch() {
    let f = Fixture::new();
    git(
        &f.0,
        &[
            "remote",
            "add",
            "origin",
            "https://example.invalid/repo.git",
        ],
    )
    .unwrap();
    git(&f.0, &["update-ref", "refs/remotes/origin/feature", "HEAD"]).unwrap();
    let target = SwitchTarget {
        branch: "origin/feature".into(),
        create: false,
        start_point: None,
    };
    let p = prepare(&f.0, &target).unwrap();
    assert_eq!(p.target_branch, "feature");
    let r = execute(
        &f.0,
        ExecuteRequest {
            target,
            fingerprint: p.fingerprint,
            strategy: Strategy::Leave,
        },
    )
    .unwrap();
    assert_eq!(r.current_branch, "feature");
    assert_eq!(
        git(&f.0, &["rev-parse", "--abbrev-ref", "@{upstream}"]).unwrap(),
        "origin/feature"
    );
}
#[test]
fn ongoing_merge_blocks_before_saving() {
    let f = Fixture::new();
    let repo = open(&f.0).unwrap();
    fs::write(repo.path().join("MERGE_HEAD"), head(&repo).unwrap()).unwrap();
    f.write("file.txt", "mine\n");
    let block = prepare(&f.0, &f.target()).unwrap().blocked.unwrap();
    assert_eq!(block.code, "operation_in_progress");
    assert_eq!(block.detail.as_deref(), Some("merge"));
    assert_eq!(git(&f.0, &["stash", "list"]).unwrap(), "");
}
#[test]
fn bring_untracked_collision_keeps_snapshot() {
    let f = Fixture::new();
    git(&f.0, &["checkout", "develop"]).unwrap();
    f.write("new.txt", "target\n");
    f.commit();
    git(&f.0, &["checkout", "main"]).unwrap();
    f.write("new.txt", "mine\n");
    let r = f.execute(Strategy::Bring);
    assert_eq!(r.outcome, Outcome::SwitchedWithConflicts);
    assert_eq!(r.current_branch, "develop");
    assert_eq!(fs::read_to_string(f.0.join("new.txt")).unwrap(), "target\n");
    let s = load(&open(&f.0).unwrap(), &r.snapshot_id.unwrap()).unwrap();
    assert_eq!(
        git(&f.0, &["show", &format!("{}^3:new.txt", s.oid.unwrap())]).unwrap(),
        "mine"
    );
}
#[cfg(unix)]
#[test]
fn executable_bit_change_invalidates_even_when_content_status_stays_modified() {
    use std::os::unix::fs::PermissionsExt;
    let f = Fixture::new();
    f.write("file.txt", "mine\n");
    let p = prepare(&f.0, &f.target()).unwrap();
    fs::set_permissions(f.0.join("file.txt"), fs::Permissions::from_mode(0o755)).unwrap();
    let r = execute(
        &f.0,
        ExecuteRequest {
            target: f.target(),
            fingerprint: p.fingerprint,
            strategy: Strategy::Leave,
        },
    )
    .unwrap();
    assert_eq!(r.outcome, Outcome::Blocked);
}
#[cfg(unix)]
#[test]
fn checkout_hook_failure_reports_actual_branch_and_retains_saved_work() {
    use std::os::unix::fs::PermissionsExt;
    let f = Fixture::new();
    let hook = open(&f.0).unwrap().path().join("hooks/post-checkout");
    fs::write(&hook, "#!/bin/sh\nexit 1\n").unwrap();
    fs::set_permissions(hook, fs::Permissions::from_mode(0o755)).unwrap();
    f.write("file.txt", "mine\n");
    let r = f.execute(Strategy::Bring);
    assert_eq!(r.current_branch, "develop");
    assert_eq!(r.outcome, Outcome::RecoveryRequired);
    assert!(r.snapshot_id.is_some());
}

#[cfg(unix)]
#[test]
fn directory_symlinks_are_saved_as_links_not_treated_as_nested_repositories() {
    use std::os::unix::fs::symlink;
    let f = Fixture::new();
    symlink(".git", f.0.join("link")).unwrap();
    f.commit();
    fs::remove_file(f.0.join("link")).unwrap();
    symlink(".git/objects", f.0.join("link")).unwrap();
    let id = f.execute(Strategy::Leave).snapshot_id.unwrap();
    let snapshot = load(&open(&f.0).unwrap(), &id).unwrap();
    let oid = snapshot.oid.unwrap();
    assert_eq!(
        git(&f.0, &["show", &format!("{oid}:link")]).unwrap(),
        ".git/objects"
    );
}

#[test]
fn leave_reports_a_localizable_code() {
    let f = Fixture::new();
    f.write("file.txt", "mine\n");
    let r = f.execute(Strategy::Leave);
    assert_eq!(r.outcome, Outcome::Switched);
    assert_eq!(r.code, "saved_on_previous");
}
#[test]
fn diverged_upstream_blocks_with_its_own_code() {
    let f = Fixture::new();
    git(
        &f.0,
        &[
            "remote",
            "add",
            "origin",
            "https://example.invalid/repo.git",
        ],
    )
    .unwrap();
    git(&f.0, &["update-ref", "refs/remotes/origin/develop", "HEAD"]).unwrap();
    let block = prepare(
        &f.0,
        &SwitchTarget {
            branch: "origin/develop".into(),
            create: false,
            start_point: None,
        },
    )
    .unwrap()
    .blocked
    .unwrap();
    assert_eq!(block.code, "upstream_mismatch");
}
