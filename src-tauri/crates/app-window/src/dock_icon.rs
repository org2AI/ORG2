//! The icon the *running* app shows in the macOS Dock / app switcher and, on
//! Windows and Linux, in each window's title bar and taskbar entry.
//!
//! Only the live process is affected: the bundle on disk keeps its signed
//! `icon.icns`, so Finder, Launchpad and Spotlight always show the default
//! mark. That is the same contract other apps with a "Dock icon" preference
//! have, and it is what keeps the code signature intact. Because the change
//! is per-process, the stored preference is re-applied at every launch
//! ([`apply_stored_dock_icon`]) before the main window is shown.

use tauri::AppHandle;

/// Settings key mirrored by `general.dockIcon` in
/// `src/config/settingsSchema/registry/general.ts`.
pub const DOCK_ICON_SETTING_KEY: &str = "general.dockIcon";

/// Bundled 512×512 PNGs rendered from `src/assets/appIcons/*.svg`.
/// All variants omit the circle behind the mark; light keeps a soft inset
/// edge so the white tile still reads on a light Dock.
const DARK_ICON_PNG: &[u8] = include_bytes!("../../../icons/dock/dark.png");
const LIGHT_ICON_PNG: &[u8] = include_bytes!("../../../icons/dock/light.png");
const RAINBOW_ICON_PNG: &[u8] = include_bytes!("../../../icons/dock/rainbow.png");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DockIconVariant {
    /// The bundle's own icon: dark tile, light `II`.
    #[default]
    Dark,
    /// Inverted: light tile, dark `II`.
    Light,
    /// Rainbow tile with the light `II` mark.
    Rainbow,
}

impl DockIconVariant {
    /// Parse the wire / settings value. Unknown values are `None` rather than
    /// the default so callers can tell "select dark icon" from "garbage".
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim() {
            "dark" => Some(Self::Dark),
            "light" => Some(Self::Light),
            "rainbow" => Some(Self::Rainbow),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Dark => "dark",
            Self::Light => "light",
            Self::Rainbow => "rainbow",
        }
    }

    fn png(self) -> &'static [u8] {
        match self {
            Self::Dark => DARK_ICON_PNG,
            Self::Light => LIGHT_ICON_PNG,
            Self::Rainbow => RAINBOW_ICON_PNG,
        }
    }
}

/// The user's stored variant. An absent key, an unreadable settings file, or
/// an unrecognised value all resolve to the default so a bad edit to
/// `settings.jsonc` can never leave the app without an icon.
pub fn stored_dock_icon_variant() -> DockIconVariant {
    settings::file_io::read_settings()
        .ok()
        .and_then(|settings| {
            settings
                .get(DOCK_ICON_SETTING_KEY)?
                .as_str()
                .and_then(DockIconVariant::parse)
        })
        .unwrap_or_default()
}

/// Re-apply the stored preference for this launch, including dark on macOS:
/// a directly launched executable may not have a bundle icon to fall back to.
pub fn apply_stored_dock_icon(app: &AppHandle) {
    let variant = stored_dock_icon_variant();
    #[cfg(not(target_os = "macos"))]
    if variant == DockIconVariant::default() {
        return;
    }
    if let Err(err) = apply_dock_icon(app, variant) {
        tracing::warn!(error = %err, variant = variant.as_str(), "Failed to apply stored dock icon");
    }
}

/// Switch the live process's icon.
///
/// macOS: `NSApplication.applicationIconImage`, which drives the Dock tile
/// and the ⌘-Tab switcher. All variants use the embedded PNG so development
/// and directly launched executables do not fall back to a generic icon.
/// AppKit requires the main thread; the command runs off it, so the call is hopped over
/// synchronously the same way the window-material helpers do.
///
/// Windows / Linux: each webview window's icon, which is what the taskbar
/// and title bar show. Windows created later start from the bundle icon and
/// are covered by the frontend re-applying the setting on mount.
pub fn apply_dock_icon(app: &AppHandle, variant: DockIconVariant) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        set_macos_application_icon(variant);
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        use tauri::{image::Image, Manager};

        let icon = Image::from_bytes(variant.png())
            .map_err(|err| format!("Failed to decode bundled dock icon: {err}"))?;
        for window in app.webview_windows().values() {
            window
                .set_icon(icon.clone())
                .map_err(|err| format!("Failed to set window icon: {err}"))?;
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn macos_application_icon(
    variant: DockIconVariant,
) -> Option<objc2::rc::Retained<objc2_app_kit::NSImage>> {
    use objc2::AllocAnyThread;
    use objc2_app_kit::NSImage;
    use objc2_foundation::NSData;

    let data = NSData::with_bytes(variant.png());
    NSImage::initWithData(NSImage::alloc(), &data)
}

#[cfg(target_os = "macos")]
fn set_macos_application_icon(variant: DockIconVariant) {
    use objc2_app_kit::NSApplication;
    use objc2_foundation::MainThreadMarker;

    let run = move || {
        // Only reachable on the main thread (directly, or via the sync hop
        // below); the marker call is the proof AppKit's API demands.
        let Some(mtm) = MainThreadMarker::new() else {
            tracing::warn!("Dock icon update reached a non-main thread; skipped");
            return;
        };
        let app = NSApplication::sharedApplication(mtm);
        let Some(image) = macos_application_icon(variant) else {
            tracing::warn!(
                variant = variant.as_str(),
                "Bundled dock icon failed to decode; keeping the current icon"
            );
            return;
        };
        // SAFETY: called on the main thread with an image AppKit owns a
        // retained reference to. Never reset to the executable's fallback icon.
        unsafe { app.setApplicationIconImage(Some(&image)) };
    };

    if crate::is_main_thread() {
        run();
    } else {
        dispatch2::DispatchQueue::main().exec_sync(run);
    }
}

#[cfg(test)]
mod tests {
    use super::DockIconVariant;

    #[test]
    fn parses_known_variants_and_tolerates_whitespace() {
        assert_eq!(DockIconVariant::parse("dark"), Some(DockIconVariant::Dark));
        assert_eq!(
            DockIconVariant::parse(" light "),
            Some(DockIconVariant::Light)
        );
        assert_eq!(
            DockIconVariant::parse("rainbow"),
            Some(DockIconVariant::Rainbow)
        );
    }

    #[test]
    fn rejects_unknown_variants() {
        assert_eq!(DockIconVariant::parse(""), None);
        assert_eq!(DockIconVariant::parse("Light"), None);
        assert_eq!(DockIconVariant::parse("inverted"), None);
    }

    #[test]
    fn default_is_the_bundle_icon() {
        assert_eq!(DockIconVariant::default(), DockIconVariant::Dark);
        assert_eq!(DockIconVariant::default().as_str(), "dark");
    }

    #[test]
    fn round_trips_through_as_str() {
        for variant in [
            DockIconVariant::Dark,
            DockIconVariant::Light,
            DockIconVariant::Rainbow,
        ] {
            assert_eq!(DockIconVariant::parse(variant.as_str()), Some(variant));
        }
    }

    #[test]
    fn bundled_icons_are_png() {
        const PNG_MAGIC: &[u8] = b"\x89PNG\r\n\x1a\n";
        assert!(super::DARK_ICON_PNG.starts_with(PNG_MAGIC));
        assert!(super::LIGHT_ICON_PNG.starts_with(PNG_MAGIC));
        assert!(super::RAINBOW_ICON_PNG.starts_with(PNG_MAGIC));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_variants_decode_without_an_app_bundle() {
        // The test executable has no app bundle. In particular, switching
        // light -> dark must supply an image instead of resetting to nil.
        objc2::rc::autoreleasepool(|_| {
            for variant in [
                DockIconVariant::Light,
                DockIconVariant::Dark,
                DockIconVariant::Rainbow,
            ] {
                let image = super::macos_application_icon(variant)
                    .expect("each variant must supply a native image without bundle metadata");
                let size = image.size();
                assert_eq!(size.width, 512.0);
                assert_eq!(size.height, 512.0);
            }
        });
    }
}
