//! Live PTY session handle: I/O endpoints, flow-control counters, and the
//! shell-termination guarantees enforced on drop.

use chrono::{DateTime, Utc};
use portable_pty::{Child, PtyPair};
use std::sync::{
    atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize},
    Arc, Mutex,
};
use tauri::async_runtime::Mutex as AsyncMutex;
use tauri::ipc::{Channel, InvokeResponseBody};
use tokio::sync::{broadcast, Notify};

use super::types::{PtyExitEvent, PtySessionIdentity};
use crate::pty_commands::shells::ShellKind;

// ============================================
// Session State
// ============================================

/// Represents an active PTY session with its I/O handles.
///
/// Each session owns:
/// - The PTY master/slave pair
/// - A writer for sending input to the shell
/// - A buffered reader for receiving output from the shell
pub struct PtySession {
    pub identity: PtySessionIdentity,
    /// The PTY master/slave pair (platform-specific implementation)
    pub pty_pair: Arc<AsyncMutex<PtyPair>>,
    /// Writer handle for sending input to the PTY (keystrokes, commands)
    pub writer: Arc<AsyncMutex<crate::pty_io::PtyWriter>>,
    /// Buffered reader for receiving output from the PTY
    pub reader: Arc<AsyncMutex<crate::pty_io::PtyReader>>,
    /// Process ID of the shell (derived from session ID for display purposes)
    pub pid: Option<u32>,
    pub stream_owner: Arc<AtomicU64>,
    pub io_stop: Arc<crate::pty_io::IoStop>,
    pub snapshot: Arc<Mutex<crate::stream_snapshot::StreamSnapshot>>,
    /// Shell's `start_time` (seconds since boot, sysinfo convention). Captured
    /// once at spawn and used by the app-exit sweep to tell our shell apart
    /// from a later PID-reuse holder. Meaningful on Unix; 0 and unused on
    /// Windows (whose sweep tree is shell+conhost only).
    pub start_time: u64,
    /// Owning handle to the spawned shell process. Held so `close_session`
    /// and `Drop` can kill it explicitly — dropping the PTY master alone does
    /// NOT reliably terminate the child on Windows ConPTY
    /// (`ClosePseudoConsole` only signals), which orphaned `conhost.exe` and
    /// the shell across app restarts. It is atomically `take()`n by either
    /// the reaper after a natural exit or `Drop`; the latter terminates and
    /// reaps it.
    pub child: Arc<Mutex<Option<Box<dyn Child + Send>>>>,
    /// Shell executable being used (e.g., "/bin/zsh", "powershell.exe")
    pub shell: String,
    /// Detected shell kind for profile display
    pub shell_kind: ShellKind,
    /// Working directory the shell was started in
    pub cwd: Option<String>,
    /// User-assigned display name (e.g., "Dev Server")
    pub name: Option<String>,
    /// Optional broadcast channel for tapping raw PTY output bytes (used by OS agent).
    /// When present, the reader task sends output here in addition to byte-stream Tauri events.
    /// Callers decode UTF-8 lazily only when they need text.
    pub output_tap: Option<broadcast::Sender<Arc<[u8]>>>,
    /// Bytes emitted to the frontend but not yet acknowledged.
    /// Used for backpressure: reader pauses when this exceeds HIGH_WATERMARK.
    pub unacked_bytes: Arc<AtomicUsize>,
    /// Notifier woken by ack_pty_data so the reader task can resume immediately
    /// without busy-sleeping. Replaces the fixed BACKPRESSURE_SLEEP_MS polling loop.
    pub ack_notify: Arc<Notify>,
    /// Latest render time reported by the frontend ACK (milliseconds, rounded).
    /// The reader uses this to emit smaller PTY chunks when the renderer is slow.
    pub frontend_render_ms: Arc<AtomicU32>,
    /// UTC timestamp when the PTY session was created.
    pub created_at: DateTime<Utc>,
    /// UTC timestamp of the latest PTY output chunk observed by the reader task.
    pub last_output_at: Arc<Mutex<Option<DateTime<Utc>>>>,
    /// True while no webview listener is attached. The reader skips event
    /// emission and does not grow `unacked_bytes`; output still accrues in
    /// `snapshot` for the next attach.
    pub detached: Arc<AtomicBool>,
    /// Total PTY bytes represented in `snapshot` (stream offset of its
    /// end). Read/written only while holding the `snapshot` lock so
    /// snapshot text and offset stay consistent.
    pub covers_seq: Arc<AtomicU64>,
    /// Bytes read while detached since the last attach; tells the frontend
    /// whether its client-side buffer missed output.
    pub missed_while_detached: Arc<AtomicUsize>,
    /// Binary sink for the attached webview's terminal output, installed by
    /// `attach_pty_output_channel` and cleared by `detach_pty_stream`.
    ///
    /// When present the reader task sends `[8-byte big-endian stream
    /// offset][raw PTY bytes]` frames here instead of emitting a
    /// `pty-output-{id}` event. The event transport has to base64 the payload,
    /// serialize it into JSON, and splice the result into a JavaScript source
    /// string that the webview then parses before it can run — several passes
    /// over every byte of terminal output. A channel frame above Tauri's raw
    /// direct-execute threshold is handed to the webview as an ArrayBuffer
    /// with no such encoding.
    pub output_channel: Arc<Mutex<Option<Channel<InvokeResponseBody>>>>,
}

impl Drop for PtySession {
    fn drop(&mut self) {
        self.io_stop.cancel();
        // Kill the spawned shell so it (and, on Windows, its ConPTY conhost
        // host) cannot outlive the session. `close_session` and the reader's
        // natural-exit path take() the child first; if either already did,
        // this is a no-op. Dropping the PTY master alone does NOT reliably
        // kill the child on Windows ConPTY — `ClosePseudoConsole` only
        // signals — so an explicit kill is required to avoid orphaned
        // conhost/shell processes accumulating across app restarts.
        let child = self
            .child
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();

        if let Some(mut child) = child {
            // Drop can run after an async future is cancelled. Explicit close
            // and app shutdown call terminate_child_sync on their blocking
            // owner first; this fallback must not block an async worker.
            std::thread::spawn(move || {
                let _ = child.kill();
                let _ = child.wait();
            });
        }
    }
}

impl PtySession {
    /// Capture exit identity while removing exactly the reader that finished.
    /// Dispatch may happen after a replacement has acquired the same map key.
    pub(crate) async fn take_finished(
        sessions: &AsyncMutex<std::collections::HashMap<String, PtySession>>,
        session_id: &str,
        reader: &Arc<AsyncMutex<crate::pty_io::PtyReader>>,
    ) -> Option<(Self, PtyExitEvent)> {
        let mut sessions = sessions.lock().await;
        if !sessions
            .get(session_id)
            .is_some_and(|session| Arc::ptr_eq(&session.reader, reader))
        {
            return None;
        }
        let session = sessions.remove(session_id)?;
        let event = session.identity.exit_event(
            session
                .stream_owner
                .load(std::sync::atomic::Ordering::Acquire),
        );
        Some((session, event))
    }

    /// Finite shell termination, called only on a blocking/shutdown owner.
    /// Reaping runs after PTY handles can drop (macOS tty exit may need that).
    pub(crate) fn terminate_child_sync(&self) {
        self.io_stop.cancel();
        if let Some(mut child) = self.child.lock().unwrap_or_else(|p| p.into_inner()).take() {
            let _ = child.kill();
            std::thread::spawn(move || {
                let _ = child.wait();
            });
        }
    }

    pub fn inspection_output(&self) -> String {
        self.snapshot
            .lock()
            .expect("snapshot mutex poisoned")
            .inspection()
            .to_string()
    }
    pub fn inspection_snapshot(&self) -> (String, bool) {
        let snapshot = self.snapshot.lock().expect("snapshot mutex poisoned");
        (
            snapshot.inspection().to_string(),
            snapshot.has_withheld_output(),
        )
    }
    pub fn inspection_chars(&self) -> usize {
        self.snapshot
            .lock()
            .expect("snapshot mutex poisoned")
            .inspection()
            .chars()
            .count()
    }

    pub fn owns_stream(&self, owner: Option<u64>) -> bool {
        self.stream_owner.load(std::sync::atomic::Ordering::Acquire) == owner.unwrap_or(0)
    }
    pub fn claim_stream(&self, owner: Option<u64>) -> Result<(), String> {
        let owner = owner.unwrap_or(0);
        let previous = self
            .stream_owner
            .fetch_max(owner, std::sync::atomic::Ordering::AcqRel);
        if owner < previous {
            Err("PTY attachment superseded".into())
        } else {
            Ok(())
        }
    }

    /// Terminate a PTY child and wait until it has been reaped.
    ///
    /// Callers must invoke this outside the session-map lock. It may briefly
    /// block on Unix while portable-pty escalates from SIGHUP to SIGKILL.
    pub(crate) fn terminate_and_reap(mut child: Box<dyn Child + Send>) {
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn session() -> PtySession {
        let pair = portable_pty::native_pty_system()
            .openpty(portable_pty::PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let reader = pair.master.try_clone_reader().unwrap();
        let writer = pair.master.take_writer().unwrap();
        let (reader, writer, io_stop) =
            crate::pty_io::wrap(pair.master.as_ref(), reader, writer).unwrap();
        PtySession {
            identity: PtySessionIdentity::new(),
            pty_pair: Arc::new(AsyncMutex::new(pair)),
            writer: Arc::new(AsyncMutex::new(writer)),
            reader: Arc::new(AsyncMutex::new(reader)),
            pid: None,
            start_time: 0,
            stream_owner: Arc::new(AtomicU64::new(0)),
            io_stop,
            snapshot: Arc::new(Mutex::new(crate::stream_snapshot::StreamSnapshot::default())),
            child: Arc::new(Mutex::new(None)),
            shell: "test".into(),
            shell_kind: ShellKind::from_shell_path("/bin/sh"),
            cwd: None,
            name: None,
            output_tap: None,
            unacked_bytes: Arc::new(AtomicUsize::new(0)),
            ack_notify: Arc::new(Notify::new()),
            frontend_render_ms: Arc::new(AtomicU32::new(0)),
            created_at: Utc::now(),
            last_output_at: Arc::new(Mutex::new(None)),
            detached: Arc::new(AtomicBool::new(false)),
            covers_seq: Arc::new(AtomicU64::new(0)),
            missed_while_detached: Arc::new(AtomicUsize::new(0)),
            output_channel: Arc::new(Mutex::new(None)),
        }
    }
    #[tokio::test]
    async fn delayed_exit_keeps_removed_native_identity_after_same_id_recreation() {
        let old = session();
        old.claim_stream(Some(10)).unwrap();
        let old_reader = old.reader.clone();
        let old_generation = old.identity.session_generation.clone();
        let sessions = AsyncMutex::new(std::collections::HashMap::from([("same-id".into(), old)]));
        // Production removal captures the payload; dispatch is delayed until
        // another PTY occupies the same registry key.
        let (_finished, event) = PtySession::take_finished(&sessions, "same-id", &old_reader)
            .await
            .unwrap();
        let replacement = session();
        replacement.claim_stream(Some(20)).unwrap();
        let replacement_generation = replacement.identity.session_generation.clone();
        sessions.lock().await.insert("same-id".into(), replacement);
        let payload = serde_json::to_value(event).unwrap();
        assert_eq!(payload["session_generation"], old_generation);
        assert_eq!(payload["owner_id"], 10);
        assert_ne!(payload["session_generation"], replacement_generation);
        assert!(PtySession::take_finished(&sessions, "same-id", &old_reader)
            .await
            .is_none());
        let sessions = sessions.lock().await;
        let replacement = &sessions["same-id"];
        replacement.claim_stream(Some(30)).unwrap();
        assert_eq!(
            replacement.identity.session_generation,
            replacement_generation
        );
        assert!(replacement.owns_stream(Some(30)));
    }
    #[tokio::test]
    async fn stale_attach_cannot_take_over_new_owner_or_authorize_old_cleanup() {
        let session = session();
        session.claim_stream(Some(10)).unwrap();
        session.claim_stream(Some(20)).unwrap();
        assert!(session.claim_stream(Some(10)).is_err());
        assert!(session.owns_stream(Some(20)));
        assert!(!session.owns_stream(Some(10)));
        assert!(!session.owns_stream(None));
        session.claim_stream(Some(20)).unwrap();
    }
    #[tokio::test]
    async fn legacy_stream_operations_are_confined_to_unclaimed_sessions() {
        let session = session();
        session.claim_stream(None).unwrap();
        assert!(session.owns_stream(None));
        session.claim_stream(Some(1)).unwrap();
        assert!(session.claim_stream(None).is_err());
        assert!(!session.owns_stream(None));
    }
    #[tokio::test]
    async fn inspection_exposes_pending_state_without_returning_raw_replay() {
        let session = session();
        session
            .snapshot
            .lock()
            .unwrap()
            .push(b"API_KEY=not-a-real-secret");
        assert_eq!(session.inspection_snapshot(), (String::new(), true));
        session.snapshot.lock().unwrap().push(b"\n");
        assert_eq!(
            session.inspection_snapshot(),
            ("API_KEY=secret_*******\n".into(), false)
        );
        assert!(session
            .snapshot
            .lock()
            .unwrap()
            .replay()
            .contains("not-a-real-secret"));
    }
    #[tokio::test]
    async fn dropping_session_cancels_its_io_owner() {
        let session = session();
        let stop = session.io_stop.clone();
        drop(session);
        assert!(stop.is_cancelled());
    }
}
