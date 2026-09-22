use super::*;
use std::io::Read;
use std::os::unix::net::UnixListener;
use std::process::{Child, Command, Stdio};

fn test_paths(root: &Path, id: &str) -> Paths {
    Paths {
        lock: root.join(format!("{id}.lock")),
        socket: root.join(format!("{id}.sock")),
    }
}

struct TestChild(Child);
impl Drop for TestChild {
    fn drop(&mut self) {
        if self.0.try_wait().ok().flatten().is_none() {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
}

fn child(root: &Path, mode: &str, participants: usize) -> TestChild {
    TestChild(
        Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "single_instance_gate::tests::child_process",
                "--nocapture",
            ])
            .env("ORG2_SINGLETON_TEST_ROOT", root)
            .env("ORG2_SINGLETON_TEST_MODE", mode)
            .env("ORG2_SINGLETON_TEST_PARTICIPANTS", participants.to_string())
            .env("ORGII_HOME", root.join("orgii"))
            .env("ORGII_EXTERNAL_HISTORY_HOME", root.join("external"))
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap(),
    )
}

// On macOS, setting SO_RCVTIMEO on an accepted Unix peer that already closed
// can fail with EINVAL. Use a bounded nonblocking reader for the fixture.
fn receive(mut stream: UnixStream) -> Vec<u8> {
    stream.set_nonblocking(true).unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    let mut payload = Vec::new();
    let mut chunk = [0; 1024];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => return payload,
            Ok(count) => payload.extend_from_slice(&chunk[..count]),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                assert!(Instant::now() < deadline, "fixture receive timed out");
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(error) => panic!("fixture receive failed: {error}"),
        }
    }
}

fn wait_file(path: &Path) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !path.exists() {
        assert!(
            Instant::now() < deadline,
            "child did not reach expected boundary"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn wait_success(mut process: TestChild) {
    let child = &mut process.0;
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if let Some(status) = child.try_wait().unwrap() {
            let mut error = String::new();
            child
                .stderr
                .take()
                .unwrap()
                .read_to_string(&mut error)
                .unwrap();
            assert!(status.success(), "child failed: {error}");
            return;
        }
        if Instant::now() >= deadline {
            child.kill().unwrap();
            child.wait().unwrap();
            panic!("child timed out");
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn child_process() {
    let Some(root) = std::env::var_os("ORG2_SINGLETON_TEST_ROOT") else {
        return;
    };
    let root = PathBuf::from(root);
    let mode = std::env::var("ORG2_SINGLETON_TEST_MODE").unwrap();
    let count: usize = std::env::var("ORG2_SINGLETON_TEST_PARTICIPANTS")
        .unwrap()
        .parse()
        .unwrap();
    let paths = test_paths(&root, "instance");
    if mode == "cold" {
        wait_file(&root.join("start"));
    }
    match admit(
        &paths,
        b"/fixture\0\0org2\0org2://oauth/callback?code=fixture-only",
        Duration::from_secs(5),
    )
    .unwrap()
    {
        Admission::Primary(_guard) => {
            // Only the admitted process may reach a simulated database writer.
            OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(root.join("primary-writer"))
                .unwrap();
            if mode == "cold" {
                std::thread::sleep(Duration::from_millis(250));
            }
            if paths.socket.exists() {
                std::fs::remove_file(&paths.socket).unwrap();
            }
            let listener = UnixListener::bind(&paths.socket).unwrap();
            std::fs::write(root.join("ready"), b"ready").unwrap();
            if mode == "crash" {
                // Parent SIGKILL tests OS lock release, without any Rust Drop cleanup.
                loop {
                    std::thread::sleep(Duration::from_secs(1));
                }
            }
            for index in 1..count {
                let (stream, _) = listener.accept().unwrap();
                let payload = receive(stream);
                assert_eq!(
                    payload,
                    b"/fixture\0\0org2\0org2://oauth/callback?code=fixture-only"
                );
                std::fs::write(root.join(format!("forward-{index}")), b"exact").unwrap();
            }
        }
        Admission::Forwarded(_) => {
            assert_eq!(mode, "cold");
            // A duplicate exits here and never opens the simulated database.
        }
    }
}

#[test]
fn concurrent_cold_starts_admit_exactly_one_writer_and_forward_every_other_launch() {
    let root = tempfile::tempdir().unwrap();
    let children: Vec<_> = (0..6).map(|_| child(root.path(), "cold", 6)).collect();
    std::fs::write(root.path().join("start"), b"start").unwrap();
    for process in children {
        wait_success(process);
    }
    assert!(root.path().join("primary-writer").exists());
    for index in 1..6 {
        assert!(root.path().join(format!("forward-{index}")).exists());
    }
}

#[test]
fn existing_listener_receives_exact_arguments_without_claiming_a_new_primary() {
    let root = tempfile::tempdir().unwrap();
    let paths = test_paths(root.path(), "older-build");
    let listener = UnixListener::bind(&paths.socket).unwrap();
    let payload =
        b"/path with spaces\0\0org2\0org2://oauth/callback?code=private-marker&state=fixture";
    assert!(
        matches!(admit(&paths, payload, Duration::from_secs(1)).unwrap(), Admission::Forwarded(pid) if pid == std::process::id() as libc::pid_t)
    );
    let (stream, _) = listener.accept().unwrap();
    let actual = receive(stream);
    assert_eq!(actual, payload);
}

#[test]
fn killed_primary_releases_the_os_lock_and_stale_socket_can_be_reclaimed() {
    let root = tempfile::tempdir().unwrap();
    let mut process = child(root.path(), "crash", 1);
    wait_file(&root.path().join("ready"));
    let paths = test_paths(root.path(), "instance");
    assert!(
        verify_listener_at(&paths.socket, Duration::ZERO).is_err(),
        "another PID cannot satisfy listener ownership"
    );
    process.0.kill().unwrap();
    process.0.wait().unwrap();
    assert!(paths.socket.exists());
    let Admission::Primary(_guard) = admit(&paths, b"\0\0", Duration::from_secs(1)).unwrap() else {
        panic!("expected recovered ownership");
    };
    // The existing Tauri plugin performs this stale socket replacement after admission.
    std::fs::remove_file(&paths.socket).unwrap();
    let _listener = UnixListener::bind(&paths.socket).unwrap();
    verify_listener_at(&paths.socket, Duration::ZERO).unwrap();
}

#[test]
fn different_instance_locks_are_independent_and_unready_duplicates_fail_closed() {
    let root = tempfile::tempdir().unwrap();
    let first = test_paths(root.path(), "first");
    let second = test_paths(root.path(), "second");
    let Admission::Primary(_one) = admit(&first, b"\0\0", Duration::ZERO).unwrap() else {
        panic!();
    };
    let Admission::Primary(_two) = admit(&second, b"\0\0", Duration::ZERO).unwrap() else {
        panic!();
    };
    let error = admit(&first, b"\0\0", Duration::from_millis(60))
        .err()
        .unwrap();
    assert_eq!(error.kind(), io::ErrorKind::TimedOut);
    assert!(
        first.lock.exists(),
        "lock inode remains in place after timeouts"
    );
}

#[test]
fn unsafe_lock_files_and_missing_listeners_fail_closed() {
    let root = tempfile::tempdir().unwrap();
    let target = root.path().join("target");
    std::fs::write(&target, b"unchanged").unwrap();
    let link = root.path().join("link");
    std::os::unix::fs::symlink(&target, &link).unwrap();
    assert!(open_lock(&link).is_err());
    assert_eq!(std::fs::read(&target).unwrap(), b"unchanged");
    assert!(verify_listener_at(&root.path().join("missing"), Duration::from_millis(60)).is_err());
}

#[test]
fn own_listener_verification_waits_for_delayed_publication() {
    let root = tempfile::tempdir().unwrap();
    let socket = root.path().join("delayed.sock");
    let delayed_socket = socket.clone();
    let publisher = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(100));
        let listener = UnixListener::bind(delayed_socket).unwrap();
        let (stream, _) = listener.accept().unwrap();
        let actual = receive(stream);
        assert_eq!(actual, b"\0\0");
    });
    let result = verify_listener_at(&socket, Duration::from_secs(2));
    publisher.join().unwrap();
    result.unwrap();
}
