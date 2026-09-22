//! Back/Forward through the engine's own back-forward list.
//!
//! The browser chrome owns the visible history (`BrowserSession.history`) and
//! steps through it by handing the target URL to `navigate_inline_webview`.
//! Loading that URL again refetches the document and starts it at the top.
//! When the step is a Back/Forward and the engine's list holds the same URL in
//! that direction, travelling to that item lands on the same page from what the
//! engine already holds: no request for the document, scroll position restored
//! (measured against a wry child WKWebView and a request-counting server).
//!
//! The destination never changes. A step is only taken natively when an item in
//! the requested direction answers to the target URL; anything else reports
//! `false` and the caller loads the URL exactly as it did before. The chrome's
//! history does not record in-page link clicks, so the engine's list is usually
//! longer than the chrome's — hence the search past the adjacent item.
//!
//! macOS only: WebView2 and WebKitGTK expose no per-item URLs to verify against.

use tauri::{AppHandle, Manager};
use url::Url;

mod native_list;

pub use native_list::HistoryDirection;

/// Step an inline webview Back/Forward to `url` through its native list.
///
/// Returns `true` when the engine started that traversal. `false` means nothing
/// happened and the caller should load `url` itself.
#[tauri::command]
pub async fn traverse_inline_webview_history(
    app: AppHandle,
    label: String,
    url: String,
    direction: String,
) -> Result<bool, String> {
    let (Some(direction), Ok(target)) = (HistoryDirection::parse(&direction), Url::parse(&url))
    else {
        return Ok(false);
    };
    let Some(webview) = app.get_webview(&label) else {
        return Ok(false);
    };
    Ok(try_traverse(&webview, direction, target).await)
}

#[cfg(target_os = "macos")]
async fn try_traverse(webview: &tauri::Webview, direction: HistoryDirection, target: Url) -> bool {
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use objc2::runtime::AnyObject;

    /// `with_webview` hops to the main thread; the list walk itself is instant.
    const MAIN_THREAD_TIMEOUT: Duration = Duration::from_secs(1);

    let (tx, mut rx) = tokio::sync::oneshot::channel::<bool>();
    // Held by the closure for its whole run and taken here on timeout, so a late
    // closure can never traverse after the caller already fell back to a plain
    // load of the same URL.
    let abandoned = Arc::new(Mutex::new(false));
    let abandoned_in_closure = Arc::clone(&abandoned);

    let dispatched = webview.with_webview(move |wv| {
        let abandoned = abandoned_in_closure
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if *abandoned {
            return;
        }
        // SAFETY: `with_webview` runs this on the main thread and `inner()` is
        // the live WKWebView, which is what `traverse_on_main_thread` requires.
        let travelled = unsafe {
            native_list::traverse_on_main_thread(wv.inner() as *mut AnyObject, direction, &target)
        };
        let _ = tx.send(travelled);
    });
    if dispatched.is_err() {
        return false;
    }

    match tokio::time::timeout(MAIN_THREAD_TIMEOUT, &mut rx).await {
        Ok(result) => result.unwrap_or(false),
        Err(_) => {
            *abandoned
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) = true;
            // The closure may have finished between the timeout and the lock.
            rx.try_recv().unwrap_or(false)
        }
    }
}

#[cfg(not(target_os = "macos"))]
async fn try_traverse(
    _webview: &tauri::Webview,
    _direction: HistoryDirection,
    _target: Url,
) -> bool {
    false
}
