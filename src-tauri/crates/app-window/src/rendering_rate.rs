//! Page rendering pace of the app's own webviews (`general.highRefreshRate`).
//!
//! WebKit paces page rendering updates near 60 Hz even on 120 Hz ProMotion
//! displays, while Chromium-based apps render at the display's full rate. The
//! internal `PreferPageRenderingUpdatesNear60FPSEnabled` feature switches that
//! pacing; measured on an M1 Pro MacBook Pro, requestAnimationFrame went from
//! 60 to 120 fps. The cost is energy while something redraws every frame
//! (repaint animations, drags, scrolling) — an idle page renders nothing at
//! either rate — so the setting is user-selectable and on by default.
//!
//! WebKit samples the preference when a page becomes visible. Set before a
//! window is first shown it applies from the first frame; a page that is
//! already on screen is hidden for one frame so the change lands without a
//! restart.
//!
//! The feature toggle is WebKit SPI (`+[WKPreferences _features]`,
//! `-[WKPreferences _setEnabled:forFeature:]`). Both are probed, so a WebKit
//! without them keeps its default pacing. Only app UI windows are touched:
//! Browser pane and OAuth webviews render third-party pages at WebKit's pace.

use tauri::{AppHandle, WebviewWindow};

use crate::commands::{SESSION_WINDOW_LABEL_PREFIX, STATION_WINDOW_LABEL_PREFIX};

/// Settings key mirrored by `general.highRefreshRate` in
/// `src/config/settingsSchema/registry/general.ts`.
pub const HIGH_REFRESH_RATE_SETTING_KEY: &str = "general.highRefreshRate";

/// The preference given the stored boolean, if any. An absent key or a
/// non-boolean value resolves to the registry default (on).
pub fn resolve_high_refresh_rate(stored: Option<bool>) -> bool {
    stored.unwrap_or(true)
}

/// Windows that render ORG2's own UI: the main window and detached session /
/// station windows.
pub fn is_app_ui_window(label: &str) -> bool {
    label == "main"
        || label.starts_with(SESSION_WINDOW_LABEL_PREFIX)
        || label.starts_with(STATION_WINDOW_LABEL_PREFIX)
}

/// Apply the stored preference to a window's own webview. Call before the
/// window is first shown so its first frame already uses the chosen pace.
pub fn apply_stored_rendering_rate(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        let stored = settings::file_io::read_settings()
            .ok()
            .and_then(|settings| {
                settings
                    .get(HIGH_REFRESH_RATE_SETTING_KEY)
                    .and_then(|value| value.as_bool())
            });
        macos::apply(window, resolve_high_refresh_rate(stored));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

/// Re-apply after `settings.jsonc` changed, given the stored boolean read by
/// the settings hook. Webviews already at the requested pace are left
/// untouched, so unrelated settings changes cost nothing visible.
pub fn apply_rendering_rate_to_app_windows(app: &AppHandle, stored: Option<bool>) {
    #[cfg(target_os = "macos")]
    {
        use tauri::Manager;

        let high_refresh_rate = resolve_high_refresh_rate(stored);
        for (label, window) in app.webview_windows() {
            if is_app_ui_window(&label) {
                macos::apply(&window, high_refresh_rate);
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, stored);
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::{c_char, CStr};
    use std::time::Duration;

    use dispatch2::{DispatchQueue, DispatchTime, MainThreadBound};
    use objc2::rc::autoreleasepool;
    use objc2::runtime::{AnyClass, AnyObject, Bool, Sel};
    use objc2::{msg_send, sel, MainThreadMarker, Message};
    use objc2_app_kit::NSView;
    use tauri::WebviewWindow;

    const NEAR_60_FPS_FEATURE: &CStr = c"PreferPageRenderingUpdatesNear60FPSEnabled";

    /// Long enough for AppKit to publish the hidden state to WebKit before the
    /// view is shown again; a same-turn hide/show is coalesced and ignored.
    const RESAMPLE_HIDE_DURATION: Duration = Duration::from_millis(16);

    pub(super) fn apply(window: &WebviewWindow, high_refresh_rate: bool) {
        let result = window.with_webview(move |webview| {
            // SAFETY: Tauri runs this closure on the main thread with the
            // window's own, live WKWebView.
            unsafe { set_page_rendering_pace(webview.inner().cast(), high_refresh_rate) };
        });
        if let Err(error) = result {
            tracing::warn!(%error, "Failed to reach the webview to set its rendering rate");
        }
    }

    /// # Safety
    /// Must run on the main thread; `web_view` is a live WKWebView or null.
    unsafe fn set_page_rendering_pace(web_view: *mut AnyObject, high_refresh_rate: bool) {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let Some(web_view) = (unsafe { web_view.as_ref() }) else {
            return;
        };
        autoreleasepool(|_| {
            let Some(feature) = (unsafe { near_60_fps_feature() }) else {
                tracing::debug!(
                    "WebKit exposes no page rendering pace feature; keeping its default"
                );
                return;
            };
            // `configuration` is a copy, but it shares the live WKPreferences.
            let configuration: *mut AnyObject = unsafe { msg_send![web_view, configuration] };
            let Some(configuration) = (unsafe { configuration.as_ref() }) else {
                return;
            };
            let preferences: *mut AnyObject = unsafe { msg_send![configuration, preferences] };
            let Some(preferences) = (unsafe { preferences.as_ref() }) else {
                return;
            };
            if !responds_to(preferences, sel!(_setEnabled:forFeature:)) {
                return;
            }

            let near_60_fps = !high_refresh_rate;
            if responds_to(preferences, sel!(_isEnabledForFeature:)) {
                let current: Bool =
                    unsafe { msg_send![preferences, _isEnabledForFeature: feature] };
                if current.as_bool() == near_60_fps {
                    return;
                }
            }
            let _: () = unsafe {
                msg_send![preferences, _setEnabled: Bool::new(near_60_fps), forFeature: feature]
            };

            // SAFETY: WKWebView is an NSView subclass.
            let view = unsafe { &*(web_view as *const AnyObject).cast::<NSView>() };
            resample_if_on_screen(view, mtm);
        });
    }

    /// The `_WKFeature` controlling the near-60 Hz pacing, if this WebKit has it.
    ///
    /// # Safety
    /// Must run on the main thread inside an autorelease pool.
    unsafe fn near_60_fps_feature() -> Option<*mut AnyObject> {
        let class = AnyClass::get(c"WKPreferences")?;
        let responds: Bool = unsafe { msg_send![class, respondsToSelector: sel!(_features)] };
        if !responds.as_bool() {
            return None;
        }
        let features: *mut AnyObject = unsafe { msg_send![class, _features] };
        let features = unsafe { features.as_ref() }?;
        let count: usize = unsafe { msg_send![features, count] };
        (0..count).find_map(|index| {
            let feature: *mut AnyObject = unsafe { msg_send![features, objectAtIndex: index] };
            let key: *mut AnyObject = unsafe { msg_send![feature.as_ref()?, key] };
            let utf8: *const c_char = unsafe { msg_send![key.as_ref()?, UTF8String] };
            let matches = !utf8.is_null() && unsafe { CStr::from_ptr(utf8) } == NEAR_60_FPS_FEATURE;
            matches.then_some(feature)
        })
    }

    fn responds_to(object: &AnyObject, selector: Sel) -> bool {
        let responds: Bool = unsafe { msg_send![object, respondsToSelector: selector] };
        responds.as_bool()
    }

    /// A page already on screen keeps its pace until it becomes visible again,
    /// so hide the webview for one frame. Hidden or not-yet-shown webviews pick
    /// the preference up when they are shown.
    fn resample_if_on_screen(view: &NSView, mtm: MainThreadMarker) {
        let Some(window) = view.window() else {
            return;
        };
        if !window.isVisible() || view.isHidden() {
            return;
        }
        let Ok(when) = DispatchTime::try_from(RESAMPLE_HIDE_DURATION) else {
            return;
        };

        view.setHidden(true);
        let restore = MainThreadBound::new(view.retain(), mtm);
        let scheduled = DispatchQueue::main().after(when, move || {
            if let Some(mtm) = MainThreadMarker::new() {
                restore.get(mtm).setHidden(false);
            }
        });
        if scheduled.is_err() {
            view.setHidden(false);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{is_app_ui_window, resolve_high_refresh_rate};

    #[test]
    fn defaults_to_high_refresh_rate() {
        assert!(resolve_high_refresh_rate(None));
    }

    #[test]
    fn follows_the_stored_boolean() {
        assert!(!resolve_high_refresh_rate(Some(false)));
        assert!(resolve_high_refresh_rate(Some(true)));
    }

    #[test]
    fn targets_only_app_ui_windows() {
        assert!(is_app_ui_window("main"));
        assert!(is_app_ui_window("app-window-session-osagent-1"));
        assert!(is_app_ui_window("app-window-station-my-station"));
        assert!(!is_app_ui_window("browser-window-1"));
        assert!(!is_app_ui_window("claude-code-oauth"));
        assert!(!is_app_ui_window("mainframe"));
    }
}
