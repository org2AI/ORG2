use crate::commands::branch::{checkout_ref, create_branch, delete_branch, rename_branch};

/// The check runs before git is spawned, so a missing repository proves the
/// value was rejected rather than handed to git.
fn missing_repo() -> &'static std::path::Path {
    std::path::Path::new("/nonexistent/orgii-operand-guard")
}

fn assert_rejected_as_option(result: Result<(), String>) {
    let error = result.expect_err("an option-shaped value must be rejected");
    assert!(
        error.contains("must not start with '-'"),
        "rejection must come from the operand check, got: {error}"
    );
}

/// Regression: branch and ref names from a request were placed in argv
/// unchecked, so `-D`, `--force` and friends could be selected through them.
#[test]
fn branch_operations_reject_option_shaped_names() {
    let repo = missing_repo();

    assert_rejected_as_option(create_branch(repo, "-D", Some("main"), false));
    assert_rejected_as_option(create_branch(repo, "feature", Some("--force"), false));
    assert_rejected_as_option(delete_branch(repo, "--all", true));
    assert_rejected_as_option(rename_branch(repo, Some("--force"), "next", false));
    assert_rejected_as_option(rename_branch(repo, None, "--force", false));
}

#[test]
fn checkout_rejects_option_shaped_refs() {
    let repo = missing_repo();

    assert_rejected_as_option(checkout_ref(repo, "--force", false));
    assert_rejected_as_option(checkout_ref(repo, "-f", true));
    // A remote-tracking target passes as a whole, but its local half is placed
    // in argv on its own.
    assert_rejected_as_option(checkout_ref(repo, "origin/--force", false));
    assert_rejected_as_option(checkout_ref(repo, "refs/remotes/fork/-x", false));
}
