//! Connection state for the desktop UI.
//!
//! The bridge's stderr carries the remote CLI's stderr, which the session
//! runner parses for error reporting, so "reconnecting" cannot be announced
//! there. It goes to a small JSON file the desktop polls instead.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Status<'a> {
    /// launching | connected | reconnecting | stopping | exited | failed
    state: &'a str,
    target: &'a str,
    /// Attach attempts so far; above 1 means the link dropped at least once.
    attempt: u32,
    last_error: Option<&'a str>,
    updated_at_ms: u128,
}

#[derive(Debug, Clone)]
pub struct StatusWriter {
    path: Option<PathBuf>,
    target: String,
}

impl StatusWriter {
    pub fn new(path: Option<PathBuf>, target: String) -> Self {
        Self { path, target }
    }

    /// Best effort: a status file that cannot be written must never take the
    /// run down with it.
    pub fn write(&self, state: &str, attempt: u32, last_error: Option<&str>) {
        let Some(path) = &self.path else {
            return;
        };
        let status = Status {
            state,
            target: &self.target,
            attempt,
            last_error,
            updated_at_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |elapsed| elapsed.as_millis()),
        };
        let Ok(json) = serde_json::to_vec(&status) else {
            return;
        };
        // Rename so a reader never sees a half-written file.
        let staged = path.with_extension("tmp");
        if std::fs::write(&staged, json).is_ok() {
            let _ = std::fs::rename(&staged, path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_camel_case_json_and_tolerates_no_path() {
        StatusWriter::new(None, "host".to_string()).write("connected", 1, None);

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("status.json");
        let writer = StatusWriter::new(Some(path.clone()), "ssh host 'devbox'".to_string());
        writer.write("reconnecting", 3, Some("connection closed"));

        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(value["state"], "reconnecting");
        assert_eq!(value["attempt"], 3);
        assert_eq!(value["lastError"], "connection closed");
        assert_eq!(value["target"], "ssh host 'devbox'");
        assert!(value["updatedAtMs"].as_u64().unwrap() > 0);
        assert!(!path.with_extension("tmp").exists());
    }
}
