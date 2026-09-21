use crate::commands::commit::list_commits;

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

/// Regression: the timeline filter was passed to `git log -- <path>` as a
/// pathspec pattern, so the history of a file named `[ab].txt` listed every
/// commit that touched `a.txt` or `b.txt`.
#[test]
fn list_commits_file_filter_is_a_literal_path() {
    if std::process::Command::new("git")
        .arg("--version")
        .output()
        .is_err()
    {
        eprintln!("skipping: git executable not available");
        return;
    }

    let repo = std::env::temp_dir().join(format!(
        "orgii-commits-literal-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock after epoch")
            .as_nanos()
    ));
    let _ = std::fs::remove_dir_all(&repo);
    std::fs::create_dir_all(&repo).expect("create test repo dir");

    git_in(&repo, &["init"]);
    for (name, subject) in [
        ("a.txt", "touch a"),
        ("b.txt", "touch b"),
        ("[ab].txt", "touch pattern"),
    ] {
        std::fs::write(repo.join(name), "one\n").expect("write file");
        git_in(&repo, &["add", "."]);
        git_in(&repo, &["commit", "-m", subject]);
    }

    let commits = list_commits(&repo, Some(50), None, Some("[ab].txt")).expect("list commits");
    let subjects: Vec<&str> = commits.commits.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(subjects, vec!["touch pattern"]);

    let _ = std::fs::remove_dir_all(&repo);
}
