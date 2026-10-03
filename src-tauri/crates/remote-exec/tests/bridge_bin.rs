//! Drives the real `org2-ssh-bridge` binary the way the session runner will:
//! as a child process with piped stdio that is stopped with SIGTERM. A fake
//! `ssh` on `PATH` runs the remote command locally under a private home.

#![cfg(unix)]

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, Instant};

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

const FAKE_SSH: &str = r#"#!/bin/sh
# Skip the client options and the host operand; run what is left.
while [ $# -gt 0 ]; do
    case "$1" in
        --) shift; break ;;
        *) shift ;;
    esac
done
shift
cd "$FAKE_REMOTE_HOME" || exit 255
HOME="$FAKE_REMOTE_HOME"
export HOME
exec sh -c "$1"
"#;

/// A bridge command whose `ssh` is the fake above, with `home` as the host.
fn bridge(home: &Path) -> Command {
    let bin_dir = home.join("bin");
    std::fs::create_dir_all(&bin_dir).unwrap();
    let ssh = bin_dir.join("ssh");
    std::fs::write(&ssh, FAKE_SSH).unwrap();
    std::fs::set_permissions(&ssh, std::fs::Permissions::from_mode(0o755)).unwrap();

    let mut command = Command::new(env!("CARGO_BIN_EXE_org2-ssh-bridge"));
    command
        .env(
            "PATH",
            format!(
                "{}:{}",
                bin_dir.display(),
                std::env::var("PATH").unwrap_or_default()
            ),
        )
        .env("FAKE_REMOTE_HOME", home)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Same as the session runner, and it keeps a kill aimed at the run
        // away from the test harness.
        .process_group(0)
        .kill_on_drop(true);
    command
}

async fn within<F: std::future::Future>(future: F) -> F::Output {
    tokio::time::timeout(Duration::from_secs(60), future)
        .await
        .expect("bridge did not finish in time")
}

#[tokio::test]
async fn bridges_stdio_env_and_the_exit_code() {
    let home = tempfile::tempdir().unwrap();
    let mut child = bridge(home.path())
        .args(["--host", "devbox", "--run-id", "bin-io", "--no-login-path"])
        .arg("--cwd")
        .arg(home.path())
        .args(["--forward-env", "GREETING", "--forward-env", "ORGII_NOT_SET"])
        .args(["--", "sh", "-c"])
        .arg(r#"IFS= read -r line; echo "$GREETING:${ORGII_NOT_SET-unset}:$line"; echo warn >&2; exit 5"#)
        .env("GREETING", "hello")
        .spawn()
        .unwrap();

    let mut stdin = child.stdin.take().unwrap();
    stdin.write_all(b"from the runner\n").await.unwrap();
    let output = within(child.wait_with_output()).await.unwrap();

    assert_eq!(
        String::from_utf8_lossy(&output.stdout),
        "hello:unset:from the runner\n"
    );
    assert_eq!(String::from_utf8_lossy(&output.stderr), "warn\n");
    assert_eq!(output.status.code(), Some(5));
    drop(stdin);
}

#[tokio::test]
async fn sigterm_stops_the_remote_process_before_the_bridge_exits() {
    let home = tempfile::tempdir().unwrap();
    let mut child = bridge(home.path())
        .args([
            "--host",
            "devbox",
            "--run-id",
            "bin-term",
            "--no-login-path",
        ])
        .args(["--stdin", "null", "--cwd"])
        .arg(home.path())
        .args(["--", "sh", "-c", "sleep 300 & echo $!; wait"])
        .spawn()
        .unwrap();
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
    let grandchild = within(lines.next_line()).await.unwrap().expect("pid line");

    let bridge_pid = child.id().expect("bridge is running").to_string();
    let sent = std::process::Command::new("kill")
        .args(["-TERM", &bridge_pid])
        .status()
        .unwrap();
    assert!(sent.success());
    let status = within(child.wait()).await.unwrap();
    assert!(!status.success());

    let alive = || {
        std::process::Command::new("kill")
            .args(["-0", &grandchild])
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    };
    let deadline = Instant::now() + Duration::from_secs(3);
    while alive() && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(!alive(), "remote process {grandchild} outlived SIGTERM");
}

#[tokio::test]
async fn usage_errors_exit_64_and_bridge_failures_exit_125() {
    let home = tempfile::tempdir().unwrap();

    let usage = bridge(home.path())
        .args([
            "--host",
            "-oProxyCommand=evil",
            "--run-id",
            "x",
            "--cwd",
            "/",
        ])
        .args(["--", "true"])
        .output();
    let usage = within(usage).await.unwrap();
    assert_eq!(usage.status.code(), Some(64));
    assert!(String::from_utf8_lossy(&usage.stderr).contains("invalid ssh host alias"));

    let rejected = bridge(home.path())
        .args([
            "--host",
            "devbox",
            "--run-id",
            "bin-rejected",
            "--stdin",
            "null",
        ])
        .args(["--cwd", "/orgii/definitely/missing", "--", "true"])
        .output();
    let rejected = within(rejected).await.unwrap();
    assert_eq!(rejected.status.code(), Some(125));
    let message = String::from_utf8_lossy(&rejected.stderr);
    assert!(message.contains("cwd-missing"), "{message}");
}
