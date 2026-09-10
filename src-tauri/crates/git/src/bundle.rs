//! Git commit command and its retrying subprocess helper.

use std::path::PathBuf;
use std::process::Stdio;

use crate::util::{close_inherited_fds, git_command, is_transient_error};

/// Helper to run git commands directly, closing inherited file descriptors
/// Uses pre_exec on Unix to close FDs 3-1024 before exec to avoid WebView FD inheritance issues
fn run_git_command(repo_path: &PathBuf, args: &[&str]) -> Result<std::process::Output, String> {
    // Verify the directory exists before running
    if !repo_path.exists() {
        return Err(format!("Repository path does not exist: {:?}", repo_path));
    }

    let max_retries = 5;
    let mut last_error = String::new();

    for attempt in 0..max_retries {
        let result = git_command().and_then(|mut cmd| {
            cmd.args(args)
                .current_dir(repo_path)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .env("GIT_TERMINAL_PROMPT", "0");

            close_inherited_fds(&mut cmd);
            cmd.output().map_err(|err| err.to_string())
        });

        match result {
            Ok(output) => return Ok(output),
            Err(e) => {
                last_error = e.to_string();

                // Only retry transient errors
                if !is_transient_error(&last_error) {
                    return Err(format!(
                        "Failed to run git {}: {} (path: {:?})",
                        args.join(" "),
                        last_error,
                        repo_path
                    ));
                }
            }
        }

        // Exponential backoff
        if attempt < max_retries - 1 {
            let delay_ms = 200 * (attempt as u64 + 1);
            println!(
                "⚠️ [GitBundle] Retry {}/{} for git {} (waiting {}ms) - {}",
                attempt + 1,
                max_retries,
                args.join(" "),
                delay_ms,
                last_error
            );
            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
        }
    }

    Err(format!(
        "git {} failed after {} retries: {} (path: {:?})",
        args.join(" "),
        max_retries,
        last_error,
        repo_path
    ))
}

/// Create a commit with the given message
/// Uses run_git_command helper with retries and clean environment
#[tauri::command(rename_all = "camelCase")]
pub fn git_commit(folder_path: String, message: String) -> Result<(), String> {
    let repo_path = PathBuf::from(&folder_path);

    if !repo_path.exists() || !repo_path.is_dir() {
        return Err(format!("Invalid folder path: {}", folder_path));
    }

    let git_dir = repo_path.join(".git");
    if !git_dir.exists() {
        return Err("Not a git repository".to_string());
    }

    // Use run_git_command which has retries and uses env -i for clean environment
    let output = run_git_command(&repo_path, &["commit", "-m", &message])?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        // Git prints "nothing to commit, working tree clean" to STDOUT and
        // exits 1; checking stderr alone turned the benign no-op into
        // `git commit failed:` with an empty message.
        if stderr.contains("nothing to commit") || stdout.contains("nothing to commit") {
            println!("📝 [GitBundle] Nothing to commit");
            return Ok(());
        }
        return Err(format!("git commit failed: {}{}", stdout, stderr));
    }

    println!("✅ [GitBundle] Commit created: {}", message);
    Ok(())
}
