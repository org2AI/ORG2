#[test]
fn selected_parent_sha_matches_selected_index() {
    let parent_shas = [
        "1111111".to_string(),
        "2222222".to_string(),
        "3333333".to_string(),
    ];
    let selected_parent_index = Some(1usize);
    let parent_sha = selected_parent_index.and_then(|index| parent_shas.get(index).cloned());
    assert_eq!(parent_sha.as_deref(), Some("2222222"));
}

/// Regression: libgit2 matches `DiffOptions::pathspec` as an fnmatch pattern
/// by default, so the diff for a file named `[ab].txt` merged the hunks of
/// `a.txt` and `b.txt` into one result labelled as the selected file.
#[test]
fn single_file_diff_matches_the_selected_path_literally() {
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
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
    if std::process::Command::new("git")
        .arg("--version")
        .output()
        .is_err()
    {
        eprintln!("skipping: git executable not available");
        return;
    }
    let repo = std::env::temp_dir().join(format!(
        "orgii-diff-literal-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock after epoch")
            .as_nanos()
    ));
    let _ = std::fs::remove_dir_all(&repo);
    std::fs::create_dir_all(&repo).expect("create test repo dir");
    git_in(&repo, &["init"]);
    for name in ["a.txt", "b.txt", "[ab].txt"] {
        std::fs::write(repo.join(name), "one\n").expect("write file");
    }
    git_in(&repo, &["add", "."]);
    git_in(&repo, &["commit", "-m", "base"]);
    for name in ["a.txt", "b.txt", "[ab].txt"] {
        std::fs::write(repo.join(name), format!("one\nedited {name}\n")).expect("edit file");
    }

    let diff = super::get_file_diff(&repo, "[ab].txt", "HEAD", None, 3).expect("diff");
    assert_eq!(diff.old_path, None);
    assert_eq!(diff.insertions, 1);
    assert_eq!(diff.hunks.len(), 1);
    let added: Vec<&str> = diff.hunks[0]
        .lines
        .iter()
        .filter(|line| line.line_type == "addition")
        .map(|line| line.content.trim_end())
        .collect();
    assert_eq!(added, vec!["edited [ab].txt"]);

    let _ = std::fs::remove_dir_all(&repo);
}
