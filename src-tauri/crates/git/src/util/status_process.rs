//! Bounded capture for read-only status probes. Drain both pipes while waiting
//! so large porcelain output cannot deadlock the deadline owner.
use std::io::Read;
use std::process::{Child, Output};
use std::sync::mpsc;
use std::time::{Duration, Instant};

pub(super) fn capture(mut child: Child, timeout: Duration) -> Result<Output, String> {
    let deadline = Instant::now() + timeout;
    let (send, receive) = mpsc::channel();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let out = send.clone();
    let stdout_thread = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = stdout
            .map(|mut pipe| pipe.read_to_end(&mut bytes))
            .transpose();
        let _ = out.send((true, result.map(|_| bytes)));
    });
    let stderr_thread = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = stderr
            .map(|mut pipe| pipe.read_to_end(&mut bytes))
            .transpose();
        let _ = send.send((false, result.map(|_| bytes)));
    });
    let result = (|| {
        let status = loop {
            if let Some(status) = child.try_wait().map_err(|err| err.to_string())? {
                break status;
            }
            if Instant::now() >= deadline {
                return Err("git status timed out".to_string());
            }
            std::thread::sleep(Duration::from_millis(25));
        };
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        for _ in 0..2 {
            let (is_stdout, bytes) = receive
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .map_err(|_| "git status output timed out".to_string())?;
            if is_stdout {
                stdout = bytes.map_err(|err| err.to_string())?;
            } else {
                stderr = bytes.map_err(|err| err.to_string())?;
            }
        }
        Ok(Output {
            status,
            stdout,
            stderr,
        })
    })();
    if result.is_err() {
        // The caller starts a dedicated process group. Kill helper descendants
        // as well as git so inherited pipes cannot keep drain threads alive.
        #[cfg(unix)]
        unsafe {
            libc::kill(-(child.id() as i32), libc::SIGKILL);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let _ = std::process::Command::new("taskkill")
                .args(["/PID", &child.id().to_string(), "/T", "/F"])
                .creation_flags(super::CREATE_NO_WINDOW)
                .output();
        }
        let _ = child.kill();
        let _ = child.wait();
    }
    let _ = stdout_thread.join();
    let _ = stderr_thread.join();
    result
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};

    fn child(script: &str) -> Child {
        Command::new("sh")
            .args(["-c", script])
            .process_group(0)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap()
    }
    #[test]
    fn kills_and_reaps_a_stalled_status_probe() {
        let started = Instant::now();
        assert!(capture(child("sleep 30"), Duration::from_millis(50))
            .unwrap_err()
            .contains("timed out"));
        assert!(started.elapsed() < Duration::from_secs(2));
    }
    #[test]
    fn drains_output_larger_than_pipe_capacity() {
        let result = capture(
            child("head -c 200000 /dev/zero; head -c 200000 /dev/zero >&2"),
            Duration::from_secs(5),
        )
        .unwrap();
        assert!(result.status.success());
        assert_eq!(result.stdout.len(), 200000);
        assert_eq!(result.stderr.len(), 200000);
    }
}
