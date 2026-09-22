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

/// Re-places the macOS traffic lights after the window events tao delivers
/// from the AppKit delegate *after* the theme frame has re-laid out the
/// title bar: resize (also `zoom:` and native full-screen transitions),
/// focus, scale-factor and theme changes. Synchronous, so a live resize
/// never shows the default position. Resets without a delegate callback
/// (`setTitle:`, appearance, de-miniaturise) are caught by the frame-change
/// observers `app_window::traffic_lights` installs per window.
pub(crate) fn sync_traffic_lights_on_window_event(
    _window: &tauri::Window,
    _event: &tauri::WindowEvent,
) {
    #[cfg(target_os = "macos")]
    match _event {
        tauri::WindowEvent::Resized(_)
        | tauri::WindowEvent::ScaleFactorChanged { .. }
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
        app_window::unpin_traffic_lights(_window.label());
        app_window::release_page_backdrop(_window.label());
        system_services::power::release_sleep_inhibitor_for_window_label(_window.label());
        release_database_leases_for_window(_window.label());
        if app_window::is_station_window_label(_window.label()) {
            browser::inline::release_station_window_webview_state(_window.label());
        }
        notify_main_of_station_window_closed(_window);
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

/// Database leases are owned by the window whose webview opened them. A
/// destroyed or reloaded webview never runs its JS disconnects, and the lease
/// registries reject new opens at capacity rather than evicting live owners,
/// so the orphans are released here.
fn release_database_leases_for_window(label: &str) {
    let sqlite = db_browser::release_owner(label);
    if sqlite > 0 {
        tracing::info!(label, count = sqlite, "[Database] Released SQLite leases");
    }
    let label = label.to_string();
    tauri::async_runtime::spawn(async move {
        let remote = db_clients::release_owner(&label).await;
        if remote > 0 {
            tracing::info!(label, count = remote, "[Database] Released SQL pool leases");
        }
    });
}

/// A detached station window (`app-window-station-<mode>`) going away is a
/// layout event for the main window: it hid its own copy of that station
/// when the window opened and must show it again. The frontend cannot
/// observe another window's destruction reliably (a crash or programmatic
/// close never runs that window's JS cleanup), so the signal is raised here
/// and delivered only to `main`.
fn notify_main_of_station_window_closed(window: &tauri::Window) {
    use tauri::Emitter;

    let label = window.label();
    if !app_window::is_station_window_label(label) {
        return;
    }
    if let Err(error) =
        window
            .app_handle()
            .emit_to("main", app_window::STATION_WINDOW_CLOSED_EVENT, label)
    {
        tracing::warn!(label, error = %error, "[Window] failed to notify main of station window close");
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
    // Only a window's own webview owns database leases and the window's
    // sleep-inhibitor hold; inline browser webviews navigating inside it must
    // not release them.
    if webview.label() == webview.window().label()
        && matches!(payload.event(), PageLoadEvent::Started)
    {
        release_database_leases_for_window(webview.window().label());
        // A reload discards the page without running React cleanup, so the
        // old page's hold would outlive it. The new page starts believing it
        // holds nothing and re-acquires only if a session is still working —
        // if the last one finished across the reload, nothing would ever
        // release the hold and the machine would stay awake until quit.
        system_services::power::release_sleep_inhibitor_for_window_label(webview.window().label());
    }
    if (webview.label() == "main" || app_window::is_station_window_label(webview.label()))
        && matches!(payload.event(), PageLoadEvent::Started)
    {
        let app = webview.app_handle().clone();
        match browser::inline::close_inline_webviews_for_window(app, webview.window().label()) {
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

#[cfg(all(target_os = "macos", feature = "market-connect"))]
fn is_market_navigation(url: &url::Url, scheme: &str) -> bool {
    url.scheme() == scheme
        && url.host_str() == Some("market")
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.fragment().is_none()
        && url.path() == "/connect"
}

#[cfg(all(test, target_os = "macos", feature = "market-connect"))]
#[test]
fn market_navigation_restores_only_the_configured_app_shortcuts() {
    assert!(is_market_navigation(
        &url::Url::parse("orgii://market/connect?workspace_id=ws_account&target=org2").unwrap(),
        "orgii"
    ));
    for raw in [
        "https://market/connect",
        "orgii://other/connect",
        "orgii://market/authorized?code=fixture",
        "orgii://market/seller/authorized",
        "orgii://market/seller/connect?provider=claude&region=sjc",
        "orgii://user@market/connect",
        "orgii://market/connect#fragment",
    ] {
        assert!(!is_market_navigation(
            &url::Url::parse(raw).unwrap(),
            "orgii"
        ));
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
            #[cfg(feature = "market-connect")]
            if market_connect::app_scheme()
                .is_ok_and(|scheme| urls.iter().any(|url| is_market_navigation(url, scheme)))
            {
                // AppKit delivered the URL to the existing process, without
                // the single-instance callback that restores its window.
                // Queue activation after this native open event has returned.
                let app = app_handle.clone();
                dispatch2::DispatchQueue::main().exec_async(move || {
                    super::plugins::restore_main_window(&app);
                });
            }
            tracing::info!(
                count = urls.len(),
                "[OpenedFiles] Native macOS open event delivered"
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
    crate::market_connection::stop_history_sync();
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
