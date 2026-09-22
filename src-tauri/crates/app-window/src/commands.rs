//! Tauri commands for window management.
//!
//! Lives in a submodule (rather than inline in `lib.rs`) because
//! `#[tauri::command]` emits a `#[macro_export] macro_rules! __cmd__<fn>`
//! plus a sibling `pub use __cmd__<fn>;`. When the function lives at the
//! crate root the two paths collapse onto the same name in the macro
//! namespace and rustc reports `E0255 __cmd__<fn> defined multiple
//! times`. Putting them in a child module keeps the `pub use` scoped to
//! `app_window::commands::__cmd__<fn>` while `#[macro_export]` still
//! reaches the crate root for `tauri::generate_handler!` to find. Same
//! pattern key-vault and integrations use.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "macos")]
use tauri::{LogicalPosition, Position, TitleBarStyle};

/// Set the native zoom factor for the main application WebView.
#[tauri::command]
pub async fn set_main_webview_zoom(app: AppHandle, scale_factor: f64) -> Result<(), String> {
    let webview = app.get_webview("main").ok_or("Main WebView not found")?;

    webview
        .set_zoom(scale_factor)
        .map_err(|err| format!("Failed to set main WebView zoom: {}", err))?;

    Ok(())
}

/// Set the native zoom factor for the CALLING window's own WebView.
///
/// Per-window replacement for [`set_main_webview_zoom`]: with detached
/// session windows, each window must zoom its own webview instead of
/// re-zooming "main". Tauri injects the invoking [`tauri::Webview`], so
/// no label lookup is needed and the command can never target another
/// window. The main-window variant is kept for compatibility.
#[tauri::command]
pub async fn set_webview_zoom(webview: tauri::Webview, scale_factor: f64) -> Result<(), String> {
    webview
        .set_zoom(scale_factor)
        .map_err(|err| format!("Failed to set WebView zoom: {}", err))?;

    Ok(())
}

/// Remove the startup background from the CALLING window. Every window's
/// frontend invokes this once React finishes loading and CSS backgrounds are
/// painted — restoring the transparent glass appearance and re-asserting the
/// traffic-light inset once more (stability itself comes from the observers
/// `app_window::traffic_lights` keeps per window). Tauri injects the invoking
/// window, so main and detached session windows each clear their own backdrop.
#[tauri::command]
pub async fn remove_window_background(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        super::remove_window_background_color(&window);
        super::set_traffic_light_position(&window, super::TRAFFIC_LIGHT_X, super::TRAFFIC_LIGHT_Y);
    }

    #[cfg(not(target_os = "macos"))]
    let _ = window;

    Ok(())
}

/// Paint the CALLING window's root tint as a native layer under the webview.
///
/// macOS only; a no-op elsewhere. The frontend passes the composite of its
/// translucent root surfaces (`html`, `body`, `#root`) as sRGB `[r, g, b, a]`
/// in `0.0..=1.0` after first paint and again on every theme or skin change,
/// then flips `<html data-native-root-tint>` so its own CSS tint goes
/// transparent. During a live resize the strip of window the page has not yet
/// painted then shows this tint over the vibrancy material — the same surface
/// the page itself settles on — instead of raw material. `None` removes the
/// layer and the frontend restores its CSS tint.
#[tauri::command]
pub async fn set_window_root_tint(
    window: tauri::WebviewWindow,
    color: Option<[f64; 4]>,
) -> Result<(), String> {
    let color = match color {
        Some(color) => Some(
            super::root_tint::normalize_root_tint(color)
                .ok_or_else(|| format!("Root tint has a non-finite component: {color:?}"))?,
        ),
        None => None,
    };

    #[cfg(target_os = "macos")]
    super::set_macos_window_root_tint(&window, color);

    #[cfg(not(target_os = "macos"))]
    let _ = (window, color);

    Ok(())
}

/// Back the CALLING window's opaque page surface with a native layer that is
/// revealed while the window resizes.
///
/// macOS only; a no-op elsewhere. `insets` are the page surface's distances
/// from the viewport's top, right, bottom and left edges in CSS px, and
/// `color` the opaque sRGB `[r, g, b, a]` it paints. The frontend sends both
/// whenever either changes, and neither when no opaque page surface is
/// mounted, which removes the layer. While a resize is in flight the band the
/// page has not painted yet then shows the page colour instead of the
/// translucent material; see `app_window::page_backdrop`.
#[tauri::command]
pub async fn set_window_page_backdrop(
    window: tauri::WebviewWindow,
    insets: Option<[f64; 4]>,
    color: Option<[f64; 4]>,
) -> Result<(), String> {
    let backdrop = match (insets, color) {
        (Some(insets), Some(color)) => Some(super::page_backdrop::normalize_page_backdrop(
            insets, color,
        )?),
        (None, None) => None,
        (insets, color) => {
            return Err(format!(
                "Page backdrop insets and colour must be sent together: insets {insets:?}, colour {color:?}"
            ))
        }
    };

    #[cfg(target_os = "macos")]
    super::set_macos_window_page_backdrop(&window, backdrop);

    #[cfg(not(target_os = "macos"))]
    let _ = (window, backdrop);

    Ok(())
}

/// Switch the icon the running app shows in the Dock / taskbar.
///
/// `variant` is the `general.dockIcon` setting value (`"dark"` | `"light"` | `"rainbow"`).
/// Unknown values are rejected rather than coerced so a schema drift between
/// TS and Rust surfaces as an error instead of silently resetting the icon.
/// The stored value is re-applied at launch by
/// [`super::dock_icon::apply_stored_dock_icon`]; this command covers live
/// changes from the Appearance settings.
#[tauri::command]
pub async fn set_dock_icon(app: AppHandle, variant: String) -> Result<(), String> {
    let variant = super::dock_icon::DockIconVariant::parse(&variant)
        .ok_or_else(|| format!("Unknown dock icon variant: {variant:?}"))?;
    super::dock_icon::apply_dock_icon(&app, variant)
}

// ============================================
// Detached app windows (session / station)
// ============================================

/// Label prefix for detached session windows. Matches the `app-window-*`
/// glob in `capabilities/default.json`, so these windows inherit the full
/// default permission set without a capability (and thus Rust schema) change.
pub const SESSION_WINDOW_LABEL_PREFIX: &str = "app-window-session-";

/// Label prefix for detached station windows (`app-window-station-<mode>`).
/// Same capability glob as session windows; one window per station mode.
pub const STATION_WINDOW_LABEL_PREFIX: &str = "app-window-station-";

/// Station modes the frontend knows (`STATION_MODES` in
/// `src/types/ui/workstation.ts`). The mode is embedded verbatim in the
/// window label and the route, so anything else is refused.
const STATION_WINDOW_MODES: [&str; 2] = ["my-station", "agent-station"];

/// Tauri event the main window receives when a station window is destroyed
/// (payload: the window label). Emitted from the app's `WindowEvent::Destroyed`
/// handler so a crash or programmatic close still reaches the main window,
/// which uses it to give the surface back to its in-window station.
pub const STATION_WINDOW_CLOSED_EVENT: &str = "orgii:station-window-closed";

/// Session ids are `<source-prefix>-<uuid>` shaped. The id is embedded
/// verbatim in both the window label and the app-route path, so anything
/// outside the shared safe charset is refused rather than escaped — escaping
/// differently per context would let label and URL disagree about identity.
fn is_window_safe_session_id(session_id: &str) -> bool {
    !session_id.is_empty()
        && session_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn session_window_label(session_id: &str) -> String {
    format!("{SESSION_WINDOW_LABEL_PREFIX}{session_id}")
}

fn is_station_window_mode(mode: &str) -> bool {
    STATION_WINDOW_MODES.contains(&mode)
}

fn station_window_label(mode: &str) -> String {
    format!("{STATION_WINDOW_LABEL_PREFIX}{mode}")
}

/// Whether `label` names a detached station window.
pub fn is_station_window_label(label: &str) -> bool {
    label
        .strip_prefix(STATION_WINDOW_LABEL_PREFIX)
        .is_some_and(is_station_window_mode)
}

/// App route a station window loads: the standalone
/// `/orgii/app/station/<mode>` page, seeded with the session the opener was
/// showing so the window converges on it before the live follow event
/// (`orgii:station-window:session`) can reach a listener.
fn station_window_route(mode: &str, session_id: Option<&str>) -> String {
    match session_id {
        Some(id) => format!("orgii/app/station/{mode}?session={id}"),
        None => format!("orgii/app/station/{mode}"),
    }
}

fn normalize_window_title(title: Option<String>) -> String {
    title
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| "ORG2".to_string())
}

/// Focus an already-open detached window, refreshing its title. Returns the
/// label so callers can short-circuit their own build.
fn focus_existing_detached_window(
    app: &AppHandle,
    label: &str,
    title: &str,
) -> Result<Option<String>, String> {
    let Some(existing) = app.get_webview_window(label) else {
        return Ok(None);
    };
    let _ = existing.set_title(title);
    existing
        .show()
        .map_err(|e| format!("Failed to show {label}: {e}"))?;
    existing
        .set_focus()
        .map_err(|e| format!("Failed to focus {label}: {e}"))?;
    Ok(Some(label.to_string()))
}

/// Build and show a detached app window — the same bundle as the main
/// window, loading one standalone app route. Shared by session and station
/// windows so both get the identical chrome contract.
///
/// There is no prewarmed window pool: the window is built on demand and
/// shown as soon as its chrome is in place, which is the fastest honest
/// feedback we can give. It is built hidden (not `visible(true)`) only so
/// the frames between `build()` and the chrome below never reach the screen
/// — the `show()` is synchronous with creation, NOT deferred to the
/// frontend's first paint.
///
/// Chrome follows the decorated-secondary-window recipe used by
/// `browser::open_browser_window`: native decorations everywhere, macOS
/// overlay title bar with repositioned traffic lights (the builder option
/// alone is unreliable for dynamically created windows — see
/// `set_traffic_light_position`), and Win11 DWM rounded corners.
fn build_detached_app_window(
    app: &AppHandle,
    label: &str,
    route: String,
    title: &str,
    inner_size: (f64, f64),
) -> Result<tauri::WebviewWindow, String> {
    let backdrop = super::startup_backdrop::startup_backdrop(app);
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(route.into()))
        .title(title)
        .inner_size(inner_size.0, inner_size.1)
        .min_inner_size(450.0, 300.0)
        .resizable(true)
        // Shown explicitly after the chrome below is applied, so the window
        // never appears in its pre-chrome state.
        .visible(false)
        .decorations(true)
        // Opaque startup backdrop for the hosts whose secondary windows are
        // opaque (Windows, Linux): it covers the gap before the webview
        // paints. It follows the app's own theme and matches --splash-bg
        // exactly, so the native backdrop and the first thing the page paints
        // are the same colour — a fixed dark value opened a light-theme
        // window dark, then white, then the app. macOS clears it again below:
        // a transparent window wants its vibrancy there, not a plate.
        .background_color(tauri::window::Color(
            backdrop.0, backdrop.1, backdrop.2, 0xff,
        ));

    // Same chrome contract as the main window's config: a TRANSPARENT
    // NSWindow under the overlay title bar. Without transparency, macOS
    // draws an opaque titlebar band across the top and the repositioned
    // traffic lights sit against a mismatched strip instead of over the
    // app's own header.
    #[cfg(target_os = "macos")]
    let builder = builder
        .hidden_title(true)
        .title_bar_style(TitleBarStyle::Overlay)
        .transparent(true)
        .traffic_light_position(Position::Logical(LogicalPosition::new(
            super::TRAFFIC_LIGHT_X,
            super::TRAFFIC_LIGHT_Y,
        )));

    let ownership_observation =
        perf_utils::begin_webview_ownership_observation(label.to_string());
    let window = builder
        .build()
        .map_err(|e| format!("Failed to create {label}: {e}"))?;
    ownership_observation.commit();

    // Reposition the traffic lights (the builder option alone is unreliable
    // for dynamically created windows), mount the same vibrancy material the
    // main window uses, and then clear the builder's opaque backdrop so the
    // webview composites onto that material from its very first frame. Same
    // contract as the main window's setup hook: a macOS window ends on
    // vibrancy, so vibrancy is also its honest pre-paint surface. Enabling
    // WKWebView background drawing here instead made the webview paint its
    // own opaque base under the page for the whole bundle boot — on a light
    // theme a full-window white rectangle on a window whose settled
    // appearance is transparent: the white flash. index.html keeps the splash
    // plate off every macOS window to match (`html[data-host-desktop="macos"]`).
    //
    // The frontend still invokes `remove_window_background` once React paints;
    // the background clear is then a no-op and the call only re-asserts the
    // traffic-light inset (which the observers installed by the first call
    // below already keep in place).
    #[cfg(target_os = "macos")]
    {
        super::set_traffic_light_position(&window, super::TRAFFIC_LIGHT_X, super::TRAFFIC_LIGHT_Y);
        super::apply_macos_window_material(&window);
        super::remove_window_background_color(&window);
        super::rendering_rate::apply_stored_rendering_rate(&window);
    }

    super::apply_host_desktop_decorated_window_corners(&window);

    // Chrome is in place: reveal the window. Not deferred to the frontend's
    // first paint — the click that opened it must get immediate feedback.
    window
        .show()
        .map_err(|e| format!("Failed to show {label}: {e}"))?;

    let _ = window.set_focus();

    Ok(window)
}

/// Open (or focus) the detached window showing exactly one session.
///
/// The window loads the standalone `/orgii/app/session/<id>` route — the same
/// bundle as the main window, rendering only the session surface. See
/// [`build_detached_app_window`] for the chrome and show contract.
///
/// `async` on purpose: on Windows, building a window from a synchronous
/// command deadlocks the main thread.
#[tauri::command]
pub async fn open_session_window(
    app: AppHandle,
    session_id: String,
    title: Option<String>,
) -> Result<String, String> {
    if !is_window_safe_session_id(&session_id) {
        return Err(format!(
            "Session id contains characters unsafe for a window label: {session_id}"
        ));
    }

    let label = session_window_label(&session_id);
    let window_title = normalize_window_title(title);

    if let Some(label) = focus_existing_detached_window(&app, &label, &window_title)? {
        return Ok(label);
    }

    let route = format!("orgii/app/session/{session_id}");
    build_detached_app_window(&app, &label, route, &window_title, (1100.0, 800.0))?;

    Ok(label)
}

/// Open (or focus) the detached window showing one station — My Station
/// (`my-station`) or Agent Station (`agent-station`) — without the chat
/// panel or sidebar. One window per mode: a second request focuses the
/// existing window and the frontend retargets its session over the
/// `orgii:station-window:session` event.
///
/// The window loads the standalone `/orgii/app/station/<mode>` route,
/// seeded with `session_id` so the station converges on the opener's
/// session before any listener could receive the live follow event.
///
/// `async` on purpose: on Windows, building a window from a synchronous
/// command deadlocks the main thread.
#[tauri::command]
pub async fn open_station_window(
    app: AppHandle,
    station_mode: String,
    session_id: Option<String>,
    title: Option<String>,
) -> Result<String, String> {
    if !is_station_window_mode(&station_mode) {
        return Err(format!("Unknown station mode: {station_mode:?}"));
    }
    if let Some(id) = session_id.as_deref() {
        if !is_window_safe_session_id(id) {
            return Err(format!(
                "Session id contains characters unsafe for a window route: {id}"
            ));
        }
    }

    let label = station_window_label(&station_mode);
    let window_title = normalize_window_title(title);

    if let Some(label) = focus_existing_detached_window(&app, &label, &window_title)? {
        return Ok(label);
    }

    let route = station_window_route(&station_mode, session_id.as_deref());
    build_detached_app_window(&app, &label, route, &window_title, (1280.0, 860.0))?;

    Ok(label)
}

#[cfg(test)]
mod session_window_tests {
    use super::{is_window_safe_session_id, session_window_label};

    #[test]
    fn accepts_prefixed_uuid_session_ids() {
        assert!(is_window_safe_session_id(
            "osagent-1f2e3d4c-5b6a-7980-a1b2-c3d4e5f60718"
        ));
        assert!(is_window_safe_session_id("humansession-abc_123"));
    }

    #[test]
    fn rejects_ids_unsafe_for_labels_or_paths() {
        assert!(!is_window_safe_session_id(""));
        assert!(!is_window_safe_session_id("osagent-1234/../../etc"));
        assert!(!is_window_safe_session_id("osagent 1234"));
        assert!(!is_window_safe_session_id("osagent-1234?x=1"));
        assert!(!is_window_safe_session_id("osagent-1234.json"));
    }

    #[test]
    fn label_matches_the_capability_glob() {
        assert_eq!(
            session_window_label("osagent-1"),
            "app-window-session-osagent-1"
        );
        assert!(session_window_label("x").starts_with("app-window-"));
    }
}

#[cfg(test)]
mod station_window_tests {
    use super::{
        is_station_window_label, is_station_window_mode, station_window_label,
        station_window_route,
    };

    #[test]
    fn accepts_only_the_two_station_modes() {
        assert!(is_station_window_mode("my-station"));
        assert!(is_station_window_mode("agent-station"));
        assert!(!is_station_window_mode(""));
        assert!(!is_station_window_mode("My-Station"));
        assert!(!is_station_window_mode("my-station/../x"));
    }

    #[test]
    fn label_matches_the_capability_glob_and_round_trips() {
        assert_eq!(
            station_window_label("agent-station"),
            "app-window-station-agent-station"
        );
        assert!(station_window_label("my-station").starts_with("app-window-"));
        assert!(is_station_window_label("app-window-station-my-station"));
        assert!(!is_station_window_label("app-window-station-kanban"));
        assert!(!is_station_window_label("app-window-session-osagent-1"));
        assert!(!is_station_window_label("main"));
    }

    #[test]
    fn route_carries_the_seed_session_only_when_given() {
        assert_eq!(
            station_window_route("my-station", None),
            "orgii/app/station/my-station"
        );
        assert_eq!(
            station_window_route("agent-station", Some("osagent-1")),
            "orgii/app/station/agent-station?session=osagent-1"
        );
    }
}

/// Whether the main window has a translucent native backdrop (Windows 11
/// acrylic). The frontend mirrors this as `<html data-windows-chrome>` so
/// CSS can relax its opaque fail-safe background. Always `false` on
/// Windows 10 (acrylic disabled — drag lag) and non-Windows hosts (macOS
/// vibrancy uses its own `data-host-desktop="macos"` CSS path).
#[tauri::command]
pub fn main_window_chrome_is_acrylic() -> bool {
    #[cfg(windows)]
    {
        super::windows_corner::current_policy().acrylic
    }
    #[cfg(not(windows))]
    {
        false
    }
}
