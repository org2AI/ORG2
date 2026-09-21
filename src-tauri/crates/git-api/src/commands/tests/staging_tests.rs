use crate::commands::staging::discard_changes;

fn git_in(dir: &std::path::Path, args: &[&str]) {
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .args([
            "-c",
            "user.email=t@t",
            "-c",
            "user.name=t",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "init.defaultBranch=main",
        ])
        .args(args)
        .output()
        .expect("spawn git");
    assert!(
        out.status.success(),
        "git {:?} failed: {}{}",
        args,
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
}

fn make_repo(tag: &str) -> std::path::PathBuf {
    let repo = std::env::temp_dir().join(format!(
        "orgii-staging-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock after epoch")
            .as_nanos()
    ));
    let _ = std::fs::remove_dir_all(&repo);
    std::fs::create_dir_all(&repo).expect("create test repo dir");
    git_in(&repo, &["init"]);
    git_in(
        &repo,
        &["config", "core.hooksPath", ".git/audit-disabled-hooks"],
    );
    std::fs::write(repo.join("tracked.txt"), "one\n").expect("write tracked");
    git_in(&repo, &["add", "."]);
    git_in(&repo, &["commit", "-m", "init"]);
    repo
}

fn git_available() -> bool {
    std::process::Command::new("git")
        .arg("--version")
        .output()
        .is_ok()
}

/// Regression: `git status --porcelain` (without -z) quotes-and-escapes
/// non-ASCII paths, so the parsed name never matched the real file —
/// "discard all" silently skipped it while reporting success, and a targeted
/// discard errored with "pathspec did not match".
#[test]
fn discard_all_removes_non_ascii_untracked_files() {
    if !git_available() {
        eprintln!("skipping: git executable not available");
        return;
    }
    let repo = make_repo("quotepath");

    std::fs::write(repo.join("émoji café.txt"), "untracked\n").expect("write unicode file");
    std::fs::write(repo.join("tracked.txt"), "one\ndirty\n").expect("dirty tracked");

    discard_changes(&repo, &[".".to_string()]).expect("discard all");

    assert!(
        !repo.join("émoji café.txt").exists(),
        "quoted-path untracked file must be deleted, not silently skipped"
    );
    assert_eq!(
        std::fs::read_to_string(repo.join("tracked.txt")).expect("read tracked"),
        "one\n",
        "tracked edit must be discarded"
    );

    let _ = std::fs::remove_dir_all(&repo);
}

/// Regression: a staged rename used to parse as the literal path
/// "old -> new", matching nothing — the discard errored out (targeted) or
/// skipped the rename (discard all).
#[test]
fn discard_all_undoes_a_staged_rename() {
    if !git_available() {
        eprintln!("skipping: git executable not available");
        return;
    }
    let repo = make_repo("rename");

    git_in(&repo, &["mv", "tracked.txt", "renamed.txt"]);

    discard_changes(&repo, &[".".to_string()]).expect("discard all");

    assert!(
        repo.join("tracked.txt").exists(),
        "original path must be restored"
    );
    assert!(
        !repo.join("renamed.txt").exists(),
        "rename target must be removed"
    );
    let status = std::process::Command::new("git")
        .arg("-C")
        .arg(&repo)
        .args(["status", "--porcelain"])
        .output()
        .expect("status");
    assert!(
        status.stdout.is_empty(),
        "tree must be clean after discard: {}",
        String::from_utf8_lossy(&status.stdout)
    );

    let _ = std::fs::remove_dir_all(&repo);
}

#[test]
fn targeted_discard_restores_a_single_dirty_file() {
    if !git_available() {
        eprintln!("skipping: git executable not available");
        return;
    }
    let repo = make_repo("targeted");

    std::fs::write(repo.join("tracked.txt"), "one\ndirty\n").expect("dirty tracked");
    std::fs::write(repo.join("other.txt"), "keep me\n").expect("write other");

    discard_changes(&repo, &["tracked.txt".to_string()]).expect("targeted discard");

    assert_eq!(
        std::fs::read_to_string(repo.join("tracked.txt")).expect("read tracked"),
        "one\n"
    );
    assert!(
        repo.join("other.txt").exists(),
        "unrelated untracked file must be untouched"
    );

    let _ = std::fs::remove_dir_all(&repo);
}

struct Fixture(std::path::PathBuf);
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn read_git(repo: &std::path::Path, args: &[&str]) -> String {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).into_owned()
}

#[test]
fn stage_and_unstage_treat_leading_option_and_revision_names_as_files() {
    use crate::commands::staging::{stage_file, unstage_files};
    let fixture = Fixture(make_repo("literal-option"));
    let repo = &fixture.0;
    for name in ["--all", "HEAD", "unselected.txt"] {
        std::fs::write(repo.join(name), "new\n").unwrap();
    }
    for name in ["--all", "HEAD"] {
        stage_file(repo, name).unwrap();
    }
    let staged = read_git(repo, &["diff", "--cached", "--name-only", "-z"]);
    assert!(staged.split('\0').any(|name| name == "--all"));
    assert!(staged.split('\0').any(|name| name == "HEAD"));
    assert!(!staged.contains("unselected.txt"));
    unstage_files(repo, &["HEAD".into(), "--all".into()]).unwrap();
    assert!(read_git(repo, &["diff", "--cached", "--name-only"]).is_empty());
    assert!(repo.join("unselected.txt").exists());
}

#[cfg(unix)]
#[test]
fn file_mutations_preserve_unselected_paths_matching_glob_or_magic() {
    use crate::commands::staging::{stage_file, unstage_files};
    let fixture = Fixture(make_repo("literal-patterns"));
    let repo = &fixture.0;
    let selected = ["*.txt", ":(glob)*.txt", "[ab].txt"];
    for name in selected.into_iter().chain(["private.txt", "a.txt"]) {
        std::fs::write(repo.join(name), "base\n").unwrap();
    }
    git_in(repo, &["add", "."]);
    git_in(repo, &["commit", "-m", "patterns"]);
    for name in selected.into_iter().chain(["private.txt", "a.txt"]) {
        std::fs::write(repo.join(name), "edited\n").unwrap();
    }
    for name in selected {
        stage_file(repo, name).unwrap();
    }
    let staged = read_git(repo, &["diff", "--cached", "--name-only", "-z"]);
    assert!(!staged.contains("private.txt"));
    assert!(!staged.split('\0').any(|p| p == "a.txt"));
    unstage_files(repo, &selected.map(String::from)).unwrap();
    assert!(read_git(repo, &["diff", "--cached", "--name-only"]).is_empty());
    crate::commands::merge::reset_file(repo, "*.txt", "HEAD").unwrap();
    assert_eq!(
        std::fs::read_to_string(repo.join("private.txt")).unwrap(),
        "edited\n"
    );
    discard_changes(repo, &selected.map(String::from)).unwrap();
    for name in selected {
        assert_eq!(std::fs::read_to_string(repo.join(name)).unwrap(), "base\n");
    }
    for name in ["private.txt", "a.txt"] {
        assert_eq!(
            std::fs::read_to_string(repo.join(name)).unwrap(),
            "edited\n"
        );
    }
}

#[test]
fn discard_checks_index_prerequisite_before_any_delete_and_can_retry() {
    let fixture = Fixture(make_repo("locked-prerequisite"));
    let repo = &fixture.0;
    std::fs::write(repo.join("new.txt"), "staged content\n").unwrap();
    std::fs::write(repo.join("untracked.txt"), "keep until reset succeeds\n").unwrap();
    std::fs::write(repo.join("tracked.txt"), "staged modification\n").unwrap();
    git_in(repo, &["add", "new.txt", "tracked.txt"]);
    let index = std::fs::read(repo.join(".git/index")).unwrap();
    std::fs::write(repo.join(".git/index.lock"), "test-owned lock").unwrap();
    let files = vec![
        "untracked.txt".into(),
        "new.txt".into(),
        "tracked.txt".into(),
    ];
    let error = discard_changes(repo, &files).unwrap_err();
    assert!(error.contains("index.lock"));
    assert_eq!(std::fs::read(repo.join(".git/index")).unwrap(), index);
    assert!(repo.join("untracked.txt").exists());
    assert!(repo.join("new.txt").exists());
    assert_eq!(
        std::fs::read_to_string(repo.join("tracked.txt")).unwrap(),
        "staged modification\n"
    );
    std::fs::remove_file(repo.join(".git/index.lock")).unwrap();
    discard_changes(repo, &files).unwrap();
    assert!(!repo.join("new.txt").exists());
    assert!(!repo.join("untracked.txt").exists());
    assert_eq!(
        std::fs::read_to_string(repo.join("tracked.txt")).unwrap(),
        "one\n"
    );
    assert!(read_git(repo, &["status", "--porcelain"]).is_empty());
}

#[test]
fn discard_initial_commit_and_explicit_bulk_keep_existing_semantics() {
    use crate::commands::staging::{stage_file, unstage_files};
    let fixture = Fixture(make_repo("unborn-and-bulk"));
    let repo = &fixture.0;
    // Delete only this disposable fixture's initial branch, producing unborn HEAD.
    git_in(repo, &["update-ref", "-d", "HEAD"]);
    std::fs::write(repo.join("other.txt"), "other\n").unwrap();
    stage_file(repo, ".").unwrap();
    unstage_files(repo, &[".".into()]).unwrap();
    assert!(read_git(repo, &["ls-files"]).is_empty());
    stage_file(repo, ".").unwrap();
    discard_changes(repo, &[".".into()]).unwrap();
    assert!(read_git(repo, &["status", "--porcelain"]).is_empty());
}

#[cfg(unix)]
#[test]
fn resolve_conflict_on_literal_pattern_preserves_other_unmerged_file() {
    use crate::commands::staging::resolve_conflict;
    let fixture = Fixture(make_repo("literal-conflict"));
    let repo = &fixture.0;
    for name in ["*.txt", "private.txt"] {
        std::fs::write(repo.join(name), "base\n").unwrap();
    }
    git_in(repo, &["add", "."]);
    git_in(repo, &["commit", "-m", "base"]);
    git_in(repo, &["checkout", "-b", "other"]);
    for name in ["*.txt", "private.txt"] {
        std::fs::write(repo.join(name), "theirs\n").unwrap();
    }
    git_in(repo, &["add", "."]);
    git_in(repo, &["commit", "-m", "theirs"]);
    git_in(repo, &["checkout", "main"]);
    for name in ["*.txt", "private.txt"] {
        std::fs::write(repo.join(name), "ours\n").unwrap();
    }
    git_in(repo, &["add", "."]);
    git_in(repo, &["commit", "-m", "ours"]);
    let merge = std::process::Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["-c", "commit.gpgsign=false", "merge", "other"])
        .output()
        .unwrap();
    assert!(!merge.status.success());
    let untouched = std::fs::read(repo.join("private.txt")).unwrap();
    resolve_conflict(repo, "*.txt", "theirs").unwrap();
    assert_eq!(
        std::fs::read_to_string(repo.join("*.txt")).unwrap(),
        "theirs\n"
    );
    assert_eq!(std::fs::read(repo.join("private.txt")).unwrap(), untouched);
    assert_eq!(
        read_git(repo, &["diff", "--name-only", "--diff-filter=U"]).trim(),
        "private.txt"
    );
}

/// Regression: the global `--literal-pathspecs` flag is exported to hooks as
/// `GIT_LITERAL_PATHSPECS=1`, so a hook that uses glob pathspecs silently
/// matched nothing during stage/discard. Per-argument `:(literal)` magic must
/// leave the hook environment alone.
#[cfg(unix)]
#[test]
fn literal_paths_do_not_leak_into_the_hook_environment() {
    use crate::commands::staging::stage_file;
    use std::os::unix::fs::PermissionsExt as _;
    let fixture = Fixture(make_repo("hook-env"));
    let repo = &fixture.0;
    let hooks = repo.join("hooks-under-test");
    std::fs::create_dir_all(&hooks).unwrap();
    let hook = hooks.join("post-index-change");
    std::fs::write(
        &hook,
        "#!/bin/sh\nprintf 'LIT=%s|%s' \"${GIT_LITERAL_PATHSPECS:-unset}\" \"$(git ls-files -- '*.txt' | tr '\\n' ' ')\" > hook-observed\n",
    )
    .unwrap();
    std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    git_in(repo, &["config", "core.hooksPath", "hooks-under-test"]);
    std::fs::write(repo.join("tracked.txt"), "edited\n").unwrap();
    stage_file(repo, "tracked.txt").unwrap();
    let observed = std::fs::read_to_string(repo.join("hook-observed")).unwrap();
    assert_eq!(observed, "LIT=unset|tracked.txt ");
}

/// `git reset HEAD --` with no pathspec resets the whole index; an empty
/// selection must never widen to that.
#[test]
fn empty_selection_is_a_no_op_for_path_operations() {
    use crate::commands::staging::{stage_file, unstage_files};
    use crate::commands::utils::run_git_path_operation;
    let fixture = Fixture(make_repo("empty-selection"));
    let repo = &fixture.0;
    std::fs::write(repo.join("tracked.txt"), "edited\n").unwrap();
    stage_file(repo, "tracked.txt").unwrap();
    run_git_path_operation(repo, &["reset", "HEAD"], &[]).unwrap();
    unstage_files(repo, &[]).unwrap();
    assert_eq!(
        read_git(repo, &["diff", "--cached", "--name-only"]).trim(),
        "tracked.txt"
    );
}
