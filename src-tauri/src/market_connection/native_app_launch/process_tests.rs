use super::*;

fn raw(args: &[&[u8]], env: &[u8]) -> Vec<u8> {
    let mut bytes = (args.len() as i32).to_ne_bytes().to_vec();
    bytes.extend_from_slice(b"/Applications/Vendor App.app/Contents/MacOS/Vendor\0\0\0");
    for arg in args {
        bytes.extend_from_slice(arg);
        bytes.push(0);
    }
    bytes.extend_from_slice(env);
    bytes
}

#[test]
fn kernel_arguments_preserve_spaces_and_do_not_parse_environment() {
    let bytes = raw(
        &[
            b"Vendor",
            b"--user-data-dir=/Users/test/profile with spaces",
            b"",
        ],
        b"--user-data-dir=/primary\0SECRET=hidden\0",
    );
    let args = arguments(&bytes).unwrap();
    assert_eq!(args.len(), 3);
    assert_eq!(
        profile_argument(&args).unwrap(),
        Some(b"/Users/test/profile with spaces".as_slice())
    );
    assert_eq!(
        profile_argument(&[b"Vendor", b"--user-data-dir", b"/isolated"]).unwrap(),
        Some(b"/isolated".as_slice())
    );
    assert_eq!(
        profile_argument(&[b"Vendor", b"--unrelated-user-data-dir=/isolated"]).unwrap(),
        None
    );
}

#[test]
fn malformed_or_duplicate_profile_arguments_fail_closed() {
    for args in [
        vec![b"Vendor".as_slice(), b"--user-data-dir"],
        vec![b"Vendor", b"--user-data-dir="],
        vec![b"Vendor", b"--user-data-dir=/a", b"--user-data-dir", b"/b"],
    ] {
        assert!(profile_argument(&args).is_err());
    }
    assert!(arguments(&[0, 0]).is_err());
    assert!(arguments(&raw(&[b"Vendor"], b"")[..6]).is_err());
    let mut wrong_count = raw(&[b"Vendor"], b"");
    wrong_count[..4].copy_from_slice(&5000i32.to_ne_bytes());
    assert!(arguments(&wrong_count).is_err());
}

#[test]
fn executable_requires_exact_bundle_child_and_rejects_symlink_escape() {
    let dir = tempfile::tempdir().unwrap();
    let bundle = dir.path().join("Vendor.app");
    std::fs::create_dir_all(bundle.join("Contents/MacOS")).unwrap();
    let binary = bundle.join("Contents/MacOS/Vendor");
    std::fs::write(&binary, b"fixture").unwrap();
    let mut dict = plist::Dictionary::new();
    dict.insert("CFBundleExecutable".into(), "Vendor".into());
    plist::Value::Dictionary(dict.clone())
        .to_file_xml(bundle.join("Contents/Info.plist"))
        .unwrap();
    assert_eq!(
        executable(&bundle.canonicalize().unwrap()).unwrap(),
        binary.canonicalize().unwrap()
    );
    dict.insert("CFBundleExecutable".into(), "../../other".into());
    plist::Value::Dictionary(dict.clone())
        .to_file_xml(bundle.join("Contents/Info.plist"))
        .unwrap();
    assert!(executable(&bundle).is_err());
    dict.insert("CFBundleExecutable".into(), "Vendor".into());
    plist::Value::Dictionary(dict)
        .to_file_xml(bundle.join("Contents/Info.plist"))
        .unwrap();
    std::fs::remove_file(&binary).unwrap();
    let outside = dir.path().join("outside");
    std::fs::write(&outside, b"fixture").unwrap();
    std::os::unix::fs::symlink(outside, binary).unwrap();
    assert!(executable(&bundle).is_err());
}

#[test]
fn real_kernel_snapshot_is_readable_and_current_process_is_not_an_app_profile() {
    let pid = std::process::id() as i32;
    let snapshot = info(pid).unwrap().unwrap();
    assert_eq!(snapshot.pbi_uid, unsafe { libc::geteuid() });
    let bytes = process_args(pid).unwrap();
    assert!(!arguments(&bytes).unwrap().is_empty());
    assert_eq!(boot().unwrap().len(), 37);
    assert!(find(
        &std::env::current_exe().unwrap(),
        Path::new("/not-an-org2-profile"),
        "org2.fixture"
    )
    .unwrap()
    .is_none());
}

use super::super::tests::FixtureChild as Child;
fn fixture_child(profile: &Path) -> Child {
    fixture_child_executable(Path::new("/bin/bash"), profile)
}
fn fixture_child_executable(executable: &Path, profile: &Path) -> Child {
    Child(
        std::process::Command::new(executable)
            .args(["-c", "read -r value", "org2-launch-fixture"])
            .arg(format!("--user-data-dir={}", profile.display()))
            .stdin(std::process::Stdio::piped())
            .spawn()
            .unwrap(),
    )
}
#[test]
fn kernel_profile_match_distinguishes_other_profiles_executables_duplicates_and_exit() {
    let dir = tempfile::tempdir().unwrap();
    let profile = dir.path().canonicalize().unwrap();
    let executable = Path::new("/bin/bash").canonicalize().unwrap();
    let mut child = fixture_child(&profile);
    let pid = child.0.id() as i32;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    let identity = loop {
        if let Some(found) = matches(pid, &executable, &profile, false).unwrap() {
            break found;
        }
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(10));
    };
    assert_eq!(
        find(&executable, &profile, "org2.fixture").unwrap(),
        Some(identity.clone())
    );
    verify(&identity, &executable, &profile).unwrap();
    let stale = Identity {
        started: (identity.started.0, identity.started.1 + 1),
        ..identity
    };
    assert!(verify(&stale, &executable, &profile).is_err());
    assert!(
        matches(pid, &executable, &profile.join("different-owner"), false)
            .unwrap()
            .is_none()
    );
    assert!(
        matches(pid, Path::new("/bin/not-the-bundle"), &profile, false)
            .unwrap()
            .is_none()
    );
    assert!(
        matches(pid, Path::new("/bin/not-the-bundle"), &profile, true)
            .unwrap_err()
            .contains("Another installed version")
    );
    assert!(matches(
        pid,
        Path::new("/bin/not-the-bundle"),
        &profile.join("other-owner"),
        true
    )
    .unwrap()
    .is_none());
    let _second = fixture_child(&profile);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    loop {
        if let Err(error) = find(&executable, &profile, "org2.fixture") {
            assert!(error.contains("Multiple official App processes"), "{error}");
            break;
        }
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    child.0.kill().unwrap();
    assert!(child
        .wait_for(std::time::Duration::from_secs(1))
        .unwrap()
        .is_some());
    assert!(matches(pid, &executable, &profile, false)
        .unwrap()
        .is_none());
}

#[test]
fn helpers_and_prefix_lookalikes_cannot_own_the_profile() {
    let profile = Path::new("/exact/profile");
    for args in [
        vec![
            b"Vendor".as_slice(),
            b"--user-data-dir=/exact/profile-suffix",
        ],
        vec![
            b"Vendor",
            b"--user-data-dir=/exact/profile",
            b"--type=renderer",
        ],
        vec![
            b"Vendor",
            b"--user-data-dir=/exact/profile",
            b"--type",
            b"utility",
        ],
        vec![b"Vendor"],
    ] {
        assert!(!owns_profile(&args, profile).unwrap());
    }
    assert!(owns_profile(&[b"Vendor", b"--user-data-dir=/exact/profile"], profile).unwrap());
}

#[test]
fn missing_executable_requires_proof_of_an_unrelated_profile() {
    let profile = Path::new("/exact/profile");
    assert!(!unrelated_without_executable(None, profile).unwrap());
    assert!(!unrelated_without_executable(
        Some(&raw(&[b"Vendor", b"--user-data-dir=/exact/profile"], b"")),
        profile,
    )
    .unwrap());
    assert!(unrelated_without_executable(
        Some(&raw(&[b"Vendor", b"--user-data-dir=/another/profile"], b"")),
        profile,
    )
    .unwrap());
    assert!(unrelated_without_executable(Some(&[0, 0]), profile).is_err());
    assert!(unrelated_without_executable(
        Some(&raw(
            &[
                b"Vendor",
                b"--user-data-dir=/another/profile",
                b"--user-data-dir=/exact/profile"
            ],
            b""
        )),
        profile,
    )
    .is_err());
}

#[test]
fn delayed_activation_is_cancelled_before_its_side_effect() {
    let queued = std::sync::Arc::new(std::sync::Mutex::new(None));
    let callback = queued.clone();
    let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let observed = calls.clone();
    let error = activation_handoff(
        std::time::Duration::from_millis(10),
        move |work| *callback.lock().unwrap() = Some(work),
        move |_| {
            observed.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(())
        },
    )
    .unwrap_err();
    assert_eq!(error, ACTIVATION_EXPIRED);
    queued.lock().unwrap().take().unwrap()();
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 0);
}

#[test]
fn activation_handoff_returns_result_without_waiting_on_itself() {
    assert!(activation_handoff(
        std::time::Duration::from_secs(1),
        |work| work(),
        |gate| gate.check()
    )
    .is_ok());
    assert_eq!(
        activation_handoff(
            std::time::Duration::from_secs(1),
            |work| work(),
            |_| Err("owner changed".into())
        )
        .unwrap_err(),
        "owner changed"
    );
}

/// A copy of this test binary that runs no tests and exits at once: the same
/// executable `find` is asked about, entering and leaving the process table.
fn short_lived_self() -> std::process::Child {
    std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "no-such-test-short-lived-process-fixture"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap()
}

#[test]
fn unreadable_process_is_reinspected_until_decided() {
    let identity = Identity {
        pid: 7,
        started: (1, 2),
    };
    let mut passes = vec![
        Inspection::Decided(Some(identity.clone())),
        Inspection::Unreadable("unreadable"),
        Inspection::Unreadable("unreadable"),
    ];
    let settled = settle(5, std::time::Duration::ZERO, || Ok(passes.pop().unwrap()));
    assert_eq!(settled.unwrap(), Some(identity));
    assert!(passes.is_empty());

    // A process that never becomes readable is never assumed unrelated.
    let mut calls = 0;
    let stuck = settle(3, std::time::Duration::ZERO, || {
        calls += 1;
        Ok(Inspection::Unreadable(
            "Cannot inspect official App arguments",
        ))
    });
    assert_eq!(stuck.unwrap_err(), "Cannot inspect official App arguments");
    assert_eq!(calls, 4);

    // Definite failures are not retried.
    let mut calls = 0;
    let failed = settle(3, std::time::Duration::ZERO, || {
        calls += 1;
        Err("Official App process changed during inspection".into())
    });
    assert!(failed.is_err());
    assert_eq!(calls, 1);
}

#[test]
fn a_held_zombie_of_the_target_executable_is_not_an_owner() {
    let mut child = short_lived_self();
    let pid = child.id() as i32;
    // Unreaped until `wait`: the kernel keeps a zombie. It reports ESRCH to
    // proc_pidinfo, so wait for that rather than a zombie status.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while info(pid).unwrap().is_some() {
        assert!(std::time::Instant::now() < deadline, "fixture never exited");
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert!(exiting(pid).unwrap());
    let found = find(
        &std::env::current_exe().unwrap(),
        Path::new("/not-an-org2-profile"),
        "org2.fixture",
    );
    child.wait().unwrap();
    assert_eq!(found.unwrap(), None);
}

#[test]
fn processes_spawning_and_exiting_during_a_scan_do_not_fail_it() {
    // Regression: children of the target executable caught mid-posix_spawn
    // (no argv yet) or mid-exit made about 40% of scans fail with "Cannot
    // inspect official App arguments", flaking sibling tests in CI.
    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let spawners: Vec<_> = (0..2)
        .map(|_| {
            let stop = stop.clone();
            std::thread::spawn(move || {
                while !stop.load(std::sync::atomic::Ordering::Relaxed) {
                    short_lived_self().wait().unwrap();
                }
            })
        })
        .collect();
    let executable = std::env::current_exe().unwrap();
    let started = std::time::Instant::now();
    let mut failures = Vec::new();
    let mut scans = 0;
    while started.elapsed() < std::time::Duration::from_secs(3) {
        scans += 1;
        if let Err(error) = find(
            &executable,
            Path::new("/not-an-org2-profile"),
            "org2.fixture",
        ) {
            failures.push(error);
        }
    }
    stop.store(true, std::sync::atomic::Ordering::Relaxed);
    for spawner in spawners {
        spawner.join().unwrap();
    }
    assert!(
        failures.is_empty(),
        "{} of {scans} scans failed: {:?}",
        failures.len(),
        failures.first()
    );
}

#[test]
fn history_writer_detection_recognizes_native_and_script_entrypoints() {
    for path in [
        "/opt/bin/claude",
        "/Applications/Claude.app/Contents/Helpers/other-helper",
        "/tmp/Claude.app/Contents/Helpers/chrome-native-host",
        "/opt/bin/claude.exe",
        "/Applications/Claude.app/Contents/MacOS/Claude",
        "/opt/lib/node_modules/@anthropic-ai/claude-code/cli.js",
    ] {
        assert!(claude_executable(path));
    }
    for path in [
        "/opt/bin/node",
        "/Applications/Claude.app/Contents/Helpers/chrome-native-host",
        "/opt/bin/claude-notes",
        "/work/Claude-history.txt",
        "/opt/bin/codex",
    ] {
        assert!(!claude_executable(path));
    }
    assert!(arguments(&[0, 0, 0, 0]).is_err());
}
