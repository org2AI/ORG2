//! Resource lifetime is independent of the model Turn's completion policy.

use super::*;

#[cfg(test)]
mod tests;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrgResourceScope {
    pub org_run_id: String,
    pub task_id: Option<String>,
}

// Held only around admission. Shutdown closes it before inspecting resources,
// so a spawned child either registers before the snapshot or is reclaimed.
static ADMISSION_OPEN: Mutex<bool> = Mutex::new(true);

pub(crate) struct ManagedShellRegistration<'a> {
    pub handle: &'a str,
    pub pid: u32,
    pub command: &'a str,
    pub log_path: PathBuf,
    pub session_id: &'a str,
    pub call_id: &'a str,
    pub control: Option<&'a TurnProcessControl>,
    pub org_scope: Option<OrgResourceScope>,
    pub cancel: CancellationToken,
}

pub(crate) fn register_managed_shell(
    registration: ManagedShellRegistration<'_>,
) -> Result<ShellMonitorCompletion, String> {
    let admission = ADMISSION_OPEN
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if !*admission
        || registration.cancel.is_cancelled()
        || registration
            .control
            .is_some_and(|control| control.background_cancel.is_cancelled())
    {
        return Err(
            "shell registration rejected during cancellation or application shutdown".into(),
        );
    }
    let (tx, rx) = watch::channel(ShellCompletionState::Running);
    register_shell_inner(ShellRegistration {
        handle: Some(registration.handle.to_string()),
        pid: registration.pid,
        command: registration.command.to_string(),
        log_path: registration.log_path,
        session_id: registration.session_id.to_string(),
        replay_identity: Some((
            registration.session_id.to_string(),
            registration.call_id.to_string(),
        )),
        turn_owner: registration.control.map(|control| control.owner.clone()),
        resource_policy: if registration
            .control
            .is_some_and(|control| control.is_agent_org)
        {
            JobResourcePolicy::TurnBound
        } else {
            JobResourcePolicy::Ordinary
        },
        org_scope: registration.org_scope,
        shell_cancel: Some(registration.cancel),
        shell_completion: Some(rx),
    });
    Ok(ShellMonitorCompletion {
        tx,
        handle: registration.handle.to_string(),
    })
}

pub(crate) fn detach_shell(handle: &str) {
    let mut reg = REGISTRY.lock().unwrap_or_else(|error| error.into_inner());
    if let Some(job) = reg.get_mut(handle) {
        if job.resource_policy == JobResourcePolicy::TurnBound {
            job.resource_policy = JobResourcePolicy::DetachedOrgShell;
        }
    }
}

pub(crate) fn is_independent_shell(handle: &str) -> bool {
    REGISTRY
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .get(handle)
        .is_some_and(|job| job.resource_policy == JobResourcePolicy::DetachedOrgShell)
}

/// Late monitor callbacks must still belong to this application registration.
pub fn shell_registration_matches(handle: &str, session: &str, call: &str) -> bool {
    REGISTRY
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .get(handle)
        .is_some_and(|job| {
            job.session_id == session
                && matches!(&job.kind, JobKind::Shell { replay_call_id: Some(id), .. } if id == call)
        })
}

pub fn require_job_session(handle: &str, session_id: &str) -> Result<(), String> {
    let reg = REGISTRY.lock().unwrap_or_else(|error| error.into_inner());
    if let Some(job) = reg.get(handle) {
        return if job.session_id == session_id {
            Ok(())
        } else {
            Err("process handle belongs to another session".into())
        };
    }
    let tombs = TOMBSTONES.lock().unwrap_or_else(|error| error.into_inner());
    if tombs
        .get(handle)
        .is_some_and(|job| job.session_id == session_id && job.created_at.elapsed() < TOMBSTONE_TTL)
    {
        Ok(())
    } else {
        Err("unknown process handle for this session".into())
    }
}

/// The UI must present the complete registration identity. Never interpret an
/// unknown/stale registration as permission to signal an OS PID directly.
pub async fn stop_registered_shell(
    handle: &str,
    session_id: &str,
    call_id: &str,
    pid: u32,
) -> Result<(), String> {
    {
        let reg = REGISTRY.lock().unwrap_or_else(|error| error.into_inner());
        let job = reg
            .get(handle)
            .ok_or("shell registration is no longer available")?;
        if job.session_id != session_id
            || !matches!(&job.kind,
            JobKind::Shell { pid: registered_pid, replay_call_id: Some(registered_call), .. }
                if *registered_pid == pid && registered_call == call_id)
        {
            return Err("shell registration identity mismatch".into());
        }
        if owned_job_execution_finished(job) {
            return Ok(());
        }
    }
    kill_shell(handle).await
}

pub async fn cancel_and_await_task_resources(
    org_run_id: &str,
    task_id: &str,
    timeout: Duration,
) -> Result<(), String> {
    let owners = {
        let reg = REGISTRY.lock().unwrap_or_else(|error| error.into_inner());
        reg.values()
            .filter(|job| {
                job.org_scope.as_ref().is_some_and(|scope| {
                    scope.org_run_id == org_run_id && scope.task_id.as_deref() == Some(task_id)
                })
            })
            .filter_map(|job| job.turn_owner.clone())
            .collect::<HashSet<_>>()
    };
    let wait = async {
        for owner in owners {
            cancel_and_await_jobs_for_owner(&owner, timeout).await?;
        }
        Ok(())
    };
    tokio::time::timeout(timeout, wait)
        .await
        .map_err(|_| "timed out releasing task resources".to_string())?
}

pub(crate) fn task_resource_owner(org_run_id: &str, task_id: &str) -> Option<TurnProcessOwner> {
    let reg = REGISTRY.lock().unwrap_or_else(|error| error.into_inner());
    reg.values()
        .filter(|job| !owned_job_execution_finished(job))
        .filter(|job| {
            job.org_scope.as_ref().is_some_and(|scope| {
                scope.org_run_id == org_run_id && scope.task_id.as_deref() == Some(task_id)
            })
        })
        .find_map(|job| job.turn_owner.clone())
}

pub(crate) fn session_has_org_resources(session_id: &str) -> bool {
    let reg = REGISTRY.lock().unwrap_or_else(|error| error.into_inner());
    session_lifecycle::live_handles(session_id)
        .iter()
        .filter_map(|handle| reg.get(handle))
        .any(|job| job.resource_policy.is_org())
}

pub(crate) fn resource_owners_for_tasks(
    org_run_id: &str,
    task_ids: &HashSet<String>,
) -> HashSet<TurnProcessOwner> {
    let reg = REGISTRY.lock().unwrap_or_else(|error| error.into_inner());
    reg.values()
        .filter(|job| {
            job.org_scope.as_ref().is_some_and(|scope| {
                scope.org_run_id == org_run_id
                    && scope
                        .task_id
                        .as_ref()
                        .is_some_and(|id| task_ids.contains(id))
            })
        })
        .filter_map(|job| job.turn_owner.clone())
        .collect()
}

pub(crate) fn cancel_subagents_for_owner(owner: &TurnProcessOwner) {
    let handles = {
        let reg = REGISTRY.lock().unwrap_or_else(|error| error.into_inner());
        let index = OWNER_INDEX
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        index
            .get(owner)
            .into_iter()
            .flatten()
            .filter_map(|handle| reg.get(handle))
            .filter(|job| job.is_running() && matches!(job.kind, JobKind::Subagent { .. }))
            .map(|job| job.handle.clone())
            .collect::<Vec<_>>()
    };
    for handle in handles {
        let _ = kill_subagent(&handle);
    }
}

pub fn close_resource_admission() {
    *ADMISSION_OPEN
        .lock()
        .unwrap_or_else(|error| error.into_inner()) = false;
}

/// Application-exit entry point; includes resources whose Session runtime has
/// already been released. Ordinary runtime eviction does not close admission.
pub async fn shutdown_resources(timeout: Duration) -> Result<(), String> {
    close_resource_admission();
    let sessions = {
        let reg = REGISTRY.lock().unwrap_or_else(|error| error.into_inner());
        reg.values()
            .map(|job| job.session_id.clone())
            .collect::<HashSet<_>>()
    };
    for session in &sessions {
        request_cancel_for_session(session);
    }
    let results = tokio::time::timeout(
        timeout,
        futures::future::join_all(
            sessions
                .iter()
                .map(|session| wait_for_session_finality(session)),
        ),
    )
    .await
    .map_err(|_| "timed out stopping application shell resources".to_string())?;
    let errors = results
        .into_iter()
        .filter_map(Result::err)
        .collect::<Vec<_>>();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum JobResourcePolicy {
    /// Ordinary sessions retain their existing completion wake behavior.
    Ordinary,
    /// Delegated agents and synchronous PTY work must converge in their Turn.
    TurnBound,
    /// An Org shell that has returned a handle may outlive its model Turn.
    DetachedOrgShell,
}

/// Called by exit/access paths, never by a retained timer. Only fully drained
/// terminal records are eligible; a live service is never TTL-evicted.
pub fn reap_detached_shells() {
    const RETAINED_TERMINAL_SHELLS: usize = 128;
    let handles = {
        let reg = REGISTRY.lock().unwrap_or_else(|error| error.into_inner());
        let mut terminal = reg
            .values()
            .filter(|job| {
                job.resource_policy == JobResourcePolicy::DetachedOrgShell
                    && owned_job_execution_finished(job)
            })
            .collect::<Vec<_>>();
        terminal.sort_by_key(|job| job.finished_at);
        let excess = terminal.len().saturating_sub(RETAINED_TERMINAL_SHELLS);
        terminal
            .into_iter()
            .enumerate()
            .filter(|(index, job)| {
                *index < excess
                    || job.output_acknowledged
                    || job
                        .finished_at
                        .is_some_and(|at| at.elapsed() >= TOMBSTONE_TTL)
            })
            .map(|(_, job)| job.handle.clone())
            .collect::<Vec<_>>()
    };
    for handle in handles {
        remove(&handle);
    }
}

impl JobResourcePolicy {
    pub(super) fn blocks_turn(self) -> bool {
        self == Self::TurnBound
    }

    pub(super) fn is_org(self) -> bool {
        self != Self::Ordinary
    }
}
