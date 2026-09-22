//! macOS traffic-light placement that survives AppKit's own title-bar layout.
//!
//! The overlay title bar puts the close / minimise / zoom buttons over the
//! app's own header, and the frontend lays its chrome out around a fixed
//! spot for them ([`TRAFFIC_LIGHT_X`], [`TRAFFIC_LIGHT_CENTER_Y`]). AppKit
//! has no API for that spot: like tao's `inset_traffic_lights`, we reach into
//! the private title-bar hierarchy, grow the `NSTitlebarContainerView`, and
//! move the three buttons.
//!
//! AppKit treats that as a temporary override. Its theme-frame layout
//! re-runs on a window resize (including `zoom:` and every native
//! full-screen transition), on `setTitle:` (the detached session window
//! sets its title on mount and on every rename), on an appearance change,
//! and on de-miniaturise, and each pass puts the container back to its
//! standard height and the buttons back to their default origin. A
//! one-shot placement therefore drifts: the buttons snap to the corner on
//! the first resize and only come back when some later event happens to
//! re-apply them — which is why clicking a window used to "move" them.
//!
//! Two mechanisms keep them pinned, both measured against a standalone
//! AppKit harness on macOS 26 before landing:
//!
//! 1. **Synchronous re-apply from the window delegate.** tao's
//!    `windowDidResize:` / `windowDidBecomeKey:` run *after* the theme
//!    frame has laid out, and Tauri delivers them synchronously as
//!    `WindowEvent::Resized` / `Focused(true)`. Re-applying there lands in
//!    the same display cycle, so a live resize never shows the default
//!    position (`app::lifecycle::sync_traffic_lights_on_window_event`).
//! 2. **A coalesced re-apply on `NSViewFrameDidChangeNotification`.** The
//!    container and the buttons post it whenever AppKit moves them, which
//!    covers the resets that have no delegate callback (`setTitle:`,
//!    appearance, de-miniaturise). A view's frame cannot be corrected from
//!    inside its own notification — AppKit finishes its `setFrame:` after
//!    posting and overwrites the correction — so the handler only schedules
//!    one main-queue re-apply, which runs once the layout pass is over.
//!
//! Every write is skipped when the frame already matches, so the re-apply
//! posts no notifications of its own and the loop settles immediately.

/// Left edge of the close button, in points from the window's left edge.
/// The other two buttons follow at AppKit's native spacing.
pub const TRAFFIC_LIGHT_X: f64 = 20.0;

/// Title-bar growth, in points: the title bar container is resized to
/// `button height + TRAFFIC_LIGHT_Y`. This is tao's formula, kept identical
/// so the `trafficLightPosition` the window builder / `tauri.conf.json`
/// hand to tao lands on the same container height whenever tao's own
/// (draw-time) re-apply happens to run.
pub const TRAFFIC_LIGHT_Y: f64 = 28.0;

/// Vertical centre of the buttons, in points from the window's top edge.
/// Mirrors `COLLAPSED_SIDEBAR_CHROME_CENTER_TOP` in
/// `src/hooks/ui/sidebar/useCollapsedSidebarChromeOffset.ts`, which the
/// pinned sidebar chrome and every detached-window header align to.
pub const TRAFFIC_LIGHT_CENTER_Y: f64 = 26.0;

/// Fallback spacing between button left edges, in points beyond one button
/// width, used only if the native spacing cannot be read (buttons
/// overlapping mid-layout). 9 is the macOS 26 measurement (14 pt buttons,
/// 23 pt pitch).
#[cfg(any(target_os = "macos", test))]
const FALLBACK_BUTTON_GAP_BEYOND_WIDTH: f64 = 9.0;

/// Target frames for the title-bar container and the three buttons, in
/// AppKit's bottom-left coordinates.
#[cfg(any(target_os = "macos", test))]
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct TrafficLightLayout {
    /// Height of the `NSTitlebarContainerView`.
    pub title_bar_height: f64,
    /// Bottom edge of that container, from the window's bottom edge.
    pub title_bar_origin_y: f64,
    /// Bottom edge of every button, from the container's bottom edge.
    pub button_origin_y: f64,
    /// Left edge of close, minimise and zoom, from the window's left edge.
    pub button_origins_x: [f64; 3],
}

/// Pure geometry behind [`set_traffic_light_position`].
///
/// `button_gap` is the pitch between button left edges; pass AppKit's
/// native value (see [`native_button_gap`]) so the trio keeps the system
/// spacing. The result is independent of where the buttons currently are,
/// which is what makes a re-apply idempotent.
#[cfg(any(target_os = "macos", test))]
pub(crate) fn traffic_light_layout(
    window_height: f64,
    button_height: f64,
    button_gap: f64,
    x: f64,
    y: f64,
    center_y: f64,
) -> TrafficLightLayout {
    let title_bar_height = button_height + y;
    TrafficLightLayout {
        title_bar_height,
        title_bar_origin_y: window_height - title_bar_height,
        button_origin_y: title_bar_height - center_y - button_height / 2.0,
        button_origins_x: [x, x + button_gap, x + 2.0 * button_gap],
    }
}

/// AppKit's own pitch between the buttons, read from a pristine layout; the
/// fallback derives it from the button width when the two frames read
/// inconsistent (a partially re-laid-out title bar).
#[cfg(any(target_os = "macos", test))]
pub(crate) fn native_button_gap(
    close_origin_x: f64,
    miniaturize_origin_x: f64,
    button_width: f64,
) -> f64 {
    let measured = miniaturize_origin_x - close_origin_x;
    if measured > button_width && measured < 3.0 * button_width {
        measured
    } else {
        button_width + FALLBACK_BUTTON_GAP_BEYOND_WIDTH
    }
}

#[cfg(target_os = "macos")]
pub use native::{set_traffic_light_position, unpin_traffic_lights};

/// No observers exist off macOS; the lifecycle hook calls this unconditionally.
#[cfg(not(target_os = "macos"))]
pub fn unpin_traffic_lights(_label: &str) {}

#[cfg(target_os = "macos")]
mod native {
    use std::ptr::NonNull;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex, OnceLock};

    use block2::RcBlock;
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, ProtocolObject};
    use objc2_app_kit::{NSViewFrameDidChangeNotification, NSWindowButton};
    use objc2_foundation::{
        NSNotification, NSNotificationCenter, NSObjectProtocol, NSPoint, NSRect,
    };

    use super::{native_button_gap, traffic_light_layout, TRAFFIC_LIGHT_CENTER_Y};
    use crate::is_main_thread;

    /// AppKit's button pitch, measured once on the first (pristine) window.
    static NATIVE_BUTTON_GAP: OnceLock<f64> = OnceLock::new();

    /// Frame-change observer tokens per window label. Raw `Retained`
    /// pointers as `usize` because the tokens are not `Send`; they are
    /// re-wrapped and released on the main thread by [`unpin_traffic_lights`].
    static PINNED: Mutex<Vec<(String, Vec<usize>)>> = Mutex::new(Vec::new());

    struct TitleBarViews {
        container: *mut AnyObject,
        buttons: [*mut AnyObject; 3],
    }

    /// The private views the placement writes to: `NSTitlebarContainerView`
    /// (two levels above a button) and the three standard buttons.
    unsafe fn title_bar_views(ns_window: *mut AnyObject) -> Option<TitleBarViews> {
        let close: *mut AnyObject =
            msg_send![ns_window, standardWindowButton: NSWindowButton::CloseButton];
        let miniaturize: *mut AnyObject =
            msg_send![ns_window, standardWindowButton: NSWindowButton::MiniaturizeButton];
        let zoom: *mut AnyObject =
            msg_send![ns_window, standardWindowButton: NSWindowButton::ZoomButton];
        if close.is_null() || miniaturize.is_null() || zoom.is_null() {
            return None;
        }
        let title_bar: *mut AnyObject = msg_send![close, superview];
        if title_bar.is_null() {
            return None;
        }
        let container: *mut AnyObject = msg_send![title_bar, superview];
        if container.is_null() {
            return None;
        }
        Some(TitleBarViews {
            container,
            buttons: [close, miniaturize, zoom],
        })
    }

    /// Write the target frames. Main thread only. Each write is skipped when
    /// the view is already there, so a settled window produces no
    /// `NSViewFrameDidChangeNotification` traffic.
    unsafe fn apply(ns_window: *mut AnyObject, x: f64, y: f64) {
        let Some(views) = title_bar_views(ns_window) else {
            return;
        };
        let window_frame: NSRect = msg_send![ns_window, frame];
        let close_frame: NSRect = msg_send![views.buttons[0], frame];
        let miniaturize_frame: NSRect = msg_send![views.buttons[1], frame];
        let gap = *NATIVE_BUTTON_GAP.get_or_init(|| {
            native_button_gap(
                close_frame.origin.x,
                miniaturize_frame.origin.x,
                close_frame.size.width,
            )
        });
        let layout = traffic_light_layout(
            window_frame.size.height,
            close_frame.size.height,
            gap,
            x,
            y,
            TRAFFIC_LIGHT_CENTER_Y,
        );

        let mut container_frame: NSRect = msg_send![views.container, frame];
        if container_frame.size.height != layout.title_bar_height
            || container_frame.origin.y != layout.title_bar_origin_y
        {
            container_frame.size.height = layout.title_bar_height;
            container_frame.origin.y = layout.title_bar_origin_y;
            let _: () = msg_send![views.container, setFrame: container_frame];
        }

        for (button, origin_x) in views.buttons.iter().zip(layout.button_origins_x) {
            let frame: NSRect = msg_send![*button, frame];
            let origin = NSPoint::new(origin_x, layout.button_origin_y);
            if frame.origin != origin {
                let _: () = msg_send![*button, setFrameOrigin: origin];
            }
        }
    }

    /// Apply on the main thread, synchronously, from any thread.
    fn apply_now(window: &tauri::WebviewWindow, x: f64, y: f64) {
        let Ok(ns_window_ptr) = window.ns_window() else {
            return;
        };
        let ns_window_addr = ns_window_ptr as usize;
        let run = move || unsafe { apply(ns_window_addr as *mut AnyObject, x, y) };
        if is_main_thread() {
            run();
        } else {
            dispatch2::DispatchQueue::main().exec_sync(run);
        }
    }

    /// Place the traffic lights on a macOS window and keep them there.
    ///
    /// `x` is the close button's left edge and `y` the title-bar growth
    /// (see the crate constants); the vertical centre is always
    /// [`TRAFFIC_LIGHT_CENTER_Y`]. Must be called after window creation —
    /// the builder's `traffic_light_position` only re-applies from tao's
    /// content-view `drawRect:`, which a webview-covered window seldom
    /// runs. Safe to call repeatedly: it is idempotent, and the first call
    /// for a window also installs the frame-change observers that re-apply
    /// after AppKit's own title-bar layout (see the module docs).
    /// [`unpin_traffic_lights`] removes them when the window is destroyed.
    pub fn set_traffic_light_position(window: &tauri::WebviewWindow, x: f64, y: f64) {
        apply_now(window, x, y);
        pin(window, x, y);
    }

    /// Install one coalesced frame-change observer per title-bar view.
    /// Idempotent per window label.
    fn pin(window: &tauri::WebviewWindow, x: f64, y: f64) {
        let label = window.label().to_string();
        if lock_pinned().iter().any(|(pinned, _)| *pinned == label) {
            return;
        }
        let Ok(ns_window_ptr) = window.ns_window() else {
            return;
        };
        let ns_window_addr = ns_window_ptr as usize;
        let window = window.clone();
        let install = move || {
            // The caller-side check is only a fast path. Concurrent callers
            // can both pass it before either installation reaches this queue.
            // Recheck on the main thread, which serializes this check with
            // observer installation and registry insertion below.
            if lock_pinned().iter().any(|(pinned, _)| *pinned == label) {
                return;
            }
            // SAFETY: main thread, live window; the views are only used for
            // the duration of this closure and never stored.
            let Some(views) = (unsafe { title_bar_views(ns_window_addr as *mut AnyObject) }) else {
                tracing::debug!(label = %label, "[Window] traffic lights: no title-bar views to pin");
                return;
            };
            let pending = Arc::new(AtomicBool::new(false));
            let block = RcBlock::new(move |_notification: NonNull<NSNotification>| {
                // One re-apply per burst: AppKit moves all four views in a
                // single layout pass, and the fix cannot run inside it.
                if pending.swap(true, Ordering::AcqRel) {
                    return;
                }
                let pending = Arc::clone(&pending);
                let window = window.clone();
                dispatch2::DispatchQueue::main().exec_async(move || {
                    pending.store(false, Ordering::Release);
                    apply_now(&window, x, y);
                });
            });
            let center = NSNotificationCenter::defaultCenter();
            let name = unsafe { NSViewFrameDidChangeNotification };
            let mut tokens = Vec::with_capacity(4);
            for view in std::iter::once(views.container).chain(views.buttons) {
                unsafe {
                    let _: () = msg_send![view, setPostsFrameChangedNotifications: true];
                    let token = center.addObserverForName_object_queue_usingBlock(
                        Some(name),
                        Some(&*view),
                        None,
                        &block,
                    );
                    tokens.push(Retained::into_raw(token) as usize);
                }
            }
            lock_pinned().push((label, tokens));
        };
        if is_main_thread() {
            install();
        } else {
            dispatch2::DispatchQueue::main().exec_sync(install);
        }
    }

    /// Remove the observers installed for `label` and release their tokens.
    /// Call from the `Destroyed` window event; a no-op for unpinned labels.
    pub fn unpin_traffic_lights(label: &str) {
        let tokens = {
            let mut pinned = lock_pinned();
            match pinned.iter().position(|(pinned, _)| pinned == label) {
                Some(index) => pinned.swap_remove(index).1,
                None => return,
            }
        };
        let release = move || {
            let center = NSNotificationCenter::defaultCenter();
            for token in tokens {
                // SAFETY: the pointer came from `Retained::into_raw` in `pin`
                // and is released exactly once here.
                let Some(token) = (unsafe {
                    Retained::from_raw(token as *mut ProtocolObject<dyn NSObjectProtocol>)
                }) else {
                    continue;
                };
                unsafe { center.removeObserver(AsRef::<AnyObject>::as_ref(&*token)) };
            }
        };
        if is_main_thread() {
            release();
        } else {
            dispatch2::DispatchQueue::main().exec_async(release);
        }
    }

    fn lock_pinned() -> std::sync::MutexGuard<'static, Vec<(String, Vec<usize>)>> {
        PINNED
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// macOS 26 measurements: 14 pt buttons at a 23 pt pitch, default
    /// container 32 pt with the buttons 9 pt off its bottom edge.
    const TAHOE_BUTTON_HEIGHT: f64 = 14.0;
    const TAHOE_BUTTON_GAP: f64 = 23.0;

    fn center_from_top(window_height: f64, button_height: f64, layout: &TrafficLightLayout) -> f64 {
        window_height - (layout.title_bar_origin_y + layout.button_origin_y + button_height / 2.0)
    }

    #[test]
    fn tahoe_layout_matches_the_frontend_contract() {
        let layout = traffic_light_layout(
            600.0,
            TAHOE_BUTTON_HEIGHT,
            TAHOE_BUTTON_GAP,
            TRAFFIC_LIGHT_X,
            TRAFFIC_LIGHT_Y,
            TRAFFIC_LIGHT_CENTER_Y,
        );
        assert_eq!(layout.title_bar_height, 42.0);
        assert_eq!(layout.title_bar_origin_y, 558.0);
        // Identical to AppKit's default bottom offset, so a window that was
        // already correct is left untouched.
        assert_eq!(layout.button_origin_y, 9.0);
        assert_eq!(layout.button_origins_x, [20.0, 43.0, 66.0]);
        assert_eq!(
            center_from_top(600.0, TAHOE_BUTTON_HEIGHT, &layout),
            TRAFFIC_LIGHT_CENTER_Y
        );
        // The frontend reserves 84 px; the zoom button's right edge must fit.
        assert!(layout.button_origins_x[2] + TAHOE_BUTTON_HEIGHT <= 84.0);
    }

    #[test]
    fn vertical_center_is_fixed_regardless_of_button_size_or_window_height() {
        for (window_height, button_height, gap) in [
            (500.0, 14.0, 23.0),
            (1084.0, 14.0, 23.0),
            (600.0, 12.0, 20.0),
            (300.0, 16.0, 24.0),
        ] {
            let layout = traffic_light_layout(
                window_height,
                button_height,
                gap,
                TRAFFIC_LIGHT_X,
                TRAFFIC_LIGHT_Y,
                TRAFFIC_LIGHT_CENTER_Y,
            );
            assert_eq!(
                center_from_top(window_height, button_height, &layout),
                TRAFFIC_LIGHT_CENTER_Y,
                "window {window_height} button {button_height}"
            );
            assert_eq!(layout.button_origins_x[0], TRAFFIC_LIGHT_X);
            assert_eq!(layout.button_origins_x[1] - layout.button_origins_x[0], gap);
        }
    }

    #[test]
    fn layout_is_independent_of_current_button_positions() {
        // Nothing about where the buttons are now feeds the target; two
        // calls with the same window give the same frames.
        let a = traffic_light_layout(700.0, 14.0, 23.0, 20.0, 28.0, 26.0);
        let b = traffic_light_layout(700.0, 14.0, 23.0, 20.0, 28.0, 26.0);
        assert_eq!(a, b);
    }

    #[test]
    fn native_gap_uses_the_measured_pitch_when_consistent() {
        assert_eq!(native_button_gap(9.0, 32.0, 14.0), 23.0);
        assert_eq!(native_button_gap(20.0, 43.0, 14.0), 23.0);
        assert_eq!(native_button_gap(7.0, 27.0, 12.0), 20.0);
    }

    #[test]
    fn native_gap_falls_back_when_buttons_read_mid_layout() {
        // Close already moved to 20, minimise still at its default 32.
        assert_eq!(native_button_gap(20.0, 32.0, 14.0), 23.0);
        // Overlapping or absurd readings.
        assert_eq!(native_button_gap(20.0, 20.0, 14.0), 23.0);
        assert_eq!(native_button_gap(0.0, 200.0, 14.0), 23.0);
    }
}
