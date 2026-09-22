use crate::repos::repo_service::clone_github;

/// Regression: the URL went into `git clone <url> <path>` unchecked, and
/// `git clone` accepts `--upload-pack=<cmd>` and `--config`. The check runs
/// before git is spawned, so nothing is created on disk either.
#[tokio::test]
async fn clone_rejects_an_option_shaped_url() {
    let target = std::env::temp_dir().join(format!(
        "orgii-clone-operand-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock after epoch")
            .as_nanos()
    ));

    let result = clone_github(
        "--upload-pack=true".to_string(),
        target.display().to_string(),
        Some("repo".to_string()),
    )
    .await;
    let Err(error) = result else {
        panic!("an option-shaped URL must be rejected");
    };

    assert!(error.contains("must not start with '-'"), "{error}");
    assert!(!target.exists(), "nothing may be cloned or created");
}
