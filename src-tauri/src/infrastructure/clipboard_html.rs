//! Unsanitized clipboard HTML.
//!
//! WebKit runs pasteboard markup through a sanitizer before it reaches a
//! webview's `paste` event, and that sanitizer drops elements it does not
//! recognise along with their subtrees. Pages assembled from custom elements —
//! GitHub's list views among them — therefore arrive as a bare skeleton.
//! Measured on a four-row pull-request list: 45,981 bytes carrying eight
//! anchors reached the composer as 5,358 bytes of empty `<li>`s, every title,
//! link and byline gone, with only `aria-label` left as evidence they existed.
//!
//! The bytes are still on the pasteboard; it is only the webview's copy that is
//! stripped. Reading `public.html` straight from `NSPasteboard` hands the
//! composer the markup the user actually copied, so its HTML→Markdown pass has
//! something to work with. Chromium-based editors never hit this because they
//! do not run WebKit's sanitizer.

/// Above this the payload costs more to ferry over IPC than the paste is worth,
/// and the frontend converter refuses it anyway. Returning `None` past the cap
/// degrades to the sanitized flavor rather than stalling the paste.
#[cfg(target_os = "macos")]
const MAX_CLIPBOARD_HTML_BYTES: usize = 1_000_000;

/// Read the clipboard's HTML flavor as the source application wrote it.
///
/// Returns `None` when the pasteboard holds no HTML, when the payload exceeds
/// the size cap, or on any platform other than macOS — every caller treats that
/// as "use what the paste event gave you".
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn read_clipboard_html() -> Option<String> {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeHTML};

    let pasteboard = NSPasteboard::generalPasteboard();
    // SAFETY: `NSPasteboardTypeHTML` is an immutable string constant vended by
    // AppKit and valid for the lifetime of the process.
    let html_type = unsafe { NSPasteboardTypeHTML };
    let html = pasteboard.stringForType(html_type)?.to_string();

    if html.len() > MAX_CLIPBOARD_HTML_BYTES {
        return None;
    }
    Some(html)
}

/// Non-macOS platforms have no WebKit sanitizer to work around: the paste
/// event's own `text/html` flavor is already the markup the user copied.
#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn read_clipboard_html() -> Option<String> {
    None
}
