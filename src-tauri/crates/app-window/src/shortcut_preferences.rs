//! The latest validated shortcut snapshot for embedded webviews.
//!
//! Keep only one script, replaced on preference edits. Browser initialization
//! and page loads read this same snapshot; no polling or per-webview cache.
use std::sync::Mutex;

static SNAPSHOT: Mutex<String> = Mutex::new(String::new());

pub fn replace(script: String) {
    *SNAPSHOT.lock().unwrap() = script;
}

pub fn initialization_script() -> String {
    SNAPSHOT.lock().unwrap().clone()
}
