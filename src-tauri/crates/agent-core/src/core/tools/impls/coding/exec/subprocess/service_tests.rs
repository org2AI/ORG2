use super::super::registry;
use super::*;
use crate::tools::call_context::{TurnProcessControl, TurnProcessOwner};

const HTTP_SERVICE_CHILD_FLAG: &str = "ORG2_HTTP_SERVICE_TEST_CHILD";
const HTTP_SERVICE_TEST_NAME: &str = concat!(
    "core::tools::impls::coding::exec::subprocess::service_tests::",
    "prior_turn_http_service_survives_new_turn_stop_until_explicit_process_stop"
);

fn identity(session: &str, turn: &str, task: &str) -> ExecIdentity {
    let control = TurnProcessControl {
        owner: TurnProcessOwner {
            session_id: session.into(),
            turn_intent_id: turn.into(),
            runtime_lease_id: format!("lease-{turn}"),
            dialog_turn_generation: format!("generation-{turn}"),
        },
        background_cancel: CancellationToken::new(),
        is_agent_org: true,
    };
    let mut identity =
        ExecIdentity::new(session, format!("call-{turn}")).with_turn_process_control(Some(control));
    identity.org_scope = Some(registry::OrgResourceScope {
        org_run_id: "real-service-run".into(),
        task_id: Some(task.into()),
    });
    identity
}

async fn start(command: &str, identity: &ExecIdentity, dir: &Path) -> String {
    execute_via_command(
        command,
        dir.to_path_buf(),
        30,
        None,
        ExecMode::Background,
        identity,
        &dir.join("replays"),
        None,
        None,
        None,
    )
    .await
    .unwrap()
}

async fn wait_for_file(path: &Path) -> String {
    // Cold interpreter startup on supported desktop hosts can exceed two
    // seconds. This is a bounded startup deadline, not a service-ready delay.
    for _ in 0..1000 {
        if let Ok(value) = std::fs::read_to_string(path) {
            if !value.is_empty() {
                return value;
            }
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!(
        "service did not publish its startup marker; jobs: {:?}",
        registry::list_jobs(Some("http-service-session"))
    );
}

async fn stop(identity: &ExecIdentity) {
    registry::cancel_and_await_jobs_for_owner(
        &identity.turn_process_control.as_ref().unwrap().owner,
        Duration::from_secs(5),
    )
    .await
    .unwrap();
}

async fn http_available(port: u16) -> bool {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    tokio::time::timeout(Duration::from_secs(2), async {
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .ok()?;
        stream
            .write_all(b"GET / HTTP/1.0\r\nHost: localhost\r\n\r\n")
            .await
            .ok()?;
        let mut response = [0_u8; 64];
        let count = stream.read(&mut response).await.ok()?;
        Some(String::from_utf8_lossy(&response[..count]).starts_with("HTTP/1.0 200"))
    })
    .await
    .ok()
    .flatten()
    .unwrap_or(false)
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

async fn run_http_service_child() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .unwrap();
    std::fs::write("port", listener.local_addr().unwrap().port().to_string()).unwrap();
    loop {
        let (mut stream, _) = listener.accept().await.unwrap();
        tokio::spawn(async move {
            let mut request = [0_u8; 512];
            let _ = stream.read(&mut request).await;
            let _ = stream
                .write_all(b"HTTP/1.0 200 OK\r\nContent-Length: 2\r\n\r\nOK")
                .await;
        });
    }
}

#[tokio::test]
#[serial_test::serial]
async fn prior_turn_http_service_survives_new_turn_stop_until_explicit_process_stop() {
    if std::env::var_os(HTTP_SERVICE_CHILD_FLAG).is_some() {
        run_http_service_child().await;
        return;
    }
    let _sandbox = test_helpers::test_env::sandbox();
    let dir = tempfile::tempdir().unwrap();
    let service = identity("http-service-session", "service-turn", "web-task");
    let test_exe = std::env::current_exe().unwrap();
    let command = format!(
        "{}=1 {} --exact {} --nocapture",
        HTTP_SERVICE_CHILD_FLAG,
        shell_quote(&test_exe.to_string_lossy()),
        shell_quote(HTTP_SERVICE_TEST_NAME)
    );
    let result = start(&command, &service, dir.path()).await;
    let port = wait_for_file(&dir.path().join("port")).await;
    let port = port.parse().unwrap();
    let before = http_available(port).await;
    let newer = identity("http-service-session", "new-turn", "next-task");
    start("sleep 120", &newer, dir.path()).await;
    stop(&newer).await;
    let after = http_available(port).await;
    let owner = &service.turn_process_control.as_ref().unwrap().owner;
    let blocks_turn = !registry::list_jobs_for_owner(owner).is_empty();
    let job = registry::list_running_shell_jobs()
        .into_iter()
        .find(|job| job.handle == service.registration_id)
        .unwrap();
    registry::stop_registered_shell(&job.handle, &job.session_id, &job.call_id, job.pid)
        .await
        .unwrap();
    let stopped = !http_available(port).await;
    let wakes = registry::claim_completion_wake_for_session(&service.session_id);
    registry::remove(&service.registration_id);
    assert!(result.contains(&service.registration_id));
    assert!(
        before && after,
        "the old service must survive cancellation of a newer Turn"
    );
    assert!(!blocks_turn && !wakes);
    assert!(stopped && !registry::process_tree_exists(job.pid));
}

#[tokio::test]
#[serial_test::serial]
async fn task_replacement_stops_an_old_writer_before_new_files_are_written() {
    let _sandbox = test_helpers::test_env::sandbox();
    let dir = tempfile::tempdir().unwrap();
    let writer = identity("writer-session", "finished-model-turn", "old-writing-task");
    let unrelated = identity("unrelated-session", "other-turn", "other-writing-task");
    start(
        "while :; do printf old >> output; sleep 0.03; done",
        &writer,
        dir.path(),
    )
    .await;
    start("sleep 120", &unrelated, dir.path()).await;
    wait_for_file(&dir.path().join("output")).await;
    let writer_pid = registry::list_running_shell_jobs()
        .into_iter()
        .find(|job| job.handle == writer.registration_id)
        .unwrap()
        .pid;
    registry::cancel_and_await_task_resources(
        "real-service-run",
        "old-writing-task",
        Duration::from_secs(5),
    )
    .await
    .unwrap();
    std::fs::write(dir.path().join("output"), "replacement").unwrap();
    tokio::time::sleep(Duration::from_millis(120)).await;
    let output = std::fs::read_to_string(dir.path().join("output")).unwrap();
    let unrelated_running = matches!(
        registry::get_status(&unrelated.registration_id),
        Some((registry::JobStatus::Running, _))
    );
    stop(&unrelated).await;
    assert_eq!(output, "replacement");
    assert!(!registry::process_tree_exists(writer_pid));
    assert!(unrelated_running);
}

#[test]
fn independent_services_have_no_implicit_one_hour_deadline() {
    use super::background::background_safety_timeout;
    assert!(!background_safety_timeout(false, Duration::from_secs(3599)));
    assert!(background_safety_timeout(false, Duration::from_secs(3600)));
    assert!(!background_safety_timeout(
        true,
        Duration::from_secs(65 * 60)
    ));
    assert!(!background_safety_timeout(true, Duration::MAX));
}

#[tokio::test]
#[serial_test::serial]
async fn failed_replay_does_not_retain_a_stopped_process_or_restart_its_turn() {
    use super::super::shell_replay::{load_replay_state, ShellReplayStream};
    use super::output_runtime::OutputRuntime;
    let _sandbox = test_helpers::test_env::sandbox();
    let dir = tempfile::tempdir().unwrap();
    let identity = identity(
        "failed-replay-session",
        "failed-replay-turn",
        "delivered-task",
    );
    let mut writer = ShellReplayWriter::create(
        &dir.path().join("replays"),
        identity.replay_target(),
        "exit 0",
        dir.path(),
        None,
    )
    .unwrap();
    writer
        .append(ShellReplayStream::Stdout, b"before failure")
        .unwrap();
    let path = writer.path().to_path_buf();
    let child = tokio::process::Command::new("sh")
        .args(["-c", "exit 0"])
        .process_group(0)
        .spawn()
        .unwrap();
    let pid = child.id().unwrap();
    let completion = registry::register_managed_shell(registry::ManagedShellRegistration {
        handle: &identity.registration_id,
        pid,
        command: "exit 0",
        log_path: path.clone(),
        session_id: &identity.session_id,
        call_id: &identity.call_id,
        control: identity.turn_process_control.as_ref(),
        org_scope: identity.org_scope.clone(),
        cancel: identity.process_cancel.clone(),
    })
    .unwrap();
    let (_failure_tx, failure_rx) = tokio::sync::watch::channel(None);
    let runtime = OutputRuntime {
        stdout_task: tokio::spawn(async {}),
        stderr_task: tokio::spawn(async {}),
        writer_task: tokio::spawn(async move {
            let _writer = writer;
            panic!("test replay writer failure");
        }),
        failure_rx,
        log_path: Some(path),
        replay_target: identity.replay_target(),
        app_handle: None,
    };
    super::background::handle_backgrounded(
        completion,
        pid,
        0,
        BackgroundReason::Explicit,
        child,
        runtime,
        identity.clone(),
        None,
        None,
        None,
    )
    .unwrap();
    let owner = &identity.turn_process_control.as_ref().unwrap().owner;
    registry::await_shells_terminated_for_owner(owner, Duration::from_secs(5))
        .await
        .unwrap();
    let replay = load_replay_state(&identity.session_id, &identity.call_id)
        .unwrap()
        .unwrap();
    assert_eq!(replay.status, ShellReplayStatus::Incomplete);
    assert!(!registry::process_tree_exists(pid));
    assert!(!registry::claim_completion_wake_for_session(
        &identity.session_id
    ));
    registry::cancel_and_await_jobs_for_owner(owner, Duration::from_secs(1))
        .await
        .unwrap();
    assert!(registry::get_status(&identity.registration_id).is_none());
}

#[tokio::test]
#[serial_test::serial]
async fn application_shutdown_drains_released_sessions_and_rejects_new_children() {
    const CHILD_FLAG: &str = "ORG2_RESOURCE_SHUTDOWN_TEST_CHILD";
    if std::env::var_os(CHILD_FLAG).is_none() {
        // Closing admission is irreversible within an application instance.
        // Exercise it in a separate test process, not a resettable test seam.
        let output = tokio::time::timeout(Duration::from_secs(30),
            tokio::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "core::tools::impls::coding::exec::subprocess::service_tests::application_shutdown_drains_released_sessions_and_rejects_new_children", "--nocapture"])
                .env(CHILD_FLAG, "1").output()).await.unwrap().unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
        return;
    }
    let _sandbox = test_helpers::test_env::sandbox();
    let dir = tempfile::tempdir().unwrap();
    let service = identity(
        "released-service-session",
        "finished-turn",
        "delivered-task",
    );
    start("sleep 120", &service, dir.path()).await;
    let pid = registry::list_running_shell_jobs()
        .into_iter()
        .find(|job| job.handle == service.registration_id)
        .unwrap()
        .pid;
    registry::shutdown_resources(Duration::from_secs(5))
        .await
        .unwrap();
    assert!(!registry::process_tree_exists(pid));
    assert!(registry::list_running_shell_jobs().is_empty());
    let rejected = identity("new-service-session", "rejected-turn", "new-task");
    let result = execute_via_command(
        "sleep 120",
        dir.path().to_path_buf(),
        30,
        None,
        ExecMode::Background,
        &rejected,
        &dir.path().join("replays"),
        None,
        None,
        None,
    )
    .await;
    assert!(result
        .unwrap_err()
        .to_string()
        .contains("registration rejected"));
    assert!(registry::list_running_shell_jobs().is_empty());
}
