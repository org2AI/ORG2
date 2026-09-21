//! Public AppKit menu vibrancy, available before our macOS 10.15 minimum.
//!
//! The content view owns the material view. Its identifier makes repeated enable
//! calls idempotent without a global registry, observers, or retained windows.
//! Do not use NSGlassEffectView or the undocumented NSVisualEffectView
//! `setCornerRadius:` selector: AppKit clips the decorated window itself.
//!
//! Native views under the webview, bottom to top: the material, the root tint
//! ([`set_root_tint`]) and the page backdrop
//! ([`set_page_backdrop_on_content_view`], revealed only while resizing by
//! `page_backdrop::native`). Each one is inserted relative to the views below
//! it, so the order holds whichever of them is mounted first.

use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool};
use objc2::{msg_send, sel};
use objc2_app_kit::{
    NSAutoresizingMaskOptions, NSUserInterfaceItemIdentification, NSView,
    NSVisualEffectBlendingMode, NSVisualEffectMaterial, NSVisualEffectState, NSVisualEffectView,
    NSWindow, NSWindowOrderingMode,
};
use objc2_foundation::{MainThreadMarker, NSDictionary, NSNull, NSPoint, NSRect, NSSize, NSString};

use crate::page_backdrop::{page_backdrop_frame, PageBackdrop};

const MATERIAL_IDENTIFIER: &str = "org2.window.menu-vibrancy";
const ROOT_TINT_IDENTIFIER: &str = "org2.window.root-tint";
const PAGE_BACKDROP_IDENTIFIER: &str = "org2.window.page-backdrop";

/// Complete the native mutation before returning, including when called by an
/// async Tauri command. Looking up the NSWindow inside the main-thread closure
/// avoids carrying an unretained native pointer across a dispatch boundary.
pub(super) fn set_enabled(window: &tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    with_content_view(window, move |content_view, mtm| {
        set_on_content_view(content_view, enabled, mtm)
    })
}

/// Run `mutate` against the window's content view on the AppKit main thread,
/// synchronously, whether or not the caller is already there.
pub(crate) fn with_content_view<T: Send>(
    window: &tauri::WebviewWindow,
    mutate: impl FnOnce(&NSView, MainThreadMarker) -> T + Send,
) -> Result<T, String> {
    let mut mutate = Some(mutate);
    let mut result = Err("Window content view closure did not run".to_owned());
    let mut run = || {
        result = (|| {
            let mtm = MainThreadMarker::new().ok_or("Window material requires the main thread")?;
            let pointer = window
                .ns_window()
                .map_err(|error| format!("Failed to get native window: {error}"))?;
            // SAFETY: Tauri supplies the NSWindow for this live window. The
            // lookup and all uses stay in one synchronous main-thread call.
            let native_window = unsafe { pointer.cast::<NSWindow>().as_ref() }
                .ok_or("Native window is unavailable")?;
            let content_view = native_window
                .contentView()
                .ok_or("Native window has no content view")?;
            let mutate = mutate
                .take()
                .ok_or("Window content view closure already ran")?;
            Ok(mutate(&content_view, mtm))
        })();
    };

    if MainThreadMarker::new().is_some() {
        run();
    } else {
        dispatch2::DispatchQueue::main().exec_sync(run);
    }
    result
}

fn find_subview(content_view: &NSView, identifier: &NSString) -> Option<Retained<NSView>> {
    content_view
        .subviews()
        .iter()
        .find(|view| view.identifier().as_deref() == Some(identifier))
}

/// Paint (or remove) the app's root tint as a native layer directly under the
/// webview and above the vibrancy material.
///
/// The page's root surfaces on macOS are translucent tints over the material
/// (`html[data-host-desktop="macos"]` in `src/index.scss`). When the window
/// grows, AppKit resizes the window and the WKWebView's view synchronously,
/// but the page pixels arrive from the WebContent process one or more frames
/// later; the newly exposed strip shows whatever sits behind the webview.
/// With the tint living in CSS that strip was raw material, visibly lighter
/// than the root surface. Hosting the same composite tint natively makes the
/// strip match that surface, and the frontend then drops its CSS tint
/// (`data-native-root-tint`) so the two never stack. The strip beside the
/// opaque page is covered by the page backdrop above this layer.
///
/// `color` is sRGB `[r, g, b, a]` in `0.0..=1.0`. `None` removes the layer.
pub(super) fn set_root_tint(
    window: &tauri::WebviewWindow,
    color: Option<[f64; 4]>,
) -> Result<(), String> {
    with_content_view(window, move |content_view, mtm| {
        set_root_tint_on_content_view(content_view, color, mtm)
    })
}

fn set_root_tint_on_content_view(
    content_view: &NSView,
    color: Option<[f64; 4]>,
    mtm: MainThreadMarker,
) {
    let identifier = NSString::from_str(ROOT_TINT_IDENTIFIER);
    let existing = find_subview(content_view, &identifier);
    let Some([r, g, b, a]) = color else {
        if let Some(view) = existing {
            view.removeFromSuperview();
        }
        return;
    };

    let tint = match existing {
        Some(view) => view,
        None => {
            let view = NSView::initWithFrame(mtm.alloc(), content_view.bounds());
            view.setIdentifier(Some(&identifier));
            view.setAutoresizingMask(
                NSAutoresizingMaskOptions::ViewWidthSizable
                    | NSAutoresizingMaskOptions::ViewHeightSizable,
            );
            // Own an explicit layer rather than relying on `wantsLayer` to
            // create one lazily: the colour below is set immediately, and a
            // nil layer would leave an invisible view and no fix.
            // SAFETY: plain class-method sends on the main thread.
            unsafe {
                let layer_class = AnyClass::get(c"CALayer").expect("CALayer");
                let layer: *mut AnyObject = msg_send![layer_class, layer];
                let _: () = msg_send![&*view, setLayer: layer];
            }
            view.setWantsLayer(true);
            // Above the material when it is mounted, otherwise at the very
            // bottom: `set_on_content_view` always inserts the material at the
            // bottom, so the tint stays above it across vibrancy toggles.
            match find_subview(content_view, &NSString::from_str(MATERIAL_IDENTIFIER)) {
                Some(material) => content_view.addSubview_positioned_relativeTo(
                    &view,
                    NSWindowOrderingMode::Above,
                    Some(&material),
                ),
                None => content_view.addSubview_positioned_relativeTo(
                    &view,
                    NSWindowOrderingMode::Below,
                    None,
                ),
            }
            view
        }
    };

    set_layer_background_color(&tint, [r, g, b, a]);
}

/// The page backdrop mounted in `content_view`, if any.
pub(crate) fn page_backdrop_view(content_view: &NSView) -> Option<Retained<NSView>> {
    find_subview(content_view, &NSString::from_str(PAGE_BACKDROP_IDENTIFIER))
}

/// Mount, update or (`None`) remove the page backdrop: an opaque layer in the
/// page colour under the page surface's region, directly beneath the webview.
/// See `page_backdrop` for why it exists and when it is visible.
///
/// A new backdrop starts hidden; `page_backdrop::native` reveals it while the
/// window resizes. Updating an existing one keeps its visibility.
pub(crate) fn set_page_backdrop_on_content_view(
    content_view: &NSView,
    backdrop: Option<PageBackdrop>,
    mtm: MainThreadMarker,
) {
    let existing = page_backdrop_view(content_view);
    let Some(backdrop) = backdrop else {
        if let Some(view) = existing {
            view.removeFromSuperview();
        }
        return;
    };

    let view = existing.unwrap_or_else(|| create_page_backdrop_view(content_view, mtm));
    let bounds = content_view.bounds();
    let [x, y, width, height] = page_backdrop_frame(
        bounds.size.width,
        bounds.size.height,
        backdrop.insets,
        webview_page_zoom(content_view),
        content_view.isFlipped(),
    );
    view.setFrame(NSRect::new(NSPoint::new(x, y), NSSize::new(width, height)));
    set_layer_background_color(&view, backdrop.color);
}

fn create_page_backdrop_view(content_view: &NSView, mtm: MainThreadMarker) -> Retained<NSView> {
    let view = NSView::initWithFrame(mtm.alloc(), content_view.bounds());
    view.setIdentifier(Some(&NSString::from_str(PAGE_BACKDROP_IDENTIFIER)));
    // Width and height follow the window; all four margins stay fixed, so
    // the sidebar inset holds and the trailing edges track the window's.
    view.setAutoresizingMask(
        NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable,
    );
    // SAFETY: plain class-method and property sends on the main thread
    // against a layer created here.
    unsafe {
        let layer_class = AnyClass::get(c"CALayer").expect("CALayer");
        let layer: *mut AnyObject = msg_send![layer_class, layer];
        // The reveal has to land in the frame of the resize that caused it; a
        // standalone layer would otherwise fade `hidden` (and colour and
        // geometry changes) in over CoreAnimation's default 0.25 s.
        let keys = ["hidden", "backgroundColor", "bounds", "position"].map(NSString::from_str);
        let null = NSNull::null();
        let key_refs: Vec<&NSString> = keys.iter().map(|key| &**key).collect();
        let no_action: &AnyObject = AsRef::<AnyObject>::as_ref(&*null);
        let actions = NSDictionary::<NSString, AnyObject>::from_slices(
            &key_refs,
            &vec![no_action; key_refs.len()],
        );
        let _: () = msg_send![layer, setActions: &*actions];
        let _: () = msg_send![&*view, setLayer: layer];
    }
    view.setWantsLayer(true);
    view.setHidden(true);

    // Directly under the webview: above the root tint, or above the material
    // while no tint is mounted. The tint is inserted directly above the
    // material and the material at the very bottom, so neither can later
    // land above this view.
    let anchor = find_subview(content_view, &NSString::from_str(ROOT_TINT_IDENTIFIER))
        .or_else(|| find_subview(content_view, &NSString::from_str(MATERIAL_IDENTIFIER)));
    match anchor {
        Some(anchor) => content_view.addSubview_positioned_relativeTo(
            &view,
            NSWindowOrderingMode::Above,
            Some(&anchor),
        ),
        None => {
            content_view.addSubview_positioned_relativeTo(&view, NSWindowOrderingMode::Below, None)
        }
    }
    view
}

/// `pageZoom` of the window's own webview (Tauri's `set_zoom`), which scales
/// CSS px into points. 1 when there is none or the API predates macOS 11.
fn webview_page_zoom(content_view: &NSView) -> f64 {
    let Some(web_view_class) = AnyClass::get(c"WKWebView") else {
        return 1.0;
    };
    // The window's own webview is added before any inline child webview, so
    // it is the first WKWebView among the content view's subviews.
    for view in content_view.subviews().iter() {
        // SAFETY: plain NSObject / WKWebView message sends on the main thread.
        unsafe {
            let is_web_view: Bool = msg_send![&*view, isKindOfClass: web_view_class];
            if !is_web_view.as_bool() {
                continue;
            }
            let responds: Bool = msg_send![&*view, respondsToSelector: sel!(pageZoom)];
            return if responds.as_bool() {
                msg_send![&*view, pageZoom]
            } else {
                1.0
            };
        }
    }
    1.0
}

fn set_layer_background_color(view: &NSView, [r, g, b, a]: [f64; 4]) {
    // SAFETY: plain AppKit / CoreAnimation message sends on the main thread
    // against a view this module owns.
    unsafe {
        let ns_color_class = AnyClass::get(c"NSColor").expect("NSColor");
        let ns_color: *mut AnyObject = msg_send![
            ns_color_class,
            colorWithSRGBRed: r,
            green: g,
            blue: b,
            alpha: a,
        ];
        let cg_color: *mut AnyObject = msg_send![ns_color, CGColor];
        let layer: *mut AnyObject = msg_send![view, layer];
        if !layer.is_null() {
            let _: () = msg_send![layer, setBackgroundColor: cg_color];
        }
    }
}

fn set_on_content_view(content_view: &NSView, enabled: bool, mtm: MainThreadMarker) {
    let identifier = NSString::from_str(MATERIAL_IDENTIFIER);
    let subviews = content_view.subviews();
    for view in subviews.iter() {
        if view.identifier().as_deref() == Some(&*identifier) {
            if !enabled {
                view.removeFromSuperview();
            }
            return;
        }
    }
    if !enabled {
        return;
    }

    let material = NSVisualEffectView::initWithFrame(mtm.alloc(), content_view.bounds());
    material.setIdentifier(Some(&identifier));
    material.setMaterial(NSVisualEffectMaterial::Menu);
    material.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
    material.setState(NSVisualEffectState::FollowsWindowActiveState);
    material.setAutoresizingMask(
        NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable,
    );
    content_view.addSubview_positioned_relativeTo(&material, NSWindowOrderingMode::Below, None);
}
