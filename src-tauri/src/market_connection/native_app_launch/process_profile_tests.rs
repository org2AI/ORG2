use super::*;

fn bytes(environment: &[u8]) -> Vec<u8> {
    let mut bytes = 1_i32.to_ne_bytes().to_vec();
    bytes.extend_from_slice(b"/fixture/vendor\0\0vendor\0");
    bytes.extend_from_slice(environment);
    bytes
}

fn expected() -> ExpectedEnvironment {
    ExpectedEnvironment(vec![
        (
            "CODEX_HOME",
            ExpectedValue::Exact(b"/managed/home".to_vec()),
        ),
        ("OPENAI_API_KEY", ExpectedValue::AbsentOrEmpty),
    ])
}

#[test]
fn environment_checks_only_owned_selectors_and_does_not_expose_credentials() {
    let value = expected();
    value
        .check_bytes(&bytes(
            b"CODEX_HOME=/managed/home\0UNRELATED_SECRET=never-copy\0",
        ))
        .unwrap();
    value
        .check_bytes(&bytes(b"CODEX_HOME=/managed/home\0OPENAI_API_KEY=\0\0\0"))
        .unwrap();
    assert_eq!(
        value
            .check_bytes(&bytes(
                b"CODEX_HOME=/managed/home\0OPENAI_API_KEY=never-log\0"
            ))
            .unwrap_err(),
        MISMATCH,
    );
    assert_eq!(
        value
            .check_bytes(&bytes(b"CODEX_HOME=/different/owner\0"))
            .unwrap_err(),
        MISMATCH,
    );
}

#[test]
fn missing_duplicate_and_malformed_environment_cannot_prove_profile() {
    for raw in [
        b"".as_slice(),
        b"OTHER_HOME=/managed/home\0",
        b"CODEX_HOME=/managed/home\0CODEX_HOME=/managed/home\0",
        b"CODEX_HOME=/managed/home\0OPENAI_API_KEY=\0OPENAI_API_KEY=\0",
        b"CODEX_HOME=/managed/home",
        b"CODEX_HOME=/managed/home\0BROKEN\0",
        b"CODEX_HOME=/managed/home\0=value\0",
    ] {
        assert_eq!(expected().check_bytes(&bytes(raw)).unwrap_err(), UNKNOWN);
    }
}

#[test]
fn darwin_auxiliary_vector_never_counts_as_profile_environment() {
    expected()
        .check_bytes(&bytes(
            b"CODEX_HOME=/managed/home\0\0executable_file=0x000001\0CODEX_HOME=/not-environment\0",
        ))
        .unwrap();
    assert_eq!(
        expected()
            .check_bytes(&bytes(b"OTHER=value\0\0CODEX_HOME=/managed/home\0"))
            .unwrap_err(),
        UNKNOWN,
    );
    assert_eq!(
        expected()
            .check_bytes(&bytes(
                b"CODEX_HOME=/different/owner\0\0CODEX_HOME=/managed/home\0"
            ))
            .unwrap_err(),
        MISMATCH,
    );
}

#[test]
fn environment_work_and_allocation_remain_bounded() {
    let mut raw = b"CODEX_HOME=/managed/home\0".to_vec();
    for _ in 0..4096 {
        raw.extend_from_slice(b"OTHER=x\0");
    }
    assert_eq!(expected().check_bytes(&bytes(&raw)).unwrap_err(), UNKNOWN);
    assert_eq!(
        expected()
            .check_bytes(&vec![0; super::super::MAX_PROCESS_ARGS_BYTES + 1])
            .unwrap_err(),
        UNKNOWN,
    );
}

#[test]
fn core_selectors_are_derived_from_owned_profile_not_arbitrary_agreement() {
    let profile = NativeAppProfile::new("codex", "https://cloud.example", "alice").unwrap();
    let expected = ExpectedEnvironment::core(&profile).unwrap();
    let mut raw = Vec::new();
    for (name, value) in &expected.0 {
        if let ExpectedValue::Exact(value) = value {
            raw.extend_from_slice(name.as_bytes());
            raw.push(b'=');
            raw.extend_from_slice(value);
            raw.push(0);
        }
    }
    expected.check_bytes(&bytes(&raw)).unwrap();
    let other = NativeAppProfile::new("codex", "https://cloud.example", "bob").unwrap();
    assert_eq!(
        ExpectedEnvironment::core(&other)
            .unwrap()
            .check_bytes(&bytes(&raw))
            .unwrap_err(),
        MISMATCH
    );
    let claude = NativeAppProfile::new("claude_desktop", "https://cloud.example", "alice").unwrap();
    assert!(ExpectedEnvironment::core(&claude).is_err());
}

#[test]
fn a_same_pid_start_time_does_not_cover_an_exec_or_reused_kernel_identity() {
    let captured = ExecGeneration {
        unique_id: 91,
        id_version: 2,
    };
    check_generation(captured, captured, captured).unwrap();
    for changed in [
        ExecGeneration {
            unique_id: 92,
            ..captured
        },
        ExecGeneration {
            id_version: 3,
            ..captured
        },
    ] {
        assert_eq!(
            check_generation(captured, changed, changed).unwrap_err(),
            UNKNOWN
        );
        assert_eq!(
            check_generation(captured, captured, changed).unwrap_err(),
            UNKNOWN
        );
    }
}

#[test]
fn kernel_process_environment_distinguishes_managed_profile_from_wrong_home() {
    use super::super::super::tests::FixtureChild;
    use std::io::Read;
    use std::time::{Duration, Instant};
    const CHILD: &str = "ORG2_PROFILE_ENV_FIXTURE_CHILD";
    if std::env::var_os(CHILD).is_some() {
        let _ = std::io::stdin().read(&mut [0_u8]);
        return;
    }
    let profile = NativeAppProfile::new("codex", "https://cloud.example", "fixture").unwrap();
    let expected = ExpectedEnvironment::core(&profile).unwrap();
    for mismatch in [false, true] {
        // Apple platform binaries such as /bin/bash omit their environment
        // from KERN_PROCARGS2. Use our owned non-platform test image instead;
        // the verifier must continue rejecting an unobservable environment.
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "market_connection::native_app_launch::process::profile::tests::kernel_process_environment_distinguishes_managed_profile_from_wrong_home",
                "--nocapture",
            ])
            .env_clear()
            .env(CHILD, "1")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        for (name, value) in &expected.0 {
            if let ExpectedValue::Exact(value) = value {
                command.env(name, std::ffi::OsStr::from_bytes(value));
            }
        }
        if mismatch {
            command.env("CODEX_HOME", "/different/owner");
        }
        let mut child = FixtureChild(command.spawn().unwrap());
        let deadline = Instant::now() + Duration::from_secs(3);
        let result = loop {
            match expected.check(child.0.id() as i32) {
                Err(reason) if reason == UNKNOWN && Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(5));
                }
                value => break value,
            }
        };
        if mismatch {
            assert_eq!(result.unwrap_err(), MISMATCH);
        } else {
            result.unwrap();
        }
        drop(child.0.stdin.take());
        assert!(child.wait_for(Duration::from_secs(3)).unwrap().is_some());
    }
}
