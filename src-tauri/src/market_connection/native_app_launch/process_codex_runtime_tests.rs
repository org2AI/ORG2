use super::super::super::tests::FixtureChild;
use super::*;
use std::time::{Duration, Instant};

#[test]
fn runtime_arguments_do_not_accept_shell_or_helper_lookalikes() {
    for args in [
        vec![b"codex".as_slice(), b"app-server"],
        vec![b"codex", b"-c", b"analytics.enabled=false", b"app-server"],
        vec![b"codex", b"--config=features.foo=true", b"app-server"],
    ] {
        assert!(app_server(&args));
    }
    for args in [
        vec![b"sh".as_slice(), b"-c", b"codex app-server"],
        vec![b"codex", b"exec", b"app-server"],
        vec![b"codex", b"app-server", b"daemon", b"version"],
        vec![b"codex", b"app-server", b"--help"],
        vec![b"helper", b"--type=utility", b"app-server"],
        vec![b"codex", b"-c"],
        vec![b"codex", b"--unknown", b"app-server"],
    ] {
        assert!(!app_server(&args));
    }
}

#[test]
fn managed_invocation_keeps_locked_route_authoritative() {
    for args in [
        vec![b"codex".as_slice(), b"app-server"],
        vec![
            b"codex",
            b"-c",
            b"features.code_mode_host=true",
            b"app-server",
            b"--analytics-default-enabled",
        ],
        vec![
            b"codex",
            b"app-server",
            b"--config=analytics.enabled=false",
            b"-c",
            b"otel.environment=\"fixture\"",
        ],
    ] {
        managed_invocation(&args).unwrap();
    }
    for setting in [
        b"model_provider=\"other\"".as_slice(),
        b"profile=\"other\"",
        b"model_providers.org2.base_url=\"https://other.example\"",
        b"chatgpt_base_url=\"https://other.example\"",
        b"openai_base_url=\"https://other.example\"",
        b"cli_auth_credentials_store=\"keyring\"",
        b"unknown=true",
        b"analytics.enabled=\"false\"",
        b"analytics.enabled=false\nprofile=\"other\"",
        b"analytics.enabled",
        b"analytics.enabled=",
        b"\"analytics.enabled\"=true",
    ] {
        assert_eq!(
            managed_invocation(&[b"codex", b"-c", setting, b"app-server"]).unwrap_err(),
            "native_runtime_invocation_unverified"
        );
    }
    for args in [
        vec![
            b"codex".as_slice(),
            b"-c",
            b"analytics.enabled=true",
            b"--config=analytics.enabled=true",
            b"app-server",
        ],
        vec![
            b"codex",
            b"app-server",
            b"--analytics-default-enabled",
            b"--analytics-default-enabled",
        ],
        vec![b"codex", b"--enable", b"unknown", b"app-server"],
        vec![b"codex", b"app-server", b"--profile", b"other"],
        vec![b"codex", b"-c", b"app-server"],
    ] {
        assert_eq!(
            managed_invocation(&args).unwrap_err(),
            "native_runtime_invocation_unverified"
        );
    }
}

fn launch(runtime: Option<&Path>, duplicate: bool) -> (FixtureChild, Identity) {
    // Execute the original system binary. Copying an Apple platform executable
    // into a fake app bundle does not produce a reliable executable fixture.
    let script = match (runtime, duplicate) {
        (None, _) => "read -r value",
        (Some(_), true) => "exec 3<&0; \"$1\" -c 'read -r value <&3' app-server & \"$1\" -c 'read -r value <&3' app-server & wait",
        (Some(_), false) => "\"$1\" -c 'read -r value' app-server; :",
    };
    let child = FixtureChild(
        std::process::Command::new("/bin/bash")
            .args(["-c", script, "runtime-fixture"])
            .arg(runtime.unwrap_or(Path::new("/bin/bash")))
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap(),
    );
    let deadline = Instant::now() + Duration::from_secs(3);
    let identity = loop {
        if let Some(value) = info(child.0.id() as i32).unwrap() {
            let identity = identity(child.0.id() as i32, &value);
            if verify_identity(&identity, Path::new("/bin/bash"), None).is_ok() {
                break identity;
            }
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    };
    (child, identity)
}

fn await_binding(gui: &Identity, runtime: &Path) -> Result<Binding, String> {
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        match observe_processes(gui, Path::new("/bin/bash"), runtime) {
            Ok(Some(value)) => return Ok(value),
            Err(error) if error != UNKNOWN => return Err(error),
            _ if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(5)),
            _ => return Err(UNKNOWN.into()),
        }
    }
}

fn finish(mut child: FixtureChild) {
    // Closing only fixture input exits its core and then its parent.
    drop(child.0.stdin.take());
    assert!(child.wait_for(Duration::from_secs(3)).unwrap().is_some());
}

#[test]
fn real_child_binding_checks_parent_executable_pid_epoch_and_exit() {
    let runtime = Path::new("/bin/bash");
    let (child, gui) = launch(Some(runtime), false);
    let binding = await_binding(&gui, runtime).unwrap();
    binding.check_processes(runtime, runtime).unwrap();
    let mut stale = binding.clone();
    stale.core_exec.id_version += 1;
    assert_eq!(
        stale.check_processes(runtime, runtime).unwrap_err(),
        UNKNOWN
    );
    let mut stale = binding.clone();
    stale.gui_exec.unique_id += 1;
    assert_eq!(
        stale.check_processes(runtime, runtime).unwrap_err(),
        UNKNOWN
    );
    let mut stale = binding.clone();
    stale.core.started.1 += 1;
    assert_eq!(
        stale.check_processes(runtime, runtime).unwrap_err(),
        UNKNOWN
    );
    assert_eq!(
        verify_identity(&binding.core, runtime, Some(gui.pid + 1)).unwrap_err(),
        UNKNOWN
    );
    finish(child);
    assert_eq!(
        binding.check_processes(runtime, runtime).unwrap_err(),
        UNKNOWN
    );
}

#[test]
fn shell_selected_runtime_cannot_satisfy_bundle_binding() {
    let (child, gui) = launch(Some(Path::new("/bin/bash")), false);
    // A populated environment/argv cannot substitute for the actual binary.
    assert_eq!(
        await_binding(&gui, Path::new("/bin/sh")).err().unwrap(),
        MISMATCH
    );
    finish(child);
}

#[test]
fn two_stdio_cores_never_form_a_binding() {
    let runtime = Path::new("/bin/bash");
    let (child, gui) = launch(Some(runtime), true);
    let deadline = Instant::now() + Duration::from_secs(3);
    while children(gui.pid).unwrap().len() < 2 {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(
        observe_processes(&gui, runtime, runtime).err().unwrap(),
        UNKNOWN
    );
    finish(child);
}

#[test]
fn gui_without_a_stdio_child_never_proves_a_daemon_runtime() {
    let runtime = Path::new("/bin/bash");
    let (child, gui) = launch(None, false);
    assert!(observe_processes(&gui, runtime, runtime).unwrap().is_none());
    finish(child);
}
