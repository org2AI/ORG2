//! Settings File Watcher
//!
//! Watches `~/.orgii/settings.jsonc` for external changes (e.g., agent edits)
//! and emits a Tauri event so the frontend can reload.
//!
//! Uses the `notify` crate (already a dependency) with debouncing.

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tracing::{error, info, warn};

use super::file_io;

/// Event name emitted to the frontend when the settings file changes externally.
pub const SETTINGS_CHANGED_EVENT: &str = "settings-file-changed";

/// Event name emitted when the settings file is deleted.
pub const SETTINGS_DELETED_EVENT: &str = "settings-file-deleted";

/// Handle to the watcher thread. Dropping this stops the watcher.
pub struct SettingsWatcherHandle {
    /// Signal to stop the watcher thread
    stop_signal: Arc<AtomicBool>,
    /// Thread handle (joined on drop)
    _thread: std::thread::JoinHandle<()>,
}

impl Drop for SettingsWatcherHandle {
    fn drop(&mut self) {
        self.stop_signal.store(true, Ordering::Relaxed);
        // Thread will exit on next event or timeout
    }
}

/// Start watching the settings file for changes.
/// Returns a handle that keeps the watcher alive.
pub fn start_watching(app_handle: AppHandle) -> Result<SettingsWatcherHandle, String> {
    let settings_path = file_io::get_settings_path();

    let settings_dir = settings_path
        .parent()
        .ok_or("Settings path has no parent directory")?
        .to_path_buf();

    // Ensure the directory exists so we can watch it
    std::fs::create_dir_all(&settings_dir)
        .map_err(|err| format!("Failed to create settings dir for watcher: {err}"))?;

    let stop_signal = Arc::new(AtomicBool::new(false));
    let stop_clone = stop_signal.clone();

    let thread = std::thread::spawn(move || {
        if let Err(err) = watcher_loop(app_handle, settings_dir, settings_path, stop_clone) {
            error!(error = %err, "settings watcher stopped with error");
        }
    });

    Ok(SettingsWatcherHandle {
        stop_signal,
        _thread: thread,
    })
}

/// Internal watcher loop that runs on a dedicated thread.
fn watcher_loop(
    app_handle: AppHandle,
    watch_dir: PathBuf,
    settings_path: PathBuf,
    stop_signal: Arc<AtomicBool>,
) -> Result<(), String> {
    let (_watcher, rx) = watch_changes(&watch_dir, &settings_path)?;

    info!(path = %settings_path.display(), "settings watcher started");

    consume_changes(&rx, &stop_signal, Duration::from_millis(500), || {
        // Remove + create/rename is an atomic replacement, not a settings reset.
        // Decide from the final filesystem state, never from an intermediate event.
        if !settings_path.exists() {
            super::hooks::on_settings_changed(&serde_json::json!({}));
            if let Err(err) = app_handle.emit(SETTINGS_DELETED_EVENT, ()) {
                error!(error = %err, "failed to emit settings delete event");
            }
            return;
        }
        match file_io::read_settings() {
            Ok(settings) => {
                super::hooks::on_settings_changed(&settings);
                if let Err(err) = app_handle.emit(SETTINGS_CHANGED_EVENT, &settings) {
                    error!(error = %err, "failed to emit settings change event");
                }
            }
            Err(err) => warn!(error = %err, "failed to read settings after change"),
        }
    });
    Ok(())
}

fn watch_changes(
    watch_dir: &std::path::Path,
    settings_path: &std::path::Path,
) -> Result<(RecommendedWatcher, mpsc::Receiver<()>), String> {
    // One dirty marker is sufficient: read the file, not intermediate payloads.
    let (tx, rx) = mpsc::sync_channel(1);
    let watched_paths = watched_path_candidates(watch_dir, settings_path);
    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<Event>| match result {
            Ok(event) if affects_settings(&event, &watched_paths) => {
                let _ = tx.try_send(());
            }
            Err(err) => warn!(error = %err, "settings watcher event error"),
            _ => {}
        },
        Config::default().with_poll_interval(Duration::from_secs(2)),
    )
    .map_err(|err| format!("Failed to create file watcher: {err}"))?;
    watcher
        .watch(watch_dir, RecursiveMode::NonRecursive)
        .map_err(|err| format!("Failed to watch settings directory: {err}"))?;
    Ok((watcher, rx))
}

/// Spellings under which the backend may report the settings file.
///
/// `notify` canonicalizes the watched directory and reports events with that
/// canonical prefix, while `settings_path` keeps the configured spelling. The
/// two differ whenever the settings home sits behind a symlink (`~/.orgii`
/// managed by a dotfile tool, or `ORGII_HOME` under `/tmp` on macOS, which
/// resolves to `/private/tmp`); an exact compare against the configured path
/// alone would then silently drop every change.
fn watched_path_candidates(
    watch_dir: &std::path::Path,
    settings_path: &std::path::Path,
) -> Vec<PathBuf> {
    let mut candidates = vec![settings_path.to_path_buf()];
    if let (Ok(canonical_dir), Some(name)) = (watch_dir.canonicalize(), settings_path.file_name()) {
        let canonical = canonical_dir.join(name);
        if !candidates.contains(&canonical) {
            candidates.push(canonical);
        }
    }
    candidates
}

fn affects_settings(event: &Event, watched: &[PathBuf]) -> bool {
    matches!(
        event.kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    ) && event
        .paths
        .iter()
        .any(|candidate| watched.iter().any(|path| path == candidate))
}

fn consume_changes(
    rx: &mpsc::Receiver<()>,
    stop_signal: &AtomicBool,
    debounce: Duration,
    mut publish: impl FnMut(),
) {
    let mut deadline: Option<Instant> = None;
    loop {
        if stop_signal.load(Ordering::Relaxed) {
            break;
        }
        let now = Instant::now();
        if deadline.is_some_and(|at| now >= at) {
            deadline = None;
            publish();
            continue;
        }
        let wait = deadline
            .map(|at| at.saturating_duration_since(now))
            .unwrap_or(Duration::from_secs(2));
        match rx.recv_timeout(wait) {
            Ok(()) => {
                // Fixed window: retain the final write without starving delivery
                // when writes are continuous. No file reads while idle.
                deadline.get_or_insert_with(|| Instant::now() + debounce);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

#[cfg(test)]
#[path = "tests/watcher_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "tests/watcher_native_tests.rs"]
mod native_tests;
