//! Shared "is this tool on PATH?" probe for every LSP / lint discovery surface.
//!
//! Resolved in-process via `which::which` (the same lookup
//! `install_pipeline::find_binary` already uses) instead of spawning
//! `which` / `where`. Semantics:
//!
//! - `PATH` is read from the process environment at call time with
//!   `std::env::var_os`, so the login-shell PATH that
//!   `app_paths::shell_path` installs at startup is visible and non-UTF-8
//!   entries are walked rather than dropped; an unset or empty `PATH` yields
//!   `false`.
//! - On Windows, `PATHEXT` is honoured, so `tsc` finds `tsc.cmd`.
//! - Only names without a path separator are searched on `PATH`; a name that
//!   contains one is resolved relative to the current directory, mirroring
//!   the `which` binary.
//! - No child process is spawned, so no console window can flash on Windows.

/// Check whether `command_name` resolves to an executable on the current
/// process `PATH`.
pub(crate) fn command_exists(command_name: &str) -> bool {
    which::which(command_name).is_ok()
}

#[cfg(test)]
mod tests {
    use super::command_exists;

    #[test]
    fn finds_a_platform_shell() {
        #[cfg(unix)]
        assert!(command_exists("sh"));

        #[cfg(windows)]
        assert!(command_exists("cmd"));
    }

    #[test]
    fn rejects_a_missing_command() {
        assert!(!command_exists(
            "orgii-command-detection-test-definitely-missing"
        ));
    }

    #[test]
    fn rejects_an_empty_name() {
        assert!(!command_exists(""));
    }
}
