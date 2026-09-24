use super::*;

fn owner(session: &str, turn: &str) -> TurnProcessControl {
    TurnProcessControl {
        owner: TurnProcessOwner {
            session_id: session.into(),
            turn_intent_id: turn.into(),
            runtime_lease_id: format!("lease-{turn}"),
            dialog_turn_generation: format!("generation-{turn}"),
        },
        background_cancel: CancellationToken::new(),
        is_agent_org: true,
    }
}

fn register(
    control: &TurnProcessControl,
    task: &str,
    pid: u32,
) -> (String, CancellationToken, ShellMonitorCompletion) {
    let handle = format!("shell-{}", uuid::Uuid::new_v4());
    let cancel = CancellationToken::new();
    let completion = register_managed_shell(ManagedShellRegistration {
        handle: &handle,
        pid,
        command: "test service",
        log_path: PathBuf::new(),
        session_id: &control.owner.session_id,
        call_id: "call",
        control: Some(control),
        org_scope: Some(OrgResourceScope {
            org_run_id: "resource-test-run".into(),
            task_id: Some(task.into()),
        }),
        cancel: cancel.clone(),
    })
    .unwrap();
    detach_shell(&handle);
    (handle, cancel, completion)
}

#[tokio::test]
async fn stale_registration_cannot_cancel_reused_pid_even_in_the_same_call() {
    let control = owner("registration-pid-reuse", "turn");
    let (old, old_cancel, old_completion) = register(&control, "old", 99_931);
    mark_exited(&old, JobStatus::Exited(0));
    old_completion.finish(Ok(()));
    remove(&old);
    let (new, new_cancel, new_completion) = register(&control, "new", 99_931);
    assert!(!shell_registration_matches(
        &old,
        &control.owner.session_id,
        "call"
    ));
    assert!(shell_registration_matches(
        &new,
        &control.owner.session_id,
        "call"
    ));
    assert!(
        stop_registered_shell(&old, &control.owner.session_id, "call", 99_931)
            .await
            .is_err()
    );
    assert!(
        stop_registered_shell(&new, "another-session", "call", 99_931)
            .await
            .is_err()
    );
    assert!(
        stop_registered_shell(&new, &control.owner.session_id, "another-call", 99_931)
            .await
            .is_err()
    );
    mark_exited(&old, JobStatus::Killed);
    set_final_result(&old, "late output".into());
    assert!(matches!(get_status(&new), Some((JobStatus::Running, _))));
    assert!(!old_cancel.is_cancelled());
    assert!(!new_cancel.is_cancelled());
    mark_exited(&new, JobStatus::Exited(0));
    new_completion.finish(Ok(()));
    remove(&new);
}

#[tokio::test]
async fn task_cleanup_includes_previous_turns_without_touching_another_task() {
    let old_control = owner("resource-task-session", "old");
    let current_control = owner("resource-task-session", "current");
    let unrelated_control = owner("resource-other-session", "other");
    let (old, old_cancel, old_completion) = register(&old_control, "target", 99_932);
    let (current, current_cancel, current_completion) =
        register(&current_control, "target", 99_933);
    let (other, other_cancel, other_completion) = register(&unrelated_control, "unrelated", 99_934);
    let cleanup = tokio::spawn(cancel_and_await_task_resources(
        "resource-test-run",
        "target",
        Duration::from_secs(1),
    ));
    let finish = |handle: String, cancel: CancellationToken, completion: ShellMonitorCompletion| async move {
        tokio::time::timeout(Duration::from_secs(1), cancel.cancelled())
            .await
            .unwrap();
        mark_exited(&handle, JobStatus::Killed);
        completion.finish(Ok(()));
    };
    tokio::join!(
        finish(old.clone(), old_cancel, old_completion),
        finish(current.clone(), current_cancel, current_completion)
    );
    cleanup.await.unwrap().unwrap();
    assert!(get_status(&old).is_none());
    assert!(get_status(&current).is_none());
    assert!(!other_cancel.is_cancelled());
    assert!(require_job_session(&other, &unrelated_control.owner.session_id).is_ok());
    assert!(require_job_session(&other, &old_control.owner.session_id).is_err());
    mark_exited(&other, JobStatus::Exited(0));
    other_completion.finish(Ok(()));
    remove(&other);
}

#[tokio::test]
async fn cancellation_needs_output_finality_and_does_not_forget_a_timeout() {
    let control = owner("resource-drain-session", "draining");
    let (handle, cancel, completion) = register(&control, "draining", 99_935);
    assert!(
        cancel_and_await_jobs_for_owner(&control.owner, Duration::from_millis(5))
            .await
            .is_err()
    );
    assert!(cancel.is_cancelled());
    assert!(!owned_jobs_are_terminal(&control.owner));
    mark_exited(&handle, JobStatus::Killed);
    assert!(!owned_jobs_are_terminal(&control.owner));
    completion.finish(Ok(()));
    cancel_and_await_jobs_for_owner(&control.owner, Duration::from_secs(1))
        .await
        .unwrap();
    assert!(owned_jobs_are_terminal(&control.owner));
}

#[test]
fn cancelled_registration_is_rejected_before_a_handle_is_published() {
    let control = owner("resource-rejected-session", "rejected");
    control.background_cancel.cancel();
    let handle = format!("shell-{}", uuid::Uuid::new_v4());
    assert!(register_managed_shell(ManagedShellRegistration {
        handle: &handle,
        pid: 99_936,
        command: "not admitted",
        log_path: PathBuf::new(),
        session_id: &control.owner.session_id,
        call_id: "call",
        control: Some(&control),
        org_scope: None,
        cancel: CancellationToken::new(),
    })
    .is_err());
    assert!(get_status(&handle).is_none());
}

#[test]
fn terminal_retention_is_bounded_without_expiring_a_live_service() {
    let control = owner("resource-retention-session", "retention");
    let (live, _, live_completion) = register(&control, "retention", 99_937);
    {
        let mut reg = REGISTRY.lock().unwrap();
        reg.get_mut(&live).unwrap().started_at = Instant::now() - Duration::from_secs(24 * 3600);
    }
    let mut finished = Vec::new();
    for _ in 0..150 {
        let (handle, _, completion) = register(&control, "retention", 99_938);
        mark_exited(&handle, JobStatus::Exited(0));
        completion.finish(Ok(()));
        finished.push(handle);
    }
    reap_detached_shells();
    let retained = list_jobs(Some(&control.owner.session_id));
    assert!(retained.len() <= 129);
    assert!(matches!(get_status(&live), Some((JobStatus::Running, _))));
    mark_exited(&live, JobStatus::Exited(0));
    live_completion.finish(Ok(()));
    remove(&live);
    for handle in finished {
        remove(&handle);
    }
    assert!(TOMBSTONES.lock().unwrap().len() <= 512);
}
