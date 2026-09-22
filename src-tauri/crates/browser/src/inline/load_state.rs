//! Last native page-load phase per inline browser webview.
//!
//! The frontend treats a `finished` phase as the only proof that a browser pane
//! rendered (wry exposes no navigation-failure callback). A webview that
//! `create_inline_webview` *reuses* does not navigate again, so the React owner
//! that asked for it would never hear a phase and would report a loaded page as
//! failed. The registry lets the reuse path replay the last phase instead.
//!
//! Wire contract: `BROWSER_WEBVIEW_LOAD_STATE_EVENT` in
//! `src/engines/BrowserCore/BrowserSessionWebview.tsx`.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter};

/// Emitted to the parent window on every navigation start/finish, and replayed
/// when an existing webview is handed to a new owner.
const BROWSER_WEBVIEW_LOAD_STATE_EVENT: &str = "browser-webview-load-state";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct LoadStateSnapshot {
    url: String,
    phase: &'static str,
}

/// Keyed by webview label. Entries live exactly as long as the native view:
/// cleared when a fresh view is built and whenever the lifecycle state is reset.
static WEBVIEW_LOAD_STATES: OnceLock<Mutex<HashMap<String, LoadStateSnapshot>>> = OnceLock::new();

fn load_states() -> &'static Mutex<HashMap<String, LoadStateSnapshot>> {
    WEBVIEW_LOAD_STATES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// `Started` is WKWebView's `didCommitNavigation`, `Finished` its
/// `didFinishNavigation`. A navigation that fails before committing reports
/// neither.
pub(super) fn phase_name(event: PageLoadEvent) -> &'static str {
    match event {
        PageLoadEvent::Started => "started",
        PageLoadEvent::Finished => "finished",
    }
}

/// Records `phase` for `label` and tells its parent window.
///
/// Targeted at the parent window label so the event reaches the React chrome
/// only; sibling browser webviews carry their own labels and never see it.
pub(super) fn report(
    app: &AppHandle,
    parent_window: &str,
    label: &str,
    url: &str,
    phase: &'static str,
) {
    let snapshot = LoadStateSnapshot {
        url: url.to_string(),
        phase,
    };
    record(label, snapshot.clone());
    emit(app, parent_window, label, &snapshot);
}

/// Re-sends the last recorded phase for a reused webview. No-op when the view
/// has not reported one yet — its first real phase will still arrive.
pub(super) fn replay(app: &AppHandle, parent_window: &str, label: &str) {
    if let Some(snapshot) = snapshot(label) {
        emit(app, parent_window, label, &snapshot);
    }
}

/// Drops the evidence for `label`; a newly built view has proven nothing yet.
pub(super) fn forget(label: &str) {
    load_states().lock().unwrap().remove(label);
}

pub(super) fn forget_where(mut matches: impl FnMut(&str) -> bool) {
    load_states()
        .lock()
        .unwrap()
        .retain(|label, _| !matches(label));
}

fn record(label: &str, snapshot: LoadStateSnapshot) {
    load_states()
        .lock()
        .unwrap()
        .insert(label.to_string(), snapshot);
}

fn snapshot(label: &str) -> Option<LoadStateSnapshot> {
    load_states().lock().unwrap().get(label).cloned()
}

fn emit(app: &AppHandle, parent_window: &str, label: &str, snapshot: &LoadStateSnapshot) {
    let _ = app.emit_to(
        parent_window,
        BROWSER_WEBVIEW_LOAD_STATE_EVENT,
        serde_json::json!({
            "label": label,
            "url": snapshot.url,
            "phase": snapshot.phase,
        }),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    // The registry is process-global; unique labels keep parallel tests apart.
    fn ulabel(suffix: &str) -> String {
        use std::sync::atomic::{AtomicU64, Ordering};
        static CTR: AtomicU64 = AtomicU64::new(0);
        format!(
            "load-state-{}-{}",
            suffix,
            CTR.fetch_add(1, Ordering::Relaxed)
        )
    }

    fn snap(url: &str, phase: &'static str) -> LoadStateSnapshot {
        LoadStateSnapshot {
            url: url.to_string(),
            phase,
        }
    }

    #[test]
    fn maps_native_events_to_wire_phases() {
        assert_eq!(phase_name(PageLoadEvent::Started), "started");
        assert_eq!(phase_name(PageLoadEvent::Finished), "finished");
    }

    #[test]
    fn keeps_only_the_latest_phase_per_label() {
        let label = ulabel("latest");
        record(&label, snap("https://a.example/", "started"));
        record(&label, snap("https://a.example/", "finished"));
        assert_eq!(
            snapshot(&label),
            Some(snap("https://a.example/", "finished"))
        );
        forget(&label);
        assert_eq!(snapshot(&label), None);
    }

    #[test]
    fn forget_where_releases_only_matching_labels() {
        let own = format!("{}__window__app-window-station-a", ulabel("own"));
        let peer = format!("{}__window__app-window-station-b", ulabel("peer"));
        record(&own, snap("https://own.example/", "finished"));
        record(&peer, snap("https://peer.example/", "finished"));

        forget_where(|label| label.ends_with("__window__app-window-station-a"));

        assert_eq!(snapshot(&own), None);
        assert_eq!(
            snapshot(&peer),
            Some(snap("https://peer.example/", "finished"))
        );
        forget(&peer);
    }
}
