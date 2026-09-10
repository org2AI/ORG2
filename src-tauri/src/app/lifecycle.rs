//! Application lifecycle handlers wired into the Tauri builder: window events,
//! page loads, and the process-level run-event loop (including shutdown).

use std::sync::atomic::{AtomicU8, Ordering};
use std::time::Duration;

use tauri::Manager;

use crate::app::bootstrap::dev_startup_debug_enabled;

const SHUTDOWN_RUNNING: u8 = 0;
const SHUTDOWN_DRAINING: u8 = 1;
const SHUTDOWN_READY_TO_EXIT: u8 = 2;
static SHUTDOWN_PHASE: AtomicU8 = AtomicU8::new(SHUTDOWN_RUNNING);

const AGENT_DRAIN_BUDGET: Duration = Duration::from_secs(3);
const DATABASE_POOL_DRAIN_BUDGET: Duration = Duration::from_secs(2);
const CHECKPOINT_WRITER_BUDGET: Duration = Duration::from_millis(250);
const CHECKPOINT_SQLITE_BUDGET: Duration = Duration::from_millis(500);
const PERSISTENCE_SHUTDOWN_BUDGET: Duration = Duration::from_secs(4);

fn exit_request_supports_bounded_shutdown(code: Option<i32>) -> bool {
    code != Some(tauri::RESTART_EXIT_CODE)
}

/// Keeps the macOS traffic lights pinned after scale-factor, theme, and focus
/// changes.
pub(crate) fn sync_traffic_lights_on_window_event(
    _window: &tauri::Window,
    _event: &tauri::WindowEvent,
) {
    #[cfg(target_os = "macos")]
    match _event {
        tauri::WindowEvent::ScaleFactorChanged { .. }
        | tauri::WindowEvent::ThemeChanged(_)
        | tauri::WindowEvent::Focused(true) => {
            if let Some(webview_window) = _window.app_handle().get_webview_window(_window.label()) {
                app_window::set_traffic_light_position(
                    &webview_window,
                    app_window::TRAFFIC_LIGHT_X,
                    app_window::TRAFFIC_LIGHT_Y,
                );
            }
        }
        _ => {}
    }
}

// Release keeps the historical behavior: closing the main window hides it so
// tray/dock entry points can reopen it. Debug Linux/Windows exits normally
// so dev runs do not leave hidden app processes behind.
pub(crate) fn handle_window_close_and_destroy(
    _window: &tauri::Window,
    _event: &tauri::WindowEvent,
) {
    // A destroyed window may never run its JS cleanup (crash, direct
    // programmatic close of a detached session window). Drop its
    // sleep-inhibitor holder so the process-wide assertion is
    // refcounted correctly — neither leaked until process exit nor
    // still attributed to a dead window.
    if let tauri::WindowEvent::Destroyed = _event {
        system_services::power::release_sleep_inhibitor_for_window_label(_window.label());
    }
    if let tauri::WindowEvent::CloseRequested { api: _api, .. } = _event {
        // Only hide the "main" window — let auxiliary windows close normally
        if _window.label() == "main" {
            #[cfg(any(target_os = "macos", not(debug_assertions)))]
            {
                _api.prevent_close();
                let _ = _window.hide();
            }
        }
    }
}

/// Main-webview page-load hook: dev startup tracing plus inline-webview
/// teardown on reload.
pub(crate) fn handle_page_load(
    webview: &tauri::Webview,
    payload: &tauri::webview::PageLoadPayload<'_>,
) {
    use tauri::webview::PageLoadEvent;
    if webview.label() == "main" {
        let event_label = match payload.event() {
            PageLoadEvent::Started => "started",
            PageLoadEvent::Finished => "finished",
        };
        if dev_startup_debug_enabled() {
            println!(
                "[TauriPageLoad] label={} event={} url={}",
                webview.label(),
                event_label,
                payload.url()
            );
            tracing::info!(
                label = webview.label(),
                event = event_label,
                url = %payload.url(),
                "[TauriPageLoad]"
            );
        }
    }
    if webview.label() == "main" && matches!(payload.event(), PageLoadEvent::Started) {
        let app = webview.app_handle().clone();
        match browser::inline::close_all_inline_webviews(app) {
            Ok(closed) if !closed.is_empty() => {
                tracing::info!(
                    count = closed.len(),
                    ?closed,
                    "[PageReload] Closed inline webviews"
                );
            }
            Err(err) => {
                tracing::warn!(error = %err, "[PageReload] Failed to close inline webviews");
            }
            _ => {}
        }
    }
}

/// Process-level run-event loop: macOS open/reopen behavior and the ordered
/// shutdown sequence on exit.
pub(crate) fn handle_run_event(app_handle: &tauri::AppHandle, event: tauri::RunEvent) {
    #[cfg(not(target_os = "macos"))]
    let _ = &app_handle;

    match event {
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Opened { urls } => {
            tracing::info!(
                count = urls.len(),
                "[OpenedFiles] Ignoring native macOS open event"
            );
        }
        // macOS: clicking the dock icon when all windows are closed should reopen the main window
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } => {
            if !has_visible_windows {
                if let Err(err) = app_window::recreate_main_window(app_handle) {
                    tracing::error!(error = %err, "[Reopen] Failed to recreate main window");
                }
            }
        }
        tauri::RunEvent::ExitRequested { api, code, .. } => {
            // Tauri explicitly ignores prevent_exit for request_restart. No
            // current ORGII call site uses that path; keep the old synchronous
            // best effort and make the missing bounded drain visible.
            if !exit_request_supports_bounded_shutdown(code) {
                tracing::warn!(
                    "[Shutdown] Tauri restart cannot be deferred; running synchronous best-effort cleanup"
                );
                run_pre_database_shutdown(app_handle);
                crate::app::bootstrap::flush_tracing_for_shutdown();
                return;
            }

            match SHUTDOWN_PHASE.compare_exchange(
                SHUTDOWN_RUNNING,
                SHUTDOWN_DRAINING,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => {
                    api.prevent_exit();
                    let handle = app_handle.clone();
                    let exit_code = code.unwrap_or(0);
                    tauri::async_runtime::spawn(async move {
                        perform_bounded_shutdown(&handle).await;
                        SHUTDOWN_PHASE.store(SHUTDOWN_READY_TO_EXIT, Ordering::Release);
                        handle.exit(exit_code);
                    });
                }
                Err(SHUTDOWN_DRAINING) => {
                    api.prevent_exit();
                    tracing::debug!("[Shutdown] exit already draining");
                }
                Err(SHUTDOWN_READY_TO_EXIT) => {
                    // Second ExitRequested was initiated by `handle.exit`
                    // after the bounded teardown completed. Let it through.
                }
                Err(other) => {
                    api.prevent_exit();
                    tracing::warn!(phase = other, "[Shutdown] unknown shutdown phase");
                }
            }
        }
        _ => {}
    }
}

async fn perform_bounded_shutdown(app_handle: &tauri::AppHandle) {
    let started = std::time::Instant::now();
    if let Some(state) = app_handle.try_state::<agent_core::state::AgentAppState>() {
        let report = state.begin_shutdown(AGENT_DRAIN_BUDGET).await;
        tracing::info!(
            sessions_signalled = report.sessions_signalled,
            sessions_drained = report.sessions_drained,
            sessions_still_processing = ?report.sessions_still_processing,
            elapsed_ms = report.elapsed_ms,
            "[Shutdown] Agent admission fenced and accepted work drained"
        );
    }

    // PTY teardown deliberately uses `blocking_lock`, so this whole ordered
    // pre-database + pool + checkpoint sequence must run on a thread that has
    // not entered the Tokio runtime. A dedicated thread also lets the async
    // coordinator enforce a hard wait budget; on timeout SQLite keeps the WAL
    // for the next safe startup instead of risking file-level cleanup.
    let persistence_handle = app_handle.clone();
    let (persistence_tx, persistence_rx) = tokio::sync::oneshot::channel();
    let persistence_thread = std::thread::Builder::new()
        .name("orgii-shutdown-persistence".to_string())
        .spawn(move || {
            run_pre_database_shutdown(&persistence_handle);
            let pool = database::db::begin_connection_pool_shutdown(DATABASE_POOL_DRAIN_BUDGET);
            let sessions = database::db::checkpoint_sessions_for_shutdown(
                CHECKPOINT_WRITER_BUDGET,
                CHECKPOINT_SQLITE_BUDGET,
            );
            let projects = database::db::checkpoint_projects_for_shutdown(CHECKPOINT_SQLITE_BUDGET);
            let _ = persistence_tx.send((pool, sessions, projects));
        });

    match persistence_thread {
        Err(error) => {
            tracing::warn!(error = %error, "[Shutdown] failed to start persistence drain thread")
        }
        Ok(_thread) => {
            match tokio::time::timeout(PERSISTENCE_SHUTDOWN_BUDGET, persistence_rx).await {
                Ok(Ok((pool, sessions, projects))) => {
                    tracing::info!(
                        drained = pool.drained,
                        idle_closed = pool.idle_connections_closed,
                        remaining_checked_out = pool.remaining_checked_out,
                        elapsed_ms = pool.elapsed_ms,
                        metrics = ?pool.metrics,
                        "[Shutdown] SQLite connection pool drain completed"
                    );
                    match sessions {
                        Ok(outcome) => tracing::info!(
                            outcome = ?outcome,
                            "[Shutdown] sessions WAL checkpoint finished"
                        ),
                        Err(error) => tracing::warn!(
                            error = %error,
                            "[Shutdown] sessions WAL checkpoint failed safely"
                        ),
                    }
                    match projects {
                        Ok(report) => tracing::info!(
                            report = ?report,
                            "[Shutdown] projects WAL checkpoint finished"
                        ),
                        Err(error) => tracing::warn!(
                            error = %error,
                            "[Shutdown] projects WAL checkpoint failed safely"
                        ),
                    }
                }
                Ok(Err(error)) => tracing::warn!(
                    error = %error,
                    "[Shutdown] persistence drain thread stopped before reporting"
                ),
                Err(_) => tracing::warn!(
                    budget_ms = PERSISTENCE_SHUTDOWN_BUDGET.as_millis(),
                    "[Shutdown] persistence drain exceeded its budget; preserving WAL for next startup"
                ),
            }
        }
    }
    tracing::info!(
        elapsed_ms = started.elapsed().as_millis(),
        "[Shutdown] bounded teardown complete"
    );
    crate::app::bootstrap::flush_tracing_for_shutdown();
}

fn run_pre_database_shutdown(app_handle: &tauri::AppHandle) {
    match agent_cli::managed_config::restore_managed_configs_for_shutdown() {
        Ok(report) => {
            if !report.restored_agents.is_empty() {
                tracing::info!(
                    agents = ?report.restored_agents,
                    "[CLI Managed Config] restored Default configs before exit"
                );
            }
            for (agent, error) in report.failed_agents {
                tracing::warn!(
                    agent,
                    error = %error,
                    "[CLI Managed Config] left config unchanged during exit"
                );
            }
        }
        Err(error) => tracing::warn!(
            error = %error,
            "[CLI Managed Config] failed to run shutdown restoration"
        ),
    }
    agent_core::coordination::work_item_recovery::mark_all_interrupted_sync();
    integrations::computer_use_lock::force_release_on_exit();
    // Close the outbound Mobile Remote relay and all per-phone actors before
    // the persistence pool is drained.
    crate::api::mobile_bridge::relay::shutdown();
    app_handle
        .state::<::terminal::pty_commands::pty::PtyState>()
        .shutdown_kill_all();
}

#[cfg(test)]
mod tests {
    use super::exit_request_supports_bounded_shutdown;

    #[test]
    fn user_and_programmatic_quit_both_run_bounded_shutdown() {
        // Tauri 2.x documents `None` as a user-interaction quit. Window-close
        // hiding is handled earlier by `CloseRequested`; this value must never
        // be treated as an automatic last-window exit that skips teardown.
        assert!(exit_request_supports_bounded_shutdown(None));
        assert!(exit_request_supports_bounded_shutdown(Some(0)));
        assert!(!exit_request_supports_bounded_shutdown(Some(
            tauri::RESTART_EXIT_CODE
        )));
    }
}
