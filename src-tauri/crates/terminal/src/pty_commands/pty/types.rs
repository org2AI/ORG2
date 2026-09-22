//! Serde payloads exchanged with the frontend across the PTY commands, plus
//! the projection from a live `PtySession` to its `PtyInfo` summary.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::atomic::{AtomicU64, Ordering},
};

use super::session::PtySession;
use crate::pty_commands::shells::ShellKind;

// ============================================
// Request Types
// ============================================

/// Immutable identity of one native PTY, also returned by `create_pty`.
/// A decimal string avoids JavaScript's integer precision limit. The counter
/// is process-local: no event or PTY survives a native process restart.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PtySessionIdentity {
    pub session_generation: String,
}

impl PtySessionIdentity {
    pub(crate) fn new() -> Self {
        static NEXT_GENERATION: AtomicU64 = AtomicU64::new(1);
        Self {
            session_generation: NEXT_GENERATION.fetch_add(1, Ordering::Relaxed).to_string(),
        }
    }

    pub(crate) fn exit_event(&self, owner_id: u64) -> PtyExitEvent {
        PtyExitEvent {
            session_generation: self.session_generation.clone(),
            owner_id,
        }
    }
}

/// Captured before releasing registry ownership, never looked up at dispatch.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtyExitEvent {
    pub session_generation: String,
    pub owner_id: u64,
}

/// Request payload for creating a new PTY session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePtyRequest {
    /// Unique identifier for this terminal session (e.g., "terminal-pty-1768913809817")
    pub session_id: String,
    #[serde(default)]
    pub owner_id: Option<u64>,
    /// Number of rows (height) for the terminal
    pub rows: u16,
    /// Number of columns (width) for the terminal
    pub cols: u16,
    /// Working directory to start the shell in (optional)
    pub cwd: Option<String>,
    /// Shell executable to use (optional, defaults to zsh/powershell)
    pub shell: Option<String>,
    /// Shell arguments (overrides default `-il` for Unix shells)
    #[serde(default)]
    pub args: Option<Vec<String>>,
    /// Custom environment variables to set in the terminal
    #[serde(default)]
    pub env: Option<HashMap<String, String>>,
    /// When true, do NOT inherit the parent process environment.
    /// Only `env` vars + TERM will be set.
    #[serde(default)]
    pub strict_env: Option<bool>,
    /// User-assigned display name for this terminal (e.g., "Dev Server")
    #[serde(default)]
    pub name: Option<String>,
}

/// Request payload for resizing an existing PTY session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResizePtyRequest {
    /// Session ID of the terminal to resize
    pub session_id: String,
    /// New number of rows
    pub rows: u16,
    /// New number of columns
    pub cols: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtyInfo {
    pub session_id: String,
    pub pid: Option<u32>,
    pub shell: String,
    pub shell_kind: ShellKind,
    pub cwd: Option<String>,
    pub name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_output_at: Option<DateTime<Utc>>,
    pub has_output_tap: bool,
    pub unacked_bytes: usize,
    pub redacted_output_chars: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtyOutputSnapshot {
    pub output: String,
    pub unacked_bytes: usize,
}

pub(super) fn pty_info_from_session(session_id: &str, session: &PtySession) -> PtyInfo {
    PtyInfo {
        session_id: session_id.to_string(),
        pid: session.pid,
        shell: session.shell.clone(),
        shell_kind: session.shell_kind.clone(),
        cwd: session.cwd.clone(),
        name: session.name.clone(),
        created_at: session.created_at,
        last_output_at: *session
            .last_output_at
            .lock()
            .expect("last_output_at mutex poisoned"),
        has_output_tap: session.output_tap.is_some(),
        unacked_bytes: session.unacked_bytes.load(Ordering::Relaxed),
        redacted_output_chars: session.inspection_chars(),
    }
}

/// Response for `attach_pty_stream`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachPtyStream {
    pub session_generation: String,
    /// Incomplete UTF-8 suffix to seed the new webview decoder.
    pub pending_utf8_b64: String,
    /// Bounded local display replay; agent inspection uses a separate redacted projection.
    pub output: String,
    /// Stream offset covered by `output`. Live `pty-output` chunks whose
    /// `seq` is below this are already contained in the snapshot and must
    /// not be written again.
    pub covers_seq: u64,
    /// True when output was produced while no listener was attached — the
    /// frontend's client-side buffer (if any) is missing data and the
    /// snapshot must be used instead.
    pub missed_output: bool,
}

/// Information about the foreground process running in a PTY session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForegroundProcessInfo {
    /// Name of the foreground process (e.g., "node", "cargo", "python")
    pub process_name: Option<String>,
    /// PID of the foreground process
    pub pid: Option<u32>,
    /// Current working directory of the foreground process
    pub cwd: Option<String>,
}

/// Memory usage for a single PTY session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtyMemoryInfo {
    pub session_id: String,
    pub pid: Option<u32>,
    pub shell: String,
    pub memory_mb: f64,
    pub buffer_bytes: usize,
    pub scrollback_lines: usize,
}
