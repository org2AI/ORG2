//! One authenticated owner, one filesystem subscription, no periodic scans.
use super::history_status::{HistorySyncState, HistorySyncView};
use super::{
    native_compatibility::{self, ResolvedNativeClient},
    owner,
};
use crate::agent_sessions::cli::parsers::codex_app_server::{
    isolated_default_route, prepare_history_store, resolve_target_route, ResolvedCodexHistoryRoute,
};
use agent_cli::managed_config::{
    self,
    native_app::{self, codex_history, NativeAppProfile},
};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

const MAX_DIRTY: usize = 128;
#[derive(Default)]
struct Dirty {
    all: bool,
    metadata: bool,
    ids: BTreeSet<String>,
}
impl Dirty {
    fn all(&mut self) {
        self.all = true;
        self.ids.clear();
    }
    fn id(&mut self, id: String) {
        if !self.all {
            self.ids.insert(id);
            if self.ids.len() > MAX_DIRTY {
                self.all();
            }
        }
    }
    fn take(&mut self) -> Option<Taken> {
        if !self.all && !self.metadata && self.ids.is_empty() {
            return None;
        }
        let all = std::mem::take(&mut self.all);
        let revalidate = all || std::mem::take(&mut self.metadata);
        let ids = std::mem::take(&mut self.ids)
            .into_iter()
            .collect::<Vec<_>>();
        Some(Taken {
            // A reverted rollout has a new immutable ID but keeps its stable
            // thread ID. Resolve file IDs against the native catalog first.
            changed_files: (!all).then_some(ids),
            revalidate,
        })
    }
    fn restore(&mut self, taken: Taken) {
        match taken.changed_files {
            None => self.all(),
            Some(ids) => {
                self.metadata |= taken.revalidate;
                for id in ids {
                    self.id(id);
                }
            }
        }
    }
}
#[derive(Debug, PartialEq, Eq)]
struct Taken {
    changed_files: Option<Vec<String>>,
    /// Configuration or catalog metadata moved; re-check the managed state
    /// before touching history. Plain rollout appends never need that.
    revalidate: bool,
}
/// One native bootstrap attempt per package configuration state. A failure is
/// remembered until the configuration changes or is explicitly re-applied, so
/// native events cannot turn a failing bootstrap into a launch loop.
struct CachedModel {
    fingerprint: [u8; 32],
    model: Result<String, String>,
}
struct Service {
    lease: owner::Lease,
    dirty: Mutex<Dirty>,
    wake: Notify,
    cancel: CancellationToken,
    primary_model: Mutex<Option<CachedModel>>,
    package_model: Mutex<Option<CachedModel>>,
    client: Mutex<Option<ResolvedNativeClient>>,
    runtime: Mutex<Option<super::native_app_launch::process::codex_runtime::ProfileRuntime>>,
    view: Mutex<HistorySyncView>,
}
struct Handle {
    service: Arc<Service>,
    task: tokio::task::JoinHandle<()>,
}

pub(crate) fn status() -> HistorySyncView {
    let service = slot()
        .lock()
        .unwrap_or_else(|v| v.into_inner())
        .as_ref()
        .map(|handle| handle.service.clone());
    service
        .filter(|service| service.check().is_ok())
        .map(|service| {
            service
                .view
                .lock()
                .unwrap_or_else(|v| v.into_inner())
                .clone()
        })
        .unwrap_or_default()
}

fn slot() -> &'static Mutex<Option<Handle>> {
    static VALUE: OnceLock<Mutex<Option<Handle>>> = OnceLock::new();
    VALUE.get_or_init(Default::default)
}

impl Service {
    fn publish(&self, update: impl FnOnce(&mut HistorySyncView)) {
        if self.check().is_err() {
            return;
        }
        let mut view = self.view.lock().unwrap_or_else(|v| v.into_inner());
        let before = view.clone();
        update(&mut view);
        view.reason = view
            .reason
            .take()
            .map(|reason| public_reason(&reason).into());
        if *view == before {
            return;
        }
        // Detailed parser failures stay out of UI events and shared logs.
        tracing::debug!(state = ?view.state, shared = view.shared, conflicts = view.conflicts, pending = view.pending, "Codex automatic history state");
        drop(view);
        super::history_status::emit_changed("codex");
    }

    fn check(&self) -> Result<(), String> {
        if self.cancel.is_cancelled() {
            Err("Codex history owner retired".into())
        } else {
            self.lease.check()
        }
    }
}

pub(super) fn ensure_started(lease: owner::Lease) {
    if lease.check().is_err() {
        return;
    }
    let mut current = slot().lock().unwrap_or_else(|v| v.into_inner());
    if lease.check().is_err() {
        return;
    }
    if let Some(handle) = current.as_ref() {
        if handle.service.lease.same_epoch(&lease) && !handle.task.is_finished() {
            // Auth refresh only changes the expiry wait. It is not a history invalidation.
            handle.service.wake.notify_one();
            return;
        }
        handle.service.cancel.cancel();
    }
    let service = Arc::new(Service {
        lease,
        dirty: Mutex::new(Dirty {
            all: true,
            ..Default::default()
        }),
        wake: Notify::new(),
        cancel: CancellationToken::new(),
        primary_model: Mutex::new(None),
        package_model: Mutex::new(None),
        client: Mutex::new(None),
        runtime: Mutex::new(None),
        view: Mutex::new(HistorySyncView::default()),
    });
    let task = tokio::spawn(run(service.clone()));
    *current = Some(Handle { service, task });
}
/// Configuration application is a real invalidation; auth refresh is not.
pub(super) fn configuration_applied() {
    let service = slot()
        .lock()
        .unwrap_or_else(|v| v.into_inner())
        .as_ref()
        .map(|v| v.service.clone());
    if let Some(service) = service.filter(|v| v.check().is_ok()) {
        *service
            .primary_model
            .lock()
            .unwrap_or_else(|v| v.into_inner()) = None;
        *service
            .package_model
            .lock()
            .unwrap_or_else(|v| v.into_inner()) = None;
        service
            .dirty
            .lock()
            .unwrap_or_else(|v| v.into_inner())
            .all();
        service.wake.notify_one();
    }
}

pub(super) fn stop() {
    if let Some(handle) = slot().lock().unwrap_or_else(|v| v.into_inner()).take() {
        handle.service.cancel.cancel();
    }
    super::history_status::emit_changed("codex");
}
pub(super) async fn before_open(
    lease: owner::Lease,
    client: ResolvedNativeClient,
) -> Result<(), String> {
    ensure_started(lease.clone());
    let service = slot()
        .lock()
        .unwrap_or_else(|v| v.into_inner())
        .as_ref()
        .filter(|v| v.service.lease.same_epoch(&lease))
        .map(|v| v.service.clone())
        .ok_or("Codex history owner changed")?;
    if let Err(reason) = client.ensure_current() {
        lease.check()?;
        service.publish(|view| {
            view.state = HistorySyncState::Paused;
            view.reason = Some(reason);
            view.native_version = Some(client.version.clone());
        });
        return Ok(());
    }
    // An explicit open is the one place a remembered bootstrap failure is retried.
    *service
        .primary_model
        .lock()
        .unwrap_or_else(|v| v.into_inner()) = None;
    *service
        .package_model
        .lock()
        .unwrap_or_else(|v| v.into_inner()) = None;
    let result = match reconcile(service.clone(), None, Some(client)).await {
        Ok(report) => {
            service.publish(|view| record(view, &report));
            report
        }
        Err(reason) => {
            service.check()?;
            tracing::warn!(
                reason = public_reason(&reason),
                "Codex history preserved; native launch can continue"
            );
            if !transient(&reason) {
                service.publish(|view| {
                    view.state = HistorySyncState::Paused;
                    view.reason = Some(reason.clone());
                });
            }
            return Ok(());
        }
    };
    if result.more {
        service
            .dirty
            .lock()
            .unwrap_or_else(|v| v.into_inner())
            .all();
        service.wake.notify_one();
    }
    Ok(())
}
async fn reconcile(
    service: Arc<Service>,
    changed_files: Option<Vec<String>>,
    selected: Option<ResolvedNativeClient>,
) -> Result<codex_history::Report, String> {
    let _serial = super::history_serial().lock().await;
    service.check()?;
    let operation = service.lease.clone().operation().await?;
    tokio::task::spawn_blocking(move || {
        let _operation = operation;
        service.check()?;
        let cached = service
            .client
            .lock()
            .unwrap_or_else(|v| v.into_inner())
            .clone();
        let client = match selected.or(cached.filter(|v| v.ensure_current().is_ok())) {
            Some(client) => client,
            None => native_compatibility::resolve("codex")?,
        };
        service.publish(|view| view.native_version = Some(client.version.clone()));
        *service.client.lock().unwrap_or_else(|v| v.into_inner()) = Some(client.clone());
        client.ensure_current()?;
        let profile = service
            .lease
            .native_app("codex")?
            .ok_or("Missing Codex profile")?;
        native_app::with_existing_profile(&profile, true, |check_profile| {
            use super::native_app_launch::process::codex_runtime::ProfileRuntime;
            // One discovery per coalesced batch; successful proofs are owner
            // scoped. Commit fences recheck exact PIDs, not every OS process.
            let cached = service
                .runtime
                .lock()
                .unwrap_or_else(|v| v.into_inner())
                .clone();
            let runtime = match cached
                .filter(|value| value.is_bound() && value.check(&client, &profile).is_ok())
            {
                Some(value) => value,
                None => ProfileRuntime::capture(&client, &profile)?,
            };
            *service.runtime.lock().unwrap_or_else(|v| v.into_inner()) = Some(runtime.clone());
            let primary = app_paths::native_transcript_home_dir().join(".codex");
            // Creating the user's first primary profile belongs to native Codex.
            // The parent watcher wakes this service when that profile appears.
            if !primary.is_dir() {
                return Ok(codex_history::Report::default());
            }
            // Explicit config wins. Missing defaults are resolved by this
            // runtime in an empty offline profile, never by opening primary.
            let primary_configuration = primary_config_identity(&primary)?;
            let check = || {
                service.check()?;
                client.ensure_current()?;
                runtime.check(&client, &profile)?;
                check_profile()?;
                // The engine accepts a model string, so keep its provider
                // selection under the same config generation as resolution.
                // A provider switch cannot reuse the previous default model.
                check_primary_configuration(&primary, &primary_configuration)
            };
            check()?;
            let primary_model = resolve_primary_model_cached(
                &service.primary_model,
                &client.generation,
                &primary,
                &check,
                || isolated_default_route(client.runtime()?, &check),
            )?;
            let package_model = resolve_package_model(&service, &client, &profile.home(), &check)?;
            codex_history::reconcile_changes(
                &profile,
                None,
                [&primary_model, &package_model],
                changed_files.as_deref(),
                check,
            )
        })
    })
    .await
    .map_err(|_| "Codex history worker stopped")?
}

fn primary_model(
    home: &Path,
    default: Option<&ResolvedCodexHistoryRoute>,
) -> Result<String, String> {
    match resolve_target_route(home, default) {
        Ok(route) => Ok(route.model),
        Err(reason) if reason == "target_route_unknown" => Ok(String::new()),
        Err(reason) => Err(reason),
    }
}

/// At most one offline metadata probe per owner/runtime/configuration state.
/// Unknown capability stops only copies needing the primary's default route;
/// explicit routes and primary-to-package sharing do not depend on the probe.
fn resolve_primary_model_cached(
    cache: &Mutex<Option<CachedModel>>,
    generation: &str,
    home: &Path,
    check: &impl Fn() -> Result<(), String>,
    probe: impl FnOnce() -> Result<Option<ResolvedCodexHistoryRoute>, String>,
) -> Result<String, String> {
    check()?;
    let explicit = primary_model(home, None)?;
    check()?;
    if !explicit.is_empty() {
        return Ok(explicit);
    }
    let fingerprint = runtime_config_fingerprint(config_fingerprint(home)?, generation);
    if let Some(cached) = cache.lock().unwrap_or_else(|v| v.into_inner()).as_ref() {
        if cached.fingerprint == fingerprint {
            check()?;
            return cached.model.clone();
        }
    }
    let default = if primary_uses_bundled_catalog(home)? {
        probe()?
    } else {
        None
    };
    check()?;
    let model = primary_model(home, default.as_ref())?;
    if fingerprint != runtime_config_fingerprint(config_fingerprint(home)?, generation) {
        return Err("target_route_unknown".into());
    }
    check()?;
    *cache.lock().unwrap_or_else(|v| v.into_inner()) = Some(CachedModel {
        fingerprint,
        model: Ok(model.clone()),
    });
    Ok(model)
}

/// An isolated empty-home catalog cannot describe a primary profile's custom
/// model catalog. Explicit models already returned above; leave only its
/// missing default pending rather than inspecting arbitrary catalog paths.
fn primary_uses_bundled_catalog(home: &Path) -> Result<bool, String> {
    let path = home.join("config.toml");
    let mut bytes = Vec::new();
    match std::fs::symlink_metadata(&path) {
        Ok(value) if value.is_file() && value.len() <= 4 * 1024 * 1024 => {
            std::fs::File::open(path)
                .map_err(|_| "Cannot inspect Codex configuration")?
                .take(4 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| "Cannot inspect Codex configuration")?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(true),
        _ => return Err("Codex configuration is not a bounded regular file".into()),
    }
    if bytes.len() > 4 * 1024 * 1024 {
        return Err("Codex configuration exceeds limit".into());
    }
    let text = std::str::from_utf8(&bytes).map_err(|_| "Invalid Codex local configuration")?;
    let value: toml::Table =
        toml::from_str(text).map_err(|_| "Invalid Codex local configuration")?;
    let selected = value
        .get("profile")
        .and_then(toml::Value::as_str)
        .and_then(|name| {
            value
                .get("profiles")
                .and_then(toml::Value::as_table)?
                .get(name)
        })
        .and_then(toml::Value::as_table);
    Ok(selected
        .and_then(|profile| profile.get("model_catalog_json"))
        .or_else(|| value.get("model_catalog_json"))
        .is_none())
}

#[derive(Debug, PartialEq, Eq)]
struct PrimaryConfigIdentity {
    length: u64,
    modified: std::time::SystemTime,
    #[cfg(unix)]
    inode: (u64, u64, i64, i64),
}

/// Metadata-only commit fence; do not re-read/hash up to 4 MiB at every writer
/// checkpoint. Configuration content is parsed once per reconciliation pass.
fn primary_config_identity(home: &Path) -> Result<Option<PrimaryConfigIdentity>, String> {
    let metadata = match std::fs::symlink_metadata(home.join("config.toml")) {
        Ok(value) if value.is_file() && value.len() <= 4 * 1024 * 1024 => value,
        Ok(_) => return Err("Codex primary configuration is not a bounded regular file".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Cannot inspect Codex primary configuration".into()),
    };
    Ok(Some(PrimaryConfigIdentity {
        length: metadata.len(),
        modified: metadata
            .modified()
            .map_err(|_| "Cannot identify Codex primary configuration")?,
        #[cfg(unix)]
        inode: {
            use std::os::unix::fs::MetadataExt;
            (
                metadata.dev(),
                metadata.ino(),
                metadata.ctime(),
                metadata.ctime_nsec(),
            )
        },
    }))
}

fn check_primary_configuration(
    home: &Path,
    expected: &Option<PrimaryConfigIdentity>,
) -> Result<(), String> {
    if &primary_config_identity(home)? != expected {
        return Err("target_route_unknown".into());
    }
    Ok(())
}

fn config_fingerprint(home: &Path) -> Result<[u8; 32], String> {
    let path = home.join("config.toml");
    let metadata = match std::fs::symlink_metadata(&path) {
        Ok(value) if value.is_file() => Some(value),
        Ok(_) => return Err("Codex configuration is not a regular file".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => return Err("Cannot inspect Codex configuration".into()),
    };
    let mut digest = Sha256::new();
    if metadata.is_some() {
        digest.update(b"present");
        let mut bytes = Vec::new();
        std::fs::File::open(&path)
            .map_err(|_| "Cannot inspect Codex configuration")?
            .take(4 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Cannot inspect Codex configuration")?;
        if bytes.len() > 4 * 1024 * 1024 {
            return Err("Codex configuration exceeds limit".into());
        }
        digest.update(bytes);
    } else {
        digest.update(b"absent");
    }
    Ok(digest.finalize().into())
}

fn resolve_package_model(
    service: &Service,
    client: &ResolvedNativeClient,
    home: &Path,
    check: &impl Fn() -> Result<(), String>,
) -> Result<String, String> {
    check()?;
    let configuration = config_fingerprint(home)?;
    let fingerprint = runtime_config_fingerprint(configuration, &client.generation);
    let store_present =
        home.join("state_5.sqlite").is_file() && home.join("thread_history_1.sqlite").is_file();
    if let Some(cached) = &*service
        .package_model
        .lock()
        .unwrap_or_else(|v| v.into_inner())
    {
        // A removed store is re-initialized once; a remembered failure is not
        // retried by native events.
        if cached.fingerprint == fingerprint && (store_present || cached.model.is_err()) {
            return cached.model.clone();
        }
    }
    let model = prepare_history_store(client.runtime()?, home, check).map(|route| route.model);
    check()?;
    if config_fingerprint(home)? != configuration {
        return Err("Codex configuration changed during history initialization".into());
    }
    *service
        .package_model
        .lock()
        .unwrap_or_else(|v| v.into_inner()) = Some(CachedModel {
        fingerprint,
        model: model.clone(),
    });
    model
}

fn runtime_config_fingerprint(configuration: [u8; 32], generation: &str) -> [u8; 32] {
    let mut digest = Sha256::new();
    digest.update(configuration);
    digest.update(generation);
    digest.finalize().into()
}

fn app_watch_roots(service: &Service) -> Vec<PathBuf> {
    let mut paths = vec![
        app_paths::home_dir().join("Applications"),
        PathBuf::from("/Applications"),
    ];
    if let Some(client) = &*service.client.lock().unwrap_or_else(|v| v.into_inner()) {
        for relative in [
            "",
            "Contents",
            "Contents/MacOS",
            "Contents/Resources",
            "Contents/_CodeSignature",
        ] {
            paths.push(client.bundle.join(relative));
        }
    }
    paths.retain(|path| path.is_dir());
    paths.sort();
    paths.dedup();
    paths
}

fn thread_id(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_str()?;
    let stem = name
        .strip_suffix(".jsonl")
        .or_else(|| name.strip_suffix(".lock"))?;
    let id = stem.get(stem.len().checked_sub(36)?..)?;
    uuid::Uuid::parse_str(id).ok().map(|_| id.to_owned())
}
fn install(
    service: &Arc<Service>,
    profile: &NativeAppProfile,
) -> Result<(RecommendedWatcher, Vec<(PathBuf, RecursiveMode)>), String> {
    let homes = vec![
        app_paths::native_transcript_home_dir().join(".codex"),
        profile.home(),
    ];
    let manifest = app_paths::cli_config_profile_manifest("codex");
    let observed = homes.clone();
    let app_roots = app_watch_roots(service);
    let manifest_callback = manifest.clone();
    let weak = Arc::downgrade(service);
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Some(service) = weak.upgrade().filter(|v| v.check().is_ok()) else {
            return;
        };
        let mut dirty = service.dirty.lock().unwrap_or_else(|v| v.into_inner());
        let mut changed = false;
        match event {
            Ok(event) if event.need_rescan() => {
                dirty.all();
                changed = true;
            }
            Ok(event) if !matches!(event.kind, notify::EventKind::Access(_)) => {
                for path in event.paths {
                    if app_roots
                        .iter()
                        .any(|root| path == *root || path.parent() == Some(root.as_path()))
                    {
                        *service.client.lock().unwrap_or_else(|v| v.into_inner()) = None;
                        dirty.all();
                        changed = true;
                    }
                    if path == manifest_callback {
                        dirty.all();
                        changed = true;
                        continue;
                    }
                    for home in &observed {
                        if path == *home {
                            dirty.all();
                            changed = true;
                            continue;
                        }
                        let Ok(relative) = path.strip_prefix(home) else {
                            continue;
                        };
                        let first = relative
                            .components()
                            .next()
                            .and_then(|v| v.as_os_str().to_str())
                            .unwrap_or("");
                        if matches!(
                            first,
                            "sessions" | "archived_sessions" | "thread-writer-locks"
                        ) {
                            if let Some(id) = thread_id(&path) {
                                dirty.id(id);
                                changed = true;
                            } else if path.is_dir() || path == home.join(first) {
                                dirty.all();
                                changed = true;
                            }
                        } else if matches!(
                            first,
                            "config.toml"
                                | "state_5.sqlite"
                                | "state_5.sqlite-wal"
                                | "thread_history_1.sqlite"
                                | "thread_history_1.sqlite-wal"
                        ) {
                            dirty.metadata = true;
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
    .map_err(|_| "Cannot observe Codex history")?;
    let roots = watch_roots(service, profile);
    for (path, mode) in &roots {
        watcher
            .watch(path, *mode)
            .map_err(|_| "Cannot subscribe to Codex history")?;
    }
    Ok((watcher, roots))
}

fn watch_roots(service: &Service, profile: &NativeAppProfile) -> Vec<(PathBuf, RecursiveMode)> {
    let homes = [
        app_paths::native_transcript_home_dir().join(".codex"),
        profile.home(),
    ];
    let manifest = app_paths::cli_config_profile_manifest("codex");
    let mut roots = app_watch_roots(service)
        .into_iter()
        .map(|path| (path, RecursiveMode::NonRecursive))
        .collect::<Vec<_>>();
    for home in homes {
        if home.is_dir() {
            roots.push((home.clone(), RecursiveMode::NonRecursive));
            for child in ["sessions", "archived_sessions", "thread-writer-locks"] {
                let path = home.join(child);
                if path.is_dir() {
                    roots.push((path, RecursiveMode::Recursive));
                }
            }
        } else if let Some(parent) = home.parent().filter(|v| v.is_dir()) {
            roots.push((parent.to_path_buf(), RecursiveMode::NonRecursive));
        }
    }
    if let Some(parent) = manifest.parent().filter(|v| v.is_dir()) {
        roots.push((parent.to_path_buf(), RecursiveMode::NonRecursive));
    }
    roots
}

fn public_reason(reason: &str) -> &'static str {
    match reason {
        "native_app_changed" => "native_app_changed",
        "native_history_runtime_unknown" => "native_history_runtime_unknown",
        "native_runtime_unverified" | "native_runtime_mismatch" | "native_app_process_stale" => {
            "native_history_runtime_unknown"
        }
        "target_route_unknown" => "target_route_unknown",
        _ => "native_history_unavailable",
    }
}

fn transient(error: &str) -> bool {
    error.ends_with("busy") || error.ends_with("already synchronizing")
}

fn record(view: &mut HistorySyncView, report: &codex_history::Report) {
    view.state = HistorySyncState::Active;
    view.reason = report
        .target_route_pending
        .then(|| "target_route_unknown".into());
    view.shared = report.shared;
    view.conflicts = report.conflicts;
    view.pending = report.pending;
}

async fn run(service: Arc<Service>) {
    let result = async {
        let profile = service.lease.native_app("codex")?.ok_or("Missing Codex history profile")?;
        // The user's native home is observed only while this profile is the
        // managed Market connection. Restore/reconfigure can happen within one
        // Cloud owner epoch: an unmanaged profile drops its subscription and
        // waits for the explicit configuration wake instead of native events.
        let mut watcher: Option<(RecommendedWatcher, Vec<(PathBuf, RecursiveMode)>)> = None;
        let mut managed = false;
        let mut conflicts = 0;
        loop {
            service.check()?;
            let taken = service.dirty.lock().unwrap_or_else(|v| v.into_inner()).take();
            if let Some(taken) = taken {
                if taken.revalidate || !managed {
                    let status = managed_config::cli_config_get_status("codex".into()).await;
                    service.check()?;
                    managed = match status.and_then(|status| profile.validate_launch(&status)) {
                        Ok(()) => true,
                        Err(reason) => {
                            tracing::debug!(%reason, "Codex automatic history is idle until the connection is configured");
                            false
                        }
                    };
                }
                if !managed {
                    watcher = None;
                    service.publish(|view| {
                        view.state = HistorySyncState::Idle;
                        view.reason = None;
                    });
                } else {
                    let resubscribed = watcher.is_none();
                    if resubscribed {
                        watcher = Some(install(&service, &profile)?);
                    }
                    // Events before a subscription are unknown: rescan.
                    let changed_files = if resubscribed { None } else { taken.changed_files.clone() };
                    match reconcile(service.clone(), changed_files, None).await {
                        Ok(report) => {
                            if report.conflicts != conflicts {
                                conflicts = report.conflicts;
                                tracing::warn!(conflicts, "Codex history has conversations with unresolved synchronization failures");
                            }
                            service.publish(|view| record(view, &report));
                            if report.more {
                                service.dirty.lock().unwrap_or_else(|v| v.into_inner()).all();
                            }
                        }
                        Err(error) if transient(&error) => {
                            service.dirty.lock().unwrap_or_else(|v| v.into_inner()).restore(taken);
                        }
                        Err(error) => {
                            tracing::warn!(reason = public_reason(&error), "Codex automatic history handoff paused until its next invalidation");
                            service.publish(|view| {
                                view.state = HistorySyncState::Paused;
                                view.reason = Some(error.clone());
                            });
                        }
                    }
                    // Register newly created native directories. Comparing the root
                    // set avoids replacing subscriptions for every token append.
                    if watcher.as_ref().is_some_and(|w| watch_roots(&service, &profile) != w.1) {
                        watcher = Some(install(&service, &profile)?);
                    }
                }
            }
            let remaining = service.lease.remaining().ok_or("Codex history owner expired")?;
            let pending = {
                let dirty = service.dirty.lock().unwrap_or_else(|v| v.into_inner());
                dirty.all || (managed && (dirty.metadata || !dirty.ids.is_empty()))
            };
            if !pending {
                tokio::select! {
                    _ = service.cancel.cancelled() => break,
                    _ = service.wake.notified() => {},
                    _ = tokio::time::sleep(remaining) => { continue; },
                }
            }
            // Event coalescing only. There is no wake or scan on an idle timer.
            tokio::select! {
                _ = service.cancel.cancelled() => break,
                _ = tokio::time::sleep(std::time::Duration::from_millis(750)) => {}
            }
        }
        Ok::<(), String>(())
    }
    .await;
    if let Err(error) = result {
        tracing::debug!(reason = %error, "Codex automatic history observer stopped");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn primary_resolution_uses_verified_default_only_for_its_provider() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().canonicalize().unwrap();
        let default = ResolvedCodexHistoryRoute {
            model: "verified-native-model".into(),
            provider: "openai".into(),
        };
        assert_eq!(primary_model(&home, None).unwrap(), "");
        assert_eq!(
            primary_model(&home, Some(&default)).unwrap(),
            "verified-native-model"
        );
        assert_eq!(std::fs::read_dir(&home).unwrap().count(), 0);
        std::fs::write(
            home.join("config.toml"),
            "model_provider='another-provider'\n",
        )
        .unwrap();
        assert_eq!(primary_model(&home, Some(&default)).unwrap(), "");
        std::fs::write(
            home.join("config.toml"),
            "model_provider='another-provider'\nmodel='explicit-model'\n",
        )
        .unwrap();
        assert_eq!(
            primary_model(&home, Some(&default)).unwrap(),
            "explicit-model"
        );
    }
    #[test]
    fn a_primary_provider_switch_fences_an_already_resolved_default() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().canonicalize().unwrap();
        let default = ResolvedCodexHistoryRoute {
            model: "verified-native-model".into(),
            provider: "openai".into(),
        };
        let before = primary_config_identity(&home).unwrap();
        assert_eq!(
            primary_model(&home, Some(&default)).unwrap(),
            "verified-native-model"
        );
        check_primary_configuration(&home, &before).unwrap();
        std::fs::write(
            home.join("config.toml"),
            "model_provider='another-provider'\n",
        )
        .unwrap();
        assert_eq!(
            check_primary_configuration(&home, &before).unwrap_err(),
            "target_route_unknown"
        );
        assert_eq!(primary_model(&home, Some(&default)).unwrap(), "");
        let before_removal = primary_config_identity(&home).unwrap();
        std::fs::remove_file(home.join("config.toml")).unwrap();
        assert_eq!(
            check_primary_configuration(&home, &before_removal).unwrap_err(),
            "target_route_unknown"
        );
    }
    #[test]
    fn replacing_primary_configuration_invalidates_identity_even_at_the_same_size() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().canonicalize().unwrap();
        std::fs::write(home.join("config.toml"), "model_provider='openai'\n").unwrap();
        let before = primary_config_identity(&home).unwrap();
        std::fs::write(home.join("replacement.toml"), "model_provider='orgii2'\n").unwrap();
        std::fs::rename(home.join("replacement.toml"), home.join("config.toml")).unwrap();
        assert_eq!(
            check_primary_configuration(&home, &before).unwrap_err(),
            "target_route_unknown"
        );
        assert_eq!(
            before.unwrap().length,
            primary_config_identity(&home).unwrap().unwrap().length
        );
    }
    #[test]
    fn bootstrap_cache_is_scoped_to_configuration_and_runtime() {
        assert_ne!(
            runtime_config_fingerprint([1; 32], "old"),
            runtime_config_fingerprint([1; 32], "new")
        );
        assert_ne!(
            runtime_config_fingerprint([1; 32], "same"),
            runtime_config_fingerprint([2; 32], "same")
        );
    }
    #[test]
    fn explicit_primary_profile_skips_default_probe_and_uses_symmetric_fallback() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().canonicalize().unwrap();
        let cache = Mutex::new(None);
        std::fs::write(home.as_path().join("config.toml"),
            "model='root-model'\nmodel_provider='root-provider'\nprofile='work'\n[profiles.work]\nmodel_provider='profile-provider'\n").unwrap();
        let route = resolve_target_route(home.as_path(), None).unwrap();
        assert_eq!(route.model, "root-model");
        assert_eq!(route.provider, "profile-provider");
        assert_eq!(
            resolve_primary_model_cached(&cache, "runtime", home.as_path(), &|| Ok(()), || panic!(
                "explicit route must not launch capability probe"
            ))
            .unwrap(),
            "root-model"
        );
        std::fs::write(home.as_path().join("config.toml"),
            "model='root-model'\nmodel_provider='root-provider'\nprofile='work'\n[profiles.work]\nmodel='profile-model'\n").unwrap();
        let route = resolve_target_route(home.as_path(), None).unwrap();
        assert_eq!(route.model, "profile-model");
        assert_eq!(route.provider, "root-provider");
        assert!(cache.lock().unwrap().is_none());
    }
    #[test]
    fn unknown_default_is_cached_and_invalidated_by_runtime_or_config() {
        use std::cell::Cell;
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().canonicalize().unwrap();
        let cache = Mutex::new(None);
        let probes = Cell::new(0);
        let unknown = || {
            probes.set(probes.get() + 1);
            Ok(None)
        };
        for _ in 0..3 {
            assert_eq!(
                resolve_primary_model_cached(
                    &cache,
                    "runtime-a",
                    home.as_path(),
                    &|| Ok(()),
                    unknown
                )
                .unwrap(),
                ""
            );
        }
        assert_eq!(probes.get(), 1);
        assert_eq!(
            resolve_primary_model_cached(&cache, "runtime-b", home.as_path(), &|| Ok(()), unknown)
                .unwrap(),
            ""
        );
        assert_eq!(probes.get(), 2);
        std::fs::write(
            home.as_path().join("config.toml"),
            "model_provider='another-provider'\n",
        )
        .unwrap();
        assert_eq!(
            resolve_primary_model_cached(&cache, "runtime-b", home.as_path(), &|| Ok(()), unknown)
                .unwrap(),
            ""
        );
        assert_eq!(probes.get(), 3);
        assert_eq!(std::fs::read_dir(home.as_path()).unwrap().count(), 1);
    }
    #[test]
    fn runtime_default_is_cached_but_never_crosses_provider_boundary() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().canonicalize().unwrap();
        let cache = Mutex::new(None);
        let default = || {
            Ok(Some(ResolvedCodexHistoryRoute {
                model: "runtime-selected".into(),
                provider: "openai".into(),
            }))
        };
        assert_eq!(
            resolve_primary_model_cached(&cache, "runtime", home.as_path(), &|| Ok(()), default)
                .unwrap(),
            "runtime-selected"
        );
        assert_eq!(
            resolve_primary_model_cached(&cache, "runtime", home.as_path(), &|| Ok(()), || panic!(
                "cached"
            ))
            .unwrap(),
            "runtime-selected"
        );
        std::fs::write(
            home.as_path().join("config.toml"),
            "model_provider='another-provider'\n",
        )
        .unwrap();
        assert_eq!(
            resolve_primary_model_cached(&cache, "runtime", home.as_path(), &|| Ok(()), default)
                .unwrap(),
            ""
        );
    }
    #[test]
    fn probe_cancellation_or_primary_mutation_is_not_cached_as_unknown() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().canonicalize().unwrap();
        let cache = Mutex::new(None);
        assert_eq!(
            resolve_primary_model_cached(&cache, "runtime", home.as_path(), &|| Ok(()), || Err(
                "owner retired".into()
            ))
            .unwrap_err(),
            "owner retired"
        );
        assert!(cache.lock().unwrap().is_none());
        let before = primary_config_identity(home.as_path()).unwrap();
        assert_eq!(
            resolve_primary_model_cached(
                &cache,
                "runtime",
                home.as_path(),
                &|| check_primary_configuration(home.as_path(), &before),
                || {
                    std::fs::write(home.as_path().join("config.toml"), "model='changed'\n")
                        .unwrap();
                    Ok(Some(ResolvedCodexHistoryRoute {
                        model: "old".into(),
                        provider: "openai".into(),
                    }))
                }
            )
            .unwrap_err(),
            "target_route_unknown"
        );
        assert!(cache.lock().unwrap().is_none());
    }
    #[test]
    fn custom_primary_catalog_requires_explicit_model_in_root_or_selected_profile() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().canonicalize().unwrap();
        let cache = Mutex::new(None);
        for config in [
            "model_catalog_json='/custom/catalog.json'\n",
            "profile='work'\n[profiles.work]\nmodel_catalog_json='/custom/catalog.json'\n",
            "model_catalog_json='/root/catalog.json'\nprofile='work'\n[profiles.work]\nmodel_provider='openai'\n",
        ] {
            std::fs::write(home.as_path().join("config.toml"), config).unwrap();
            assert_eq!(resolve_primary_model_cached(&cache, "runtime", home.as_path(), &|| Ok(()),
                || panic!("custom catalog cannot use isolated bundled default")).unwrap(), "");
        }
        for config in [
            "model_catalog_json='/custom/catalog.json'\nmodel='custom-explicit'\n",
            "model_catalog_json='/custom/catalog.json'\nprofile='work'\n[profiles.work]\nmodel='custom-explicit'\n",
        ] {
            std::fs::write(home.as_path().join("config.toml"), config).unwrap();
            assert_eq!(resolve_primary_model_cached(&cache, "runtime", home.as_path(), &|| Ok(()),
                || panic!("explicit model requires no probe")).unwrap(), "custom-explicit");
        }
        std::fs::write(home.as_path().join("config.toml"), "profile='work'\n[profiles.work]\n[profiles.unselected]\nmodel_catalog_json='/other/catalog.json'\n").unwrap();
        assert!(primary_uses_bundled_catalog(home.as_path()).unwrap());
    }
    #[test]
    fn pending_return_route_is_distinct_from_shared_count_and_private_errors() {
        let mut view = HistorySyncView::default();
        record(
            &mut view,
            &codex_history::Report {
                shared: 4,
                target_route_pending: true,
                ..Default::default()
            },
        );
        assert_eq!(view.reason.as_deref(), Some("target_route_unknown"));
        assert_eq!(view.shared, 4);
        assert_eq!(
            public_reason("open /private/user/session/config.json: denied"),
            "native_history_unavailable"
        );
    }
    #[test]
    fn dirty_queue_is_bounded_and_refresh_has_no_work() {
        let mut dirty = Dirty::default();
        assert!(dirty.take().is_none());
        for id in 0..200 {
            dirty.id(id.to_string());
        }
        assert!(dirty.all);
        assert!(dirty.ids.is_empty());
        assert_eq!(
            dirty.take(),
            Some(Taken {
                changed_files: None,
                revalidate: true
            })
        );
        assert!(dirty.take().is_none());
    }
    #[test]
    fn only_native_rollout_and_writer_identities_are_accepted() {
        let id = "11111111-1111-7111-8111-111111111111";
        assert_eq!(
            thread_id(Path::new(&format!("rollout-date-{id}.jsonl"))).as_deref(),
            Some(id)
        );
        assert_eq!(
            thread_id(Path::new(&format!("{id}.lock"))).as_deref(),
            Some(id)
        );
        assert!(thread_id(Path::new(".coordination.lock")).is_none());
    }
    #[test]
    fn metadata_invalidation_is_not_lost_behind_an_unrelated_rollout_event() {
        let mut dirty = Dirty {
            metadata: true,
            ..Default::default()
        };
        dirty.id("thread-a".into());
        assert_eq!(
            dirty.take(),
            Some(Taken {
                changed_files: Some(vec!["thread-a".into()]),
                revalidate: true
            })
        );
    }
    #[test]
    fn rollout_events_do_not_revalidate_and_transient_failures_restore_them() {
        let mut dirty = Dirty::default();
        dirty.id("thread-a".into());
        let taken = dirty.take().unwrap();
        assert_eq!(
            taken,
            Taken {
                changed_files: Some(vec!["thread-a".into()]),
                revalidate: false
            }
        );
        assert!(dirty.take().is_none());
        dirty.restore(taken);
        assert_eq!(
            dirty.take(),
            Some(Taken {
                changed_files: Some(vec!["thread-a".into()]),
                revalidate: false
            })
        );
        assert!(transient("Native App configuration is busy"));
        assert!(transient("Codex history is already synchronizing"));
        assert!(!transient("Codex history owner retired"));
    }
}
