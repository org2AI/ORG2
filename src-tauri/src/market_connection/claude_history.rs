//! Owner-scoped automatic history handoff, independent of frontend lifecycle.
//! Filesystem callbacks collect bounded invalidations; they never parse history.
//! Busy writers are waited on by process-exit notifications, not sync polling.
use super::{
    claude_history_writers,
    history_status::{HistorySyncState, HistorySyncView, emit_changed},
    owner,
};
use crate::agent_sessions::cli::native_materializer::claude_history_handoff::{
    self, Report, Status,
};
use agent_cli::managed_config::native_app::{self, NativeAppProfile};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
};
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

const MAX_DIRTY: usize = 128;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Disabled,
    WaitingForExit,
    Syncing,
    Current,
    Attention,
    Unavailable,
}
#[derive(Clone)]
struct Progress {
    pub phase: Phase,
    pub issues: usize,
    reason: Option<&'static str>,
}
impl Default for Progress {
    fn default() -> Self {
        Self {
            phase: Phase::Disabled,
            issues: 0,
            reason: None,
        }
    }
}
impl Progress {
    fn view(&self) -> HistorySyncView {
        let (state, reason) = match self.phase {
            Phase::Disabled => (HistorySyncState::Idle, None),
            Phase::Current => (HistorySyncState::Active, None),
            Phase::Syncing => (HistorySyncState::Active, Some("claude_history_syncing")),
            Phase::WaitingForExit => (
                HistorySyncState::Active,
                Some("claude_history_waiting_for_exit"),
            ),
            Phase::Attention => (HistorySyncState::Paused, Some("claude_history_attention")),
            Phase::Unavailable => (HistorySyncState::Paused, Some("claude_history_unavailable")),
        };
        HistorySyncView {
            state,
            reason: self.reason.or(reason).map(str::to_owned),
            native_version: None,
            // The handoff report counts processed rows, not a full inventory.
            // Never present those as a count of all shared conversations.
            shared: 0,
            conflicts: 0,
            pending: self.issues,
        }
    }
}

/// Snapshot only: no filesystem scan, subscription or retry on a UI read.
/// A retired or invalid owner cannot expose its previous account's state.
pub(crate) fn status() -> HistorySyncView {
    let slot = current().lock().unwrap_or_else(|e| e.into_inner());
    slot.as_ref()
        .map(|handle| handle.service.view())
        .unwrap_or_else(|| Progress::default().view())
}

#[derive(Default)]
struct Dirty {
    all: bool,
    ids: HashSet<String>,
    configuration: bool,
}
impl Dirty {
    fn all(&mut self) {
        self.all = true;
        self.ids.clear();
    }
    fn add(&mut self, id: &str) {
        if self.all {
            return;
        }
        if self.ids.len() == MAX_DIRTY {
            self.all();
        } else {
            self.ids.insert(id.to_owned());
        }
    }
    fn pending(&self) -> bool {
        self.all || !self.ids.is_empty()
    }
    fn take(&mut self) -> Option<HashSet<String>> {
        if std::mem::take(&mut self.all) {
            self.ids.clear();
            None
        } else {
            Some(std::mem::take(&mut self.ids))
        }
    }
    fn restore(&mut self, ids: Option<HashSet<String>>) {
        match ids {
            None => self.all(),
            Some(ids) => {
                for id in ids {
                    self.add(&id);
                }
            }
        }
    }
}

/// Bounded unresolved state belongs to one service/owner epoch. A partial pass
/// proves nothing about omitted sessions or an earlier incomplete inventory.
#[derive(Default)]
struct Issues {
    sessions: HashSet<String>,
    incomplete: bool,
}
fn resolved(status: Status) -> bool {
    matches!(
        status,
        Status::Clean | Status::SyncedToPrimary | Status::SyncedToPackage
    )
}
impl Issues {
    fn update(&mut self, report: &Report, full: bool) -> usize {
        if full && resolved(report.status) {
            self.sessions.clear();
            self.incomplete = false;
        }
        for item in &report.items {
            if resolved(item.status) {
                self.sessions.remove(&item.session_id);
            } else if self.sessions.contains(&item.session_id) || self.sessions.len() < MAX_DIRTY {
                self.sessions.insert(item.session_id.clone());
            } else {
                // Never claim Current after dropping an unresolved identifier.
                self.incomplete = true;
            }
        }
        if !resolved(report.status)
            && (report.items.iter().all(|item| resolved(item.status))
                || matches!(
                    report.status,
                    Status::Limit | Status::Failed | Status::Changed
                ))
        {
            self.incomplete = true;
        }
        self.sessions.len() + usize::from(self.incomplete)
    }
}

struct Service {
    lease: owner::Lease,
    dirty: Mutex<Dirty>,
    snapshot: Mutex<Progress>,
    issues: Mutex<Issues>,
    wake: Notify,
    cancelled: CancellationToken,
    retiring: AtomicBool,
}
struct Handle {
    service: Arc<Service>,
    task: tokio::task::JoinHandle<()>,
}
fn current() -> &'static Mutex<Option<Handle>> {
    static CURRENT: OnceLock<Mutex<Option<Handle>>> = OnceLock::new();
    CURRENT.get_or_init(Default::default)
}
impl Service {
    fn view(&self) -> HistorySyncView {
        let snapshot = self.snapshot.lock().unwrap_or_else(|e| e.into_inner());
        if self.valid() && !self.retiring.load(Ordering::Acquire) {
            snapshot.view()
        } else {
            Progress::default().view()
        }
    }
    fn accepts_wake(&self, lease: &owner::Lease) -> bool {
        !self.retiring.load(Ordering::Acquire)
            && !self.cancelled.is_cancelled()
            && self.lease.same_epoch(lease)
    }
    fn namespace_pending(&self, ids: Option<HashSet<String>>) {
        self.dirty
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .restore(ids);
        self.publish_reason(
            Phase::Unavailable,
            0,
            Some("claude_history_namespace_pending"),
        );
        // No self-wakeup: only a new namespace/config event or writer exit
        // justifies another bounded import attempt.
    }
    /// Both Open and the filesystem queue publish through the same owner-scoped
    /// issue set. The caller holds history_serial until publication completes.
    fn record_reconciliation(&self, result: &Reconciliation, ids: Option<HashSet<String>>) {
        if !self.valid() {
            return;
        }
        match result {
            Reconciliation::Unavailable => {
                self.dirty
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .restore(ids);
                self.publish_reason(
                    Phase::Unavailable,
                    0,
                    Some("native_history_runtime_unknown"),
                );
            }
            Reconciliation::NamespacePending => self.namespace_pending(ids),
            Reconciliation::Complete(report) => {
                tracing::debug!(status = ?report.status, processed = report.items.len(), "[Claude History] automatic handoff completed");
                if matches!(
                    report.status,
                    Status::Busy | Status::WriterUnknown | Status::ScopeChanged
                ) {
                    self.dirty
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .restore(ids);
                    self.publish(
                        if report.status == Status::Busy {
                            Phase::WaitingForExit
                        } else {
                            Phase::Unavailable
                        },
                        0,
                    );
                } else {
                    let count = self
                        .issues
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .update(report, ids.is_none());
                    self.publish(
                        if count > 0 {
                            Phase::Attention
                        } else {
                            Phase::Current
                        },
                        count,
                    );
                }
            }
        }
    }
    fn valid(&self) -> bool {
        !self.cancelled.is_cancelled() && self.lease.check().is_ok()
    }
    fn publish(&self, phase: Phase, issues: usize) {
        self.publish_reason(phase, issues, None);
    }
    fn publish_reason(&self, phase: Phase, issues: usize, reason: Option<&'static str>) {
        if !self.valid() {
            return;
        }
        let mut value = self.snapshot.lock().unwrap_or_else(|e| e.into_inner());
        if value.phase == phase && value.issues == issues && value.reason == reason {
            return;
        }
        value.phase = phase;
        value.issues = issues;
        value.reason = reason;
        drop(value);
        tracing::debug!(?phase, issues, "[Claude History] automatic handoff state");
        emit_changed("claude_desktop");
    }
}

/// Called after native auth verification and after applying a managed profile.
/// Refresh wakes only the expiry deadline; it never requests a history scan.
pub(super) fn ensure_started(lease: owner::Lease) {
    if lease.check().is_err() {
        return;
    }
    let mut slot = current().lock().unwrap_or_else(|e| e.into_inner());
    // The owner may change while waiting for CURRENT. Never let stale cleanup
    // cancel a replacement owner's service after its initial lease check.
    // Owner transitions release their state lock before taking CURRENT.
    if lease.check().is_err() {
        return;
    }
    if let Some(handle) = slot.as_ref() {
        if handle.service.accepts_wake(&lease) && !handle.task.is_finished() {
            handle.service.wake.notify_one();
            return;
        }
        handle.service.cancelled.cancel();
    }
    let mut dirty = Dirty::default();
    dirty.all();
    let service = Arc::new(Service {
        lease,
        dirty: Mutex::new(dirty),
        snapshot: Mutex::new(Progress::default()),
        issues: Mutex::new(Issues::default()),
        wake: Notify::new(),
        cancelled: CancellationToken::new(),
        retiring: AtomicBool::new(false),
    });
    let task = tokio::spawn(run(service.clone()));
    *slot = Some(Handle { service, task });
    drop(slot);
    emit_changed("claude_desktop");
}
pub(super) fn stop() {
    let handle = current().lock().unwrap_or_else(|e| e.into_inner()).take();
    if let Some(handle) = handle {
        handle.service.cancelled.cancel();
        emit_changed("claude_desktop");
    }
}

async fn existing_profile(lease: &owner::Lease) -> Result<NativeAppProfile, String> {
    lease.check()?;
    let profile = lease
        .native_app("claude_desktop")?
        .ok_or("Unsupported native profile")?;
    // Public status serialization waits for an in-flight Apply/Restore before
    // deciding ownership; a transient config lock must not stop the service.
    let status = agent_cli::managed_config::cli_config_get_status("claude_desktop".into()).await?;
    lease.check()?;
    profile.validate_launch(&status)?;
    Ok(profile)
}

fn install_watcher(
    service: &Arc<Service>,
    profile: &NativeAppProfile,
) -> Result<RecommendedWatcher, String> {
    let roots = claude_history_handoff::watch_roots(profile);
    let manifest = app_paths::cli_config_profile_manifest("claude_desktop");
    let mut targets = roots.clone();
    targets.push(manifest.clone());
    let weak = Arc::downgrade(service);
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Some(service) = weak.upgrade().filter(|s| s.valid()) else {
            return;
        };
        let mut dirty = service.dirty.lock().unwrap_or_else(|e| e.into_inner());
        let mut changed = false;
        match event {
            Ok(event) if event.need_rescan() => {
                dirty.all();
                dirty.configuration = true;
                changed = true;
            }
            Ok(event) if !matches!(event.kind, notify::EventKind::Access(_)) => {
                let directory_change = matches!(
                    event.kind,
                    notify::EventKind::Create(notify::event::CreateKind::Folder)
                        | notify::EventKind::Remove(notify::event::RemoveKind::Folder)
                        | notify::EventKind::Modify(notify::event::ModifyKind::Name(_))
                );
                for path in event.paths {
                    if path == manifest {
                        dirty.configuration = true;
                        changed = true;
                    } else if roots.iter().any(|root| path.starts_with(root)) {
                        if path.extension().is_some_and(|ext| ext == "jsonl") {
                            if let Some(id) = path
                                .file_stem()
                                .and_then(|v| v.to_str())
                                .filter(|v| uuid::Uuid::parse_str(v).is_ok())
                            {
                                dirty.add(id);
                                changed = true;
                            }
                        } else if directory_change
                            || path.extension().is_some_and(|ext| ext == "json")
                            || roots.contains(&path)
                        {
                            dirty.all();
                            changed = true;
                        }
                    }
                }
            }
            Err(_) => {
                dirty.all();
                changed = true;
            }
            _ => {}
        }
        drop(dirty);
        if changed {
            service.wake.notify_one();
        }
    })
    .map_err(|_| "Cannot observe Claude history")?;
    let mut candidates = Vec::<PathBuf>::new();
    for target in targets {
        // The parent covers creation/replacement of a missing directory. Never
        // widen a watcher to the user's home or all of Application Support.
        let mut path = if target.is_dir() {
            target
        } else {
            target
                .parent()
                .ok_or("Missing history directory")?
                .to_path_buf()
        };
        // Newly configured isolated profiles do not have transcript/catalog
        // directories until Claude starts. Their own root is the widest
        // permitted fallback; callbacks still filter the exact history roots.
        while !path.is_dir() && path.starts_with(profile.root()) && path != profile.root() {
            path = path
                .parent()
                .ok_or("Missing history directory")?
                .to_path_buf();
        }
        if !path.is_dir() {
            return Err("Missing history directory".into());
        }
        candidates.push(path);
    }
    candidates.sort_by_key(|path| path.components().count());
    let mut watched = Vec::<PathBuf>::new();
    for path in candidates {
        if !watched.iter().any(|parent| path.starts_with(parent)) {
            watcher
                .watch(&path, RecursiveMode::Recursive)
                .map_err(|_| "Cannot observe Claude history")?;
            watched.push(path);
        }
    }
    Ok(watcher)
}

enum Reconciliation {
    Complete(Report),
    /// App identity failures are separate from transcript format errors.
    Unavailable,
    /// The vendor has not registered a local namespace yet. Retain work until
    /// a namespace/writer/config event; never certify an empty target as current.
    NamespacePending,
}

fn registered_handoff(
    profile: &NativeAppProfile,
    check_owner: impl Fn() -> Result<(), Status>,
    check_writers: impl Fn() -> Result<(), Status>,
    handoff: impl FnOnce() -> Report,
) -> Reconciliation {
    use crate::agent_sessions::cli::native_materializer::isolated_claude_history;
    let failed_guard = std::cell::Cell::new(None);
    let guard = || {
        let result = check_owner().and_then(|_| check_writers());
        result.map_err(|status| {
            failed_guard.set(Some(status));
            "Claude history owner or writer changed".to_owned()
        })
    };
    let result = isolated_claude_history::import_after_launch(
        profile,
        std::time::Instant::now() + std::time::Duration::from_secs(15),
        &guard,
    );
    match result {
        Ok(false) => Reconciliation::NamespacePending,
        Ok(true) => Reconciliation::Complete(handoff()),
        Err(_) => Reconciliation::Complete(Report {
            status: failed_guard.get().unwrap_or(Status::Unsupported),
            items: Vec::new(),
        }),
    }
}

async fn reconcile(service: Arc<Service>, ids: Option<HashSet<String>>) -> Reconciliation {
    let _serial = super::history_serial().lock().await;
    service.publish(Phase::Syncing, 0);
    let pending = ids.clone();
    let worker_service = service.clone();
    let result = async {
        let service = worker_service;
        if !service.valid() {
            return Err(Status::ScopeChanged);
        }
        let operation = service
            .lease
            .clone()
            .operation()
            .await
            .map_err(|_| Status::ScopeChanged)?;
        tokio::task::spawn_blocking(move || {
            let _operation = operation;
            // This only runs for an actual handoff attempt, after the writer
            // exit gate (or an explicit Open), never for UI reads or tokens.
            let Ok(client) = super::native_compatibility::resolve("claude_desktop") else {
                return Ok(Reconciliation::Unavailable);
            };
            if client.ensure_current().is_err() {
                return Ok(Reconciliation::Unavailable);
            }
            let profile = service
                .lease
                .native_app("claude_desktop")
                .map_err(|_| Status::ScopeChanged)?
                .ok_or(Status::Unsupported)?;
            native_app::with_existing_profile(&profile, true, |check_profile| {
                let check_owner = || {
                    if !service.valid() {
                        return Err(Status::ScopeChanged);
                    }
                    client.ensure_current().map_err(|_| Status::ScopeChanged)?;
                    check_profile().map_err(|_| Status::ScopeChanged)
                };
                let check_writers = || {
                    claude_history_writers::writers_closed().map_err(|code| {
                        if code == "busy" {
                            Status::Busy
                        } else {
                            Status::WriterUnknown
                        }
                    })
                };
                Ok(registered_handoff(
                    &profile,
                    check_owner,
                    check_writers,
                    || {
                        claude_history_handoff::run_automatic(
                            &profile,
                            service.lease.user(),
                            ids.as_ref(),
                            check_owner,
                            check_writers,
                        )
                    },
                ))
            })
            .map_err(|_| Status::ScopeChanged)
        })
        .await
        .map_err(|_| Status::Failed)?
    }
    .await;
    let result = result.unwrap_or_else(|status| {
        Reconciliation::Complete(Report {
            status,
            items: Vec::new(),
        })
    });
    service.record_reconciliation(&result, pending);
    result
}

async fn run(service: Arc<Service>) {
    let Ok(profile) = existing_profile(&service.lease).await else {
        service.publish(Phase::Disabled, 0);
        return;
    };
    let init_service = service.clone();
    let setup = tokio::task::spawn_blocking(move || install_watcher(&init_service, &profile)).await;
    let Ok(Ok(watcher)) = setup else {
        service.publish(Phase::Unavailable, 0);
        return;
    };
    let mut writers = None;
    let mut waiting = false;
    let mut configuration_stopped = false;
    loop {
        if !service.valid() {
            break;
        }
        let configuration = {
            let mut dirty = service.dirty.lock().unwrap_or_else(|e| e.into_inner());
            std::mem::take(&mut dirty.configuration)
        };
        if configuration && existing_profile(&service.lease).await.is_err() {
            // An expired authorization is recoverable; a valid lease with
            // an invalid managed configuration must stay stopped.
            configuration_stopped = service.lease.check().is_ok();
            break;
        }
        let pending = service
            .dirty
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .pending();
        if pending && !waiting {
            let weak = Arc::downgrade(&service);
            let registration = tokio::task::spawn_blocking(move || {
                claude_history_writers::watch_busy(move || {
                    if let Some(service) = weak.upgrade() {
                        service.wake.notify_one();
                    }
                })
            })
            .await;
            match registration {
                Ok(Ok(Some(guard))) => {
                    writers = Some(guard);
                    waiting = true;
                    service.publish(Phase::WaitingForExit, 0);
                }
                Ok(Ok(None)) => {
                    let ids = service
                        .dirty
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .take();
                    if matches!(
                        reconcile(service.clone(), ids).await,
                        Reconciliation::Complete(Report {
                            status: Status::Busy,
                            ..
                        })
                    ) {
                        // Re-register the process-exit wait after a writer
                        // appears between the initial check and reconciliation.
                        continue;
                    }
                }
                _ => {
                    service.publish(Phase::Unavailable, 0);
                }
            }
        }
        let Some(remaining) = service.lease.remaining() else {
            break;
        };
        tokio::select! {
            _ = service.cancelled.cancelled() => break,
            _ = tokio::time::sleep(remaining) => {},
            _ = service.wake.notified() => {
                // Filesystem events while writers run only accumulate dirty IDs.
                // A finished exit watcher invalidates the writer snapshot.
                if writers.as_ref().is_some_and(claude_history_writers::Guard::is_finished) {
                    if let Some(guard) = writers.take() { let _ = tokio::task::spawn_blocking(move || drop(guard)).await; }
                    waiting = false;
                }
            }
        }
    }
    // A still-running cleanup/refresh task can no longer consume wakeups.
    service.retiring.store(true, Ordering::Release);
    service.publish(Phase::Disabled, 0);
    emit_changed("claude_desktop");
    // Dropping FSEvents/kqueue can join native threads; keep it off the executor.
    let _ = tokio::task::spawn_blocking(move || {
        drop(writers);
        drop(watcher);
    })
    .await;
    // Release all watchers and operation resources before canonical auth sync.
    // Exactly one demand at expiry; failed recovery waits for frontend online/
    // focus events, never a coordinator retry timer.
    if !service.cancelled.is_cancelled() && !configuration_stopped {
        if let Some(start) = service.lease.expiry_refresh() {
            let _ = super::owner_refresh::request_started(service.lease.user(), start).await;
        } else if service.lease.check().is_ok() {
            // Same-owner refresh can win just before the retiring flag. Its
            // earlier wake is now consumed by replacing this retired service.
            ensure_started(service.lease.clone());
        }
    }
}

/// Await a safe handoff before ORG2 starts the managed client. Independent Dock
/// launches cannot be fenced; the commit path still rechecks all live writers.
pub(super) async fn before_open(lease: owner::Lease) {
    ensure_started(lease.clone());
    let service = current()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .filter(|h| h.service.lease.same_epoch(&lease))
        .map(|h| h.service.clone());
    if let Some(service) = service {
        if matches!(
            reconcile(service.clone(), None).await,
            Reconciliation::Complete(Report {
                status: Status::Busy | Status::WriterUnknown | Status::ScopeChanged,
                ..
            })
        ) {
            // The shared result handler retains dirty work; ask the background
            // queue to install its exit watch instead of silently losing it.
            service.wake.notify_one();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn waiting_and_unverified_history_are_explicit_without_private_error_text() {
        let waiting = Progress {
            phase: Phase::WaitingForExit,
            issues: 2,
            reason: None,
        }
        .view();
        assert_eq!(waiting.state, HistorySyncState::Active);
        assert_eq!(
            waiting.reason.as_deref(),
            Some("claude_history_waiting_for_exit")
        );
        assert_eq!(waiting.pending, 2);
        let unknown = Progress {
            phase: Phase::Unavailable,
            issues: 0,
            reason: Some("claude_history_namespace_pending"),
        }
        .view();
        assert_eq!(unknown.state, HistorySyncState::Paused);
        assert_eq!(
            unknown.reason.as_deref(),
            Some("claude_history_namespace_pending")
        );
        assert_eq!(Progress::default().view().state, HistorySyncState::Idle);
    }
    #[test]
    fn retired_owner_cannot_expose_or_replace_its_history_snapshot() {
        let (lease, invalidate) = owner::test_lease("claude-snapshot-owner");
        let service = Service {
            lease,
            dirty: Mutex::new(Dirty::default()),
            snapshot: Mutex::new(Progress::default()),
            issues: Mutex::new(Issues::default()),
            wake: Notify::new(),
            cancelled: CancellationToken::new(),
            retiring: AtomicBool::new(false),
        };
        service.publish(Phase::Attention, 3);
        assert_eq!(service.view().pending, 3);
        invalidate();
        service.publish(Phase::Current, 0);
        assert_eq!(service.snapshot.lock().unwrap().phase, Phase::Attention);
        assert_eq!(service.view().state, HistorySyncState::Idle);
        assert_eq!(service.view().pending, 0);
    }
    #[test]
    fn bursts_are_bounded_and_overflow_preserves_work() {
        let mut dirty = Dirty::default();
        for i in 0..10_000 {
            dirty.add(&i.to_string());
        }
        assert!(dirty.all);
        assert!(dirty.ids.is_empty());
        assert!(dirty.take().is_none());
        assert!(!dirty.pending());
    }
    #[test]
    fn busy_work_merges_with_new_events_without_losing_ids() {
        let mut dirty = Dirty::default();
        dirty.add("a");
        let pending = dirty.take();
        dirty.add("b");
        dirty.restore(pending);
        assert_eq!(
            dirty.take().unwrap(),
            HashSet::from(["a".to_owned(), "b".to_owned()])
        );
        dirty.restore(None);
        dirty.add("c");
        assert!(dirty.take().is_none());
    }
    fn report(status: Status, items: &[(&str, Status)]) -> Report {
        Report {
            status,
            items: items
                .iter()
                .map(|(id, status)| claude_history_handoff::Item {
                    session_id: (*id).into(),
                    status: *status,
                })
                .collect(),
        }
    }
    #[test]
    fn open_and_background_results_share_visible_unresolved_state() {
        let (lease, _) = owner::test_lease("history-report-owner");
        let service = Service {
            lease,
            dirty: Mutex::new(Dirty::default()),
            snapshot: Mutex::new(Progress::default()),
            issues: Mutex::new(Issues::default()),
            wake: Notify::new(),
            cancelled: CancellationToken::new(),
            retiring: AtomicBool::new(false),
        };
        for status in [
            Status::Unsupported,
            Status::Conflict,
            Status::Incomplete,
            Status::Failed,
            Status::Limit,
        ] {
            // A full Open pass must expose a rejected handoff, including a
            // preflight rejection with no per-session results.
            service.record_reconciliation(&Reconciliation::Complete(report(status, &[])), None);
            assert_eq!(service.view().state, HistorySyncState::Paused);
            assert_eq!(
                service.view().reason.as_deref(),
                Some("claude_history_attention")
            );
            assert_eq!(service.view().pending, 1);
            // An unrelated background file event cannot clear that failure.
            service.record_reconciliation(
                &Reconciliation::Complete(report(Status::Clean, &[("other", Status::Clean)])),
                Some(HashSet::from(["other".into()])),
            );
            assert_eq!(service.view().state, HistorySyncState::Paused);
            assert_eq!(service.view().pending, 1);
            service
                .record_reconciliation(&Reconciliation::Complete(report(Status::Clean, &[])), None);
            assert_eq!(service.view().state, HistorySyncState::Active);
            assert_eq!(service.view().pending, 0);
        }
        for status in [Status::Busy, Status::WriterUnknown, Status::ScopeChanged] {
            service.record_reconciliation(&Reconciliation::Complete(report(status, &[])), None);
            assert!(service.dirty.lock().unwrap().pending());
            assert_eq!(
                service.snapshot.lock().unwrap().phase,
                if status == Status::Busy {
                    Phase::WaitingForExit
                } else {
                    Phase::Unavailable
                }
            );
            service.dirty.lock().unwrap().take();
        }
    }
    #[test]
    fn partial_success_preserves_other_sessions_until_explicitly_resolved() {
        let mut issues = Issues::default();
        assert_eq!(
            issues.update(
                &report(Status::Conflict, &[("bad", Status::Conflict)]),
                false
            ),
            1
        );
        assert_eq!(
            issues.update(&report(Status::Clean, &[("other", Status::Clean)]), false),
            1
        );
        assert_eq!(issues.update(&report(Status::Clean, &[]), false), 1);
        assert_eq!(
            issues.update(
                &report(Status::Clean, &[("bad", Status::SyncedToPrimary)]),
                false
            ),
            0
        );
    }
    #[test]
    fn incomplete_inventory_is_cleared_only_by_a_successful_full_pass() {
        let mut issues = Issues::default();
        issues.update(
            &report(Status::Unsupported, &[("bad", Status::Unsupported)]),
            false,
        );
        assert_eq!(issues.update(&report(Status::Limit, &[]), true), 2);
        assert_eq!(
            issues.update(&report(Status::Clean, &[("bad", Status::Clean)]), false),
            1
        );
        assert_eq!(issues.update(&report(Status::Failed, &[]), true), 1);
        assert_eq!(issues.update(&report(Status::Clean, &[]), true), 0);
    }
    #[test]
    fn unresolved_overflow_stays_bounded_and_cannot_be_hidden_by_partial_results() {
        let mut issues = Issues::default();
        for index in 0..MAX_DIRTY + 10 {
            issues.update(
                &report(
                    Status::Unsupported,
                    &[(&index.to_string(), Status::Unsupported)],
                ),
                false,
            );
        }
        assert_eq!(issues.sessions.len(), MAX_DIRTY);
        assert!(issues.incomplete);
        for index in 0..MAX_DIRTY {
            issues.update(
                &report(Status::Clean, &[(&index.to_string(), Status::Clean)]),
                false,
            );
        }
        assert_eq!(issues.sessions.len(), 0);
        assert_eq!(issues.update(&report(Status::Clean, &[]), false), 1);
        assert_eq!(
            issues.update(
                &report(Status::Clean, &[("new", Status::Unsupported)]),
                true
            ),
            1
        );
        assert_eq!(issues.update(&report(Status::Clean, &[]), true), 0);
    }
    #[tokio::test]
    async fn retiring_task_cannot_absorb_same_owner_refresh_wakeup() {
        let (lease, _) = owner::test_lease("history-owner");
        let service = Arc::new(Service {
            lease: lease.clone(),
            dirty: Mutex::new(Dirty::default()),
            snapshot: Mutex::new(Progress::default()),
            issues: Mutex::new(Issues::default()),
            wake: Notify::new(),
            cancelled: CancellationToken::new(),
            retiring: AtomicBool::new(false),
        });
        let (done, waiting) = tokio::sync::oneshot::channel::<()>();
        let handle = Handle {
            service: service.clone(),
            task: tokio::spawn(async move {
                let _ = waiting.await;
            }),
        };
        assert!(!handle.task.is_finished());
        assert!(handle.service.accepts_wake(&lease));
        service.retiring.store(true, Ordering::Release);
        assert!(!handle.task.is_finished());
        assert!(!handle.service.accepts_wake(&lease));
        // Retirement is per service; a replacement sharing this verified
        // owner is independent from the old task's late completion.
        let replacement = Service {
            lease: lease.clone(),
            dirty: Mutex::new(Dirty::default()),
            snapshot: Mutex::new(Progress::default()),
            issues: Mutex::new(Issues::default()),
            wake: Notify::new(),
            cancelled: CancellationToken::new(),
            retiring: AtomicBool::new(false),
        };
        done.send(()).unwrap();
        handle.task.await.unwrap();
        assert!(replacement.accepts_wake(&lease));
    }
}

#[cfg(test)]
#[path = "claude_history_namespace_tests.rs"]
mod namespace_tests;
