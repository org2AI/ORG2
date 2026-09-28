//! Whole-session raw last-write-wins publication. Receipts distinguish native
//! revisions from our own copies; journals contain only publication evidence.
use super::super::write_file_atomically;
use super::{Budget, Status, records};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

const MAX_FILE: u64 = 16 * 1024 * 1024;
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Fingerprint {
    len: usize,
    hash: String,
}
impl Fingerprint {
    fn of(bytes: &[u8]) -> Self {
        Self {
            len: bytes.len(),
            hash: format!("{:x}", Sha256::digest(bytes)),
        }
    }
    fn valid(&self) -> bool {
        self.len > 0
            && self.len as u64 <= MAX_FILE
            && self.hash.len() == 64
            && self
                .hash
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    }
    fn prefix(&self, bytes: &[u8]) -> bool {
        bytes
            .get(..self.len)
            .is_some_and(|part| Self::of(part) == *self)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Observed {
    content: Fingerprint,
    native_ns: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Receipt {
    version: u8,
    binding: String,
    generation: u64,
    primary: Observed,
    package: Observed,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Journal {
    version: u8,
    binding: String,
    to_primary: bool,
    before: Option<Fingerprint>,
    source: Observed,
    next: Receipt,
}
// Migration reads the old byte baselines, not the removed projection language.
// Their hashes identify accepted physical prefixes even when both views differ.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyReceipt {
    version: u8,
    binding: String,
    generation: u64,
    primary: Fingerprint,
    package: Fingerprint,
    ledger: Vec<serde_json::Value>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyJournal {
    to_primary: bool,
    before: Fingerprint,
    after: Fingerprint,
    next: LegacyReceipt,
}
#[derive(Clone, Debug, PartialEq, Eq)]
struct Stamp {
    len: u64,
    modified_ns: u64,
    #[cfg(unix)]
    dev: u64,
    #[cfg(unix)]
    ino: u64,
    #[cfg(unix)]
    changed: (i64, i64),
}
impl Stamp {
    fn read_with_links(metadata: &fs::Metadata, links: u64) -> Result<Self, Status> {
        #[cfg(not(unix))]
        let _ = links;
        if !metadata.is_file() {
            return Err(Status::Changed);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if metadata.nlink() != links || metadata.uid() != unsafe { libc::geteuid() } {
                return Err(Status::Changed);
            }
        }
        let modified_ns = metadata
            .modified()
            .map_err(|_| Status::Changed)?
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| Status::Changed)?
            .as_nanos()
            .try_into()
            .map_err(|_| Status::Changed)?;
        #[cfg(unix)]
        use std::os::unix::fs::MetadataExt;
        Ok(Self {
            len: metadata.len(),
            modified_ns,
            #[cfg(unix)]
            dev: metadata.dev(),
            #[cfg(unix)]
            ino: metadata.ino(),
            #[cfg(unix)]
            changed: (metadata.ctime(), metadata.ctime_nsec()),
        })
    }
}
struct Snapshot {
    bytes: Vec<u8>,
    content: Fingerprint,
    stamp: Stamp,
}
impl Snapshot {
    fn observed(&self, previous: Option<&Observed>) -> Result<Observed, Status> {
        if let Some(previous) = previous.filter(|old| old.content == self.content) {
            return Ok(previous.clone());
        }
        valid_native_time(self.stamp.modified_ns)?;
        Ok(Observed {
            content: self.content.clone(),
            native_ns: self.stamp.modified_ns,
        })
    }
}
fn now_ns() -> Result<u64, Status> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| Status::Changed)?
        .as_nanos()
        .try_into()
        .map_err(|_| Status::Changed)
}
fn valid_native_time(value: u64) -> Result<(), Status> {
    if value == 0 || value > now_ns()? {
        Err(Status::Changed)
    } else {
        Ok(())
    }
}
fn valid_receipt(value: &Receipt, binding: &str) -> Result<(), Status> {
    if value.version != 3 || value.binding != binding {
        return Err(Status::Conflict);
    }
    let now = now_ns()?;
    if [&value.primary, &value.package]
        .iter()
        .any(|observed| !observed.content.valid() || observed.native_ns > now)
    {
        return Err(Status::Unsupported);
    }
    Ok(())
}
fn snapshot(path: &Path, max: u64, budget: &Budget) -> Result<Snapshot, Status> {
    snapshot_with_links(path, max, budget, 1)
}
fn snapshot_with_links(
    path: &Path,
    max: u64,
    budget: &Budget,
    links: u64,
) -> Result<Snapshot, Status> {
    budget.check()?;
    safe(path.parent().ok_or(Status::Changed)?, path)?;
    let before = Stamp::read_with_links(
        &fs::symlink_metadata(path).map_err(|_| Status::Changed)?,
        links,
    )?;
    if before.len > max {
        return Err(Status::Limit);
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options.open(path).map_err(|_| Status::Changed)?;
    if Stamp::read_with_links(&file.metadata().map_err(|_| Status::Changed)?, links)? != before {
        return Err(Status::Changed);
    }
    let mut bytes = Vec::new();
    let mut chunk = [0; 64 * 1024];
    loop {
        budget.check()?;
        let count = file.read(&mut chunk).map_err(|_| Status::Failed)?;
        if count == 0 {
            break;
        }
        budget.charge(count as u64)?;
        if bytes.len() as u64 + count as u64 > max {
            return Err(Status::Limit);
        }
        bytes.extend_from_slice(&chunk[..count]);
    }
    if bytes.len() as u64 != before.len
        || Stamp::read_with_links(&file.metadata().map_err(|_| Status::Changed)?, links)? != before
        || Stamp::read_with_links(
            &fs::symlink_metadata(path).map_err(|_| Status::Changed)?,
            links,
        )? != before
    {
        return Err(Status::Changed);
    }
    Ok(Snapshot {
        content: Fingerprint::of(&bytes),
        bytes,
        stamp: before,
    })
}
fn optional_snapshot(path: &Path, budget: &Budget) -> Result<Option<Snapshot>, Status> {
    if !path.try_exists().map_err(|_| Status::Failed)? {
        return Ok(None);
    }
    snapshot(path, MAX_FILE, budget).map(Some)
}
fn recheck(path: &Path, expected: Option<&Snapshot>, budget: &Budget) -> Result<(), Status> {
    let current = optional_snapshot(path, budget)?;
    match (expected, current) {
        (None, None) => Ok(()),
        (Some(before), Some(after))
            if before.stamp == after.stamp && before.content == after.content =>
        {
            Ok(())
        }
        _ => Err(Status::Changed),
    }
}
pub(super) fn safe(root: &Path, path: &Path) -> Result<(), Status> {
    if !root.is_absolute()
        || !path.is_absolute()
        || root
            .components()
            .chain(path.components())
            .any(|part| matches!(part, std::path::Component::ParentDir))
        || !path.starts_with(root)
    {
        return Err(Status::Changed);
    }
    for part in path.ancestors() {
        match fs::symlink_metadata(part) {
            Ok(m) if m.file_type().is_symlink() => return Err(Status::Changed),
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(Status::Failed),
        }
    }
    Ok(())
}
fn read(path: &Path, max: u64, budget: &Budget) -> Result<Vec<u8>, Status> {
    Ok(snapshot(path, max, budget)?.bytes)
}

fn write(path: &Path, bytes: &[u8]) -> Result<(), Status> {
    safe(path.parent().ok_or(Status::Changed)?, path)?;
    write_file_atomically(path, "handoff.tmp", "Claude history handoff", |file| {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(fs::Permissions::from_mode(0o600))
                .map_err(|e| e.to_string())?;
        }
        file.write_all(bytes).map_err(|e| e.to_string())
    })
    .map_err(|_| Status::Failed)
}
fn save<T: Serialize>(path: &Path, value: &T) -> Result<(), Status> {
    write(
        path,
        &serde_json::to_vec(value).map_err(|_| Status::Failed)?,
    )
}
fn save_changed<T: Serialize>(path: &Path, value: &T, budget: &Budget) -> Result<(), Status> {
    let bytes = serde_json::to_vec(value).map_err(|_| Status::Failed)?;
    if path.try_exists().map_err(|_| Status::Failed)? && read(path, 128 * 1024, budget)? == bytes {
        return Ok(());
    }
    write(path, &bytes)
}
fn remove_stage(path: &Path, expected: &Fingerprint, budget: &Budget) -> Result<(), Status> {
    if let Some(current) = optional_snapshot(path, budget)? {
        if current.content != *expected {
            return Err(Status::Conflict);
        }
        remove(path)?;
    }
    Ok(())
}
fn load<T: serde::de::DeserializeOwned>(path: &Path, budget: &Budget) -> Result<Option<T>, Status> {
    if !path.try_exists().map_err(|_| Status::Failed)? {
        return Ok(None);
    }
    serde_json::from_slice(&read(path, 128 * 1024, budget)?)
        .map(Some)
        .map_err(|_| Status::Unsupported)
}

/// Same stable adjacent lock as materialization, but never block the worker.
pub(super) fn try_lock(path: &Path) -> Result<fs::File, Status> {
    let lock = path.with_file_name(format!(
        ".{}.orgii.lock",
        path.file_name()
            .ok_or(Status::Changed)?
            .to_str()
            .ok_or(Status::Changed)?
    ));
    try_lock_file(&lock)
}

pub(super) fn try_catalog_lock(directory: &Path) -> Result<fs::File, Status> {
    try_lock_file(&directory.join(".orgii-sessions-index.lock"))
}

fn try_lock_file(lock: &Path) -> Result<fs::File, Status> {
    safe(lock.parent().ok_or(Status::Changed)?, lock)?;
    let mut options = fs::OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    let file = options.open(lock).map_err(|_| Status::Changed)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let metadata = file.metadata().map_err(|_| Status::Changed)?;
        if !metadata.is_file()
            || metadata.nlink() != 1
            || metadata.uid() != unsafe { libc::geteuid() }
        {
            return Err(Status::Changed);
        }
    }
    file.try_lock().map_err(|_| Status::Busy)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let opened = file.metadata().map_err(|_| Status::Changed)?;
        let current_path = fs::symlink_metadata(lock).map_err(|_| Status::Changed)?;
        if !current_path.is_file()
            || current_path.ino() != opened.ino()
            || current_path.dev() != opened.dev()
            || opened.nlink() != 1
            || opened.uid() != unsafe { libc::geteuid() }
        {
            return Err(Status::Changed);
        }
    }
    Ok(file)
}
pub(super) fn catalog_row(
    path: &Path,
    budget: &Budget,
) -> Result<Option<serde_json::Value>, Status> {
    budget.check()?;
    if path.extension().and_then(|p| p.to_str()) != Some("json") || !path.is_file() {
        return Ok(None);
    }
    let bytes = read(
        path,
        super::super::CLAUDE_DESKTOP_METADATA_MAX_BYTES,
        budget,
    )?;
    Ok(serde_json::from_slice::<serde_json::Value>(&bytes)
        .ok()
        .filter(|r| r.is_object()))
}

pub(super) struct Scope<'a> {
    pub binding: &'a str,
    pub cwd: &'a Path,
}
fn binding(
    primary: &Path,
    package: &Path,
    session: &str,
    scope: Option<&str>,
) -> Result<String, Status> {
    Ok(format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&(primary, package, session, scope)).map_err(|_| Status::Failed)?
        )
    ))
}
fn state_directory(root: &Path) -> Result<(), Status> {
    safe(root, root)?;
    fs::create_dir_all(root).map_err(|_| Status::Failed)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(root, fs::Permissions::from_mode(0o700)).map_err(|_| Status::Failed)?;
    }
    Ok(())
}
fn remove(path: &Path) -> Result<(), Status> {
    safe(path.parent().ok_or(Status::Changed)?, path)?;
    match fs::remove_file(path) {
        Ok(()) => sync_parent(path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(Status::Failed),
    }
}
fn sync_parent(path: &Path) -> Result<(), Status> {
    fs::File::open(path.parent().ok_or(Status::Changed)?)
        .and_then(|file| file.sync_all())
        .map_err(|_| Status::Failed)
}
fn stage_path(destination: &Path, binding: &str) -> Result<PathBuf, Status> {
    Ok(destination.with_file_name(format!(
        ".{}.{}.lww-new.jsonl",
        destination
            .file_name()
            .and_then(|v| v.to_str())
            .ok_or(Status::Changed)?,
        binding
    )))
}
// A no-clobber publish uses a hard link, followed by unlinking the new-content
// stage. Recover only that exact two-name inode if a crash split those steps.
fn recover_linked_publication(
    primary: &Path,
    package: &Path,
    pending_path: &Path,
    binding: &str,
    budget: &Budget,
    guard: &impl Fn() -> Result<(), Status>,
) -> Result<(), Status> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let Some(value) = load::<serde_json::Value>(pending_path, budget)? else {
            return Ok(());
        };
        if value["version"] != 3 {
            return Ok(());
        }
        let pending: Journal = serde_json::from_value(value).map_err(|_| Status::Unsupported)?;
        if pending.before.is_some() {
            return Ok(());
        }
        valid_receipt(&pending.next, binding)?;
        valid_native_time(pending.source.native_ns)?;
        if pending.binding != binding
            || pending.next.primary != pending.source
            || pending.next.package != pending.source
        {
            return Err(Status::Conflict);
        }
        let target = if pending.to_primary { primary } else { package };
        let Some(metadata) = fs::symlink_metadata(target).ok() else {
            return Ok(());
        };
        if metadata.nlink() != 2 {
            return Ok(());
        }
        let staged = stage_path(target, binding)?;
        let target_snapshot = snapshot_with_links(target, MAX_FILE, budget, 2)?;
        let stage_snapshot = snapshot_with_links(&staged, MAX_FILE, budget, 2)?;
        if target_snapshot.stamp != stage_snapshot.stamp
            || target_snapshot.content != pending.source.content
        {
            return Err(Status::Conflict);
        }
        guard()?;
        if Stamp::read_with_links(
            &fs::symlink_metadata(target).map_err(|_| Status::Changed)?,
            2,
        )? != target_snapshot.stamp
            || Stamp::read_with_links(
                &fs::symlink_metadata(&staged).map_err(|_| Status::Changed)?,
                2,
            )? != stage_snapshot.stamp
        {
            return Err(Status::Changed);
        }
        remove(&staged)?;
    }
    #[cfg(not(unix))]
    let _ = (primary, package, pending_path, binding, budget, guard);
    Ok(())
}
fn legacy_receipt(
    value: LegacyReceipt,
    binding: &str,
    a: &Snapshot,
    b: &Snapshot,
) -> Result<Receipt, Status> {
    if value.version != 2
        || !value.primary.valid()
        || !value.package.valid()
        || value.binding != binding
        || value.ledger.len() > 128
        || !value.primary.prefix(&a.bytes)
        || !value.package.prefix(&b.bytes)
    {
        return Err(Status::Conflict);
    }
    // Old copies have no reliable native timestamps. Keep each accepted hash
    // independently; only a real subsequent content change can supersede it.
    Ok(Receipt {
        version: 3,
        binding: binding.to_owned(),
        generation: value.generation,
        primary: Observed {
            content: value.primary,
            native_ns: 0,
        },
        package: Observed {
            content: value.package,
            native_ns: 0,
        },
    })
}
fn receipt(
    path: &Path,
    binding: &str,
    a: Option<&Snapshot>,
    b: Option<&Snapshot>,
    budget: &Budget,
) -> Result<Option<Receipt>, Status> {
    let Some(value) = load::<serde_json::Value>(path, budget)? else {
        return Ok(None);
    };
    match value["version"].as_u64() {
        Some(3) => {
            let receipt: Receipt =
                serde_json::from_value(value).map_err(|_| Status::Unsupported)?;
            valid_receipt(&receipt, binding)?;
            Ok(Some(receipt))
        }
        Some(2) => Ok(Some(legacy_receipt(
            serde_json::from_value(value).map_err(|_| Status::Unsupported)?,
            binding,
            a.ok_or(Status::Changed)?,
            b.ok_or(Status::Changed)?,
        )?)),
        _ => Err(Status::Unsupported),
    }
}
#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(super) fn reconcile(
    primary_root: &Path,
    primary: &Path,
    package_root: &Path,
    package: &Path,
    state_root: &Path,
    session: &str,
    budget: &Budget,
    guard: &impl Fn() -> Result<(), Status>,
) -> Result<Status, Status> {
    reconcile_inner(
        primary_root,
        primary,
        package_root,
        package,
        state_root,
        session,
        budget,
        guard,
        None,
    )
}
#[allow(clippy::too_many_arguments)]
pub(super) fn reconcile_scoped(
    primary_root: &Path,
    primary: &Path,
    package_root: &Path,
    package: &Path,
    state_root: &Path,
    session: &str,
    budget: &Budget,
    guard: &impl Fn() -> Result<(), Status>,
    scope: Scope<'_>,
) -> Result<Status, Status> {
    if !scope.cwd.is_absolute()
        || scope
            .cwd
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err(Status::ScopeChanged);
    }
    reconcile_inner(
        primary_root,
        primary,
        package_root,
        package,
        state_root,
        session,
        budget,
        guard,
        Some(scope.binding),
    )
}
#[allow(clippy::too_many_arguments)]
fn reconcile_inner(
    primary_root: &Path,
    primary: &Path,
    package_root: &Path,
    package: &Path,
    state_root: &Path,
    session: &str,
    budget: &Budget,
    guard: &impl Fn() -> Result<(), Status>,
    scope: Option<&str>,
) -> Result<Status, Status> {
    budget.check()?;
    guard()?;
    safe(primary_root, primary)?;
    safe(package_root, package)?;
    safe(state_root, state_root)?;
    let binding = binding(primary, package, session, scope)?;
    let state = state_root.join(format!("{binding}.json"));
    let pending_path = state_root.join(format!("{binding}.pending.json"));
    for path in [primary, package] {
        fs::create_dir_all(path.parent().ok_or(Status::Changed)?).map_err(|_| Status::Failed)?;
    }
    let _primary_lock = try_lock(primary)?;
    let _package_lock = try_lock(package)?;
    recover_linked_publication(primary, package, &pending_path, &binding, budget, guard)?;
    let a = optional_snapshot(primary, budget)?;
    let b = optional_snapshot(package, budget)?;
    for observed in [&a, &b].into_iter().flatten() {
        records::validate(&observed.bytes, session, budget)?;
    }
    if a.is_none() && b.is_none() {
        return Err(Status::Changed);
    }
    let mut baseline = receipt(&state, &binding, a.as_ref(), b.as_ref(), budget)?;
    if let Some(value) = load::<serde_json::Value>(&pending_path, budget)? {
        if value.get("version").is_none() {
            // Old v2 transaction: complete only a proven publication, or cancel
            // a proven uncommitted operation with a verified prior baseline.
            let pending: LegacyJournal =
                serde_json::from_value(value).map_err(|_| Status::Unsupported)?;
            let (target, source) = if pending.to_primary {
                (a.as_ref(), b.as_ref())
            } else {
                (b.as_ref(), a.as_ref())
            };
            let target = target.ok_or(Status::Conflict)?;
            let source = source.ok_or(Status::Conflict)?;
            let expected_source = if pending.to_primary {
                &pending.next.package
            } else {
                &pending.next.primary
            };
            let expected_target = if pending.to_primary {
                &pending.next.primary
            } else {
                &pending.next.package
            };
            if pending.next.binding != binding
                || &pending.after != expected_target
                || source.content != *expected_source
            {
                return Err(Status::Conflict);
            }
            if target.content == pending.after {
                baseline = Some(legacy_receipt(
                    pending.next,
                    &binding,
                    a.as_ref().ok_or(Status::Conflict)?,
                    b.as_ref().ok_or(Status::Conflict)?,
                )?);
            } else if target.content != pending.before || baseline.is_none() {
                return Err(Status::Conflict);
            }
            guard()?;
            recheck(primary, a.as_ref(), budget)?;
            recheck(package, b.as_ref(), budget)?;
            state_directory(state_root)?;
            if let Some(ref accepted) = baseline {
                save(&state, accepted)?;
            }
            remove(&pending_path)?;
        } else {
            let pending: Journal =
                serde_json::from_value(value).map_err(|_| Status::Unsupported)?;
            if pending.version != 3
                || pending.binding != binding
                || pending.next.version != 3
                || pending.next.binding != binding
                || pending.next.primary != pending.source
                || pending.next.package != pending.source
            {
                return Err(Status::Conflict);
            }
            valid_receipt(&pending.next, &binding)?;
            valid_native_time(pending.source.native_ns)?;
            if pending.before.as_ref().is_some_and(|value| !value.valid()) {
                return Err(Status::Unsupported);
            }
            let target = if pending.to_primary {
                a.as_ref()
            } else {
                b.as_ref()
            };
            let current = target.map(|value| &value.content);
            if current == Some(&pending.source.content) {
                // Publication is already visible. Adopting the receipt changes
                // no native data; a newer source edit is reconciled below.
                baseline = Some(pending.next);
            } else if current != pending.before.as_ref() {
                // A completed native edit may supersede an interrupted choice.
                // A reliable prior receipt lets LWW compare the current raw
                // revisions; do not assign the discarded winner's clock to them.
                let accepted = baseline.as_ref().ok_or(Status::Conflict)?;
                a.as_ref()
                    .ok_or(Status::Conflict)?
                    .observed(Some(&accepted.primary))?;
                b.as_ref()
                    .ok_or(Status::Conflict)?
                    .observed(Some(&accepted.package))?;
            }
            guard()?;
            recheck(primary, a.as_ref(), budget)?;
            recheck(package, b.as_ref(), budget)?;
            state_directory(state_root)?;
            if let Some(ref accepted) = baseline {
                save(&state, accepted)?;
            }
            remove_stage(
                &stage_path(if pending.to_primary { primary } else { package }, &binding)?,
                &pending.source.content,
                budget,
            )?;
            remove(&pending_path)?;
        }
    }
    // A missing previously accepted side may be a deliberate native deletion.
    // Initial registration can create missing data; sync does not resurrect it.
    if baseline.is_some() && (a.is_none() || b.is_none()) {
        return Err(Status::Changed);
    }
    let left = a
        .as_ref()
        .map(|value| value.observed(baseline.as_ref().map(|r| &r.primary)))
        .transpose()?;
    let right = b
        .as_ref()
        .map(|value| value.observed(baseline.as_ref().map(|r| &r.package)))
        .transpose()?;
    let same = left
        .as_ref()
        .zip(right.as_ref())
        .is_some_and(|(a, b)| a.content == b.content);
    let left_changed = left.as_ref().is_some_and(|v| {
        baseline
            .as_ref()
            .is_none_or(|old| old.primary.content != v.content)
    });
    let right_changed = right.as_ref().is_some_and(|v| {
        baseline
            .as_ref()
            .is_none_or(|old| old.package.content != v.content)
    });
    if same || (!left_changed && !right_changed) {
        guard()?;
        recheck(primary, a.as_ref(), budget)?;
        recheck(package, b.as_ref(), budget)?;
        state_directory(state_root)?;
        save_changed(
            &state,
            &Receipt {
                version: 3,
                binding,
                generation: baseline.as_ref().map_or(0, |r| r.generation),
                primary: left.ok_or(Status::Changed)?,
                package: right.ok_or(Status::Changed)?,
            },
            budget,
        )?;
        return Ok(Status::Clean);
    }
    let to_primary = match (&left, &right, left_changed, right_changed) {
        (None, Some(_), _, _) => true,
        (Some(_), None, _, _) => false,
        (_, _, true, false) => false,
        (_, _, false, true) => true,
        (Some(a), Some(b), _, _) => b.native_ns > a.native_ns,
        _ => return Err(Status::Changed),
    };
    let (source, target, destination, winner) = if to_primary {
        (
            b.as_ref().ok_or(Status::Changed)?,
            a.as_ref(),
            primary,
            right.ok_or(Status::Changed)?,
        )
    } else {
        (
            a.as_ref().ok_or(Status::Changed)?,
            b.as_ref(),
            package,
            left.ok_or(Status::Changed)?,
        )
    };
    guard()?;
    state_directory(state_root)?;
    let next = Receipt {
        version: 3,
        binding: binding.clone(),
        generation: baseline.map_or(Ok(1), |r| r.generation.checked_add(1).ok_or(Status::Limit))?,
        primary: winner.clone(),
        package: winner.clone(),
    };
    let pending = Journal {
        version: 3,
        binding: binding.clone(),
        to_primary,
        before: target.map(|value| value.content.clone()),
        source: winner,
        next,
    };
    // Journal first: even a crash during staging leaves one bounded, owned
    // new-content path whose identity is derived from this transaction.
    let staged = stage_path(destination, &binding)?;
    if staged.try_exists().map_err(|_| Status::Failed)? {
        return Err(Status::Conflict);
    }
    save(&pending_path, &pending)?;
    if !create_checked(&staged, &source.bytes, guard)? {
        return Err(Status::Conflict);
    }
    guard()?;
    recheck(primary, a.as_ref(), budget)?;
    recheck(package, b.as_ref(), budget)?;
    if snapshot(&staged, MAX_FILE, budget)?.content != source.content {
        return Err(Status::Changed);
    }
    guard()?;
    if target.is_none() {
        // Atomic no-clobber creation; a late native creator always wins.
        fs::hard_link(&staged, destination).map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                Status::Changed
            } else {
                Status::Failed
            }
        })?;
        remove(&staged)?;
    } else {
        fs::rename(&staged, destination).map_err(|_| Status::Failed)?;
    }
    sync_parent(destination)?;
    guard()?;
    if snapshot(destination, MAX_FILE, budget)?.content != source.content {
        return Err(Status::Changed);
    }
    recheck(
        if to_primary { package } else { primary },
        Some(source),
        budget,
    )?;
    save(&state, &pending.next)?;
    remove(&pending_path)?;
    Ok(if to_primary {
        Status::SyncedToPrimary
    } else {
        Status::SyncedToPackage
    })
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Registration {
    version: u8,
    catalog: Fingerprint,
    next: Receipt,
}
pub(super) fn registration_pending(
    primary: &Path,
    package: &Path,
    state_root: &Path,
    session: &str,
    scope: &str,
) -> Result<bool, Status> {
    let path = state_root.join(format!(
        "{}.register.json",
        binding(primary, package, session, Some(scope))?
    ));
    safe(state_root, &path)?;
    path.try_exists().map_err(|_| Status::Failed)
}
fn create_checked(
    path: &Path,
    bytes: &[u8],
    check: &impl Fn() -> Result<(), Status>,
) -> Result<bool, Status> {
    safe(path.parent().ok_or(Status::Changed)?, path)?;
    let failure = std::cell::Cell::new(None);
    super::super::create_file_atomically_checked(
        path,
        "Claude conversation registration",
        &|| {
            check().map_err(|error| {
                failure.set(Some(error));
                "Claude registration changed".to_owned()
            })
        },
        |file| {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                file.set_permissions(fs::Permissions::from_mode(0o600))
                    .map_err(|e| e.to_string())?;
            }
            file.write_all(bytes).map_err(|e| e.to_string())
        },
    )
    .map_err(|_| failure.get().unwrap_or(Status::Failed))
}
/// Register one raw conversation. Target catalog metadata is independently
/// constructed with local defaults; no source credentials/permissions are copied.
#[allow(clippy::too_many_arguments)]
pub(super) fn register_new(
    primary_root: &Path,
    primary: &Path,
    package_root: &Path,
    package: &Path,
    state_root: &Path,
    catalog: &Path,
    catalog_row: &serde_json::Value,
    session: &str,
    budget: &Budget,
    guard: &impl Fn() -> Result<(), Status>,
    scope: Scope<'_>,
) -> Result<(), Status> {
    budget.check()?;
    guard()?;
    safe(primary_root, primary)?;
    safe(package_root, package)?;
    safe(state_root, state_root)?;
    safe(catalog.parent().ok_or(Status::Changed)?, catalog)?;
    fs::create_dir_all(primary.parent().ok_or(Status::Changed)?).map_err(|_| Status::Failed)?;
    let _primary_lock = try_lock(primary)?;
    let _package_lock = try_lock(package)?;
    let _catalog_lock = try_lock(catalog)?;
    let source = snapshot(package, MAX_FILE, budget)?;
    records::validate(&source.bytes, session, budget)?;
    let binding = binding(primary, package, session, Some(scope.binding))?;
    let state = state_root.join(format!("{binding}.json"));
    let pending_path = state_root.join(format!("{binding}.register.json"));
    let metadata = serde_json::to_vec(catalog_row).map_err(|_| Status::Unsupported)?;
    let observation = source.observed(None)?;
    let next = Receipt {
        version: 3,
        binding: binding.clone(),
        generation: 0,
        primary: observation.clone(),
        package: observation,
    };
    let prior = load::<serde_json::Value>(&pending_path, budget)?;
    let next = if let Some(value) = &prior {
        // Old registration may have published a transformed body. Keep its
        // transaction and evidence intact; never silently adopt or replay it.
        if value["version"] != 2 {
            return Err(Status::Unsupported);
        }
        let pending: Registration =
            serde_json::from_value(value.clone()).map_err(|_| Status::Unsupported)?;
        if pending.next.version != 3
            || pending.next.binding != binding
            || pending.catalog != Fingerprint::of(&metadata)
            || pending.next.primary.content != source.content
            || pending.next.package != pending.next.primary
        {
            return Err(Status::Conflict);
        }
        valid_receipt(&pending.next, &binding)?;
        valid_native_time(pending.next.primary.native_ns)?;
        pending.next
    } else {
        if primary.try_exists().map_err(|_| Status::Failed)?
            || catalog.try_exists().map_err(|_| Status::Failed)?
            || state.try_exists().map_err(|_| Status::Failed)?
        {
            return Err(Status::Conflict);
        }
        guard()?;
        state_directory(state_root)?;
        save(
            &pending_path,
            &Registration {
                version: 2,
                catalog: Fingerprint::of(&metadata),
                next: next.clone(),
            },
        )?;
        next
    };
    let check_source = || {
        budget.check()?;
        guard()?;
        recheck(package, Some(&source), budget)
    };
    check_source()?;
    if !create_checked(primary, &source.bytes, &check_source)?
        && (prior.is_none() || snapshot(primary, MAX_FILE, budget)?.content != source.content)
    {
        return Err(Status::Conflict);
    }
    let check_published = || {
        check_source()?;
        if snapshot(primary, MAX_FILE, budget)?.content != source.content {
            return Err(Status::Changed);
        }
        Ok(())
    };
    check_published()?;
    save(&state, &next)?;
    // Catalog visibility is last. A retry can only adopt this transaction's
    // exact raw transcript and independently constructed metadata.
    if !create_checked(catalog, &metadata, &check_published)?
        && (prior.is_none()
            || read(
                catalog,
                super::super::CLAUDE_DESKTOP_METADATA_MAX_BYTES,
                budget,
            )? != metadata)
    {
        return Err(Status::Conflict);
    }
    check_published()?;
    remove(&pending_path)?;
    Ok(())
}
