//! Git credential lookup.

#[cfg(test)]
use std::ffi::OsString;
#[cfg(test)]
use std::path::Path;

use serde::Serialize;
use tauri::command;

use project_management::sync::git_credentials::find_https_credential;

use super::repos::github_repo_full_name_from_remote;
use super::shared::make_client;

#[derive(Debug, Serialize)]
pub struct GitHubGitCredential {
    pub username: String,
    pub token: String,
    pub repo_full_name: String,
}

/// Build the argv a GitHub clone would pass to `git`.
///
/// Pulled out as a pure function so the unit tests below can assert that
/// (a) the OAuth token only ever appears inside the
/// `http.extraHeader=Authorization: Bearer …` config flag and never as a
/// CLI argument, in the URL, or anywhere else; and (b) `--depth 1` plus
/// `--branch <b> --single-branch` (when a branch is requested) are wired
/// correctly. Returns `OsString` so paths with non-UTF-8 components round
/// trip cleanly.
#[cfg(test)]
pub(crate) fn build_clone_argv(
    token: &str,
    repo_full_name: &str,
    target_dir: &Path,
    branch: Option<&str>,
) -> Vec<OsString> {
    let clean_url = format!("https://github.com/{repo_full_name}.git");
    let mut argv: Vec<OsString> = Vec::with_capacity(8);
    argv.push("-c".into());
    argv.push(format!("http.extraHeader=Authorization: Bearer {token}").into());
    argv.push("clone".into());
    argv.push("--depth".into());
    argv.push("1".into());
    if let Some(b) = branch {
        argv.push("--branch".into());
        argv.push(b.into());
        argv.push("--single-branch".into());
    }
    argv.push(clean_url.into());
    argv.push(target_dir.as_os_str().to_owned());
    argv
}

/// Format a clone-failure error string, redacting the token if `git`
/// happened to echo it back. Pulled out so the redaction logic is unit-
/// testable without spawning a subprocess.
#[cfg(test)]
pub(crate) fn clean_git_clone_error(token: &str, exit_code: Option<i32>, stderr: &[u8]) -> String {
    let stderr_str = String::from_utf8_lossy(stderr).replace(token, "***");
    format!(
        "git clone failed (exit {exit_code:?}): {}",
        stderr_str.trim()
    )
}

#[command]
pub async fn github_git_credential_for_remote(
    remote_url: String,
) -> Result<Option<GitHubGitCredential>, String> {
    let Some(repo_full_name) = github_repo_full_name_from_remote(&remote_url) else {
        return Ok(None);
    };
    let Some(credential) = find_https_credential()? else {
        return Ok(None);
    };
    Ok(Some(GitHubGitCredential {
        username: credential.username,
        token: credential.token,
        repo_full_name,
    }))
}

/// Resolve the authenticated GitHub account identity with one lightweight
/// `/user` request. Git transport credentials intentionally use the fixed
/// `x-access-token` username, so that value cannot classify authored PRs or
/// outstanding review requests.
#[command]
pub async fn github_get_viewer_login() -> Result<String, String> {
    let user = make_client()?.get("/user").await?;
    viewer_login_from_user(&user)
}

fn viewer_login_from_user(user: &serde_json::Value) -> Result<String, String> {
    user["login"]
        .as_str()
        .filter(|login| !login.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| "Missing login in GitHub /user response".to_string())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::viewer_login_from_user;

    #[test]
    fn extracts_authenticated_viewer_login() {
        assert_eq!(
            viewer_login_from_user(&json!({ "login": "octocat" })),
            Ok("octocat".to_string())
        );
    }

    #[test]
    fn rejects_missing_or_empty_viewer_login() {
        assert!(viewer_login_from_user(&json!({})).is_err());
        assert!(viewer_login_from_user(&json!({ "login": "" })).is_err());
    }
}
