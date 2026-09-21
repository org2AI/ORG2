//! Bounded, on-demand access to existing MyStation PTYs. No process creation or polling.
use std::{sync::Arc, time::Duration};
use tauri::{State, WebviewWindow};
use terminal::pty_commands::pty::PtyState;
use tokio::sync::{Mutex, Semaphore};

const MAX_OUTPUT_BYTES: usize = 8192;
static INPUT_JOBS: Semaphore = Semaphore::const_new(16);
/// The write half `guarded_write` drives. A real `PtyWriter` can only be built
/// from a live PTY master, so the cancellation, capacity and timeout
/// guarantees below are exercised through fixtures implementing this trait.
#[async_trait::async_trait]
trait TerminalWrite: Send + 'static {
    async fn write_all(&mut self, bytes: &[u8]) -> std::io::Result<()>;
}
#[async_trait::async_trait]
impl TerminalWrite for terminal::pty_io::PtyWriter {
    async fn write_all(&mut self, bytes: &[u8]) -> std::io::Result<()> {
        terminal::pty_io::PtyWriter::write_all(self, bytes).await
    }
}

fn terminal_id(request: &app_ui::Request) -> Result<&str, String> {
    let id = request.params["terminalId"].as_str().unwrap_or("");
    if id.is_empty()
        || id.len() > 128
        || id.starts_with("agent-pty-")
        || id.starts_with("chatpanel-")
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("TERMINAL_NOT_FOUND: Expected a MyStation shell terminal ID".into());
    }
    Ok(id)
}
fn input_data(request: &app_ui::Request) -> Result<String, String> {
    let data = match request.command.as_str() {
        "ui.terminal.execute" => {
            let command = request.params["command"]
                .as_str()
                .filter(|s| !s.is_empty())
                .ok_or("TERMINAL_INVALID_INPUT: command is required")?;
            format!("{command}\r")
        }
        "ui.terminal.input" => request.params["data"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or("TERMINAL_INVALID_INPUT: data is required")?
            .to_string(),
        "ui.terminal.interrupt" => "\x03".to_string(),
        _ => return Err("TERMINAL_INVALID_INPUT: Unsupported terminal operation".into()),
    };
    if data.len() > 32769 {
        return Err("TERMINAL_INVALID_INPUT: Input exceeds 32 KiB".into());
    }
    Ok(data)
}
fn output_tail(output: &str, max_bytes: usize) -> (&str, bool) {
    let mut start = output.len().saturating_sub(max_bytes);
    while !output.is_char_boundary(start) {
        start += 1;
    }
    (&output[start..], start != 0)
}

/// Input may partially reach the PTY before an OS write fails or times out.
/// Keep that result unknown and retain the writer/permit until the worker ends.
async fn guarded_write<W: TerminalWrite>(
    writer: Arc<Mutex<W>>,
    data: String,
    active: impl Fn() -> bool + Send + 'static,
) -> Result<usize, String> {
    let permit = INPUT_JOBS
        .try_acquire()
        .map_err(|_| "BUSY: Terminal input workers are occupied")?;
    let mut writer = writer
        .try_lock_owned()
        .map_err(|_| "BUSY: Terminal is receiving another input")?;
    let mut task = tokio::spawn(async move {
        let _permit = permit;
        if !active() {
            return Err("TERMINAL_REQUEST_EXPIRED: Input was not sent".to_string());
        }
        writer.write_all(data.as_bytes()).await.map_err(|_| {
            "TERMINAL_WRITE_UNKNOWN: Input may have been partially delivered".to_string()
        })?;
        Ok(data.len())
    });
    match tokio::time::timeout(Duration::from_secs(2), &mut task).await {
        Ok(result) => result.map_err(|_| {
            "TERMINAL_WRITE_UNKNOWN: Input worker ended without confirmation".to_string()
        })?,
        Err(_) => {
            // A submitted PTY write cannot be undone, so the worker is never
            // aborted: it keeps the writer lock and the permit until it ends,
            // which blocks an interleaved second write rather than replaying
            // this one. The caller gets an unknown receipt now.
            Err("TERMINAL_WRITE_UNKNOWN: Input delivery exceeded the deadline; do not resend automatically".into())
        }
    }
}

#[tauri::command]
pub async fn ui_terminal_io(
    window: WebviewWindow,
    generation: String,
    request: app_ui::Request,
    state: State<'_, PtyState>,
) -> Result<serde_json::Value, String> {
    super::commands::main_only(&window)?;
    if !app_ui::broker().active(&generation, &request) {
        return Err("TERMINAL_REQUEST_EXPIRED: Request is no longer active".into());
    }
    let id = terminal_id(&request)?.to_string();
    let backend_id = format!("terminal-pty-{id}");
    let registry = state.sessions_arc();
    let sessions = tokio::time::timeout(Duration::from_millis(500), registry.lock())
        .await
        .map_err(|_| "BUSY: PTY registry is busy")?;
    let session = sessions
        .get(&backend_id)
        .ok_or("TERMINAL_NOT_READY: PTY is not live; opening a tab only registers a terminal")?;
    if request.command == "ui.terminal.read" {
        let max_bytes = request
            .params
            .get("maxBytes")
            .map(|value| {
                value
                    .as_u64()
                    .filter(|n| (1..=MAX_OUTPUT_BYTES as u64).contains(n))
                    .ok_or("TERMINAL_INVALID_INPUT: maxBytes must be between 1 and 8192")
            })
            .transpose()?
            .unwrap_or(4096) as usize;
        let output = session.inspection_output();
        drop(sessions);
        let (tail, truncated) = output_tail(&output, max_bytes);
        return Ok(
            serde_json::json!({"terminalId":id,"output":tail,"truncated":truncated,
            "source":"retained-redacted-pty","encoding":"utf8-with-ansi"}),
        );
    }
    let data = input_data(&request)?;
    let writer = session.writer.clone();
    let expected_writer = writer.clone();
    drop(sessions);
    let bytes = guarded_write(writer, data, move || {
        app_ui::broker().active(&generation, &request)
            && registry.try_lock().is_ok_and(|sessions| {
                sessions
                    .get(&backend_id)
                    .is_some_and(|session| Arc::ptr_eq(&session.writer, &expected_writer))
            })
    })
    .await?;
    Ok(
        serde_json::json!({"terminalId":id,"inputState":"written","bytesWritten":bytes,
        "executionState":"unconfirmed"}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;
    static INPUT_TEST_LOCK: Mutex<()> = Mutex::const_new(());
    struct Capture(Arc<StdMutex<Vec<u8>>>);
    #[async_trait::async_trait]
    impl TerminalWrite for Capture {
        async fn write_all(&mut self, bytes: &[u8]) -> std::io::Result<()> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(())
        }
    }
    fn request(command: &str, params: serde_json::Value) -> app_ui::Request {
        let mut request: app_ui::Request =
            serde_json::from_str(include_str!("../../../crates/app-ui/protocol.fixture.json"))
                .unwrap();
        request.command = command.into();
        request.params = params;
        request
    }
    #[test]
    fn terminal_input_distinguishes_submission_raw_text_and_interrupt() {
        use serde_json::json;
        assert_eq!(
            input_data(&request(
                "ui.terminal.execute",
                json!({"command":"echo hello"})
            ))
            .unwrap(),
            "echo hello\r"
        );
        assert_eq!(
            input_data(&request("ui.terminal.input", json!({"data":"hello\n"}))).unwrap(),
            "hello\n"
        );
        assert_eq!(
            input_data(&request("ui.terminal.interrupt", json!({}))).unwrap(),
            "\x03"
        );
        assert!(input_data(&request("gui.execute", json!({}))).is_err());
        assert!(terminal_id(&request(
            "ui.terminal.read",
            json!({"terminalId":"agent-pty-secret"})
        ))
        .is_err());
    }
    #[test]
    fn output_tail_is_utf8_safe_and_json_bounded() {
        assert_eq!(output_tail("abc你好", 4), ("好", true));
        assert_eq!(output_tail("abc", 8), ("abc", false));
        let output = "\u{001b}".repeat(100_000);
        let (tail, truncated) = output_tail(&output, MAX_OUTPUT_BYTES);
        assert!(truncated);
        assert_eq!(tail.len(), MAX_OUTPUT_BYTES);
        assert!(serde_json::to_vec(&tail).unwrap().len() < app_ui::MAX_BODY);
    }
    #[tokio::test]
    async fn guarded_writer_checks_cancellation_and_never_replays_busy_input() {
        let _test = INPUT_TEST_LOCK.lock().await;
        let bytes = Arc::new(StdMutex::new(Vec::new()));
        let writer = Arc::new(Mutex::new(Capture(bytes.clone())));
        assert!(guarded_write(writer.clone(), "forbidden".into(), || false)
            .await
            .unwrap_err()
            .starts_with("TERMINAL_REQUEST_EXPIRED"));
        assert!(bytes.lock().unwrap().is_empty());
        let held = writer.clone().lock_owned().await;
        assert!(guarded_write(writer.clone(), "busy".into(), || true)
            .await
            .unwrap_err()
            .starts_with("BUSY"));
        drop(held);
        assert_eq!(
            guarded_write(writer, "one\r".into(), || true)
                .await
                .unwrap(),
            4
        );
        assert_eq!(&*bytes.lock().unwrap(), b"one\r");
    }
    #[tokio::test]
    async fn worker_capacity_and_partial_writes_have_explicit_outcomes() {
        let _test = INPUT_TEST_LOCK.lock().await;
        let permits = INPUT_JOBS.try_acquire_many(16).unwrap();
        let bytes = Arc::new(StdMutex::new(Vec::new()));
        let writer = Arc::new(Mutex::new(Capture(bytes.clone())));
        assert!(guarded_write(writer, "busy".into(), || true)
            .await
            .unwrap_err()
            .starts_with("BUSY"));
        assert!(bytes.lock().unwrap().is_empty());
        drop(permits);
        // `PtyWriter::write_all` submits and flushes as one step, so a failed
        // flush now surfaces as a failed write with the same unknown outcome.
        struct WriteFailure;
        #[async_trait::async_trait]
        impl TerminalWrite for WriteFailure {
            async fn write_all(&mut self, _bytes: &[u8]) -> std::io::Result<()> {
                Err(std::io::Error::other("fixture write failure"))
            }
        }
        let writer = Arc::new(Mutex::new(WriteFailure));
        assert!(guarded_write(writer, "possibly delivered".into(), || true)
            .await
            .unwrap_err()
            .starts_with("TERMINAL_WRITE_UNKNOWN"));
    }
    #[tokio::test]
    async fn timed_out_write_keeps_its_writer_until_the_worker_finishes() {
        let _test = INPUT_TEST_LOCK.lock().await;
        let gate = Arc::new(tokio::sync::Notify::new());
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        struct BlockedWriter {
            gate: Arc<tokio::sync::Notify>,
            started: Option<tokio::sync::oneshot::Sender<()>>,
        }
        #[async_trait::async_trait]
        impl TerminalWrite for BlockedWriter {
            async fn write_all(&mut self, _bytes: &[u8]) -> std::io::Result<()> {
                if let Some(started) = self.started.take() {
                    let _ = started.send(());
                }
                // A submitted write is never cancelled; hold the writer past
                // the caller's deadline exactly as a slow PTY would.
                self.gate.notified().await;
                Ok(())
            }
        }
        let writer = Arc::new(Mutex::new(BlockedWriter {
            gate: gate.clone(),
            started: Some(started_tx),
        }));
        let task = tokio::spawn(guarded_write(writer.clone(), "one".into(), || true));
        started_rx.await.unwrap();
        let outcome = task.await.unwrap();
        let held_after_timeout = writer.try_lock().is_err();
        // Always release the fixture worker before asserting, including failure paths.
        gate.notify_one();
        let _finished = writer.lock().await;
        assert!(outcome.unwrap_err().starts_with("TERMINAL_WRITE_UNKNOWN"));
        assert!(held_after_timeout);
        assert_eq!(INPUT_JOBS.available_permits(), 16);
    }
}
