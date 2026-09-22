//! Native page backdrop: keeps a macOS window resize from exposing
//! translucent vibrancy beside the app's opaque page.
//!
//! WebKit on macOS 14+ composites web content in the UI process
//! (`RemoteLayerTreeDrawingAreaProxy`). A window resize reaches the WKWebView
//! at once, but its new size goes to the WebContent process without a
//! CoreAnimation fence (`UpdateGeometry(size, flushSynchronously: false)`), so
//! the page arrives at that size one or more frames later. Until then the band
//! the page has not painted shows whatever sits under the transparent webview:
//! the Menu material and the root tint (`macos_material::set_root_tint`), a
//! translucent surface next to a page that is opaque. The legacy tiled drawing
//! area fenced the resize with the web process's commit, which is why the band
//! used to be absent.
//!
//! The frontend reports its opaque page surface through
//! `set_window_page_backdrop`: the surface's insets from the viewport edges
//! and the colour it paints. [`native::set_page_backdrop`] keeps an opaque
//! layer of that colour under that region, between the root tint and the
//! webview, and reveals it only while the window is resizing. Under the page
//! it is covered; in the band at the trailing edges it shows the page colour
//! instead of the material. It is hidden again once resizing has been quiet for
//! [`RESIZE_REVEAL_HOLD`]. It cannot stay visible: the frontend's new insets
//! reach it a frame or two after the page repaints, so a visible layer would
//! sit under the translucent sidebar whenever the sidebar grows.
//!
//! The reveal runs from `NSWindowDidResizeNotification` and
//! `NSWindowWillStartLiveResizeNotification` observers, not from Tauri's
//! `WindowEvent::Resized`. tao only queues that event and drains the queue in a
//! run-loop observer ordered after CoreAnimation's commit, so a reveal from it
//! would reach the screen one frame after the resize.
//!
//! Measured against a standalone AppKit + WKWebView harness on macOS 26 with
//! this window's layer stack (programmatic 10 pt growth steps over a
//! text-heavy page): the trailing band showed the page colour in 18% of
//! samples without the layer and in 100% with it revealed from the resize
//! notification, first step included. With 16–33 ms of emulated IPC delay, an
//! always-visible layer put a band of up to 54 pt under a growing sidebar;
//! the resize-only reveal put none.

use std::time::Duration;

/// How long the backdrop stays revealed after the last resize event. The page
/// normally catches up within a few frames; the hold only has to outlast a
/// slow re-layout, and a late hide is invisible because the page covers the
/// layer.
pub const RESIZE_REVEAL_HOLD: Duration = Duration::from_millis(500);

/// Lowest alpha accepted as opaque. A translucent backdrop would stack
/// visibly under the translucent surface it mirrors while it is revealed.
pub const OPAQUE_ALPHA_MIN: f64 = 0.999;

/// The page surface the frontend asked to back natively.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PageBackdrop {
    /// Distance from the viewport's top, right, bottom and left edges to the
    /// page surface, in CSS px.
    pub insets: [f64; 4],
    /// Opaque sRGB colour `[r, g, b, a]`, components in `0.0..=1.0`.
    pub color: [f64; 4],
}

/// Validate a page backdrop from the wire.
///
/// Negative insets clamp to zero. A non-finite value, or a colour that is not
/// opaque, is rejected: the frontend only mirrors opaque surfaces, so either
/// means its measurement went wrong.
pub fn normalize_page_backdrop(insets: [f64; 4], color: [f64; 4]) -> Result<PageBackdrop, String> {
    if insets.iter().any(|inset| !inset.is_finite()) {
        return Err(format!("Page backdrop inset is not finite: {insets:?}"));
    }
    let [r, g, b, a] = crate::root_tint::normalize_root_tint(color)
        .ok_or_else(|| format!("Page backdrop colour has a non-finite component: {color:?}"))?;
    if a < OPAQUE_ALPHA_MIN {
        return Err(format!("Page backdrop colour must be opaque: {color:?}"));
    }
    Ok(PageBackdrop {
        insets: insets.map(|inset| inset.max(0.0)),
        color: [r, g, b, 1.0],
    })
}

/// AppKit frame `[x, y, width, height]` of the backdrop inside a content view
/// of `width` × `height` points.
///
/// `insets` are CSS px, scaled by the webview's `page_zoom` into points.
/// `flipped` is the content view's `isFlipped`: `y` measures from the top
/// edge when it is set and from the bottom edge otherwise.
pub fn page_backdrop_frame(
    width: f64,
    height: f64,
    insets: [f64; 4],
    page_zoom: f64,
    flipped: bool,
) -> [f64; 4] {
    let zoom = if page_zoom.is_finite() && page_zoom > 0.0 {
        page_zoom
    } else {
        1.0
    };
    let [top, right, bottom, left] = insets.map(|inset| inset * zoom);
    [
        left,
        if flipped { top } else { bottom },
        (width - left - right).max(0.0),
        (height - top - bottom).max(0.0),
    ]
}

/// When to look again at a revealed backdrop: `None` hides it now, otherwise
/// the delay before the next check. A live resize holds it for as long as
/// the pointer does, even when the frame stops changing.
pub fn reveal_hold_remaining(
    since_last_resize: Duration,
    in_live_resize: bool,
) -> Option<Duration> {
    if in_live_resize {
        return Some(RESIZE_REVEAL_HOLD);
    }
    RESIZE_REVEAL_HOLD
        .checked_sub(since_last_resize)
        .filter(|remaining| !remaining.is_zero())
}

#[cfg(target_os = "macos")]
pub(crate) mod native {
    use std::ptr::NonNull;
    use std::sync::{Mutex, MutexGuard};
    use std::time::{Duration, Instant};

    use block2::RcBlock;
    use dispatch2::{DispatchQueue, DispatchTime, MainThreadBound};
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, ProtocolObject};
    use objc2_app_kit::{
        NSView, NSWindow, NSWindowDidEndLiveResizeNotification, NSWindowDidResizeNotification,
        NSWindowWillStartLiveResizeNotification,
    };
    use objc2_foundation::{
        MainThreadMarker, NSNotification, NSNotificationCenter, NSObjectProtocol,
    };

    use super::{reveal_hold_remaining, PageBackdrop, RESIZE_REVEAL_HOLD};
    use crate::macos_material::{
        page_backdrop_view, set_page_backdrop_on_content_view, with_content_view,
    };

    /// Resize observers and reveal state for one window.
    struct ResizeWatch {
        label: String,
        /// The `NSWindow` the observers were registered on. A window
        /// recreated under the same label gets fresh observers.
        ns_window: usize,
        /// Observer tokens as raw `Retained` pointers: the tokens are not
        /// `Send`. Released on the main thread by [`remove_observers`].
        tokens: Vec<usize>,
        last_resize: Option<Instant>,
        hide_check_scheduled: bool,
    }

    static WATCHES: Mutex<Vec<ResizeWatch>> = Mutex::new(Vec::new());

    /// Mount, update or (`None`) remove the page backdrop of `window`, and
    /// start watching the window's resizes the first time one is mounted.
    pub(crate) fn set_page_backdrop(
        window: &tauri::WebviewWindow,
        backdrop: Option<PageBackdrop>,
    ) -> Result<(), String> {
        let label = window.label().to_owned();
        with_content_view(window, move |content_view, mtm| {
            set_page_backdrop_on_content_view(content_view, backdrop, mtm);
            if backdrop.is_some() {
                if let Some(ns_window) = content_view.window() {
                    watch_resizes(&label, &ns_window);
                }
            }
        })
    }

    /// Stop watching `label`'s resizes. Call from the `Destroyed` window
    /// event; a no-op for windows that never mounted a backdrop.
    pub(crate) fn release_page_backdrop(label: &str) {
        let tokens = {
            let mut watches = lock_watches();
            match watches.iter().position(|watch| watch.label == label) {
                Some(index) => watches.swap_remove(index).tokens,
                None => return,
            }
        };
        if crate::is_main_thread() {
            remove_observers(tokens);
        } else {
            DispatchQueue::main().exec_async(move || remove_observers(tokens));
        }
    }

    /// Main thread only. Idempotent per window.
    fn watch_resizes(label: &str, ns_window: &NSWindow) {
        let ns_window_addr = ns_window as *const NSWindow as usize;
        let stale_tokens = {
            let mut watches = lock_watches();
            match watches.iter().position(|watch| watch.label == label) {
                Some(index) if watches[index].ns_window == ns_window_addr => return,
                Some(index) => watches.swap_remove(index).tokens,
                None => Vec::new(),
            }
        };
        remove_observers(stale_tokens);

        let reveal_label = label.to_owned();
        let reveal = RcBlock::new(move |notification: NonNull<NSNotification>| {
            // SAFETY: NSNotificationCenter passes a live notification.
            on_window_resize(unsafe { notification.as_ref() }, &reveal_label, true);
        });
        let settle_label = label.to_owned();
        let settle = RcBlock::new(move |notification: NonNull<NSNotification>| {
            // SAFETY: as above.
            on_window_resize(unsafe { notification.as_ref() }, &settle_label, false);
        });

        let center = NSNotificationCenter::defaultCenter();
        let observed = AsRef::<AnyObject>::as_ref(ns_window);
        // SAFETY: AppKit's notification-name statics; the blocks are copied
        // by the center, which keeps them until the tokens are removed.
        let tokens = unsafe {
            [
                (NSWindowWillStartLiveResizeNotification, &reveal),
                (NSWindowDidResizeNotification, &reveal),
                (NSWindowDidEndLiveResizeNotification, &settle),
            ]
            .into_iter()
            .map(|(name, block)| {
                let token = center.addObserverForName_object_queue_usingBlock(
                    Some(name),
                    Some(observed),
                    None,
                    block,
                );
                Retained::into_raw(token) as usize
            })
            .collect()
        };
        lock_watches().push(ResizeWatch {
            label: label.to_owned(),
            ns_window: ns_window_addr,
            tokens,
            last_resize: None,
            hide_check_scheduled: false,
        });
    }

    /// Runs synchronously inside AppKit's resize notifications, so a reveal
    /// lands in the same CoreAnimation transaction as the new window frame.
    /// Tauri APIs are deliberately avoided here: the notification can be
    /// posted from inside a Tauri call that resizes the window.
    fn on_window_resize(notification: &NSNotification, label: &str, reveal: bool) {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let Some(object) = notification.object() else {
            return;
        };
        // SAFETY: the observer was registered on an NSWindow, and AppKit posts
        // window notifications on the main thread with that window as object.
        let ns_window = unsafe { Retained::cast_unchecked::<NSWindow>(object) };
        let Some(content_view) = ns_window.contentView() else {
            return;
        };
        let Some(view) = page_backdrop_view(&content_view) else {
            return;
        };
        if reveal && view.isHidden() {
            view.setHidden(false);
        }
        let schedule_check = {
            let mut watches = lock_watches();
            let Some(watch) = watches.iter_mut().find(|watch| watch.label == label) else {
                return;
            };
            watch.last_resize = Some(Instant::now());
            !std::mem::replace(&mut watch.hide_check_scheduled, true)
        };
        if schedule_check {
            schedule_hide_check(label.to_owned(), ns_window, view, RESIZE_REVEAL_HOLD, mtm);
        }
    }

    fn schedule_hide_check(
        label: String,
        ns_window: Retained<NSWindow>,
        view: Retained<NSView>,
        delay: Duration,
        mtm: MainThreadMarker,
    ) {
        let fallback_view = view.clone();
        let check_label = label.clone();
        let targets = MainThreadBound::new((ns_window, view), mtm);
        let scheduled = DispatchTime::try_from(delay).ok().and_then(|when| {
            DispatchQueue::main()
                .after(when, move || {
                    if let Some(mtm) = MainThreadMarker::new() {
                        let (ns_window, view) = targets.into_inner(mtm);
                        run_hide_check(check_label, ns_window, view, mtm);
                    }
                })
                .ok()
        });
        if scheduled.is_none() {
            // Never leave the layer revealed without a pending check.
            finish_reveal(&label);
            fallback_view.setHidden(true);
        }
    }

    fn run_hide_check(
        label: String,
        ns_window: Retained<NSWindow>,
        view: Retained<NSView>,
        mtm: MainThreadMarker,
    ) {
        let since_last_resize = {
            let watches = lock_watches();
            let Some(watch) = watches.iter().find(|watch| watch.label == label) else {
                return;
            };
            watch
                .last_resize
                .map_or(RESIZE_REVEAL_HOLD, |last_resize| last_resize.elapsed())
        };
        match reveal_hold_remaining(since_last_resize, ns_window.inLiveResize()) {
            Some(remaining) => schedule_hide_check(label, ns_window, view, remaining, mtm),
            None => {
                finish_reveal(&label);
                view.setHidden(true);
            }
        }
    }

    fn finish_reveal(label: &str) {
        if let Some(watch) = lock_watches().iter_mut().find(|watch| watch.label == label) {
            watch.hide_check_scheduled = false;
        }
    }

    /// Main thread only.
    fn remove_observers(tokens: Vec<usize>) {
        if tokens.is_empty() {
            return;
        }
        let center = NSNotificationCenter::defaultCenter();
        for token in tokens {
            // SAFETY: the pointer came from `Retained::into_raw` in
            // `watch_resizes` and is released exactly once here.
            let Some(token) =
                (unsafe { Retained::from_raw(token as *mut ProtocolObject<dyn NSObjectProtocol>) })
            else {
                continue;
            };
            unsafe { center.removeObserver(AsRef::<AnyObject>::as_ref(&*token)) };
        }
    }

    fn lock_watches() -> MutexGuard<'static, Vec<ResizeWatch>> {
        WATCHES
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DARK_PAGE: [f64; 4] = [20.0 / 255.0, 20.0 / 255.0, 20.0 / 255.0, 1.0];

    #[test]
    fn accepts_an_opaque_page_surface() {
        assert_eq!(
            normalize_page_backdrop([0.0, 0.0, 0.0, 240.0], DARK_PAGE),
            Ok(PageBackdrop {
                insets: [0.0, 0.0, 0.0, 240.0],
                color: DARK_PAGE,
            })
        );
    }

    #[test]
    fn clamps_negative_insets_and_near_opaque_alpha() {
        let backdrop =
            normalize_page_backdrop([-0.5, 0.0, -3.0, 12.0], [0.5, 0.5, 0.5, 0.9995]).unwrap();
        assert_eq!(backdrop.insets, [0.0, 0.0, 0.0, 12.0]);
        assert_eq!(backdrop.color[3], 1.0);
    }

    #[test]
    fn rejects_translucent_colours() {
        assert!(normalize_page_backdrop([0.0; 4], [1.0, 1.0, 1.0, 0.386]).is_err());
        assert!(normalize_page_backdrop([0.0; 4], [1.0, 1.0, 1.0, 0.0]).is_err());
    }

    #[test]
    fn rejects_non_finite_values() {
        assert!(normalize_page_backdrop([f64::NAN, 0.0, 0.0, 0.0], DARK_PAGE).is_err());
        assert!(normalize_page_backdrop([0.0; 4], [0.0, f64::INFINITY, 0.0, 1.0]).is_err());
    }

    #[test]
    fn frame_leaves_the_sidebar_out_and_reaches_the_trailing_edges() {
        // 1200 × 800 content view, 240 px sidebar, page flush with the other edges.
        assert_eq!(
            page_backdrop_frame(1200.0, 800.0, [0.0, 0.0, 0.0, 240.0], 1.0, false),
            [240.0, 0.0, 960.0, 800.0]
        );
    }

    #[test]
    fn frame_scales_css_px_by_page_zoom() {
        assert_eq!(
            page_backdrop_frame(1200.0, 800.0, [10.0, 0.0, 20.0, 200.0], 1.5, false),
            [300.0, 30.0, 900.0, 755.0]
        );
    }

    #[test]
    fn frame_measures_y_from_the_top_in_a_flipped_view() {
        assert_eq!(
            page_backdrop_frame(1200.0, 800.0, [10.0, 0.0, 20.0, 0.0], 1.0, true)[1],
            10.0
        );
    }

    #[test]
    fn frame_treats_an_invalid_zoom_as_unzoomed_and_never_goes_negative() {
        assert_eq!(
            page_backdrop_frame(300.0, 200.0, [0.0, 0.0, 0.0, 100.0], f64::NAN, false),
            [100.0, 0.0, 200.0, 200.0]
        );
        assert_eq!(
            page_backdrop_frame(300.0, 200.0, [150.0, 200.0, 150.0, 200.0], 0.0, false),
            [200.0, 150.0, 0.0, 0.0]
        );
    }

    #[test]
    fn hold_counts_down_from_the_last_resize() {
        assert_eq!(
            reveal_hold_remaining(Duration::from_millis(200), false),
            Some(Duration::from_millis(300))
        );
        assert_eq!(reveal_hold_remaining(RESIZE_REVEAL_HOLD, false), None);
        assert_eq!(reveal_hold_remaining(Duration::from_secs(3), false), None);
    }

    #[test]
    fn hold_lasts_while_a_live_resize_is_still_tracking() {
        assert_eq!(
            reveal_hold_remaining(Duration::from_secs(3), true),
            Some(RESIZE_REVEAL_HOLD)
        );
    }
}
