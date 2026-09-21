//! Process `$PATH` augmentation from the user's interactive login shell,
//! plus the well-known executable directories that shell probe commonly
//! misses. No-op on Windows.

#[cfg(unix)]
use std::collections::HashSet;
#[cfg(unix)]
use std::path::{Path, PathBuf};
#[cfg(unix)]
use std::process::{Command, Stdio};
#[cfg(unix)]
use std::time::Duration;

/// Augment the process `$PATH` with the user's full interactive login-shell PATH.
///
/// macOS `.app` bundles launched from the Dock or Finder start with a
/// stripped PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), so `which npm`,
/// `which claude`, etc. fail even when those tools are installed via
/// Homebrew (`/opt/homebrew/bin`) or nvm/fnm (`~/.nvm/...`).
///
/// Strategy: try shells in order, most complete first.
///   1. `$SHELL -i -l -c 'echo $PATH'` — interactive login: sources both
///      `~/.zprofile` (or `~/.bash_profile`) AND `~/.zshrc` (or `~/.bashrc`),
///      which is where nvm/fnm/conda inject themselves.
///   2. `$SHELL -l -c 'echo $PATH'` — non-interactive login: fallback if
///      the interactive run fails (some shells refuse `-i` without a tty).
///
/// The `-i` flag is what makes nvm visible: nvm hooks itself into the shell
/// via `~/.zshrc`, which is only sourced for interactive shells, not for
/// plain `zsh -l` (login-but-non-interactive).
///
/// Safe to call multiple times (idempotent). On Windows it's a no-op.
/// Call once at app startup before any binary-detection probes run.
pub fn augment_path_from_shell() {
    #[cfg(unix)]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

        // Try interactive login first (picks up nvm via ~/.zshrc), then
        // plain login as fallback. Each probe is wrapped in a timeout so a
        // misbehaving rc file (one that blocks on a prompt / network call)
        // can't hang app startup forever.
        // Both probes run CONCURRENTLY, and the interactive one — the only
        // one that sources ~/.zshrc, i.e. nvm, pyenv and keg-only Homebrew —
        // wins whenever it answers at all. Serially it was capped at 5 s and
        // the fallback could not start until it gave up; an interactive zsh
        // costs ~3 s from a GUI process here against ~0.45 s from a terminal,
        // and when it exceeded the cap during bootstrap the app came up with
        // a login-only PATH and no way to tell. See PATH_PROBE_BUDGET.
        let shell_path_str = run_shell_path_probes(&shell);

        if shell_path_str.is_none() {
            tracing::warn!(
                "[app_paths] shell PATH probe failed for {:?}; falling back to well-known dirs only",
                shell
            );
        }

        let current_path = std::env::var("PATH").unwrap_or_default();
        let current_dirs: HashSet<String> =
            current_path.split(':').map(|s| s.to_string()).collect();

        // Candidate dirs from the shell probe (if any) plus well-known install
        // locations that login-shell PATH frequently misses (homebrew, pipx,
        // uv, cargo, ~/.local/bin). Only dirs that actually exist are added.
        let mut candidate_dirs: Vec<String> = Vec::new();
        if let Some(shell_path) = shell_path_str.as_deref() {
            for dir in shell_path.split(':') {
                if !dir.is_empty() {
                    candidate_dirs.push(dir.to_string());
                }
            }
        }
        for dir in well_known_bin_dirs() {
            candidate_dirs.push(dir);
        }

        let mut seen: HashSet<String> = HashSet::new();
        let new_dirs: Vec<String> = candidate_dirs
            .into_iter()
            .filter(|dir| {
                !dir.is_empty()
                    && !current_dirs.contains(dir)
                    && seen.insert(dir.clone())
                    // Well-known dirs are only appended when present; shell dirs
                    // are trusted as-is (the shell already resolved them).
                    && Path::new(dir).is_dir()
            })
            .collect();

        if new_dirs.is_empty() {
            return;
        }

        let augmented = if current_path.is_empty() {
            new_dirs.join(":")
        } else {
            format!("{}:{}", new_dirs.join(":"), current_path)
        };

        std::env::set_var("PATH", &augmented);
        tracing::info!(
            "[app_paths] augmented PATH with {} new dirs: {:?}",
            new_dirs.len(),
            new_dirs,
        );
    }
}

/// How long BOTH probes together may take.
///
/// Serially this was 5 s EACH — the login-only fallback could not even start
/// until the interactive probe had given up, so the real worst case was ~10 s
/// and the interactive probe never got more than 5 s. Running them together
/// banks the fallback's answer immediately, which is what makes it safe to be
/// more patient with the probe that actually sees `~/.zshrc`: 8 s here is
/// strictly less than the old worst case while giving an interactive zsh that
/// costs ~3 s from a GUI process (nvm's auto-use spawns node) the headroom it
/// needs under bootstrap load. Nothing waits on this once either probe wins.
#[cfg(unix)]
const PATH_PROBE_BUDGET: Duration = Duration::from_secs(8);

/// What each probe did, kept for the diagnostic line emitted once tracing is
/// up (`augment_path_from_shell` runs before the log file exists).
#[cfg(unix)]
static PROBE_DIAGNOSTICS: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();

/// One line per PATH probe attempt: which arguments, whether it answered, how
/// long it took and how many directories it yielded. Empty until
/// `augment_path_from_shell` has run. Safe to call at any later point.
#[cfg(unix)]
pub fn shell_path_probe_diagnostics() -> Vec<String> {
    PROBE_DIAGNOSTICS.get().cloned().unwrap_or_default()
}

#[cfg(not(unix))]
pub fn shell_path_probe_diagnostics() -> Vec<String> {
    Vec::new()
}

/// Race `$SHELL -i -l -c` against `$SHELL -l -c` and return the better answer.
///
/// The interactive probe is what sees `~/.zshrc` (nvm, pyenv, keg-only
/// Homebrew), so it is preferred whenever it answers within the budget; the
/// login-only probe is the fallback. Running them together means a slow
/// `~/.zshrc` no longer costs the interactive probe its chance.
#[cfg(unix)]
fn run_shell_path_probes(shell: &str) -> Option<String> {
    use std::sync::mpsc;

    let attempts: [Vec<&str>; 2] = [
        vec!["-i", "-l", "-c", "echo $PATH"],
        vec!["-l", "-c", "echo $PATH"],
    ];
    let started = std::time::Instant::now();
    let (tx, rx) = mpsc::channel();
    for (index, args) in attempts.iter().enumerate() {
        let tx = tx.clone();
        let shell = shell.to_string();
        let args: Vec<String> = args.iter().map(|s| (*s).to_string()).collect();
        std::thread::spawn(move || {
            let output = Command::new(&shell)
                .args(&args)
                .stdin(Stdio::null())
                .stderr(Stdio::null())
                .output();
            let _ = tx.send((index, output, started.elapsed()));
        });
    }
    drop(tx);

    let mut results: [Option<String>; 2] = [None, None];
    let mut diagnostics: Vec<String> = attempts
        .iter()
        .map(|args| format!("{} {:?}: no answer within the budget", shell, args))
        .collect();
    // Take whatever lands before the shared deadline; stop early once the
    // preferred probe has answered.
    while let Ok((index, output, elapsed)) = rx.recv_timeout(
        PATH_PROBE_BUDGET.saturating_sub(started.elapsed()),
    ) {
        let parsed = output.as_ref().ok().and_then(usable_path);
        diagnostics[index] = match (&output, &parsed) {
            (Ok(o), Some(path)) => format!(
                "{} {:?}: ok in {} ms, exit {:?}, {} dirs",
                shell,
                attempts[index],
                elapsed.as_millis(),
                o.status.code(),
                path.split(':').filter(|d| !d.is_empty()).count()
            ),
            (Ok(o), None) => format!(
                "{} {:?}: unusable after {} ms, exit {:?}, {} stdout bytes",
                shell,
                attempts[index],
                elapsed.as_millis(),
                o.status.code(),
                o.stdout.len()
            ),
            (Err(err), _) => format!(
                "{} {:?}: could not start after {} ms: {err}",
                shell,
                attempts[index],
                elapsed.as_millis()
            ),
        };
        results[index] = parsed;
        if results[0].is_some() {
            break;
        }
    }
    let _ = PROBE_DIAGNOSTICS.set(diagnostics);
    results[0].take().or_else(|| results[1].take())
}

/// The `$PATH` a probe printed, or None when it is not usable.
///
/// Only the LAST non-empty line is read: a chatty rc file prints banners
/// before `echo $PATH` runs, and taking the whole of stdout would splice a
/// banner onto the first directory and silently corrupt it.
#[cfg(unix)]
fn usable_path(output: &std::process::Output) -> Option<String> {
    if !output.status.success() {
        return None;
    }
    let raw = std::str::from_utf8(&output.stdout).ok()?;
    let last = raw.lines().rev().find(|line| !line.trim().is_empty())?;
    let trimmed = last.trim();
    // A PATH is absolute, colon-separated directories; anything else is a
    // banner or a prompt and must not be spliced into the process PATH.
    if trimmed.is_empty() || !trimmed.split(':').any(|dir| dir.starts_with('/')) {
        return None;
    }
    Some(trimmed.to_string())
}

/// Well-known executable directories that login-shell PATH probes commonly
/// miss (tool installers that hook only interactive rc files, or that install
/// outside the standard login PATH). Caller filters to those that exist.
#[cfg(unix)]
fn well_known_bin_dirs() -> Vec<String> {
    let mut dirs = vec![
        "/opt/homebrew/bin".to_string(),
        "/opt/homebrew/sbin".to_string(),
        "/usr/local/bin".to_string(),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        for sub in [".local/bin", ".cargo/bin", ".local/share/uv/tools/bin"] {
            if let Some(p) = home.join(sub).to_str() {
                dirs.push(p.to_string());
            }
        }
    }
    dirs
}

#[cfg(all(test, unix))]
mod tests {
    use super::usable_path;
    use std::os::unix::process::ExitStatusExt;
    use std::process::{ExitStatus, Output};

    fn output(code: i32, stdout: &str) -> Output {
        Output {
            status: ExitStatus::from_raw(code << 8),
            stdout: stdout.as_bytes().to_vec(),
            stderr: Vec::new(),
        }
    }

    #[test]
    fn a_plain_path_is_taken_as_is() {
        let out = output(0, "/opt/homebrew/bin:/usr/bin:/bin\n");
        assert_eq!(
            usable_path(&out).as_deref(),
            Some("/opt/homebrew/bin:/usr/bin:/bin")
        );
    }

    #[test]
    fn an_rc_file_banner_before_the_path_is_ignored() {
        // A chatty ~/.zshrc prints before `echo $PATH` runs. Reading all of
        // stdout would splice the banner onto the first directory.
        let out = output(
            0,
            "nvm: using node v22\nsome plugin loaded\n/opt/homebrew/opt/node@22/bin:/usr/bin\n",
        );
        assert_eq!(
            usable_path(&out).as_deref(),
            Some("/opt/homebrew/opt/node@22/bin:/usr/bin")
        );
    }

    #[test]
    fn trailing_blank_lines_do_not_hide_the_path() {
        let out = output(0, "/usr/bin:/bin\n\n\n");
        assert_eq!(usable_path(&out).as_deref(), Some("/usr/bin:/bin"));
    }

    #[test]
    fn a_failed_probe_is_never_used() {
        let out = output(1, "/usr/bin:/bin\n");
        assert_eq!(usable_path(&out), None);
    }

    #[test]
    fn output_without_any_absolute_directory_is_rejected() {
        // A prompt or an error line is not a PATH; splicing it in would put
        // garbage at the front of the process PATH.
        assert_eq!(usable_path(&output(0, "command not found: nvm\n")), None);
        assert_eq!(usable_path(&output(0, "   \n")), None);
        assert_eq!(usable_path(&output(0, "")), None);
    }
}
