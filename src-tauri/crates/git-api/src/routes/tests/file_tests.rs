use axum::http::StatusCode;
use axum::response::IntoResponse;

use crate::routes::file::{parse_blob_hash, parse_stage_number, FileRouteError};

// ============================================
// parse_stage_number
// ============================================

#[test]
fn parse_stage_normal_file() {
    assert_eq!(parse_stage_number("100644 abc123def456 0 src/main.rs"), 0);
}

#[test]
fn parse_stage_conflict_ours() {
    assert_eq!(parse_stage_number("100644 abc123def456 2 src/main.rs"), 2);
}

#[test]
fn parse_stage_conflict_theirs() {
    assert_eq!(parse_stage_number("100644 abc123def456 3 src/main.rs"), 3);
}

#[test]
fn parse_stage_base() {
    assert_eq!(parse_stage_number("100644 abc123def456 1 src/main.rs"), 1);
}

#[test]
fn parse_stage_empty_input() {
    assert_eq!(parse_stage_number(""), 0);
}

#[test]
fn parse_stage_partial_input() {
    assert_eq!(parse_stage_number("100644 abc123"), 0);
}

#[test]
fn parse_stage_invalid_number() {
    assert_eq!(parse_stage_number("100644 abc123 X src/main.rs"), 0);
}

// ============================================
// parse_blob_hash
// ============================================

#[test]
fn parse_blob_hash_normal() {
    let hash = parse_blob_hash("100644 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 0 README.md");
    assert_eq!(hash.unwrap(), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
}

#[test]
fn parse_blob_hash_empty() {
    assert!(parse_blob_hash("").is_none());
}

#[test]
fn parse_blob_hash_single_field() {
    assert!(parse_blob_hash("100644").is_none());
}

#[test]
fn parse_blob_hash_two_fields() {
    let hash = parse_blob_hash("100644 abc123");
    assert_eq!(hash.unwrap(), "abc123");
}

// ============================================
// FileRouteError IntoResponse
// ============================================

#[test]
fn api_error_git_returns_bad_request() {
    let err = FileRouteError::GitError("test error".to_string());
    let response = err.into_response();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[test]
fn api_error_invalid_request_returns_bad_request() {
    let err = FileRouteError::InvalidRequest("bad input".to_string());
    let response = err.into_response();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[test]
fn api_error_io_returns_internal_server_error() {
    let err = FileRouteError::IoError(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        "not found",
    ));
    let response = err.into_response();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

/// Regression: `git ls-files --stage -- <name>` matched the selected name as a
/// pathspec pattern and the parsers read the first line, so an untracked
/// `[ab].txt` reported `a.txt`'s tracked state and blob hash.
#[tokio::test]
async fn git_file_status_matches_the_selected_path_literally() {
    use crate::routes::file::{get_git_file_status, GitFileStatusQuery};
    use axum::extract::Query;
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
        "orgii-file-status-literal-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock after epoch")
            .as_nanos()
    ));
    let _ = std::fs::remove_dir_all(&repo);
    std::fs::create_dir_all(&repo).expect("create test repo dir");
    git_in(&repo, &["init"]);
    for name in ["a.txt", "b.txt"] {
        std::fs::write(repo.join(name), "one\n").expect("write file");
    }
    git_in(&repo, &["add", "."]);
    git_in(&repo, &["commit", "-m", "base"]);
    std::fs::write(repo.join("[ab].txt"), "untracked\n").expect("write untracked");

    let response = get_git_file_status(Query(GitFileStatusQuery {
        repo_path: repo.to_string_lossy().into_owned(),
        file_path: repo.join("[ab].txt").to_string_lossy().into_owned(),
    }))
    .await;
    let Ok(response) = response else {
        panic!("route must succeed for a literal path");
    };
    assert!(!response.0.data.is_tracked);
    assert!(!response.0.data.is_staged);
    assert_eq!(response.0.data.blob_hash, None);

    let _ = std::fs::remove_dir_all(&repo);
}
