//! Inline Browser Page Color Scheme (macOS)
//!
//! Lets the user force the `prefers-color-scheme` a browsed page sees, without
//! touching the app's own theme. A child WKWebView normally inherits the
//! window's effective appearance, so browsed pages follow the app theme; an
//! explicit `NSAppearance` on the WKWebView overrides that for the page alone.
//!
//! The preference is process-wide rather than per view: the frontend persists
//! it and re-sends it on start, and this module keeps the last value so a view
//! created later (a new tab, a restored session) is born with it instead of
//! flashing the inherited scheme first.
//!
//! ## Platforms
//!
//! macOS only. WebView2's `PreferredColorScheme` is a profile-wide setting that
//! would also restyle the app's own webview, and WebKitGTK has no per-view
//! override, so those platforms keep following the window theme.

use std::sync::atomic::{AtomicU8, Ordering};

use tauri::{AppHandle, Manager};

/// Labels of the webviews that show user-browsed pages. Mirrors the prefix
/// `getBrowserSessionWebviewLabel` builds on the frontend.
const BROWSER_SESSION_LABEL_PREFIX: &str = "browser-session-";

/// The color scheme a browsed page is told the user prefers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BrowserColorScheme {
    /// Inherit the window's appearance, i.e. follow the app theme.
    Auto,
    Light,
    Dark,
}

impl BrowserColorScheme {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "auto" => Ok(Self::Auto),
            "light" => Ok(Self::Light),
            "dark" => Ok(Self::Dark),
            other => Err(format!("Unknown browser color scheme '{other}'")),
        }
    }

    fn to_u8(self) -> u8 {
        match self {
            Self::Auto => 0,
            Self::Light => 1,
            Self::Dark => 2,
        }
    }

    fn from_u8(value: u8) -> Self {
        match value {
            1 => Self::Light,
            2 => Self::Dark,
            _ => Self::Auto,
        }
    }
}

static PREFERRED_SCHEME: AtomicU8 = AtomicU8::new(0);

fn preferred_scheme() -> BrowserColorScheme {
    BrowserColorScheme::from_u8(PREFERRED_SCHEME.load(Ordering::Relaxed))
}

pub(crate) fn is_browser_session_label(label: &str) -> bool {
    label.starts_with(BROWSER_SESSION_LABEL_PREFIX)
}

/// Record the preferred page color scheme and apply it to every inline browser
/// webview in every window. Returns the labels that took the new scheme.
#[tauri::command]
pub fn browser_webviews_set_color_scheme(
    app: AppHandle,
    scheme: String,
) -> Result<Vec<String>, String> {
    let scheme = BrowserColorScheme::parse(&scheme)?;
    PREFERRED_SCHEME.store(scheme.to_u8(), Ordering::Relaxed);

    let mut applied: Vec<String> = Vec::new();
    for (label, webview) in app.webviews() {
        if !is_browser_session_label(&label) {
            continue;
        }
        match apply_scheme(&webview, scheme) {
            Ok(()) => applied.push(label),
            // Not fatal — a webview might be mid-teardown. Log and continue.
            Err(err) => tracing::warn!(
                label = %label,
                error = %err,
                "browser::color_scheme: skipped webview"
            ),
        }
    }

    Ok(applied)
}

/// Give a freshly created browser webview the recorded preference. `Auto` is
/// what a new view already does, so it is left untouched.
pub(crate) fn apply_preferred(webview: &tauri::Webview) {
    let scheme = preferred_scheme();
    if scheme == BrowserColorScheme::Auto {
        return;
    }
    if let Err(err) = apply_scheme(webview, scheme) {
        tracing::warn!(
            label = %webview.label(),
            error = %err,
            "browser::color_scheme: failed to apply preferred scheme"
        );
    }
}

fn apply_scheme(webview: &tauri::Webview, scheme: BrowserColorScheme) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        apply_scheme_macos(webview, scheme)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = webview;
        let _ = scheme;
        Err("browser page color scheme is only implemented on macOS".to_string())
    }
}

#[cfg(target_os = "macos")]
fn apply_scheme_macos(webview: &tauri::Webview, scheme: BrowserColorScheme) -> Result<(), String> {
    use objc2_app_kit::{
        NSAppearance, NSAppearanceCustomization, NSAppearanceNameAqua, NSAppearanceNameDarkAqua,
        NSView,
    };

    // SAFETY: `wv.inner()` is a valid WKWebView*, which is an NSView, for the
    // duration of the closure; `with_webview` runs it on the main thread, where
    // AppKit requires appearance changes. The pointer is null-checked, and the
    // appearance-name statics are constant AppKit symbols.
    webview
        .with_webview(move |wv| unsafe {
            let view_ptr = wv.inner() as *const NSView;
            let Some(view) = view_ptr.as_ref() else {
                return;
            };

            let appearance = match scheme {
                // nil hands the decision back to the window's appearance.
                BrowserColorScheme::Auto => None,
                BrowserColorScheme::Light => NSAppearance::appearanceNamed(NSAppearanceNameAqua),
                BrowserColorScheme::Dark => NSAppearance::appearanceNamed(NSAppearanceNameDarkAqua),
            };
            view.setAppearance(appearance.as_deref());
        })
        .map_err(|e| format!("with_webview failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_accepts_the_three_wire_values() {
        assert_eq!(
            BrowserColorScheme::parse("auto"),
            Ok(BrowserColorScheme::Auto)
        );
        assert_eq!(
            BrowserColorScheme::parse("light"),
            Ok(BrowserColorScheme::Light)
        );
        assert_eq!(
            BrowserColorScheme::parse("dark"),
            Ok(BrowserColorScheme::Dark)
        );
    }

    #[test]
    fn parse_rejects_unknown_values() {
        assert!(BrowserColorScheme::parse("Dark").is_err());
        assert!(BrowserColorScheme::parse("").is_err());
        assert!(BrowserColorScheme::parse("system").is_err());
    }

    #[test]
    fn stored_byte_round_trips_every_scheme() {
        for scheme in [
            BrowserColorScheme::Auto,
            BrowserColorScheme::Light,
            BrowserColorScheme::Dark,
        ] {
            assert_eq!(BrowserColorScheme::from_u8(scheme.to_u8()), scheme);
        }
    }

    #[test]
    fn unknown_stored_byte_falls_back_to_auto() {
        assert_eq!(BrowserColorScheme::from_u8(200), BrowserColorScheme::Auto);
    }

    #[test]
    fn only_browser_session_labels_are_targeted() {
        assert!(is_browser_session_label("browser-session-1234"));
        assert!(is_browser_session_label(
            "browser-session-1234__window__detached-1"
        ));
        assert!(!is_browser_session_label("main"));
        assert!(!is_browser_session_label("oauth-capture-1"));
    }
}
