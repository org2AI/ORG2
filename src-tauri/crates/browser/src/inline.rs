//! Inline Webview Management
//!
//! Webviews embedded within the main application window.
//! Used for displaying web content inline (e.g., embedded browser panels).
//!
//! ## Single-owner model
//!
//! Each app window owns its live native browser views through SharedBrowserApp.
//! My Station and Agent Station in that document share the same owner. Detached
//! windows use scoped labels; a view is never reused under a different parent.
//!
//! Native create/close operations share a per-label asynchronous lane. Each
//! frontend generation owns one slot; release is idempotent and cannot consume
//! a later owner. Empty lanes are reclaimed after the last queued command.

use super::inline_ownership::{owner_lane, owner_lane_for_window, window_reload_lanes};

use tauri::webview::WebviewBuilder;
use tauri::WebviewUrl;
use tauri::{AppHandle, Emitter, Manager};
use tracing::{debug, warn};

use super::scripts::{
    ANTI_BOT_DETECTION_SCRIPT, ELEMENT_INSPECTOR_SCRIPT, PAGE_AGENT_SCRIPT,
    SHORTCUT_FORWARDING_SCRIPT,
};
#[cfg(debug_assertions)]
use super::scripts::{CONSOLE_CAPTURE_SCRIPT, NETWORK_CAPTURE_SCRIPT};

const OFFSCREEN_POSITION: f64 = -10000.0;
const OFFSCREEN_MIN_SIZE: f64 = 1.0;

fn frame_from_corners(
    x: f64,
    y: f64,
    a: Option<f64>,
    b: Option<f64>,
    width: f64,
    height: f64,
) -> (f64, f64, f64, f64) {
    let resolved_width = a
        .map(|right| (right - x).max(OFFSCREEN_MIN_SIZE))
        .unwrap_or(width);
    let resolved_height = b
        .map(|bottom| (bottom - y).max(OFFSCREEN_MIN_SIZE))
        .unwrap_or(height);
    (x, y, resolved_width, resolved_height)
}

/// Create an inline webview embedded within the main window.
///
/// Features:
/// - Positioned within the app UI (x, y, width, height)
/// - Anti-bot detection scripts (realistic browser fingerprint)
/// - Console and network log capture
/// - New window request handling (blocks popups, emits events)
/// - Optional incognito mode and custom user agent
///
/// # Events Emitted
///
/// - `webview-new-window-request`: When the webview tries to open a popup
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn create_inline_webview(
    app: AppHandle,
    parent_window: String,
    label: String,
    url: String,
    x: f64,
    y: f64,
    a: Option<f64>,
    b: Option<f64>,
    width: f64,
    height: f64,
    user_agent: Option<String>,
    incognito: bool,
    generation: Option<u64>,
    visible: bool,
) -> Result<(), String> {
    let (x, y, width, height) = frame_from_corners(x, y, a, b, width, height);
    debug!(
        label = %label,
        x, y, width, height,
        parent_window = %parent_window,
        "browser::inline: creating webview"
    );

    // Serialize all native lifecycle calls for this label without blocking the
    // UI thread while another command is creating/closing a WebView.
    let lane = owner_lane_for_window(&label, &parent_window)?;
    let epoch = lane.epoch.current();
    let mut owners = lane.state.lock().await;
    lane.epoch.check(epoch)?;
    owners.release_before(epoch);

    // Validate before acquiring a slot so invalid requests cannot leak owners.
    let parsed_url: url::Url = url.parse().map_err(|e| format!("Invalid URL: {}", e))?;

    // Get the parent window
    let window = app.get_window(&parent_window).ok_or_else(|| {
        let windows: Vec<_> = app.windows().keys().cloned().collect();
        debug!(windows = ?windows, "browser::inline: parent window not found");
        format!(
            "Parent window '{}' not found. Available: {:?}",
            parent_window, windows
        )
    })?;

    // A reused label must belong to this parent. Reject before changing its
    // generation or ref count so a second window cannot take over its lifecycle.
    if let Some(existing) = app.get_webview(&label) {
        if existing.window().label() != parent_window {
            return Err(format!("Webview '{label}' belongs to another window"));
        }
    }

    // When a webview with this label already exists, reuse it. Respect the
    // caller's initial visibility so inactive restored tabs stay offscreen
    // instead of covering an active empty tab.
    if let Some(existing) = app.get_webview(&label) {
        if !owners.may_configure(generation) {
            owners.acquire(generation, epoch);
            return lane.epoch.check(epoch);
        }
        // Generation-aware owners publish visibility only after the IPC reply
        // confirms their React owner is still mounted.
        let should_show = visible && generation.is_none();
        debug!(
            label = %label,
            visible = should_show,
            "browser::inline: reusing existing webview"
        );
        let (target_x, target_y, target_width, target_height) = if should_show {
            (x, y, width, height)
        } else {
            (
                OFFSCREEN_POSITION,
                OFFSCREEN_POSITION,
                OFFSCREEN_MIN_SIZE,
                OFFSCREEN_MIN_SIZE,
            )
        };
        let pos = tauri::Position::Logical(tauri::LogicalPosition::new(target_x, target_y));
        let size = tauri::Size::Logical(tauri::LogicalSize::new(target_width, target_height));
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            existing.set_position(pos)?;
            existing.set_size(size)?;
            existing.navigate(parsed_url.clone())?;
            if should_show {
                existing.show()?;
            }
            Ok::<(), tauri::Error>(())
        }));
        return match result {
            Ok(Ok(())) => {
                owners.acquire(generation, epoch);
                lane.epoch.check(epoch)
            }
            failure => match failure {
                Ok(Err(error)) => Err(format!("Failed to reuse webview: {error}")),
                _ => Err("Reusing native webview panicked".to_string()),
            },
        };
    }

    if !owners.may_configure(generation) {
        return Err("Inline webview creation was superseded by a newer owner".to_string());
    }

    let label_for_closure = label.clone();
    let app_for_closure = app.clone();
    let parent_for_shortcuts = parent_window.clone();

    // Build the webview with anti-bot detection, element inspector, page agent
    // (DOM automation), and new window handling. Console/network interception is
    // diagnostic-only and is not injected into bundled release webviews.
    let mut builder = WebviewBuilder::new(&label, WebviewUrl::External(parsed_url))
        .initialization_script(ANTI_BOT_DETECTION_SCRIPT);

    #[cfg(debug_assertions)]
    {
        builder = builder
            .initialization_script(CONSOLE_CAPTURE_SCRIPT)
            .initialization_script(NETWORK_CAPTURE_SCRIPT);
    }

    builder = builder
        .initialization_script(ELEMENT_INSPECTOR_SCRIPT)
        .initialization_script(PAGE_AGENT_SCRIPT)
        .initialization_script(app_window::shortcut_preferences::initialization_script())
        .initialization_script(SHORTCUT_FORWARDING_SCRIPT)
        .on_page_load(|webview, _| {
            let _ = webview.eval(app_window::shortcut_preferences::initialization_script());
        })
        .on_new_window(move |new_window_url, _cookies| {
            let url_str = new_window_url.to_string();
            debug!(url = %url_str, "browser::inline: new window requested");

            if new_window_url.scheme() == "orgii-shortcut" {
                if let Some(shortcut) = new_window_url.host_str() {
                    let _ = app_for_closure.emit_to(
                        &parent_for_shortcuts,
                        "inline-webview-shortcut",
                        serde_json::json!({
                            "shortcut": shortcut,
                            "keys": ""
                        }),
                    );
                }
                return tauri::webview::NewWindowResponse::Deny;
            }

            let _ = app_for_closure.emit(
                "webview-new-window-request",
                serde_json::json!({
                    "url": url_str,
                    "webviewLabel": label_for_closure
                }),
            );

            tauri::webview::NewWindowResponse::Deny
        });

    // Set user agent if provided
    if let Some(ua) = user_agent {
        builder = builder.user_agent(&ua);
    }

    // Set incognito mode
    if incognito {
        builder = builder.incognito(true);
    }

    // Create offscreen but keep the real viewport size. Tauri/wry creates child
    // webviews visible by default, and calling hide() during the creation window
    // can poison wry's internal runtime mutex. Offscreen creation avoids a
    // visible white pane, while the real size lets sites such as Bing initialize
    // responsive layout/scripts correctly instead of seeing a 1x1 viewport.
    let position = tauri::Position::Logical(tauri::LogicalPosition::new(
        OFFSCREEN_POSITION,
        OFFSCREEN_POSITION,
    ));
    let size = tauri::Size::Logical(tauri::LogicalSize::new(
        width.max(OFFSCREEN_MIN_SIZE),
        height.max(OFFSCREEN_MIN_SIZE),
    ));

    let ownership_observation = perf_utils::begin_webview_ownership_observation(label.clone());
    let webview = window
        .add_child(builder, position, size)
        .map_err(|e| format!("Failed to create webview: {}", e))?;

    owners.acquire(generation, epoch);
    ownership_observation.commit();
    // The synchronous reload snapshot includes this held lane, even if the
    // native child appeared after that snapshot. Cleanup waits for this lane.
    lane.epoch.check(epoch)?;

    debug!(
        label = %webview.label(),
        "browser::inline: successfully created webview (offscreen until frontend shows it)"
    );

    Ok(())
}

/// Update the position and size of an inline webview.
///
/// Uses catch_unwind to handle wry panics when webview is in invalid state.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn update_inline_webview_position(
    app: AppHandle,
    label: String,
    x: f64,
    y: f64,
    a: Option<f64>,
    b: Option<f64>,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let (x, y, width, height) = frame_from_corners(x, y, a, b, width, height);
    if let Some(webview) = app.get_webview(&label) {
        let pos = tauri::Position::Logical(tauri::LogicalPosition::new(x, y));
        let size = tauri::Size::Logical(tauri::LogicalSize::new(width, height));

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            webview.set_position(pos)?;
            webview.set_size(size)?;
            Ok::<(), tauri::Error>(())
        }));

        match result {
            Ok(Ok(())) => Ok(()),
            Ok(Err(e)) => Err(format!("Failed to update position: {}", e)),
            Err(_) => {
                // Silently ignore - position updates are frequent and webview might be closing
                Ok(())
            }
        }
    } else {
        // Webview not yet created or already destroyed — not an error.
        // This is expected during the creation race (CT becomes active before
        // My Station's BrowserSessionWebview finishes create_inline_webview).
        Ok(())
    }
}

/// Show or hide an inline webview.
///
/// Uses catch_unwind to handle wry panics when webview is in invalid state.
#[tauri::command]
pub fn set_inline_webview_visibility(
    app: AppHandle,
    label: String,
    visible: bool,
) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&label) {
        // Use catch_unwind to handle wry panics when webview is in invalid state
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            if visible {
                webview.show()
            } else {
                webview.hide()
            }
        }));

        match result {
            Ok(Ok(())) => Ok(()),
            Ok(Err(e)) => Err(format!("Failed to set visibility: {}", e)),
            Err(_) => {
                // Caught panic from wry - webview is likely in invalid state
                warn!(
                    label = %label,
                    "browser::inline: visibility change panicked; webview may be invalid"
                );
                Ok(())
            }
        }
    } else {
        // Not an error — webview not yet created or already destroyed.
        Ok(())
    }
}

/// Release one owner and close the native WebView only after the last owner.
/// Queued closes wait for creation; the frontend also releases a late create
/// after unmount. Repeated or stale generation releases are safe no-ops.
#[tauri::command]
pub async fn close_inline_webview(
    app: AppHandle,
    label: String,
    generation: Option<u64>,
) -> Result<(), String> {
    let lane = owner_lane(&label);
    let mut owners = lane.state.lock().await;
    if !owners.release(generation) {
        return Ok(());
    }
    if let Some(webview) = app.get_webview(&label) {
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| webview.close())) {
            Ok(Ok(())) => Ok(()),
            Ok(Err(error)) => Err(format!("Failed to close: {error}")),
            Err(_) => Err("Closing native webview panicked".to_string()),
        }
    } else {
        Ok(())
    }
}

/// Hide all inline webviews.
///
/// Used by error pages to ensure webviews don't block UI.
/// Native webviews render at the OS level and don't respect CSS z-index,
/// so they must be explicitly hidden to allow overlay UI to be clickable.
///
/// Uses catch_unwind to handle wry panics when webviews are in invalid state.
#[tauri::command]
pub fn hide_all_inline_webviews(
    app: AppHandle,
    window: tauri::Window,
) -> Result<Vec<String>, String> {
    let mut hidden_labels = Vec::new();

    // Get all webviews in the app
    let webviews = app.webviews();

    for (label, webview) in webviews.iter() {
        // Keep the calling window's app surface and every other window intact.
        if label == window.label() || webview.window().label() != window.label() {
            continue;
        }

        // Clone webview for catch_unwind (needs 'static lifetime)
        let webview_clone = webview.clone();
        let result =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| webview_clone.hide()));

        match result {
            Ok(Ok(())) => {
                debug!(label = %label, "browser::inline: hidden webview");
                hidden_labels.push(label.clone());
            }
            Ok(Err(e)) => {
                warn!(label = %label, error = %e, "browser::inline: failed to hide webview");
            }
            Err(_) => {
                warn!(label = %label, "browser::inline: hide panicked; skipping");
            }
        }
    }

    Ok(hidden_labels)
}

/// Close all inline webviews (browser panels, tabs, etc).
///
/// Used during hot reload to destroy all webviews before React re-mounts.
/// Native webviews don't automatically clean up when React components unmount
/// during HMR, causing orphaned webviews that overlap the reloaded UI.
///
/// Releases ownership predating a native reload boundary under each label's
/// command lane. Owners admitted by the new renderer survive delayed cleanup.
/// The synchronous page-load callback captures this boundary before spawning.
///
/// Excludes app windows (shell-*, app-window-*, window-*) which should persist
/// across HMR to avoid closing user's open windows.
///
/// Uses catch_unwind to handle wry panics when webviews are in invalid state.
#[tauri::command]
pub async fn close_all_inline_webviews(
    app: AppHandle,
    window: tauri::Window,
) -> Result<Vec<String>, String> {
    begin_inline_webview_reload(&app, window.label())
        .close(app)
        .await
}

/// Captured synchronously by the main page-load callback, before a new renderer
/// can submit work. Includes pending command lanes whose native child is absent.
pub struct InlineWebviewReload {
    lanes: Vec<(super::inline_ownership::OwnerLane, u64)>,
}

pub fn begin_inline_webview_reload(app: &AppHandle, window_label: &str) -> InlineWebviewReload {
    let mut lanes = window_reload_lanes(window_label);
    let registered: std::collections::HashSet<_> =
        lanes.iter().map(|(lane, _)| lane.label.clone()).collect();
    for (label, webview) in app.webviews() {
        if registered.contains(&label)
            || webview.window().label() != window_label
            || label == window_label
            || label.starts_with("shell-")
            || label.starts_with("app-window-")
            || label.starts_with("window-")
        {
            continue;
        }
        if let Ok(lane) = owner_lane_for_window(&label, window_label) {
            let epoch = lane.epoch.advance();
            lanes.push((lane, epoch));
        }
    }
    InlineWebviewReload { lanes }
}

impl InlineWebviewReload {
    pub async fn close(self, app: AppHandle) -> Result<Vec<String>, String> {
        let mut closed_labels = Vec::new();
        for (lane, epoch) in self.lanes {
            let label = lane.label.clone();
            let mut owners = lane.state.lock().await;
            owners.release_before(epoch);
            // A new renderer may already have reused this exact native label.
            if !owners.is_empty() {
                continue;
            }
            if let Some(webview) = app.get_webview(&label) {
                match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| webview.close())) {
                    Ok(Ok(())) => closed_labels.push(label),
                    Ok(Err(error)) => warn!(%label, %error, "browser::inline: reload close failed"),
                    Err(_) => warn!(%label, "browser::inline: reload close panicked"),
                }
            }
        }
        Ok(closed_labels)
    }
}

/// Navigate an inline webview to a new URL.
///
/// Uses catch_unwind to handle wry panics when webview is in invalid state.
#[tauri::command]
pub fn navigate_inline_webview(app: AppHandle, label: String, url: String) -> Result<(), String> {
    let parsed_url: url::Url = url.parse().map_err(|e| format!("Invalid URL: {}", e))?;

    if let Some(webview) = app.get_webview(&label) {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            webview.navigate(parsed_url)
        }));

        match result {
            Ok(Ok(())) => Ok(()),
            Ok(Err(e)) => Err(format!("Failed to navigate: {}", e)),
            Err(_) => {
                warn!(
                    label = %label,
                    "browser::inline: navigate panicked; webview may be invalid"
                );
                Err("Navigation failed - webview in invalid state".to_string())
            }
        }
    } else {
        Err(format!("Webview '{}' not found", label))
    }
}

/// Reload an inline webview without destroying or repositioning it.
///
/// Uses catch_unwind to handle wry panics when webview is in invalid state.
#[tauri::command]
pub fn reload_inline_webview(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&label) {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| webview.reload()));

        match result {
            Ok(Ok(())) => Ok(()),
            Ok(Err(e)) => Err(format!("Failed to reload: {}", e)),
            Err(_) => {
                warn!(
                    label = %label,
                    "browser::inline: reload panicked; webview may be invalid"
                );
                Err("Reload failed - webview in invalid state".to_string())
            }
        }
    } else {
        Err(format!("Webview '{}' not found", label))
    }
}
