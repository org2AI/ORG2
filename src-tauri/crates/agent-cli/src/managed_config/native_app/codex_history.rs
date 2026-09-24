//! Automatic local Codex history handoff. Configuration and authentication stay
//! in their original profiles. Native rollout bytes and frozen fork prefixes
//! are preserved; a native settings event binds continuation to the target.
//!
//! Every reconciliation caller must supply a write-authorization check bound to
//! the verified native binary/runtime, owner and configuration. It is checked
//! before work and again at publication boundaries, including recovery. Local
//! schema and native integrity checks can veto that authority, never establish it.
mod files;
mod revision;
mod routing;
mod store;
#[cfg(test)]
mod tests;

use super::NativeAppProfile;
use files::{Stamp, WriterLock};
use revision::{Observation, Revision};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Read,
    path::{Path, PathBuf},
};
use store::ThreadRecord;

const MAX_LEDGER_BYTES: u64 = 16 * 1024 * 1024;
const MAX_ANCESTORS: usize = 64;
const BATCH: usize = 16;
use super::RECENT_CONVERSATIONS;

#[derive(Default, Debug)]
pub struct Report {
    pub copied: usize,
    pub busy: usize,
    pub conflicts: usize,
    pub more: bool,
    /// Conversations currently shared between the two homes (journal pairs).
    pub shared: usize,
    /// Interrupted publications still awaiting recovery (journal pending).
    pub pending: usize,
    /// Only the package -> primary direction is waiting for a verified route.
    pub target_route_pending: bool,
}
/// A conversation that cannot be shared is re-evaluated on a relevant pass, but the
/// operator is told once per distinct reason, and again only after it healed.
fn attention_log() -> std::sync::MutexGuard<'static, BTreeMap<String, String>> {
    static LAST: std::sync::Mutex<BTreeMap<String, String>> =
        std::sync::Mutex::new(BTreeMap::new());
    LAST.lock().unwrap_or_else(|v| v.into_inner())
}
fn attention(id: &str, message: &'static str, reason: &str) {
    let mut last = attention_log();
    if last.len() > 10_000 {
        last.clear();
    }
    if last.get(id).is_some_and(|previous| previous == reason) {
        return;
    }
    last.insert(id.to_owned(), reason.to_owned());
    tracing::warn!(thread_id = %id, reason = %reason, "{message}");
}
fn healed(id: &str) {
    attention_log().remove(id);
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Version {
    path: PathBuf,
    file: Stamp,
    metadata: String,
}
fn version(home: &Path, row: &ThreadRecord) -> Result<Version, String> {
    Ok(Version {
        path: files::relative_rollout(home, &row.rollout_path)?,
        file: files::stamp(&row.rollout_path)?,
        metadata: row.metadata_hash.clone(),
    })
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Pair {
    primary: Version,
    package: Version,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    revisions: Option<[Revision; 2]>,
    // Decode the old bounded journal only; never classify or write these proofs.
    #[serde(default, rename = "proofs", skip_serializing)]
    legacy_proofs: Option<serde_json::Value>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PendingFile {
    source: PathBuf,
    source_stamp: Stamp,
    destination: PathBuf,
    before: Option<Stamp>,
    staged: PathBuf,
    after: Stamp,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Dependency {
    relative: PathBuf,
    stamp: Stamp,
    rollout_id: String,
    cutoff: u64,
    ordinal: u64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Pending {
    id: String,
    to_package: bool,
    source: Version,
    target: Option<Version>,
    files: Vec<PendingFile>,
    rollout_ids: Vec<String>,
    lock_ids: Vec<String>,
    snapshot: PathBuf,
    dependencies: Vec<Dependency>,
    route_config: Option<Stamp>,
    provider: String,
    model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    revisions: Option<[Revision; 2]>,
    // Decode the old bounded journal only; never classify or write these proofs.
    #[serde(default, rename = "proofs", skip_serializing)]
    legacy_proofs: Option<serde_json::Value>,
    /// A new immutable rollout generation keeps the stable conversation ID
    /// while preserving every byte any native fork might already reference.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    rollout_alias: Option<String>,
    /// Durable intent to remove only an unpublished operation's private artifacts.
    #[serde(default)]
    cancelling: bool,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Ledger {
    version: u8,
    pairs: BTreeMap<String, Pair>,
    pending: BTreeMap<String, Pending>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    observations: BTreeMap<String, [Option<Observation>; 2]>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    waits: BTreeMap<String, revision::Wait>,
    #[serde(default, rename = "reviews", skip_serializing)]
    legacy_reviews: BTreeMap<String, serde_json::Value>,
}

fn valid_relative(path: &Path) -> bool {
    path.is_relative()
        && matches!(path.components().next(), Some(std::path::Component::Normal(v)) if v == "sessions" || v == "archived_sessions")
        && path
            .components()
            .all(|v| matches!(v, std::path::Component::Normal(_)))
        && path.extension().is_some_and(|v| v == "jsonl")
        && files::physical_id(path).is_ok()
}

fn valid_digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn validate_version(value: &Version) -> Result<(), String> {
    if !valid_relative(&value.path) || !valid_digest(&value.metadata) {
        return Err("Invalid Codex revision version in journal".into());
    }
    Ok(())
}

fn validate_revision(value: &Revision) -> Result<(), String> {
    if !valid_digest(&value.raw) || !valid_digest(&value.metadata) {
        return Err("Invalid Codex revision digest in journal".into());
    }
    revision::valid_time(value.written_ns)?;
    Ok(())
}

fn read_ledger(path: &Path) -> Result<Ledger, String> {
    files::regular_path(path, true)?;
    if !path.exists() {
        return Ok(Ledger {
            version: 4,
            ..Default::default()
        });
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|_| "Cannot read Codex history journal")?
        .take(MAX_LEDGER_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read Codex history journal")?;
    if bytes.len() as u64 > MAX_LEDGER_BYTES {
        return Err("Codex history journal exceeds limit".into());
    }
    let mut ledger: Ledger =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid Codex history journal")?;
    if !matches!(ledger.version, 2..=4) || ledger.pairs.len() > 10_000 || ledger.pending.len() > 128
    {
        return Err("Unsupported Codex history journal".into());
    }
    if ledger.observations.len() > 10_000 || ledger.waits.len() > 10_000 {
        return Err("Codex revision observations exceed limit".into());
    }
    for (id, pair) in &ledger.pairs {
        if !files::valid_id(id) {
            return Err("Invalid Codex journal conversation".into());
        }
        validate_version(&pair.primary)?;
        validate_version(&pair.package)?;
        if let Some(revisions) = &pair.revisions {
            for revision in revisions {
                validate_revision(revision)?;
            }
        }
    }
    for (id, sides) in &ledger.observations {
        if !files::valid_id(id) {
            return Err("Invalid Codex journal observation identity".into());
        }
        for observation in sides.iter().flatten() {
            validate_version(&observation.version)?;
            validate_revision(&observation.revision)?;
        }
    }
    for (id, wait) in &ledger.waits {
        if !files::valid_id(id)
            || wait.writers == 0
            || wait.writers > 3
            || wait.writers & (1 << usize::from(wait.to_package)) == 0
        {
            return Err("Invalid Codex journal writer state".into());
        }
        validate_version(&wait.target)?;
    }
    for (id, pending) in &ledger.pending {
        if !files::valid_id(id) || pending.id != *id {
            return Err("Invalid Codex pending identity".into());
        }
        validate_version(&pending.source)?;
        if let Some(target) = &pending.target {
            validate_version(target)?;
        }
        if let Some(revisions) = &pending.revisions {
            for revision in revisions {
                validate_revision(revision)?;
            }
        }
    }
    // v2/v3 operations retain their original snapshot, paths and guards. Their
    // old settings-only decisions do not participate in revision selection.
    for pair in ledger.pairs.values_mut() {
        pair.legacy_proofs = None;
    }
    for pending in ledger.pending.values_mut() {
        pending.legacy_proofs = None;
    }
    ledger.legacy_reviews.clear();
    ledger.version = 4;
    Ok(ledger)
}
fn save(path: &Path, ledger: &Ledger) -> Result<(), String> {
    files::regular_path(path, true)?;
    let bytes = serde_json::to_vec(ledger).map_err(|_| "Cannot encode Codex history journal")?;
    if bytes.len() as u64 > MAX_LEDGER_BYTES {
        return Err("Codex history journal exceeds limit".into());
    }
    super::super::file_io::write_sensitive_file_atomic(path, &bytes)?;
    files::sync_directory(path.parent().ok_or("Missing history journal directory")?)
}

fn config_stamp(home: &Path) -> Result<Option<Stamp>, String> {
    let path = home.join("config.toml");
    files::regular_path(&path, true)?;
    path.exists().then(|| files::stamp(&path)).transpose()
}

/// Read only the explicit native route. Default model resolution remains the
/// native app-server's responsibility, shared by bootstrap and reconciliation.
pub fn configured_route(home: &Path) -> Result<(Option<String>, String), String> {
    let path = home.join("config.toml");
    files::regular_path(&path, true)?;
    let mut text = String::new();
    if path.exists() {
        fs::File::open(path)
            .map_err(|_| "Cannot inspect Codex local route")?
            .take(4 * 1024 * 1024 + 1)
            .read_to_string(&mut text)
            .map_err(|_| "Cannot inspect Codex local route")?;
    }
    if text.len() > 4 * 1024 * 1024 {
        return Err("Codex local configuration exceeds limit".into());
    }
    let value: toml::Table =
        toml::from_str(&text).map_err(|_| "Invalid Codex local configuration")?;
    let token = |table: &toml::Table, key: &str, limit: usize| -> Result<Option<String>, String> {
        table
            .get(key)
            .map(|value| {
                value
                    .as_str()
                    .filter(|v| {
                        !v.is_empty() && v.len() <= limit && !v.chars().any(char::is_control)
                    })
                    .map(str::to_owned)
                    .ok_or_else(|| "Invalid Codex local route".to_string())
            })
            .transpose()
    };
    // An explicitly selected config profile overrides both route fields. Do
    // not resolve only its model while silently taking a different provider
    // from the root, or treat an unknown profile as the native default.
    let selected = token(&value, "profile", 256)?
        .map(|name| {
            value
                .get("profiles")
                .and_then(toml::Value::as_table)
                .and_then(|profiles| profiles.get(&name))
                .and_then(toml::Value::as_table)
                .ok_or_else(|| "target_route_unknown".to_string())
        })
        .transpose()?;
    let field = |key, limit| -> Result<Option<String>, String> {
        let selected = selected
            .map(|profile| token(profile, key, limit))
            .transpose()?
            .flatten();
        let root = token(&value, key, limit)?;
        Ok(selected.or(root))
    };
    Ok((
        field("model", 256)?,
        field("model_provider", 256)?.unwrap_or_else(|| "openai".into()),
    ))
}

fn route(home: &Path, resolved_model: &str) -> Result<(String, String), String> {
    let (model, provider) = configured_route(home)?;
    let model = model
        .or_else(|| (!resolved_model.is_empty()).then(|| resolved_model.to_owned()))
        .ok_or("Resolve the native Codex default model before sharing history")?;
    Ok((provider, model))
}

struct Segment {
    id: String,
    path: PathBuf,
    stable_id: String,
    cutoff: Option<u64>,
    cutoff_ordinal: Option<u64>,
}
fn lineage(home: &Path, row: &ThreadRecord) -> Result<Vec<Segment>, String> {
    let mut path = row.rollout_path.clone();
    let mut result = Vec::new();
    let mut seen = BTreeSet::new();
    let mut inventory = None;
    let mut cutoff = None;
    let mut cutoff_ordinal = None;
    loop {
        files::relative_rollout(home, &path)?;
        let id = files::physical_id(&path)?;
        if !seen.insert(id.clone()) || result.len() == MAX_ANCESTORS {
            return Err("Codex history lineage cycles or exceeds limit".into());
        }
        let head = files::head(&path)?;
        let stable_id = head["payload"]["id"]
            .as_str()
            .ok_or("Missing Codex thread identity")?
            .to_owned();
        if result.is_empty() && stable_id != row.id {
            return Err("Codex rollout belongs to another thread".into());
        }
        if cutoff.is_some_and(|end| end > fs::metadata(&path).map(|v| v.len()).unwrap_or(0)) {
            return Err("Codex fork references an incomplete ancestor".into());
        }
        result.push(Segment {
            id,
            path,
            stable_id,
            cutoff,
            cutoff_ordinal,
        });
        let base = &head["payload"]["history_base"];
        if base.is_null() {
            break;
        }
        let id = base["thread_id"]
            .as_str()
            .filter(|v| files::valid_id(v))
            .ok_or("Invalid Codex fork ancestor")?;
        cutoff = Some(
            base["end_byte_offset"]
                .as_u64()
                .ok_or("Invalid Codex fork cutoff")?,
        );
        cutoff_ordinal = Some(
            base["end_ordinal_exclusive"]
                .as_u64()
                .ok_or("Invalid Codex fork ordinal")?,
        );
        if inventory.is_none() {
            inventory = Some(files::inventory(home)?);
        }
        path = inventory
            .as_ref()
            .and_then(|v| v.get(id))
            .ok_or("Codex fork ancestor is missing")?
            .clone();
    }
    result.reverse();
    Ok(result)
}

fn locks(homes: &[&Path], segments: &[Segment]) -> Result<Vec<WriterLock>, String> {
    let mut keys = BTreeSet::new();
    for home in homes {
        for segment in segments {
            keys.insert((home.to_path_buf(), segment.stable_id.clone()));
            keys.insert((home.to_path_buf(), segment.id.clone()));
        }
    }
    keys.into_iter()
        .map(|(home, id)| WriterLock::acquire(&home, &id))
        .collect()
}

fn same_prefix(
    source: &Path,
    target: &Path,
    count: u64,
    check: &impl Fn() -> Result<(), String>,
) -> Result<bool, String> {
    use std::io::Read;
    let mut a = fs::File::open(source).map_err(|_| "Cannot inspect Codex history ancestor")?;
    let mut b = fs::File::open(target).map_err(|_| "Cannot inspect Codex history ancestor")?;
    let mut count = count;
    let mut left = [0_u8; 65536];
    let mut right = [0_u8; 65536];
    while count > 0 {
        check()?;
        let n = count.min(left.len() as u64) as usize;
        a.read_exact(&mut left[..n])
            .map_err(|_| "Incomplete Codex history ancestor")?;
        if b.read_exact(&mut right[..n]).is_err() || left[..n] != right[..n] {
            return Ok(false);
        }
        count -= n as u64;
    }
    Ok(true)
}

/// The caller supplies an authenticated owner fence and holds the existing
/// managed-profile lock. Missing native databases mean first launch has not
/// initialized its store yet; filesystem creation will request another pass.
/// Reconcile using explicit target configuration. `check` must establish the
/// binary/runtime-bound history capability and current owner/configuration;
/// observed bytes alone cannot authorize writes. See the module contract.
pub fn reconcile(
    profile: &NativeAppProfile,
    ids: Option<&[String]>,
    check: impl Fn() -> Result<(), String>,
) -> Result<Report, String> {
    reconcile_changes(profile, ids, ["", ""], None, check)
}

/// Defaults come from the installed native app-server; explicit config takes precedence.
/// `changed_files = Some(ids)` is for reliable filesystem invalidations:
/// metadata-only events still inspect the catalog, but do not stat unchanged
/// known rollouts. Startup and watcher rescan must pass `None`.
/// `check` must supply the same write authority required by [`reconcile`], for
/// both new publications and pending recovery.
pub fn reconcile_changes(
    profile: &NativeAppProfile,
    ids: Option<&[String]>,
    native_defaults: [&str; 2],
    changed_files: Option<&[String]>,
    check: impl Fn() -> Result<(), String>,
) -> Result<Report, String> {
    profile.validate("codex")?;
    let primary = app_paths::native_transcript_home_dir().join(".codex");
    reconcile_at_with_models(
        &primary,
        &profile.home(),
        &profile.root().join("codex-history/state.json"),
        ids,
        native_defaults,
        changed_files,
        check,
    )
}

#[cfg(test)]
fn reconcile_at(
    primary: &Path,
    package: &Path,
    journal: &Path,
    ids: Option<&[String]>,
    check: impl Fn() -> Result<(), String>,
) -> Result<Report, String> {
    reconcile_at_with_models(primary, package, journal, ids, ["", ""], None, check)
}

fn reconcile_at_with_models(
    primary: &Path,
    package: &Path,
    journal: &Path,
    ids: Option<&[String]>,
    native_defaults: [&str; 2],
    changed_files: Option<&[String]>,
    check: impl Fn() -> Result<(), String>,
) -> Result<Report, String> {
    check()?;
    for home in [primary, package] {
        files::regular_path(home, true)?;
        if !home.join("state_5.sqlite").is_file() || !home.join("thread_history_1.sqlite").is_file()
        {
            return Ok(Report::default());
        }
    }
    let parent = journal
        .parent()
        .ok_or("Missing Codex history journal directory")?;
    files::create_directories(parent)?;
    files::regular_path(parent, false)?;
    let lock_path = parent.join("sync.lock");
    files::regular_path(&lock_path, true)?;
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(lock_path)
        .map_err(|_| "Cannot open Codex history coordinator")?;
    fs2::FileExt::try_lock_exclusive(&lock)
        .map_err(|_| "Codex history is already synchronizing")?;
    let mut ledger = read_ledger(journal)?;
    let mut report = Report::default();
    let explicit_selection = ids.is_some();
    let mut left = store::list_threads(primary, ids)?
        .into_iter()
        .map(|v| (v.id.clone(), v))
        .collect::<BTreeMap<_, _>>();
    let mut right = store::list_threads(package, ids)?
        .into_iter()
        .map(|v| (v.id.clone(), v))
        .collect::<BTreeMap<_, _>>();
    if left.is_empty() && right.is_empty() && ledger.pending.is_empty() {
        return Ok(report);
    }
    let recovering = !ledger.pending.is_empty();
    // Recover each thread independently. A target that diverged after a crash
    // retains its journal and originals without blocking unrelated history.
    for id in ledger.pending.keys().cloned().collect::<Vec<_>>() {
        check()?;
        let pending = ledger.pending.get(&id).unwrap();
        let target = if pending.to_package { package } else { primary };
        let recovery = pending
            .lock_ids
            .iter()
            .map(|id| WriterLock::acquire(target, id))
            .collect::<Result<Vec<_>, _>>()
            .and_then(|_locks| finish(primary, package, journal, &mut ledger, &id, &check));
        match recovery {
            Ok(()) => {
                healed(&id);
                report.copied += 1;
            }
            Err(error) if error == "busy" => report.busy += 1,
            Err(error) if error == "revision_changed" => {
                report.busy += 1;
                report.more = true;
            }
            Err(error) => {
                check()?;
                report.conflicts += 1;
                attention(&id, "Codex history recovery preserved pending data", &error);
            }
        }
    }
    // Recovery may have published new rows; normal incremental passes do not
    // pay for a second inventory read.
    if recovering {
        left = store::list_threads(primary, ids)?
            .into_iter()
            .map(|v| (v.id.clone(), v))
            .collect();
        right = store::list_threads(package, ids)?
            .into_iter()
            .map(|v| (v.id.clone(), v))
            .collect();
    }
    let ids = left
        .keys()
        .chain(right.keys())
        .cloned()
        .collect::<BTreeSet<_>>();
    let changed_files =
        changed_files.map(|ids| ids.iter().map(String::as_str).collect::<BTreeSet<_>>());
    let recent = if explicit_selection {
        None
    } else {
        Some(recent_conversations(primary, &left))
    };
    // The primary profile is never probed with a native process. Explicit
    // configuration or a caller-verified binary default resolves this direction.
    let primary_route_pending =
        native_defaults[0].is_empty() && configured_route(primary)?.0.is_none();
    report.target_route_pending = primary_route_pending;
    let mut dependencies = 0;
    let mut revision_budget = revision::Budget::default();
    let mut ledger_dirty = false;
    let mut revision_deferred = false;
    // UUIDv7 recency ordering brings recent conversations into view first.
    for id in ids.into_iter().rev() {
        check()?;
        if ledger.pending.contains_key(&id) {
            continue;
        }
        if let Some(changed) = changed_files
            .as_ref()
            .filter(|changed| !changed.contains(id.as_str()))
        {
            if let (Some(base), Some(left), Some(right)) =
                (ledger.pairs.get(&id), left.get(&id), right.get(&id))
            {
                let raw_changed = |row: &ThreadRecord| {
                    files::physical_id(&row.rollout_path)
                        .is_ok_and(|raw| changed.contains(raw.as_str()))
                };
                if base.revisions.is_some()
                    && !raw_changed(left)
                    && !raw_changed(right)
                    && left.metadata_hash == base.primary.metadata
                    && right.metadata_hash == base.package.metadata
                    && left.rollout_path == primary.join(&base.primary.path)
                    && right.rollout_path == package.join(&base.package.path)
                {
                    continue;
                }
            }
        }
        let l = left.get(&id).map(|v| version(primary, v)).transpose();
        let r = right.get(&id).map(|v| version(package, v)).transpose();
        let (l, r) = match (l, r) {
            (Ok(l), Ok(r)) => (l, r),
            (Err(error), _) | (_, Err(error)) => {
                report.conflicts += 1;
                attention(&id, "Codex history handoff needs attention", &error);
                continue;
            }
        };
        let base = ledger.pairs.get(&id).cloned();
        if base.as_ref().is_some_and(|base| {
            base.revisions.is_some()
                && l.as_ref() == Some(&base.primary)
                && r.as_ref() == Some(&base.package)
        }) {
            continue;
        }
        if base.is_none()
            && r.is_none()
            && recent.as_ref().is_some_and(|recent| !recent.contains(&id))
        {
            continue;
        }
        // A missing previously shared side is not authorization to resurrect it.
        if base.is_some() && (l.is_none() || r.is_none()) {
            report.conflicts += 1;
            continue;
        }
        let writers = revision::writer_state([primary, package], &id, [l.as_ref(), r.as_ref()])?;
        if let Some(wait) = ledger.waits.get(&id) {
            let target = if wait.to_package {
                r.as_ref()
            } else {
                l.as_ref()
            };
            if writers == wait.writers && target == Some(&wait.target) {
                report.busy += 1;
                continue;
            }
            ledger.waits.remove(&id);
            ledger_dirty = true;
        }
        if writers == 3 {
            report.busy += 1;
            continue;
        }
        // Avoid hashing a changing source on every filesystem event while its
        // only possible destination is still loaded. This is a deferral only.
        let one_changed = base
            .as_ref()
            .and_then(|base| match (l.as_ref(), r.as_ref()) {
                (Some(left), Some(right)) if left != &base.primary && right == &base.package => {
                    Some(true)
                }
                (Some(left), Some(right)) if left == &base.primary && right != &base.package => {
                    Some(false)
                }
                _ => None,
            });
        if let Some(to_package) =
            one_changed.filter(|to_package| writers & (1 << usize::from(*to_package)) != 0)
        {
            ledger.waits.insert(
                id.clone(),
                revision::Wait {
                    target: if to_package {
                        r.clone().unwrap()
                    } else {
                        l.clone().unwrap()
                    },
                    to_package,
                    writers,
                },
            );
            ledger_dirty = true;
            report.busy += 1;
            continue;
        }
        let mut observations = ledger.observations.get(&id).cloned().unwrap_or_default();
        let mut ready = true;
        for (side, home, row, current) in [
            (0, primary, left.get(&id), l.as_ref()),
            (1, package, right.get(&id), r.as_ref()),
        ] {
            let (Some(row), Some(current)) = (row, current) else {
                if observations[side].take().is_some() {
                    ledger_dirty = true;
                }
                continue;
            };
            if observations[side]
                .as_ref()
                .is_some_and(|seen| &seen.version == current)
            {
                continue;
            }
            let baseline = base.as_ref().and_then(|base| {
                base.revisions.as_ref().map(|revisions| Observation {
                    version: if side == 0 {
                        base.primary.clone()
                    } else {
                        base.package.clone()
                    },
                    revision: revisions[side].clone(),
                })
            });
            if baseline
                .as_ref()
                .is_some_and(|seen| &seen.version == current)
            {
                observations[side] = baseline;
                ledger_dirty = true;
                continue;
            }
            match revision_budget.take(current.file.len) {
                Ok(true) => {}
                Ok(false) => {
                    revision_deferred = true;
                    report.busy += 1;
                    ready = false;
                    break;
                }
                Err(error) => {
                    attention(&id, "Codex revision could not be captured", &error);
                    report.conflicts += 1;
                    ready = false;
                    break;
                }
            }
            // Projection/lineage reads share the capture-attempt budget. A loaded
            // unfinished source consumes no full-rollout hash work.
            if writers & (1 << side) != 0 {
                match revision::completed(home, row) {
                    Ok(true) => {}
                    result => {
                        check()?;
                        if let Err(error) = result {
                            attention(&id, "Codex loaded revision is not complete", &error);
                        }
                        report.busy += 1;
                        ready = false;
                        break;
                    }
                }
            }
            match revision::observe(
                home,
                row,
                current,
                observations[side].as_ref().or(baseline.as_ref()),
                &check,
            ) {
                Ok(observation) => {
                    observations[side] = Some(observation);
                    ledger_dirty = true;
                }
                Err(error) => {
                    check()?;
                    if error == "busy" {
                        report.busy += 1;
                    } else {
                        report.conflicts += 1;
                        attention(&id, "Codex revision could not be captured", &error);
                    }
                    ready = false;
                    break;
                }
            }
        }
        if ledger.observations.len() < 10_000 || ledger.observations.contains_key(&id) {
            ledger.observations.insert(id.clone(), observations.clone());
        } else {
            return Err("Codex revision observations exceed limit".into());
        }
        if !ready {
            continue;
        }
        let direction = match (&observations[0], &observations[1]) {
            (Some(_), None) => Some(true),
            (None, Some(_)) => Some(false),
            (Some(left), Some(right)) => {
                let changed = base
                    .as_ref()
                    .map(|base| {
                        if let Some(revisions) = &base.revisions {
                            (
                                !left.revision.same_data(&revisions[0]),
                                !right.revision.same_data(&revisions[1]),
                            )
                        } else {
                            // No retroactive hash is invented for a changed legacy side.
                            (left.version != base.primary, right.version != base.package)
                        }
                    })
                    .unwrap_or((true, true));
                if left.revision.same_data(&right.revision) || changed == (false, false) {
                    ledger.pairs.insert(
                        id.clone(),
                        Pair {
                            primary: left.version.clone(),
                            package: right.version.clone(),
                            revisions: Some([left.revision.clone(), right.revision.clone()]),
                            legacy_proofs: None,
                        },
                    );
                    ledger_dirty = true;
                    healed(&id);
                    None
                } else {
                    Some(match changed {
                        (true, false) => true,
                        (false, true) => false,
                        _ => revision::primary_wins(&left.revision, &right.revision),
                    })
                }
            }
            _ => None,
        };
        let divergence = l
            .as_ref()
            .zip(r.as_ref())
            .map(|(l, r)| (l.clone(), r.clone()));
        let Some(to_package) = direction else {
            continue;
        };
        if !to_package && primary_route_pending {
            report.busy += 1;
            continue;
        }
        if report.copied >= BATCH {
            report.more = true;
            break;
        }
        if ledger.pending.len() >= 128 {
            report.conflicts += 1;
            continue;
        }
        let (source_home, target_home, source_row, target_row) = if to_package {
            (primary, package, left.get(&id).unwrap(), right.get(&id))
        } else {
            (package, primary, right.get(&id).unwrap(), left.get(&id))
        };
        match prepare_copy(
            source_home,
            target_home,
            source_row,
            target_row,
            to_package,
            native_defaults[usize::from(to_package)],
            journal,
            divergence.as_ref(),
            &observations[usize::from(!to_package)]
                .as_ref()
                .ok_or("Missing selected Codex revision")?
                .revision,
            &check,
        ) {
            Ok((pending, _locks)) => {
                // Keep destination writer locks continuously through durable
                // publication. Loaded sources use a validated read snapshot.
                ledger.pending.insert(id.clone(), pending);
                save(journal, &ledger)?;
                match finish(primary, package, journal, &mut ledger, &id, &check) {
                    Ok(()) => {
                        healed(&id);
                        report.copied += 1;
                    }
                    Err(error) if error == "revision_changed" => {
                        report.busy += 1;
                        report.more = true;
                    }
                    Err(error) => {
                        check()?;
                        report.conflicts += 1;
                        attention(
                            &id,
                            "Codex history publication retained for recovery",
                            &error,
                        );
                    }
                }
            }
            Err(error) if error == "busy" => {
                report.busy += 1;
                if writers & (1 << usize::from(to_package)) != 0 {
                    if let Some(target) = if to_package { &r } else { &l } {
                        ledger.waits.insert(
                            id.clone(),
                            revision::Wait {
                                target: target.clone(),
                                to_package,
                                writers,
                            },
                        );
                        ledger_dirty = true;
                    }
                }
            }
            Err(error) if error == "dependency" => dependencies += 1,
            Err(error) => {
                check()?;
                report.conflicts += 1;
                attention(&id, "Codex history handoff needs attention", &error);
            }
        }
    }
    // Retry dependencies only after actual progress; a busy parent is woken by
    // its native writer-lock event, never by a periodic retry.
    report.more |= dependencies > 0 && report.copied > 0;
    // Persisted observations let later batches pass previously hashed revisions.
    // No progress means wait for native invalidation, never spin on Busy.
    report.more |= revision_deferred && (ledger_dirty || report.copied > 0);
    if ledger_dirty {
        check()?;
        save(journal, &ledger)?;
    }
    report.shared = ledger.pairs.len();
    report.pending = ledger.pending.len();
    Ok(report)
}

/// The newest unarchived primary conversations plus the frozen ancestors their
/// forks need; a fork outside this window could otherwise never publish.
fn recent_conversations(primary: &Path, rows: &BTreeMap<String, ThreadRecord>) -> BTreeSet<String> {
    let mut ordered = rows
        .values()
        .filter(|row| !row.archived())
        .collect::<Vec<_>>();
    ordered.sort_by(|a, b| {
        b.updated_at()
            .cmp(&a.updated_at())
            .then_with(|| b.id.cmp(&a.id))
    });
    let mut selected = BTreeSet::new();
    for row in ordered.into_iter().take(RECENT_CONVERSATIONS) {
        selected.insert(row.id.clone());
        if let Ok(segments) = lineage(primary, row) {
            selected.extend(segments.into_iter().map(|segment| segment.stable_id));
        }
    }
    selected
}

#[allow(clippy::too_many_arguments)]
fn prepare_copy(
    source_home: &Path,
    target_home: &Path,
    source: &ThreadRecord,
    target: Option<&ThreadRecord>,
    to_package: bool,
    native_default: &str,
    journal: &Path,
    divergence: Option<&(Version, Version)>,
    selected: &Revision,
    check: &impl Fn() -> Result<(), String>,
) -> Result<(Pending, Vec<WriterLock>), String> {
    let before = version(source_home, source)?;
    let target_before = target.map(|row| version(target_home, row)).transpose()?;
    let segments = lineage(source_home, source)?;
    for segment in &segments {
        if segment.stable_id != source.id
            && !store::list_threads(source_home, Some(std::slice::from_ref(&segment.stable_id)))?
                .is_empty()
            && store::list_threads(target_home, Some(std::slice::from_ref(&segment.stable_id)))?
                .is_empty()
        {
            return Err("dependency".into());
        }
    }
    // Never write a loaded destination. A loaded source is read-only here:
    // it can be snapshotted only at a complete native projection frontier.
    let mut native_locks = locks(&[target_home], &segments)?;
    if let Some(target) = target {
        let physical = files::physical_id(&target.rollout_path)?;
        if !segments
            .iter()
            .any(|segment| segment.id == physical || segment.stable_id == physical)
        {
            native_locks.push(WriterLock::acquire(target_home, &physical)?);
        }
    }
    let source_loaded = match locks(&[source_home], &segments) {
        Ok(locks) => {
            native_locks.extend(locks);
            false
        }
        Err(error) if error == "busy" => true,
        Err(error) => return Err(error),
    };
    check()?;
    if let Some((primary, package)) = divergence {
        let (expected_source, expected_target) = if to_package {
            (primary, package)
        } else {
            (package, primary)
        };
        if &before != expected_source
            || target
                .map(|r| version(target_home, r))
                .transpose()?
                .as_ref()
                != Some(expected_target)
        {
            return Err("busy".into());
        }
    }
    if version(source_home, source)? != before {
        return Err(if source_loaded {
            "busy"
        } else {
            "Codex source changed before snapshot"
        }
        .into());
    }
    let route_config = config_stamp(target_home)?;
    let (provider, default_model) = route(target_home, native_default)?;
    let (model, permission, approval) = if let Some(target) = target {
        let settings = target.routing_settings()?;
        (
            if settings.1 == provider {
                settings.0.unwrap_or(default_model)
            } else {
                default_model
            },
            settings.2,
            settings.3,
        )
    } else {
        (
            default_model,
            routing::conservative_permission_profile(),
            routing::conservative_approval_policy(),
        )
    };
    let prepared = store::prepare(
        source_home,
        &source.id,
        &segments.iter().map(|s| s.id.clone()).collect::<Vec<_>>(),
    )?;
    if prepared.record().metadata_hash != source.metadata_hash {
        return Err(if source_loaded {
            "busy"
        } else {
            "Codex source metadata changed"
        }
        .into());
    }
    let captured_files = segments
        .iter()
        .map(|segment| files::stamp(&segment.path))
        .collect::<Result<Vec<_>, _>>()?;
    if captured_files
        .iter()
        .try_fold(0_u64, |bytes, stamp| bytes.checked_add(stamp.len))
        .is_none_or(|bytes| bytes > revision::MAX_BYTES)
    {
        return Err("Codex lineage exceeds the bounded snapshot limit".into());
    }
    if source_loaded {
        if source.history_mode != "paginated" || !prepared.completed_rollouts()? {
            return Err("busy".into());
        }
        for (segment, stamp) in segments.iter().zip(&captured_files) {
            let projection = prepared
                .projections()
                .iter()
                .find(|p| p.rollout_id == segment.id)
                .ok_or("Missing source projection")?;
            let next = files::tail(&segment.path)?["ordinal"]
                .as_u64()
                .and_then(|v| v.checked_add(1));
            if projection
                .next_byte_offset
                .and_then(|v| u64::try_from(v).ok())
                != Some(stamp.len)
                || projection.next_ordinal.and_then(|v| u64::try_from(v).ok()) != next
                || next.is_none()
            {
                return Err("busy".into());
            }
        }
    }
    for projection in prepared.projections() {
        let segment = segments
            .iter()
            .find(|s| s.id == projection.rollout_id)
            .ok_or("Unknown Codex history projection")?;
        let size = files::stamp(&segment.path)?.len;
        if projection
            .next_byte_offset
            .is_some_and(|offset| offset < 0 || offset as u64 > size)
        {
            return Err("Codex history projection is ahead of its durable rollout".into());
        }
        if let Some(ordinal) = files::tail(&segment.path)?["ordinal"].as_u64() {
            if projection
                .next_ordinal
                .is_some_and(|next| next < 0 || next as u64 > ordinal.saturating_add(1))
            {
                return Err(
                    "Codex history projection ordinal is ahead of its durable rollout".into(),
                );
            }
        }
    }
    let mut staged = Vec::new();
    let mut dependencies = Vec::new();
    let mut revisions = None;
    let mut rollout_alias = None;
    let mut target_inventory = None;
    for segment in &segments {
        check()?;
        let relative = files::relative_rollout(source_home, &segment.path)?;
        let mut destination = target_home.join(relative);
        files::regular_path(&destination, true)?;
        let is_current = segment.path == source.rollout_path;
        // Physical identity spans both native discovery directories. A retained
        // generation may no longer be the current target row, or may live at
        // its earlier archive location. Never publish a second path for it.
        let inspect_retained = if is_current {
            target.is_none_or(|row| row.rollout_path.file_name() != destination.file_name())
        } else {
            !destination.exists()
        };
        if inspect_retained && target_inventory.is_none() {
            target_inventory = Some(files::inventory_with_check(target_home, check)?);
        }
        let retained = target_inventory
            .as_ref()
            .and_then(|inventory| inventory.get(&segment.id));
        let existing_ancestor = if is_current {
            None
        } else if destination.exists() {
            Some(destination.clone())
        } else {
            retained.cloned()
        };
        if let Some(existing) = existing_ancestor {
            if !same_prefix(
                &segment.path,
                &existing,
                segment.cutoff.ok_or("Missing Codex ancestor cutoff")?,
                check,
            )? {
                return Err("Codex fork ancestor differs between profiles".into());
            }
            let checkpoints = store::checkpoints(target_home, std::slice::from_ref(&segment.id))?;
            if checkpoints.first().is_none_or(|p| {
                p.next_byte_offset.is_none_or(|offset| {
                    offset < 0 || (offset as u64) < segment.cutoff.unwrap_or(0)
                }) || p.next_ordinal.is_none_or(|ordinal| {
                    ordinal < 0 || (ordinal as u64) < segment.cutoff_ordinal.unwrap_or(0)
                })
            }) {
                return Err(
                    "Codex fork ancestor projection has not reached its immutable prefix".into(),
                );
            }
            dependencies.push(Dependency {
                relative: files::relative_rollout(target_home, &existing)?,
                stamp: files::stamp(&existing)?,
                rollout_id: segment.id.clone(),
                cutoff: segment.cutoff.ok_or("Missing ancestor cutoff")?,
                ordinal: segment.cutoff_ordinal.ok_or("Missing ancestor ordinal")?,
            });
            continue;
        }
        let mut before_stamp = destination
            .exists()
            .then(|| files::stamp(&destination))
            .transpose()?;
        if is_current && target.is_none() && before_stamp.is_some() {
            return Err("Unregistered Codex history already exists at destination".into());
        }
        let source_stamp = files::stamp(&segment.path)?;
        if is_current && source_stamp != before.file {
            return Err(if source_loaded {
                "busy"
            } else {
                "Codex source changed before staging"
            }
            .into());
        }
        let temporary = files::stage_with_check(&segment.path, &destination, check)?;
        if is_current {
            let raw = revision::hash(temporary.path(), source_stamp.len, check)?;
            let metadata = prepared.record().revision_metadata_hash()?;
            let written_ns = selected.written_ns;
            let source_revision = Revision {
                raw,
                metadata: metadata.clone(),
                written_ns,
            };
            if !source_revision.same_data(selected) {
                return Err("busy".into());
            }
            let tail = files::tail(temporary.path())?;
            let ordinal = if source.history_mode == "paginated" {
                Some(
                    tail["ordinal"]
                        .as_u64()
                        .and_then(|v| v.checked_add(1))
                        .ok_or("Invalid Codex history ordinal")?,
                )
            } else {
                None
            };
            let event = routing::settings_event(
                &source.id,
                &model,
                &provider,
                &source.cwd,
                &permission,
                &approval,
                ordinal,
            )?;
            files::append(temporary.path(), &event)?;
            let target_revision = Revision {
                raw: revision::hash(temporary.path(), files::stamp(temporary.path())?.len, check)?,
                metadata,
                written_ns,
            };
            revisions = Some(if to_package {
                [source_revision, target_revision]
            } else {
                [target_revision, source_revision]
            });
        }
        // A path move can also replace the same physical rollout (archive /
        // unarchive), so test both discoverable locations before publication.
        let mut replace_prefix = is_current
            && retained.is_some_and(|path| {
                path != &destination
                    && target.is_none_or(|row| {
                        path != &row.rollout_path
                            || row.rollout_path.file_name() != destination.file_name()
                    })
            });
        if is_current {
            for existing in std::iter::once(destination.as_path()).chain(
                target
                    .filter(|row| row.rollout_path.file_name() == destination.file_name())
                    .map(|row| row.rollout_path.as_path()),
            ) {
                if existing.exists() {
                    let length = files::stamp(existing)?.len;
                    if files::stamp(temporary.path())?.len < length
                        || !same_prefix(temporary.path(), existing, length, check)?
                    {
                        replace_prefix = true;
                    }
                }
            }
        }
        if replace_prefix {
            // Fork reads do NOT honor Codex's parent writer lock. Any old
            // prefix may already be a frozen ancestor, even without a SQL root.
            // Keep that file immutable and publish a fresh physical rollout.
            // Bound retained generations without deleting any native ancestor.
            if target_inventory.is_none() {
                target_inventory = Some(files::inventory_with_check(target_home, check)?);
            }
            let inventory = target_inventory
                .as_ref()
                .ok_or("Missing Codex history generation inventory")?;
            if inventory.len() >= 4096 {
                return Err("Codex immutable history generation limit reached".into());
            }
            check()?;
            let alias = uuid::Uuid::new_v4().to_string();
            if inventory.contains_key(&alias)
                || segments
                    .iter()
                    .any(|s| s.id == alias || s.stable_id == alias)
            {
                return Err("Codex immutable history generation identity collision".into());
            }
            destination = target_home.join(files::alias_path(
                &files::relative_rollout(source_home, &segment.path)?,
                &alias,
            )?);
            files::regular_path(&destination, true)?;
            if destination.exists() {
                return Err("Codex history generation already exists".into());
            }
            native_locks.push(WriterLock::acquire(target_home, &alias)?);
            before_stamp = None;
            rollout_alias = Some(alias);
        }
        if files::stamp(&segment.path)? != source_stamp {
            return Err(if source_loaded {
                "busy"
            } else {
                "Codex source changed while staging"
            }
            .into());
        }
        let after = files::stamp(temporary.path())?;
        staged.push((
            temporary,
            PendingFile {
                source: segment.path.clone(),
                source_stamp,
                destination,
                before: before_stamp,
                staged: PathBuf::new(),
                after,
            },
        ));
    }
    check()?;
    let snapshots = journal
        .parent()
        .ok_or("Missing history journal")?
        .join("snapshots");
    files::regular_path(&snapshots, true)?;
    files::create_directories(&snapshots)?;
    let snapshot_dir = tempfile::Builder::new()
        .prefix("handoff-")
        .tempdir_in(&snapshots)
        .map_err(|_| "Cannot create history snapshot directory")?;
    let snapshot = snapshot_dir.path().join("snapshot.sqlite");
    prepared.persist_snapshot(&snapshot, check)?;
    let fresh_source = store::list_threads(source_home, Some(std::slice::from_ref(&source.id)))?
        .pop()
        .ok_or("Codex source disappeared while staging")?;
    if version(source_home, &fresh_source)? != before {
        return Err("busy".into());
    }
    let fresh_target = store::list_threads(target_home, Some(std::slice::from_ref(&source.id)))?
        .pop()
        .map(|row| version(target_home, &row))
        .transpose()?;
    if fresh_target != target_before {
        return Err("busy".into());
    }
    if source_loaded {
        // The source may have appended, reverted, renamed, or advanced its SQL
        // projection while copying. No artifact is published in that case.
        let fresh = store::prepare(
            source_home,
            &source.id,
            &segments.iter().map(|s| s.id.clone()).collect::<Vec<_>>(),
        )?;
        if fresh.record().metadata_hash != prepared.record().metadata_hash
            || fresh.record().rollout_path != prepared.record().rollout_path
            || fresh.projections() != prepared.projections()
            || !fresh.completed_rollouts()?
        {
            return Err("busy".into());
        }
        for (segment, stamp) in segments.iter().zip(&captured_files) {
            if files::stamp(&segment.path)? != *stamp {
                return Err("busy".into());
            }
        }
    }
    let mut files = Vec::new();
    for (temporary, mut entry) in staged {
        entry.staged = temporary
            .into_temp_path()
            .keep()
            .map_err(|_| "Cannot retain staged Codex history")?;
        files::sync_directory(
            entry
                .staged
                .parent()
                .ok_or("Missing staged history directory")?,
        )?;
        files.push(entry);
    }
    let _retained = snapshot_dir.keep();
    files::sync_directory(&snapshots)?;
    Ok((
        Pending {
            id: source.id.clone(),
            to_package,
            source: before,
            target: target_before,
            files,
            rollout_ids: segments.iter().map(|s| s.id.clone()).collect(),
            lock_ids: segments
                .iter()
                .flat_map(|s| [s.id.clone(), s.stable_id.clone()])
                .chain(rollout_alias.iter().cloned())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect(),
            snapshot,
            dependencies,
            route_config,
            provider,
            model,
            revisions,
            legacy_proofs: None,
            rollout_alias,
            cancelling: false,
        },
        native_locks,
    ))
}

/// The native app finished an interrupted publication for us when every file we
/// placed is still exactly our published copy and its projection frontier sits
/// at the end of that copy. Anything the native app appended since is real
/// divergence and stays a conflict.
fn natively_completed(
    target_home: &Path,
    pending: &Pending,
    existing: Option<&ThreadRecord>,
    destination: &Path,
) -> Result<bool, String> {
    let Some(existing) = existing else {
        return Ok(false);
    };
    if existing.rollout_path != destination {
        return Ok(false);
    }
    for entry in &pending.files {
        if !entry.destination.exists()
            || !files::stamp(&entry.destination)?.published_from(&entry.after)
        {
            return Ok(false);
        }
    }
    let rollout_id = files::physical_id(destination)?;
    let length = i64::try_from(files::stamp(destination)?.len)
        .map_err(|_| "Codex rollout exceeds native SQLite range")?;
    Ok(
        store::checkpoints(target_home, std::slice::from_ref(&rollout_id))?
            .first()
            .is_some_and(|checkpoint| checkpoint.next_byte_offset == Some(length)),
    )
}

fn cleanup_cancelled(
    source_home: &Path,
    target_home: &Path,
    journal: &Path,
    ledger: &mut Ledger,
    pending: &Pending,
    check: &impl Fn() -> Result<(), String>,
) -> Result<(), String> {
    let destination = target_home.join(match &pending.rollout_alias {
        Some(alias) => files::alias_path(&pending.source.path, alias)?,
        None => pending.source.path.clone(),
    });
    // First validate every owned temporary before removing any. Already absent
    // files are valid when resuming an interrupted cancellation.
    for entry in &pending.files {
        check()?;
        let relative = entry
            .source
            .strip_prefix(source_home)
            .map_err(|_| "Invalid cancelled Codex source")?;
        if !valid_relative(relative)
            || !pending.rollout_ids.contains(&files::physical_id(relative)?)
            || entry.destination
                != if relative == pending.source.path {
                    destination.clone()
                } else {
                    target_home.join(relative)
                }
            || entry.staged.parent() != entry.destination.parent()
            || !entry
                .staged
                .file_name()
                .and_then(|v| v.to_str())
                .is_some_and(|v| v.starts_with(".tmp"))
        {
            return Err("Invalid cancelled Codex artifact path".into());
        }
        files::regular_path(&entry.staged, true)?;
        files::regular_path(&entry.destination, true)?;
        if entry.staged.exists() && files::stamp(&entry.staged)? != entry.after {
            return Err("Cancelled Codex staging artifact changed".into());
        }
        // A cancellation must never consume or mask any published native file.
        if entry.destination.exists()
            && files::stamp(&entry.destination)?.published_from(&entry.after)
        {
            return Err("Cancelled Codex operation was already published".into());
        }
    }
    for entry in &pending.files {
        check()?;
        if entry.staged.exists() {
            if files::stamp(&entry.staged)? != entry.after {
                return Err("Cancelled Codex staging artifact changed".into());
            }
            fs::remove_file(&entry.staged)
                .map_err(|_| "Cannot clean obsolete Codex staged publication")?;
            files::sync_directory(entry.staged.parent().unwrap())?;
        }
    }
    check()?;
    files::regular_path(&pending.snapshot, true)?;
    if pending.snapshot.exists() {
        fs::remove_file(&pending.snapshot).map_err(|_| "Cannot clean obsolete Codex snapshot")?;
    }
    let directory = pending
        .snapshot
        .parent()
        .ok_or("Missing Codex snapshot parent")?;
    if directory.exists() {
        files::sync_directory(directory)?;
        fs::remove_dir(directory).map_err(|_| "Cannot clean obsolete Codex snapshot directory")?;
        files::sync_directory(directory.parent().unwrap())?;
    }
    check()?;
    ledger.pending.remove(&pending.id);
    ledger.observations.remove(&pending.id);
    ledger.waits.remove(&pending.id);
    save(journal, ledger)
}

fn finish(
    primary: &Path,
    package: &Path,
    journal: &Path,
    ledger: &mut Ledger,
    id: &str,
    check: &impl Fn() -> Result<(), String>,
) -> Result<(), String> {
    let pending = ledger
        .pending
        .get(id)
        .ok_or("Missing Codex history operation")?
        .clone();
    let (source_home, target_home) = if pending.to_package {
        (primary, package)
    } else {
        (package, primary)
    };
    let snapshots = journal
        .parent()
        .ok_or("Missing history journal")?
        .join("snapshots");
    if !valid_relative(&pending.source.path)
        || pending
            .target
            .as_ref()
            .is_some_and(|v| !valid_relative(&v.path))
        || pending.id != id
        || !files::valid_id(id)
        || pending.files.is_empty()
        || pending.files.len() > MAX_ANCESTORS
        || pending.rollout_ids.is_empty()
        || pending.rollout_ids.len() > MAX_ANCESTORS
        || pending.lock_ids.len() > MAX_ANCESTORS * 2 + 1
        || pending.dependencies.len() > MAX_ANCESTORS
        || !pending.lock_ids.iter().any(|v| v == id)
        || pending.rollout_alias.as_ref().is_some_and(|alias| {
            !files::valid_id(alias)
                || !pending.lock_ids.contains(alias)
                || pending.rollout_ids.contains(alias)
                || alias == id
        })
        || pending
            .snapshot
            .file_name()
            .is_none_or(|v| v != "snapshot.sqlite")
        || pending.snapshot.parent().and_then(Path::parent) != Some(snapshots.as_path())
        || !pending
            .snapshot
            .parent()
            .and_then(Path::file_name)
            .and_then(|v| v.to_str())
            .is_some_and(|v| v.starts_with("handoff-"))
    {
        return Err("Invalid Codex history recovery journal".into());
    }
    if pending.cancelling {
        cleanup_cancelled(source_home, target_home, journal, ledger, &pending, check)?;
        return Err("revision_changed".into());
    }
    if config_stamp(target_home)? != pending.route_config {
        return Err("Codex destination route changed during pending handoff".into());
    }
    // An already-present ancestor was deliberately not overwritten. Recovery
    // must confirm it still exists and covers the child's frozen lineage.
    for dependency in &pending.dependencies {
        check()?;
        if !valid_relative(&dependency.relative)
            || !pending.rollout_ids.contains(&dependency.rollout_id)
            || !pending.lock_ids.contains(&dependency.rollout_id)
            || files::stamp(&target_home.join(&dependency.relative))? != dependency.stamp
        {
            return Err("Codex fork ancestor changed during pending handoff".into());
        }
        let checkpoints =
            store::checkpoints(target_home, std::slice::from_ref(&dependency.rollout_id))?;
        if checkpoints.first().is_none_or(|p| {
            p.next_byte_offset
                .is_none_or(|v| v < 0 || (v as u64) < dependency.cutoff)
                || p.next_ordinal
                    .is_none_or(|v| v < 0 || (v as u64) < dependency.ordinal)
        }) {
            return Err("Codex fork ancestor projection changed during pending handoff".into());
        }
    }
    let prepared = store::PreparedThread::from_snapshot(&pending.snapshot)?;
    let source = prepared.record();
    if source.id != id
        || source.metadata_hash != pending.source.metadata
        || source.rollout_path != source_home.join(&pending.source.path)
    {
        return Err("Codex history snapshot disagrees with its journal".into());
    }
    let existing = store::list_threads(target_home, Some(std::slice::from_ref(&pending.id)))?.pop();
    let expected = existing.as_ref().map(|v| v.metadata_hash.as_str());
    let destination = target_home.join(match &pending.rollout_alias {
        Some(alias) => files::alias_path(&pending.source.path, alias)?,
        None => pending.source.path.clone(),
    });
    let published_metadata = prepared.metadata_at(&destination)?;
    let mut native_completed = false;
    if expected != pending.target.as_ref().map(|v| v.metadata.as_str())
        && expected != Some(published_metadata.as_str())
    {
        // A publication interrupted between rename and SQL leaves our file in
        // place. If the native app then opened the conversation, it projected
        // exactly that file and rewrote the row's own metadata. That is not
        // divergence: keep its projection and only bind the route.
        native_completed =
            natively_completed(target_home, &pending, existing.as_ref(), &destination)?;
        if !native_completed {
            return Err("Codex destination metadata changed during pending handoff".into());
        }
    }
    let mut unpublished = Vec::new();
    for entry in &pending.files {
        check()?;
        let relative = entry
            .source
            .strip_prefix(source_home)
            .map_err(|_| "Invalid Codex history source path")?;
        let rollout_id = files::physical_id(&entry.source)?;
        if !matches!(relative.components().next(), Some(std::path::Component::Normal(v)) if v == "sessions" || v == "archived_sessions")
            || relative.extension().is_none_or(|v| v != "jsonl")
            || !pending.rollout_ids.contains(&rollout_id)
            || !pending.lock_ids.contains(&rollout_id)
            || entry.destination
                != if relative == pending.source.path {
                    destination.clone()
                } else {
                    target_home.join(relative)
                }
            || entry.staged.parent() != entry.destination.parent()
            || !entry
                .staged
                .file_name()
                .and_then(|v| v.to_str())
                .is_some_and(|v| v.starts_with(".tmp"))
        {
            return Err("Invalid Codex history journal path".into());
        }
        files::regular_path(&entry.destination, true)?;
        let current = entry
            .destination
            .exists()
            .then(|| files::stamp(&entry.destination))
            .transpose()?;
        if current
            .as_ref()
            .is_some_and(|stamp| stamp.published_from(&entry.after))
        {
            continue;
        }
        if current != entry.before {
            return Err("Codex destination changed during pending handoff".into());
        }
        if files::stamp(&entry.staged)? != entry.after {
            return Err("Staged Codex history changed".into());
        }
        // A full prefix extension preserves every frozen native dependency.
        // No superseded conversation snapshot is copied into a backup.
        if let Some(current) = &current {
            if files::stamp(&entry.staged)?.len < current.len
                || !same_prefix(&entry.staged, &entry.destination, current.len, check)?
            {
                return Err("Codex history publication would replace a frozen prefix".into());
            }
        }
        unpublished.push(entry);
    }
    if unpublished.len() == pending.files.len() {
        // No native-visible publication has happened. A changed source invalidates
        // this selection; retire only this operation's verified private stages.
        let fresh = store::list_threads(source_home, Some(&[id.to_owned()]))?
            .pop()
            .map(|row| version(source_home, &row))
            .transpose()?;
        if fresh.as_ref() != Some(&pending.source) {
            check()?;
            ledger.pending.get_mut(id).unwrap().cancelling = true;
            save(journal, ledger)?;
            drop(prepared);
            let cancelled = ledger.pending[id].clone();
            cleanup_cancelled(source_home, target_home, journal, ledger, &cancelled, check)?;
            return Err("revision_changed".into());
        }
    }
    for entry in unpublished {
        check()?;
        let current = entry
            .destination
            .exists()
            .then(|| files::stamp(&entry.destination))
            .transpose()?;
        if current != entry.before || files::stamp(&entry.staged)? != entry.after {
            return Err("Codex publication changed after preflight".into());
        }
        fs::rename(&entry.staged, &entry.destination)
            .map_err(|_| "Cannot publish Codex history")?;
        files::sync_directory(entry.destination.parent().unwrap())?;
    }
    check()?;
    let imported = pending
        .files
        .iter()
        .map(|entry| files::physical_id(&entry.source))
        .collect::<Result<Vec<_>, _>>()?;
    if config_stamp(target_home)? != pending.route_config {
        return Err("Codex destination route changed before history publication".into());
    }
    let target = if native_completed {
        store::set_route(target_home, &pending.id, &pending.provider, &pending.model)?
    } else {
        prepared.apply_with_alias(
            target_home,
            &destination,
            &imported,
            &pending.provider,
            &pending.model,
            expected,
            pending
                .rollout_alias
                .as_ref()
                .map(|alias| (pending.rollout_ids.last().unwrap().as_str(), alias.as_str())),
            check,
        )?
    };
    check()?;
    // Archive/revert moves the current pointer. Retain the old artifact as an
    // immutable ancestor when its rollout id differs; otherwise remove the
    // duplicate discovery path once the same physical file is discoverable there.
    if let Some(old) = &pending.target {
        let old_path = target_home.join(&old.path);
        if old_path != destination
            && old_path.file_name() == destination.file_name()
            && old_path.exists()
        {
            files::relative_rollout(target_home, &old_path)?;
            if files::stamp(&old_path)? != old.file {
                return Err("Codex old rollout changed during archive".into());
            }
            check()?;
            // Same physical ID remains fully present at its new discoverable
            // path. Remove only the duplicate directory entry, never a distinct
            // generation. No old snapshot backup is created.
            fs::remove_file(&old_path).map_err(|_| "Cannot remove duplicate Codex archive path")?;
            files::sync_directory(old_path.parent().unwrap())?;
        }
    }
    let source_version = pending.source.clone();
    let target_version = version(target_home, &target)?;
    let revisions = if let Some(mut revisions) = pending.revisions.clone() {
        revisions[usize::from(pending.to_package)].metadata = target.revision_metadata_hash()?;
        Some(revisions)
    } else {
        // Recover a v2/v3 publication from its immutable selected snapshot. The
        // original source prefix is still present before our appended route.
        let entry = pending
            .files
            .iter()
            .find(|entry| entry.source == source.rollout_path)
            .ok_or("Missing current Codex recovery file")?;
        let written_ns = revision::valid_time(pending.source.file.modified_ns())?;
        let source_revision = Revision {
            raw: revision::hash(&destination, entry.source_stamp.len, check)?,
            metadata: source.revision_metadata_hash()?,
            written_ns,
        };
        let target_revision = Revision {
            raw: revision::hash(&destination, target_version.file.len, check)?,
            metadata: target.revision_metadata_hash()?,
            written_ns,
        };
        Some(if pending.to_package {
            [source_revision, target_revision]
        } else {
            [target_revision, source_revision]
        })
    };
    let pair = if pending.to_package {
        Pair {
            primary: source_version,
            package: target_version,
            revisions,
            legacy_proofs: None,
        }
    } else {
        Pair {
            primary: target_version,
            package: source_version,
            revisions,
            legacy_proofs: None,
        }
    };
    check()?;
    ledger.pairs.insert(pending.id.clone(), pair);
    ledger.pending.remove(&pending.id);
    ledger.observations.remove(&pending.id);
    ledger.waits.remove(&pending.id);
    save(journal, ledger)?;
    // Cleanup only after the ledger no longer needs the immutable snapshot.
    let _ = fs::remove_file(&pending.snapshot);
    let _ = fs::remove_dir(pending.snapshot.parent().unwrap());
    Ok(())
}
