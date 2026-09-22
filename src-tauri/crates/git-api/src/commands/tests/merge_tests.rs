use crate::commands::merge::{
    cherry_pick_commit, merge_branch, rebase_args, rebase_branch, reset_file, reset_head,
    reset_mode_flag, revert_commit,
};

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

// ============================================
// rebase_args
// ============================================

/// Regression: a bare `git rebase` refuses to start whenever the working tree
/// is dirty at all ("cannot rebase: You have unstaged changes"), even when
/// nothing overlaps the replayed commits — the same defect fixed for pulls in
/// `pull_strategy_args`. `--autostash` must always accompany `rebase`.
#[test]
fn rebase_args_always_autostash() {
    assert_eq!(
        rebase_args("main", None),
        vec!["rebase", "--autostash", "main"]
    );
    assert_eq!(
        rebase_args("origin/main", Some("feature/x")),
        vec!["rebase", "--autostash", "origin/main", "feature/x"]
    );
}

// ============================================
// rebase_branch — integration against a real repository: a rebase onto an
// advanced base must succeed with an unrelated dirty file in the tree.
// ============================================

#[test]
fn rebase_branch_tolerates_unrelated_dirty_file() {
    if std::process::Command::new("git")
        .arg("--version")
        .output()
        .is_err()
    {
        eprintln!("skipping: git executable not available");
        return;
    }

    let repo = std::env::temp_dir().join(format!(
        "orgii-rebase-int-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock after epoch")
            .as_nanos()
    ));
    let _ = std::fs::remove_dir_all(&repo);
    std::fs::create_dir_all(&repo).expect("create test repo dir");

    git_in(&repo, &["init"]);
    std::fs::write(repo.join("base.txt"), "base\n").expect("write base");
    git_in(&repo, &["add", "."]);
    git_in(&repo, &["commit", "-m", "base"]);
    git_in(&repo, &["checkout", "-b", "feature"]);
    std::fs::write(repo.join("feature.txt"), "feature\n").expect("write feature");
    git_in(&repo, &["add", "feature.txt"]);
    git_in(&repo, &["commit", "-m", "feature work"]);
    git_in(&repo, &["checkout", "main"]);
    std::fs::write(repo.join("main.txt"), "main\n").expect("write main");
    git_in(&repo, &["add", "main.txt"]);
    git_in(&repo, &["commit", "-m", "main advances"]);
    git_in(&repo, &["checkout", "feature"]);

    // An unstaged edit to a tracked file that no replayed commit touches —
    // exactly the state that used to make `git rebase` refuse outright.
    std::fs::write(repo.join("base.txt"), "base\nuncommitted local edit\n").expect("write dirty");

    let result = rebase_branch(&repo, "main", None).expect("rebase runs");
    assert!(
        result.success,
        "rebase over an unrelated dirty file must succeed: {}",
        result.message
    );
    assert!(!result.has_conflicts);
    let restored = std::fs::read_to_string(repo.join("base.txt")).expect("read base.txt");
    assert!(
        restored.contains("uncommitted local edit") && repo.join("main.txt").exists(),
        "dirty edit must be restored on top of the rebased branch"
    );

    let _ = std::fs::remove_dir_all(&repo);
}

// ============================================
// Conflict reporting — structural, not substring — and editor-free continue.
// ============================================

/// Regression: has_conflicts came from a bare "CONFLICT" substring over the
/// output, so a perfectly clean merge whose diffstat listed a file named
/// CONFLICTS.md reported failure and opened the conflict resolver. And
/// `rebase --continue` ran without editor suppression, so continuing after a
/// resolved conflict tried to open the commit-message editor and aborted in
/// a TTY-less process.
#[test]
fn conflict_reporting_is_structural_and_continue_needs_no_editor() {
    use crate::commands::merge::{merge_branch, rebase_continue};

    if std::process::Command::new("git")
        .arg("--version")
        .output()
        .is_err()
    {
        eprintln!("skipping: git executable not available");
        return;
    }

    let repo = std::env::temp_dir().join(format!(
        "orgii-merge-int-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock after epoch")
            .as_nanos()
    ));
    let _ = std::fs::remove_dir_all(&repo);
    std::fs::create_dir_all(&repo).expect("create test repo dir");

    git_in(&repo, &["init"]);
    std::fs::write(repo.join("CONFLICTS.md"), "base\n").expect("write file");
    git_in(&repo, &["add", "."]);
    git_in(&repo, &["commit", "-m", "init"]);

    // Scenario 1: a clean merge whose diffstat mentions CONFLICTS.md.
    git_in(&repo, &["checkout", "-b", "docs"]);
    std::fs::write(repo.join("CONFLICTS.md"), "base\ndocs edit\n").expect("write file");
    git_in(&repo, &["commit", "-am", "docs edit"]);
    git_in(&repo, &["checkout", "main"]);
    let merged = merge_branch(&repo, "docs", false, None).expect("merge runs");
    assert!(
        merged.success,
        "clean merge must not fail over a scary filename: {}",
        merged.message
    );
    assert!(!merged.has_conflicts);
    assert!(merged.conflicted_files.is_empty());

    // Scenario 2: a real conflict — reported structurally, then resolved and
    // continued without an editor.
    git_in(&repo, &["checkout", "-b", "clash", "HEAD~1"]);
    std::fs::write(repo.join("CONFLICTS.md"), "base\nclash edit\n").expect("write file");
    git_in(&repo, &["commit", "-am", "clash edit"]);
    let rebased = rebase_branch(&repo, "main", None).expect("rebase runs");
    assert!(!rebased.success);
    assert!(rebased.has_conflicts);
    assert_eq!(rebased.conflicted_files, vec!["CONFLICTS.md".to_string()]);

    std::fs::write(repo.join("CONFLICTS.md"), "base\ndocs edit\nclash edit\n").expect("resolve");
    git_in(&repo, &["add", "CONFLICTS.md"]);
    let continued = rebase_continue(&repo).expect("continue runs");
    assert!(
        continued.success,
        "continue must not depend on an editor: {}",
        continued.message
    );

    let _ = std::fs::remove_dir_all(&repo);
}

// ============================================
// Request values must be operands, never options
// ============================================

fn assert_rejected_as_option<T>(result: Result<T, String>) {
    let Err(error) = result else {
        panic!("an option-shaped value must be rejected");
    };
    assert!(
        error.contains("must not start with '-'"),
        "rejection must come from the operand check, got: {error}"
    );
}

/// Regression: `upstream` went into `git rebase --autostash <upstream>`
/// unchecked. `git rebase` accepts `--exec=<cmd>`, so an option-shaped value ran
/// a program of the caller's choosing. The repository below is the state in
/// which that fired — an upstream is configured and one commit is ahead of it.
#[test]
fn rebase_branch_never_runs_an_option_shaped_upstream() {
    if std::process::Command::new("git")
        .arg("--version")
        .output()
        .is_err()
    {
        eprintln!("skipping: git executable not available");
        return;
    }

    let root = std::env::temp_dir().join(format!(
        "orgii-rebase-operand-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock after epoch")
            .as_nanos()
    ));
    let _ = std::fs::remove_dir_all(&root);
    let origin = root.join("origin.git");
    let repo = root.join("work");
    std::fs::create_dir_all(&origin).expect("create origin dir");
    std::fs::create_dir_all(&repo).expect("create work dir");

    git_in(&origin, &["init", "--bare"]);
    git_in(&repo, &["init"]);
    git_in(&repo, &["commit", "--allow-empty", "-m", "base"]);
    git_in(&repo, &["branch", "-M", "main"]);
    git_in(
        &repo,
        &[
            "remote",
            "add",
            "origin",
            origin.to_str().expect("utf8 path"),
        ],
    );
    git_in(&repo, &["push", "-u", "origin", "main"]);
    git_in(&repo, &["commit", "--allow-empty", "-m", "ahead"]);

    let marker = root.join("EXECUTED");
    let payload = format!("--exec=touch {}", marker.display());

    assert_rejected_as_option(rebase_branch(&repo, &payload, None));
    assert_rejected_as_option(rebase_branch(&repo, "main", Some(&payload)));
    assert!(
        !marker.exists(),
        "an option-shaped rebase value must never reach git"
    );

    let _ = std::fs::remove_dir_all(&root);
}

/// The check runs before git is spawned, so a missing repository proves the
/// value was rejected rather than handed to git.
#[test]
fn history_operations_reject_option_shaped_refs() {
    let repo = std::path::Path::new("/nonexistent/orgii-operand-guard");

    assert_rejected_as_option(merge_branch(repo, "--no-verify", false, None));
    assert_rejected_as_option(cherry_pick_commit(repo, "--abort", false));
    assert_rejected_as_option(revert_commit(repo, "--abort", false));
    assert_rejected_as_option(reset_head(repo, "--pathspec-from-file=x", "hard"));
    assert_rejected_as_option(reset_file(repo, "a.txt", "--ours"));
}

/// Regression: `mode` was interpolated as `--{mode}`, so any `git reset` option
/// could be selected through it.
#[test]
fn reset_mode_is_an_allowlist() {
    assert_eq!(reset_mode_flag("soft"), Ok("--soft"));
    assert_eq!(reset_mode_flag("mixed"), Ok("--mixed"));
    assert_eq!(reset_mode_flag("hard"), Ok("--hard"));

    for mode in [
        "",
        "keep",
        "merge",
        "pathspec-from-file=x",
        "hard --quiet",
        "-hard",
    ] {
        assert!(reset_mode_flag(mode).is_err(), "{mode:?} must be rejected");
    }

    let repo = std::path::Path::new("/nonexistent/orgii-operand-guard");
    let error = reset_head(repo, "HEAD", "pathspec-from-file=x").expect_err("invalid mode");
    assert!(error.contains("Invalid reset mode"), "{error}");
}
