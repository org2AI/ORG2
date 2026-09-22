//! The WebKit back-forward list walk behind `traverse_inline_webview_history`.
//!
//! Free of Tauri types on purpose: the matching rule is unit-tested here, and
//! the AppKit half can be compiled into a scratch binary and run against a real
//! `WKWebView`, which `cargo test` (off the main thread) cannot do.

// The matching rule only has a caller on macOS (and in tests); gate it so other
// targets do not carry it as dead code.
#[cfg(any(target_os = "macos", test))]
use url::Url;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HistoryDirection {
    Back,
    Forward,
}

impl HistoryDirection {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "back" => Some(Self::Back),
            "forward" => Some(Self::Forward),
            _ => None,
        }
    }
}

/// The URLs one back-forward item answers to: where the load ended up, and what
/// was first requested (they differ after a redirect, and the chrome's history
/// holds the requested one).
#[cfg(any(target_os = "macos", test))]
#[derive(Debug, Default, PartialEq, Eq)]
pub struct ItemUrls {
    pub url: Option<String>,
    pub initial_url: Option<String>,
}

#[cfg(any(target_os = "macos", test))]
fn canonical(raw: &str) -> Option<String> {
    Url::parse(raw).ok().map(String::from)
}

#[cfg(any(target_os = "macos", test))]
pub fn is_same_page(item: &ItemUrls, target: &Url) -> bool {
    [item.url.as_deref(), item.initial_url.as_deref()]
        .into_iter()
        .flatten()
        .filter_map(canonical)
        .any(|candidate| candidate == target.as_str())
}

#[cfg(target_os = "macos")]
pub use macos::traverse_on_main_thread;

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::{c_char, CStr};

    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use url::Url;

    use super::{is_same_page, HistoryDirection, ItemUrls};

    /// How far from the current item to look. Bounds the main-thread walk on a
    /// tab with a very long native history.
    const MAX_ITEM_DISTANCE: isize = 50;

    /// Travel to the nearest item in `direction` that is `target`. Returns
    /// whether WebKit started that navigation; `false` leaves the view alone.
    ///
    /// # Safety
    ///
    /// Must run on the main thread. `wk_webview` must be null or a live
    /// `WKWebView`. Every selector is public WebKit API, and every returned
    /// object is only used inside this call, within the caller's autorelease
    /// scope.
    pub unsafe fn traverse_on_main_thread(
        wk_webview: *mut AnyObject,
        direction: HistoryDirection,
        target: &Url,
    ) -> bool {
        if wk_webview.is_null() {
            return false;
        }
        let list: *mut AnyObject = msg_send![wk_webview, backForwardList];
        if list.is_null() {
            return false;
        }

        // `itemAtIndex:` is relative to the current item: -1 is the page before
        // it, 1 the page after, nil past either end.
        let step: isize = match direction {
            HistoryDirection::Back => -1,
            HistoryDirection::Forward => 1,
        };
        for distance in 1..=MAX_ITEM_DISTANCE {
            let item: *mut AnyObject = msg_send![list, itemAtIndex: step * distance];
            if item.is_null() {
                return false;
            }
            let urls = ItemUrls {
                url: nsurl_string(msg_send![item, URL]),
                initial_url: nsurl_string(msg_send![item, initialURL]),
            };
            if is_same_page(&urls, target) {
                let navigation: *mut AnyObject =
                    msg_send![wk_webview, goToBackForwardListItem: item];
                return !navigation.is_null();
            }
        }
        false
    }

    unsafe fn nsurl_string(url: *mut AnyObject) -> Option<String> {
        if url.is_null() {
            return None;
        }
        let absolute: *mut AnyObject = msg_send![url, absoluteString];
        if absolute.is_null() {
            return None;
        }
        let utf8: *const c_char = msg_send![absolute, UTF8String];
        if utf8.is_null() {
            return None;
        }
        CStr::from_ptr(utf8).to_str().ok().map(str::to_owned)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(url: &str, initial_url: &str) -> ItemUrls {
        ItemUrls {
            url: Some(url.to_string()),
            initial_url: Some(initial_url.to_string()),
        }
    }

    fn target(raw: &str) -> Url {
        Url::parse(raw).unwrap()
    }

    #[test]
    fn matches_the_url_the_chrome_recorded_without_a_trailing_slash() {
        // The URL bar stores `https://github.com`; WebKit reports the item as
        // `https://github.com/`.
        let github = item("https://github.com/", "https://github.com/");
        assert!(is_same_page(&github, &target("https://github.com")));
    }

    #[test]
    fn matches_a_redirected_item_by_the_url_first_requested() {
        let redirected = item("https://www.example.com/home", "http://example.com/");
        assert!(is_same_page(&redirected, &target("http://example.com")));
        assert!(is_same_page(
            &redirected,
            &target("https://www.example.com/home")
        ));
    }

    #[test]
    fn rejects_a_different_page_on_the_same_site() {
        let listing = item("https://example.com/a", "https://example.com/a");
        assert!(!is_same_page(&listing, &target("https://example.com/b")));
        assert!(!is_same_page(
            &listing,
            &target("https://example.com/a?x=1")
        ));
        assert!(!is_same_page(
            &listing,
            &target("https://example.com/a#top")
        ));
    }

    #[test]
    fn rejects_an_item_with_no_readable_url() {
        assert!(!is_same_page(
            &ItemUrls::default(),
            &target("https://example.com")
        ));
        let garbage = item("not a url", "");
        assert!(!is_same_page(&garbage, &target("https://example.com")));
    }

    #[test]
    fn parses_only_the_two_directions() {
        assert_eq!(
            HistoryDirection::parse("back"),
            Some(HistoryDirection::Back)
        );
        assert_eq!(
            HistoryDirection::parse("forward"),
            Some(HistoryDirection::Forward)
        );
        assert_eq!(HistoryDirection::parse("reload"), None);
    }
}
