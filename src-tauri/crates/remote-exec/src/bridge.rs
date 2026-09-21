//! The reconnecting bridge: launch once, then replay the remote logs into
//! local stdio from a byte offset, as many times as the connection needs.

use std::future::Future;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use thiserror::Error;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::time::{sleep, timeout};

use crate::connector::Connector;
use crate::protocol::{
    find_reply, read_frame_header, read_line_limited, Frame, Reply, ATTACH_SYNC,
    MAX_PREAMBLE_BYTES, REPLY_PREFIX,
};
use crate::script::{
    attach_command, ctl_command, launch_script, write_command, CtlAction, RunSpec, Signal,
    SpecError, StdinMode, LAUNCH_COMMAND,
};
use crate::status::StatusWriter;

const COPY_CHUNK: usize = 64 * 1024;
const DIAGNOSTIC_TAIL: usize = 4 * 1024;

#[derive(Debug, Clone)]
pub struct BridgeOptions {
    /// Launch is the one step that fails fast: starting a turn while the host
    /// is unreachable should report that, not hang.
    pub launch_attempts: u32,
    /// Budget for one launch or control exchange.
    pub exec_timeout: Duration,
    /// Budget for delivering one stdin message.
    pub write_timeout: Duration,
    pub reconnect_initial: Duration,
    pub reconnect_max: Duration,
    /// The helper sends a keepalive every 5s; silence longer than this means
    /// the connection is dead even if the local `ssh` has not noticed yet.
    pub stall_timeout: Duration,
    /// How long a TERM gets before the run is KILLed.
    pub kill_grace: Duration,
    pub status_file: Option<PathBuf>,
    /// Remove the remote run directory once the exit code is in hand.
    pub cleanup_on_exit: bool,
}

impl Default for BridgeOptions {
    fn default() -> Self {
        Self {
            launch_attempts: 3,
            exec_timeout: Duration::from_secs(60),
            write_timeout: Duration::from_secs(120),
            reconnect_initial: Duration::from_millis(500),
            reconnect_max: Duration::from_secs(15),
            stall_timeout: Duration::from_secs(20),
            kill_grace: Duration::from_secs(5),
            status_file: None,
            cleanup_on_exit: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BridgeExit {
    /// The remote process's exit code.
    pub code: i32,
    /// 1 when the connection never dropped.
    pub attach_attempts: u32,
    /// The run ended because the bridge was asked to shut down.
    pub killed: bool,
}

#[derive(Debug, Error)]
pub enum BridgeError {
    #[error(transparent)]
    Spec(#[from] SpecError),
    #[error("could not reach {target}: {detail}")]
    Unreachable { target: String, detail: String },
    #[error("{target} refused to start the run: {reason}")]
    Rejected { target: String, reason: String },
    #[error("the run is gone from {target}: {reason}")]
    RunLost { target: String, reason: String },
    #[error("local output closed: {0}")]
    LocalIo(#[source] std::io::Error),
}

#[derive(Debug, Error)]
enum ExchangeError {
    #[error("{0}")]
    Transport(String),
    #[error("timed out")]
    Timeout,
}

/// Run one helper command to completion and return its verdict.
async fn exchange(
    connector: &dyn Connector,
    remote_command: &str,
    input: Option<&[u8]>,
    limit: Duration,
) -> Result<Reply, ExchangeError> {
    let mut command = connector.command(remote_command);
    command
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command
        .spawn()
        .map_err(|err| ExchangeError::Transport(format!("spawn failed: {err}")))?;
    let stdin = child.stdin.take();

    let work = async {
        let feed = async {
            if let (Some(mut stdin), Some(bytes)) = (stdin, input) {
                // A failed write shows up as a missing reply; nothing to add.
                let _ = stdin.write_all(bytes).await;
                let _ = stdin.shutdown().await;
            }
        };
        let (_, output) = tokio::join!(feed, child.wait_with_output());
        output
    };
    let output = match timeout(limit, work).await {
        Err(_) => return Err(ExchangeError::Timeout),
        Ok(Err(err)) => return Err(ExchangeError::Transport(err.to_string())),
        Ok(Ok(output)) => output,
    };

    find_reply(&String::from_utf8_lossy(&output.stdout)).ok_or_else(|| {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail = stderr.trim();
        let detail = detail
            .char_indices()
            .rev()
            .nth(DIAGNOSTIC_TAIL)
            .map_or(detail, |(index, _)| &detail[index..]);
        ExchangeError::Transport(format!("{} ({detail})", output.status))
    })
}

fn next_delay(current: Duration, max: Duration) -> Duration {
    (current * 2).min(max)
}

async fn launch(
    connector: &dyn Connector,
    spec: &RunSpec,
    options: &BridgeOptions,
) -> Result<(), BridgeError> {
    let script = launch_script(spec)?;
    let mut delay = options.reconnect_initial;
    let mut detail = String::new();
    for attempt in 1..=options.launch_attempts.max(1) {
        let reply = exchange(
            connector,
            LAUNCH_COMMAND,
            Some(script.as_bytes()),
            options.exec_timeout,
        )
        .await;
        match reply {
            Ok(Reply::Ok(_)) => return Ok(()),
            // An earlier attempt that lost its reply may still be running.
            Ok(Reply::Err(reason)) if reason == "incomplete-run-dir" => detail = reason,
            Ok(Reply::Err(reason)) => {
                return Err(BridgeError::Rejected {
                    target: connector.describe(),
                    reason,
                })
            }
            Err(err) => detail = err.to_string(),
        }
        if attempt < options.launch_attempts {
            sleep(delay).await;
            delay = next_delay(delay, options.reconnect_max);
        }
    }
    Err(BridgeError::Unreachable {
        target: connector.describe(),
        detail,
    })
}

/// What every attach attempt of one run shares.
#[derive(Clone, Copy)]
struct Run<'a> {
    connector: &'a dyn Connector,
    run_id: &'a str,
    options: &'a BridgeOptions,
    status: &'a StatusWriter,
}

#[derive(Debug, Default)]
struct Offsets {
    stdout: u64,
    stderr: u64,
}

enum AttachEnd {
    Exited(i32),
    /// The connection went away; resume from the current offsets.
    Dropped {
        reason: String,
        /// The shared connection itself looks dead, not just this channel.
        reset: bool,
    },
    Fatal(BridgeError),
}

/// Forward exactly `len` payload bytes. The offset advances per byte handed
/// to the local sink, so a frame cut in half resumes mid-frame, with nothing
/// repeated and nothing skipped.
async fn copy_payload<R, W>(
    reader: &mut R,
    sink: &mut W,
    len: u64,
    offset: &mut u64,
    stall: Duration,
) -> Result<(), AttachEnd>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut remaining = len;
    let mut buffer = vec![0u8; COPY_CHUNK.min(len as usize).max(1)];
    while remaining > 0 {
        let want = buffer.len().min(remaining as usize);
        let read = match timeout(stall, reader.read(&mut buffer[..want])).await {
            Err(_) => {
                return Err(AttachEnd::Dropped {
                    reason: "stalled mid-frame".to_string(),
                    reset: true,
                })
            }
            Ok(Err(err)) => {
                return Err(AttachEnd::Dropped {
                    reason: err.to_string(),
                    reset: false,
                })
            }
            Ok(Ok(0)) => {
                return Err(AttachEnd::Dropped {
                    reason: "connection closed mid-frame".to_string(),
                    reset: false,
                })
            }
            Ok(Ok(read)) => read,
        };
        let forward = async {
            sink.write_all(&buffer[..read]).await?;
            sink.flush().await
        };
        forward
            .await
            .map_err(|err| AttachEnd::Fatal(BridgeError::LocalIo(err)))?;
        *offset += read as u64;
        remaining -= read as u64;
    }
    Ok(())
}

async fn keep_tail<R: AsyncRead + Unpin>(mut reader: R) -> String {
    let mut tail = Vec::new();
    let mut buffer = [0u8; 1024];
    while let Ok(read) = reader.read(&mut buffer).await {
        if read == 0 {
            break;
        }
        tail.extend_from_slice(&buffer[..read]);
        if tail.len() > DIAGNOSTIC_TAIL {
            tail.drain(..tail.len() - DIAGNOSTIC_TAIL);
        }
    }
    String::from_utf8_lossy(&tail).trim().to_string()
}

async fn attach_once<O, E>(
    run: &Run<'_>,
    offsets: &mut Offsets,
    stdout: &mut O,
    stderr: &mut E,
    attempt: u32,
) -> AttachEnd
where
    O: AsyncWrite + Unpin,
    E: AsyncWrite + Unpin,
{
    let Run {
        connector,
        run_id,
        options,
        status,
    } = *run;
    let mut command = connector.command(&attach_command(run_id, offsets.stdout, offsets.stderr));
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(err) => {
            return AttachEnd::Dropped {
                reason: format!("spawn failed: {err}"),
                reset: false,
            }
        }
    };
    let mut reader = BufReader::with_capacity(
        COPY_CHUNK,
        child.stdout.take().expect("attach stdout is piped"),
    );
    let diagnostics = tokio::spawn(keep_tail(
        child.stderr.take().expect("attach stderr is piped"),
    ));
    let stall = options.stall_timeout;

    // Until the sync marker, stdout may carry a banner or rc-file output.
    let mut preamble = 0usize;
    loop {
        let line = match timeout(stall, read_line_limited(&mut reader, MAX_PREAMBLE_BYTES)).await {
            Err(_) => {
                return AttachEnd::Dropped {
                    reason: "no response from the host".to_string(),
                    reset: true,
                }
            }
            Ok(Ok(Some(line))) => line,
            Ok(Ok(None)) | Ok(Err(_)) => {
                drop(reader);
                let detail = timeout(Duration::from_secs(1), diagnostics)
                    .await
                    .ok()
                    .and_then(Result::ok)
                    .unwrap_or_default();
                return AttachEnd::Dropped {
                    reason: format!("connection failed: {detail}"),
                    reset: true,
                };
            }
        };
        let text = String::from_utf8_lossy(&line);
        if text == ATTACH_SYNC {
            break;
        }
        if let Some(reason) = text
            .strip_prefix(REPLY_PREFIX)
            .and_then(|rest| rest.strip_prefix("ERR "))
        {
            return AttachEnd::Fatal(BridgeError::RunLost {
                target: connector.describe(),
                reason: reason.to_string(),
            });
        }
        preamble += line.len() + 1;
        if preamble > MAX_PREAMBLE_BYTES {
            return AttachEnd::Dropped {
                reason: "no sync marker in the host's output".to_string(),
                reset: false,
            };
        }
    }
    status.write("connected", attempt, None);

    loop {
        let frame = match timeout(stall, read_frame_header(&mut reader)).await {
            Err(_) => {
                return AttachEnd::Dropped {
                    reason: "connection stalled".to_string(),
                    reset: true,
                }
            }
            Ok(Err(err)) => {
                return AttachEnd::Dropped {
                    reason: err.to_string(),
                    reset: false,
                }
            }
            Ok(Ok(None)) => {
                return AttachEnd::Dropped {
                    reason: "connection closed".to_string(),
                    reset: false,
                }
            }
            Ok(Ok(Some(frame))) => frame,
        };
        let copied = match frame {
            Frame::Keepalive => Ok(()),
            Frame::Exit(code) => return AttachEnd::Exited(code),
            Frame::Stdout(len) => {
                copy_payload(&mut reader, stdout, len, &mut offsets.stdout, stall).await
            }
            Frame::Stderr(len) => {
                copy_payload(&mut reader, stderr, len, &mut offsets.stderr, stall).await
            }
        };
        if let Err(end) = copied {
            return end;
        }
    }
}

async fn attach_until_exit<O, E>(
    run: &Run<'_>,
    stdout: &mut O,
    stderr: &mut E,
    attempts: &mut u32,
) -> Result<i32, BridgeError>
where
    O: AsyncWrite + Unpin,
    E: AsyncWrite + Unpin,
{
    let Run {
        connector,
        run_id,
        options,
        status,
    } = *run;
    let mut offsets = Offsets::default();
    let mut delay = options.reconnect_initial;
    loop {
        *attempts += 1;
        let before = offsets.stdout + offsets.stderr;
        let end = attach_once(run, &mut offsets, stdout, stderr, *attempts).await;
        let (reason, reset) = match end {
            AttachEnd::Exited(code) => return Ok(code),
            AttachEnd::Fatal(err) => return Err(err),
            AttachEnd::Dropped { reason, reset } => (reason, reset),
        };
        tracing::warn!(run_id, attempt = *attempts, %reason, "attach dropped; will resume");
        status.write("reconnecting", *attempts, Some(&reason));
        // Progress means the link worked a moment ago: start the backoff over.
        if offsets.stdout + offsets.stderr > before {
            delay = options.reconnect_initial;
        }
        if reset {
            if let Some(mut command) = connector.reset_command() {
                let _ = timeout(Duration::from_secs(5), command.status()).await;
            }
        }
        sleep(delay).await;
        delay = next_delay(delay, options.reconnect_max);
    }
}

/// Deliver one stdin message, retrying until the host acknowledges it. The
/// sequence number makes a retry of a delivered message a no-op remotely.
/// `false` means the run no longer takes input.
async fn deliver(
    connector: &dyn Connector,
    run_id: &str,
    seq: u64,
    message: &[u8],
    options: &BridgeOptions,
) -> bool {
    let command = write_command(run_id, seq, message.len());
    let mut delay = options.reconnect_initial;
    loop {
        match exchange(connector, &command, Some(message), options.write_timeout).await {
            Ok(Reply::Ok(_)) => return true,
            // The transfer was cut short but the helper still answered, or the
            // supervisor has not opened the FIFO yet. Both clear on a retry.
            Ok(Reply::Err(reason)) if reason == "short-write" || reason == "not-ready" => {}
            Ok(Reply::Err(reason)) => {
                tracing::debug!(run_id, seq, %reason, "stdin no longer accepted");
                return false;
            }
            Err(err) => tracing::debug!(run_id, seq, %err, "stdin delivery failed; retrying"),
        }
        sleep(delay).await;
        delay = next_delay(delay, options.reconnect_max);
    }
}

/// Forward local stdin as whole-line messages. Every CLI transport here is
/// newline-delimited JSON, so a message boundary is always a line boundary
/// and a retry can never splice half a line into the stream.
async fn pump_stdin<I>(
    connector: Arc<dyn Connector>,
    run_id: String,
    mut input: I,
    options: BridgeOptions,
) where
    I: AsyncRead + Unpin,
{
    let mut pending = Vec::new();
    let mut buffer = vec![0u8; COPY_CHUNK];
    let mut seq = 0u64;
    loop {
        let read = match input.read(&mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(read) => read,
        };
        pending.extend_from_slice(&buffer[..read]);
        let Some(newline) = pending.iter().rposition(|byte| *byte == b'\n') else {
            continue;
        };
        let message: Vec<u8> = pending.drain(..=newline).collect();
        if !deliver(connector.as_ref(), &run_id, seq, &message, &options).await {
            return;
        }
        seq += 1;
    }
    if !pending.is_empty() && !deliver(connector.as_ref(), &run_id, seq, &pending, &options).await {
        return;
    }
    // Local EOF is deliberate, unlike a dropped connection: pass it on.
    let command = ctl_command(&run_id, CtlAction::CloseStdin);
    let mut delay = options.reconnect_initial;
    loop {
        match exchange(connector.as_ref(), &command, None, options.exec_timeout).await {
            Ok(_) => return,
            Err(_) => {
                sleep(delay).await;
                delay = next_delay(delay, options.reconnect_max);
            }
        }
    }
}

async fn send_kill(connector: Arc<dyn Connector>, run_id: String, signal: Signal, limit: Duration) {
    let command = ctl_command(&run_id, CtlAction::Kill(signal));
    for _ in 0..3 {
        if exchange(connector.as_ref(), &command, None, limit)
            .await
            .is_ok()
        {
            return;
        }
        sleep(Duration::from_millis(300)).await;
    }
    tracing::warn!(
        run_id,
        ?signal,
        "could not deliver the kill; the run may outlive the bridge"
    );
}

/// Start `spec` on the host and bridge its stdio until it exits.
///
/// Resolves with the remote exit code. When `shutdown` resolves first the run
/// is terminated (TERM, then KILL after the grace period) before returning.
pub async fn run_bridge<I, O, E, S>(
    connector: Arc<dyn Connector>,
    spec: RunSpec,
    options: BridgeOptions,
    stdin: Option<I>,
    mut stdout: O,
    mut stderr: E,
    shutdown: S,
) -> Result<BridgeExit, BridgeError>
where
    I: AsyncRead + Unpin + Send + 'static,
    O: AsyncWrite + Unpin,
    E: AsyncWrite + Unpin,
    S: Future<Output = ()>,
{
    let status = StatusWriter::new(options.status_file.clone(), connector.describe());
    status.write("launching", 0, None);
    if let Err(err) = launch(connector.as_ref(), &spec, &options).await {
        status.write("failed", 0, Some(&err.to_string()));
        return Err(err);
    }

    let run_id = spec.run_id.clone();
    let stdin_task = match (spec.stdin, stdin) {
        (StdinMode::Pipe, Some(input)) => Some(tokio::spawn(pump_stdin(
            Arc::clone(&connector),
            run_id.clone(),
            input,
            options.clone(),
        ))),
        _ => None,
    };

    let mut attempts = 0u32;
    let mut killed = false;
    let result = {
        let run = Run {
            connector: connector.as_ref(),
            run_id: &run_id,
            options: &options,
            status: &status,
        };
        let attach = attach_until_exit(&run, &mut stdout, &mut stderr, &mut attempts);
        tokio::pin!(attach);
        tokio::pin!(shutdown);
        tokio::select! {
            result = &mut attach => result,
            () = &mut shutdown => {
                killed = true;
                status.write("stopping", 0, None);
                let kill_limit = options.exec_timeout.min(Duration::from_secs(10));
                // Off to the side, so output keeps flowing while TERM lands.
                tokio::spawn(send_kill(
                    Arc::clone(&connector),
                    run_id.clone(),
                    Signal::Term,
                    kill_limit,
                ));
                match timeout(options.kill_grace, &mut attach).await {
                    Ok(result) => result,
                    Err(_) => {
                        send_kill(Arc::clone(&connector), run_id.clone(), Signal::Kill, kill_limit)
                            .await;
                        timeout(options.kill_grace, &mut attach)
                            .await
                            .unwrap_or(Ok(128 + 15))
                    }
                }
            }
        }
    };

    if let Some(task) = stdin_task {
        task.abort();
    }
    let code = match result {
        Ok(code) => code,
        Err(err) => {
            status.write("failed", attempts, Some(&err.to_string()));
            return Err(err);
        }
    };
    if options.cleanup_on_exit {
        let cleanup = ctl_command(&run_id, CtlAction::Cleanup);
        let limit = options.exec_timeout.min(Duration::from_secs(10));
        let _ = exchange(connector.as_ref(), &cleanup, None, limit).await;
    }
    status.write("exited", attempts, None);
    Ok(BridgeExit {
        code,
        attach_attempts: attempts,
        killed,
    })
}
