//! End-to-end tests of the bridge against a local `sh` standing in for the
//! SSH host. The protocol is identical; only the transport differs, and the
//! `Flaky` connector reproduces what a bad network does to that transport.

#![cfg(unix)]

use std::future::pending;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use remote_exec::{
    run_bridge, BridgeError, BridgeOptions, Connector, LocalShConnector, RunSpec, StdinMode,
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

struct Flaky {
    inner: LocalShConnector,
    /// Truncate this many attach streams after `cut_bytes` bytes, the way a
    /// dropped connection cuts a frame in half.
    attach_cuts: AtomicU32,
    cut_bytes: usize,
    /// Run this many stdin deliveries but lose their acknowledgement.
    lost_write_replies: AtomicU32,
    /// Once the first attach has been issued, fail everything for this long.
    outage_after_first_attach: Option<Duration>,
    outage_until: Mutex<Option<Instant>>,
    always_offline: AtomicBool,
    attaches: AtomicU32,
}

impl Flaky {
    fn new(home: &Path) -> Self {
        Self {
            inner: LocalShConnector::new(home.to_path_buf()),
            attach_cuts: AtomicU32::new(0),
            cut_bytes: 0,
            lost_write_replies: AtomicU32::new(0),
            outage_after_first_attach: None,
            outage_until: Mutex::new(None),
            always_offline: AtomicBool::new(false),
            attaches: AtomicU32::new(0),
        }
    }

    fn take(counter: &AtomicU32) -> bool {
        counter
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |left| {
                left.checked_sub(1)
            })
            .is_ok()
    }
}

impl Connector for Flaky {
    fn command(&self, remote_command: &str) -> Command {
        let mut outage = self.outage_until.lock().unwrap();
        let offline = self.always_offline.load(Ordering::SeqCst)
            || outage.is_some_and(|until| Instant::now() < until);
        if offline {
            // What `ssh` does when it cannot connect.
            return self.inner.command("echo 'connect failed' >&2; exit 255");
        }
        if remote_command.contains(" attach ") {
            let first = self.attaches.fetch_add(1, Ordering::SeqCst) == 0;
            if let (true, Some(length)) = (first, self.outage_after_first_attach) {
                *outage = Some(Instant::now() + length);
            }
            if Self::take(&self.attach_cuts) {
                return self
                    .inner
                    .command(&format!("{remote_command} | head -c {}", self.cut_bytes));
            }
        }
        if remote_command.contains(" write ") && Self::take(&self.lost_write_replies) {
            return self.inner.command(&format!("{remote_command} >/dev/null"));
        }
        self.inner.command(remote_command)
    }

    fn describe(&self) -> String {
        "flaky local sh".to_string()
    }
}

fn options() -> BridgeOptions {
    BridgeOptions {
        launch_attempts: 2,
        reconnect_initial: Duration::from_millis(40),
        reconnect_max: Duration::from_millis(200),
        kill_grace: Duration::from_secs(4),
        ..BridgeOptions::default()
    }
}

fn spec(run_id: &str, cwd: &Path, script: &str, stdin: StdinMode) -> RunSpec {
    RunSpec {
        run_id: run_id.to_string(),
        cwd: cwd.to_string_lossy().into_owned(),
        argv: vec!["sh".to_string(), "-c".to_string(), script.to_string()],
        env: Vec::new(),
        stdin,
        resolve_login_path: false,
    }
}

/// A protocol bug here tends to show up as a wait that never ends; fail
/// instead of hanging the suite.
async fn within<F: std::future::Future>(future: F) -> F::Output {
    tokio::time::timeout(Duration::from_secs(60), future)
        .await
        .expect("bridge did not finish in time")
}

struct Outcome {
    code: i32,
    attempts: u32,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

async fn run(connector: Arc<Flaky>, spec: RunSpec) -> Result<Outcome, BridgeError> {
    let (mut stdout, mut stderr) = (Vec::new(), Vec::new());
    let exit = within(run_bridge(
        connector,
        spec,
        options(),
        None::<tokio::io::Empty>,
        &mut stdout,
        &mut stderr,
        pending(),
    ))
    .await?;
    Ok(Outcome {
        code: exit.code,
        attempts: exit.attach_attempts,
        stdout,
        stderr,
    })
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

#[tokio::test]
async fn streams_both_outputs_and_the_exit_code_then_cleans_up() {
    let home = tempfile::tempdir().unwrap();
    let connector = Arc::new(Flaky::new(home.path()));
    let outcome = run(
        connector,
        spec(
            "basic",
            home.path(),
            "printf hello; printf oops >&2; exit 7",
            StdinMode::Null,
        ),
    )
    .await
    .unwrap();

    assert_eq!(text(&outcome.stdout), "hello");
    assert_eq!(text(&outcome.stderr), "oops");
    assert_eq!(outcome.code, 7);
    assert_eq!(outcome.attempts, 1);
    assert!(!home.path().join(".orgii/remote/runs/basic").exists());
}

#[tokio::test]
async fn resumes_mid_frame_without_repeating_or_skipping_a_byte() {
    let home = tempfile::tempdir().unwrap();
    let mut flaky = Flaky::new(home.path());
    flaky.attach_cuts = AtomicU32::new(6);
    flaky.cut_bytes = 700;
    let script = r#"i=0; while [ $i -lt 400 ]; do
        echo "out line $i"; echo "err line $i" >&2
        [ $((i % 100)) -eq 99 ] && sleep 0.2
        i=$((i+1)); done"#;
    let outcome = run(
        Arc::new(flaky),
        spec("resume", home.path(), script, StdinMode::Null),
    )
    .await
    .unwrap();

    let expect = |label: &str| {
        (0..400)
            .map(|i| format!("{label} line {i}\n"))
            .collect::<String>()
    };
    assert_eq!(text(&outcome.stdout), expect("out"));
    assert_eq!(text(&outcome.stderr), expect("err"));
    assert_eq!(outcome.code, 0);
    assert!(outcome.attempts >= 7, "attempts = {}", outcome.attempts);
}

#[tokio::test]
async fn large_output_survives_a_cut_inside_a_capped_frame() {
    let home = tempfile::tempdir().unwrap();
    let mut flaky = Flaky::new(home.path());
    flaky.attach_cuts = AtomicU32::new(1);
    flaky.cut_bytes = 1_500_000;
    let outcome = run(
        Arc::new(flaky),
        spec(
            "large",
            home.path(),
            "head -c 3000000 /dev/zero | tr '\\0' x",
            StdinMode::Null,
        ),
    )
    .await
    .unwrap();

    assert_eq!(outcome.stdout.len(), 3_000_000);
    assert!(outcome.stdout.iter().all(|byte| *byte == b'x'));
    assert_eq!(outcome.attempts, 2);
}

#[tokio::test]
async fn a_run_that_finishes_during_an_outage_is_fully_recovered() {
    let home = tempfile::tempdir().unwrap();
    let mut flaky = Flaky::new(home.path());
    // Sync marker, one frame header and "start\n": the link dies right after
    // the first line, stays down while the process finishes, then returns.
    flaky.attach_cuts = AtomicU32::new(1);
    flaky.cut_bytes = "ORGII-ATTACH 1\nO 6\nstart\n".len();
    flaky.outage_after_first_attach = Some(Duration::from_millis(1500));
    let outcome = run(
        Arc::new(flaky),
        spec(
            "outage",
            home.path(),
            "echo start; sleep 0.7; echo end; exit 3",
            StdinMode::Null,
        ),
    )
    .await
    .unwrap();

    assert_eq!(text(&outcome.stdout), "start\nend\n");
    assert_eq!(outcome.code, 3);
    assert!(outcome.attempts > 2, "attempts = {}", outcome.attempts);
}

#[tokio::test]
async fn stdin_is_delivered_exactly_once_and_eof_is_passed_on() {
    let home = tempfile::tempdir().unwrap();
    let flaky = Flaky::new(home.path());
    // The message lands but its acknowledgement is lost, twice. The retries
    // must be recognised remotely instead of being delivered again.
    flaky.lost_write_replies.store(2, Ordering::SeqCst);
    let (mut input, bridge_stdin) = tokio::io::duplex(1024);
    let script = r#"while IFS= read -r line; do echo "got:$line"; done; echo eof"#;

    let (mut stdout, mut stderr) = (Vec::new(), Vec::new());
    let bridge = run_bridge(
        Arc::new(flaky),
        spec("stdin", home.path(), script, StdinMode::Pipe),
        options(),
        Some(bridge_stdin),
        &mut stdout,
        &mut stderr,
        pending(),
    );
    let feed = async move {
        for line in ["one\n", "it's \"two\"\n", "three\n"] {
            input.write_all(line.as_bytes()).await.unwrap();
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
        drop(input);
    };
    let (exit, ()) = within(async { tokio::join!(bridge, feed) }).await;

    assert_eq!(exit.unwrap().code, 0);
    assert_eq!(text(&stdout), "got:one\ngot:it's \"two\"\ngot:three\neof\n");
}

/// Regression: a message written before the supervisor had opened the FIFO
/// went into a pipe nobody held and was dropped. A slow login shell keeps the
/// supervisor busy long enough to make the early write certain.
#[tokio::test]
async fn an_early_stdin_message_waits_for_the_process_to_open_its_stdin() {
    use std::os::unix::fs::PermissionsExt;

    let home = tempfile::tempdir().unwrap();
    let login_shell = home.path().join("slow-login-shell");
    std::fs::write(&login_shell, "#!/bin/sh\nsleep 1\n").unwrap();
    std::fs::set_permissions(&login_shell, std::fs::Permissions::from_mode(0o755)).unwrap();
    let mut flaky = Flaky::new(home.path());
    flaky.inner = flaky
        .inner
        .with_env("SHELL", &login_shell.to_string_lossy());

    let mut run_spec = spec(
        "early",
        home.path(),
        r#"IFS= read -r line; echo "got:$line""#,
        StdinMode::Pipe,
    );
    run_spec.resolve_login_path = true;
    let (mut input, bridge_stdin) = tokio::io::duplex(1024);
    input.write_all(b"first\n").await.unwrap();

    let (mut stdout, mut stderr) = (Vec::new(), Vec::new());
    let exit = within(run_bridge(
        Arc::new(flaky),
        run_spec,
        options(),
        Some(bridge_stdin),
        &mut stdout,
        &mut stderr,
        pending(),
    ))
    .await
    .unwrap();

    assert_eq!(text(&stdout), "got:first\n");
    assert_eq!(exit.code, 0);
    drop(input);
}

#[tokio::test]
async fn shutdown_terminates_the_remote_process_tree() {
    let home = tempfile::tempdir().unwrap();
    let (stdout, observed) = tokio::io::duplex(4096);
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    let mut stderr = Vec::new();

    let bridge = run_bridge(
        Arc::new(Flaky::new(home.path())),
        spec(
            "kill",
            home.path(),
            "sleep 300 & echo $!; echo ready; wait",
            StdinMode::Null,
        ),
        options(),
        None::<tokio::io::Empty>,
        stdout,
        &mut stderr,
        async {
            let _ = stopped.await;
        },
    );
    let observe = async move {
        let mut lines = BufReader::new(observed).lines();
        let grandchild = lines.next_line().await.unwrap().expect("pid line");
        assert_eq!(lines.next_line().await.unwrap().as_deref(), Some("ready"));
        stop.send(()).unwrap();
        grandchild
    };
    let (exit, grandchild) = within(async { tokio::join!(bridge, observe) }).await;

    let exit = exit.unwrap();
    assert!(exit.killed);
    assert_ne!(exit.code, 0);
    let alive = || {
        std::process::Command::new("kill")
            .args(["-0", &grandchild])
            .stderr(std::process::Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    };
    let deadline = Instant::now() + Duration::from_secs(3);
    while alive() && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(!alive(), "grandchild {grandchild} outlived the shutdown");
}

#[tokio::test]
async fn hostile_arguments_reach_the_process_verbatim() {
    let home = tempfile::tempdir().unwrap();
    let hostile = "it's $(echo pwned) `id`\nORGII_CMD_EOF_0\necho pwned; \"q\" \\n end";
    let mut run_spec = spec("hostile", home.path(), "", StdinMode::Null);
    run_spec.argv = vec!["printf".to_string(), "%s".to_string(), hostile.to_string()];
    let outcome = run(Arc::new(Flaky::new(home.path())), run_spec)
        .await
        .unwrap();

    assert_eq!(text(&outcome.stdout), hostile);
    assert_eq!(outcome.code, 0);
}

#[tokio::test]
async fn env_is_exported_and_path_comes_from_the_login_shell() {
    use std::os::unix::fs::PermissionsExt;

    let home = tempfile::tempdir().unwrap();
    let login_shell = home.path().join("fake-login-shell");
    std::fs::write(
        &login_shell,
        "#!/bin/sh\nprintf 'rc file noise\\n__ORGII_PATH__%s__ORGII_END__\\n' \"/fake/bin:$PATH\"\n",
    )
    .unwrap();
    std::fs::set_permissions(&login_shell, std::fs::Permissions::from_mode(0o755)).unwrap();

    let mut flaky = Flaky::new(home.path());
    flaky.inner = flaky
        .inner
        .with_env("SHELL", &login_shell.to_string_lossy());
    let mut run_spec = spec(
        "env",
        home.path(),
        r#"printf '%s|%s' "${PATH%%:*}" "$GREETING""#,
        StdinMode::Null,
    );
    run_spec.resolve_login_path = true;
    run_spec.env = vec![("GREETING".to_string(), "hi 'there' $USER".to_string())];
    let outcome = run(Arc::new(flaky), run_spec).await.unwrap();

    assert_eq!(text(&outcome.stdout), "/fake/bin|hi 'there' $USER");
}

#[tokio::test]
async fn a_missing_working_directory_is_rejected_without_retrying() {
    let home = tempfile::tempdir().unwrap();
    let missing = home.path().join("nope");
    let error = run(
        Arc::new(Flaky::new(home.path())),
        spec("nocwd", &missing, "true", StdinMode::Null),
    )
    .await
    .err()
    .expect("launch must fail");

    assert!(
        matches!(&error, BridgeError::Rejected { reason, .. } if reason == "cwd-missing"),
        "{error}"
    );
}

#[tokio::test]
async fn an_unreachable_host_fails_the_launch_quickly() {
    let home = tempfile::tempdir().unwrap();
    let flaky = Flaky::new(home.path());
    flaky.always_offline.store(true, Ordering::SeqCst);
    let started = Instant::now();
    let error = run(
        Arc::new(flaky),
        spec("offline", home.path(), "true", StdinMode::Null),
    )
    .await
    .err()
    .expect("launch must fail");

    assert!(
        matches!(&error, BridgeError::Unreachable { detail, .. } if detail.contains("connect failed")),
        "{error}"
    );
    assert!(started.elapsed() < Duration::from_secs(5));
}

#[tokio::test]
async fn a_missing_program_reports_127_with_the_shell_error() {
    let home = tempfile::tempdir().unwrap();
    let mut run_spec = spec("missing", home.path(), "", StdinMode::Null);
    run_spec.argv = vec!["orgii-no-such-cli".to_string()];
    let outcome = run(Arc::new(Flaky::new(home.path())), run_spec)
        .await
        .unwrap();

    assert_eq!(outcome.code, 127);
    assert!(text(&outcome.stderr).contains("orgii-no-such-cli"));
}
