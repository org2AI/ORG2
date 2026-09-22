use super::super::write_file_atomically;
use super::{Budget, Status, records};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::Path,
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
    fn prefix(&self, bytes: &[u8]) -> bool {
        bytes.get(..self.len).is_some_and(|b| Self::of(b) == *self)
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct LedgerEntry {
    to_primary: bool,
    projection: records::Projection,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Baseline {
    version: u8,
    binding: String,
    primary: Fingerprint,
    package: Fingerprint,
    generation: u64,
    ledger: Vec<LedgerEntry>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Journal {
    to_primary: bool,
    before: Fingerprint,
    after: Fingerprint,
    next: Baseline,
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
    budget.check()?;
    safe(path.parent().ok_or(Status::Changed)?, path)?;
    let before = fs::symlink_metadata(path).map_err(|_| Status::Changed)?;
    if !before.is_file() || before.len() > max {
        return Err(Status::Limit);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if before.nlink() != 1 || before.uid() != unsafe { libc::geteuid() } {
            return Err(Status::Changed);
        }
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options.open(path).map_err(|_| Status::Changed)?;
    let _opened = file.metadata().map_err(|_| Status::Changed)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if before.ino() != _opened.ino() || before.dev() != _opened.dev() {
            return Err(Status::Changed);
        }
    }
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 64 * 1024];
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
    let after = file.metadata().map_err(|_| Status::Changed)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let current_path = fs::symlink_metadata(path).map_err(|_| Status::Changed)?;
        if !current_path.is_file()
            || current_path.ino() != after.ino()
            || current_path.dev() != after.dev()
            || after.nlink() != 1
            || after.uid() != unsafe { libc::geteuid() }
        {
            return Err(Status::Changed);
        }
    }
    if bytes.len() as u64 != before.len()
        || before.len() != after.len()
        || before.modified().ok() != after.modified().ok()
    {
        return Err(Status::Changed);
    }
    Ok(bytes)
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
    reconcile_with_snapshots(
        primary_root,
        primary,
        package_root,
        package,
        state_root,
        session,
        budget,
        guard,
        None,
        None,
    )
}

/// Offline prototype only. Callers capture the destination's currently
/// effective snapshot after validating the real root/account/session/cwd scope
/// and confirming all writers stopped; the full byte baseline must still match.
#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(super) fn reconcile_with_snapshots(
    primary_root: &Path,
    primary: &Path,
    package_root: &Path,
    package: &Path,
    state_root: &Path,
    session: &str,
    budget: &Budget,
    guard: &impl Fn() -> Result<(), Status>,
    primary_snapshot: Option<&records::TargetSnapshot>,
    package_snapshot: Option<&records::TargetSnapshot>,
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
        primary_snapshot,
        package_snapshot,
        None,
        false,
    )
}

pub(super) struct Scope<'a> {
    pub binding: &'a str,
    pub cwd: &'a Path,
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
    preview: bool,
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
        None,
        Some(scope),
        preview,
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
    primary_snapshot: Option<&records::TargetSnapshot>,
    package_snapshot: Option<&records::TargetSnapshot>,
    scope: Option<Scope<'_>>,
    preview: bool,
) -> Result<Status, Status> {
    budget.check()?;
    guard()?;
    safe(primary_root, primary)?;
    safe(package_root, package)?;
    // Stable locks serialize ORG2 writers only. The caller separately requires
    // normal shutdown of all official writers before this operation.
    if !primary.is_file() || !package.is_file() {
        return Err(Status::Changed);
    }
    let _primary_lock = if preview {
        None
    } else {
        Some(try_lock(primary)?)
    };
    let _package_lock = if preview {
        None
    } else {
        Some(try_lock(package)?)
    };
    let a = read(primary, MAX_FILE, budget)?;
    let b = read(package, MAX_FILE, budget)?;
    records::validate(&a, session, budget)?;
    records::validate(&b, session, budget)?;
    let (captured_primary, captured_package) = if let Some(scope) = &scope {
        for bytes in [&a, &b] {
            for row in records::rows(bytes, budget)? {
                if row["uuid"].is_string() && row["cwd"].as_str().map(Path::new) != Some(scope.cwd)
                {
                    // A historical cwd mismatch makes this pair unsupported;
                    // it is not an owner transition that invalidates the roster.
                    return Err(Status::Unsupported);
                }
            }
        }
        let capture = |bytes: &[u8]| -> Result<Option<records::TargetSnapshot>, Status> {
            match records::TargetSnapshot::capture(bytes, session, budget) {
                Ok(snapshot) => Ok(Some(snapshot)),
                Err(Status::Unsupported) => Ok(None),
                Err(status) => Err(status),
            }
        };
        (capture(&a)?, capture(&b)?)
    } else {
        (None, None)
    };
    let primary_snapshot = captured_primary.as_ref().or(primary_snapshot);
    let package_snapshot = captured_package.as_ref().or(package_snapshot);
    let binding = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&(
                primary,
                package,
                session,
                scope.as_ref().map(|value| value.binding)
            ))
            .map_err(|_| Status::Failed)?
        )
    );
    let state = state_root.join(format!("{binding}.json"));
    let journal = state_root.join(format!("{binding}.pending.json"));
    safe(state_root, &state)?;
    safe(state_root, &journal)?;
    guard()?;
    if !preview {
        fs::create_dir_all(state_root).map_err(|_| Status::Failed)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(state_root, fs::Permissions::from_mode(0o700))
                .map_err(|_| Status::Failed)?;
        }
    }
    if let Some(pending) = load::<Journal>(&journal, budget)? {
        if pending.next.binding != binding
            || pending.next.version != 2
            || pending.after
                != (if pending.to_primary {
                    pending.next.primary.clone()
                } else {
                    pending.next.package.clone()
                })
        {
            return Err(Status::Conflict);
        }
        let target = if pending.to_primary { &a } else { &b };
        let current = Fingerprint::of(target);
        if preview {
            let source = if pending.to_primary { &b } else { &a };
            let expected_source = if pending.to_primary {
                &pending.next.package
            } else {
                &pending.next.primary
            };
            if &Fingerprint::of(source) != expected_source
                || (current != pending.before && current != pending.after)
            {
                return Err(Status::Conflict);
            }
            if current == pending.after {
                verify_ledger(&pending.next, &a, &b, budget)?;
            }
            guard()?;
            return Ok(Status::RecoveryReady);
        }
        if current == pending.after {
            // Publish happened before a crash. Adopt exactly that baseline;
            // never append the same batch again or overwrite a newer writer.
            guard()?;
            save(&state, &pending.next)?;
        } else if current != pending.before {
            return Err(Status::Conflict);
        }
        guard()?;
        fs::remove_file(&journal).map_err(|_| Status::Failed)?;
    }
    let mut baseline = match load::<Baseline>(&state, budget)? {
        Some(value) if value.version == 2 && value.binding == binding => value,
        Some(_) => return Err(Status::Conflict),
        None => {
            // Legacy 2056 copies may lack a baseline. Only exact-prefix
            // ancestry is sufficient evidence to bootstrap their pairing.
            let common = if b.starts_with(&a) {
                &a
            } else if a.starts_with(&b) {
                &b
            } else {
                return Err(Status::Conflict);
            };
            records::validate(common, session, budget)?;
            Baseline {
                version: 2,
                generation: 0,
                ledger: Vec::new(),
                binding: binding.clone(),
                primary: Fingerprint::of(common),
                package: Fingerprint::of(common),
            }
        }
    };
    if !baseline.primary.prefix(&a) || !baseline.package.prefix(&b) {
        return Err(Status::Conflict);
    }
    verify_ledger(&baseline, &a, &b, budget)?;
    if let Some(snapshot) = primary_snapshot {
        snapshot.verify(&a, budget)?;
    }
    if let Some(snapshot) = package_snapshot {
        snapshot.verify(&b, budget)?;
    }
    // A source snapshot identical to its own baseline may still differ from
    // the other profile after an earlier projection. Never infer destination
    // trust from source equality, even on the strict legacy entry point.
    for (suffix, trust) in [
        (&a[baseline.primary.len..], package_snapshot),
        (&b[baseline.package.len..], primary_snapshot),
    ] {
        if trust.is_none()
            && !suffix.is_empty()
            && records::rows(suffix, budget)?.iter().any(|row| {
                row["type"] == "attachment" && row["attachment"]["type"] == "prompt_snapshot"
            })
        {
            return Err(Status::Unsupported);
        }
    }
    let (a_projection, b_projection) = if scope.is_some() {
        (
            records::project_conversation(
                &a[..baseline.primary.len],
                &a[baseline.primary.len..],
                &b,
                session,
                budget,
            )?,
            records::project_conversation(
                &b[..baseline.package.len],
                &b[baseline.package.len..],
                &a,
                session,
                budget,
            )?,
        )
    } else {
        let a_projection = records::project_with_snapshot(
            &a[..baseline.primary.len],
            &a[baseline.primary.len..],
            session,
            budget,
            package_snapshot,
        )?;
        let b_projection = records::project_with_snapshot(
            &b[..baseline.package.len],
            &b[baseline.package.len..],
            session,
            budget,
            primary_snapshot,
        )?;
        (a_projection, b_projection)
    };
    let a_addition = a_projection.bytes;
    let b_addition = b_projection.bytes;
    let a_new = !a_addition.is_empty();
    let b_new = !b_addition.is_empty();
    if a_new && b_new {
        return Err(Status::Conflict);
    }
    if !a_new && !b_new {
        baseline.primary = Fingerprint::of(&a);
        baseline.package = Fingerprint::of(&b);
        budget.check()?;
        guard()?;
        if !preview {
            save(&state, &baseline)?;
        }
        return Ok(Status::Clean);
    }
    let to_primary = b_new;
    let (target, destination, addition) = if to_primary {
        (&a, primary, b_addition)
    } else {
        (&b, package, a_addition)
    };
    // Both physical baselines may advance through local metadata. Only an
    // actual projected continuation counts as a new branch.
    let mut next_bytes = target.clone();
    next_bytes.extend_from_slice(&addition);
    if next_bytes.len() as u64 > MAX_FILE {
        return Err(Status::Limit);
    }
    records::validate(&next_bytes, session, budget)?;
    let projected = if to_primary {
        b_projection.ledger
    } else {
        a_projection.ledger
    };
    if baseline.ledger.len() + projected.len() > 128 {
        return Err(Status::Limit);
    }
    baseline
        .ledger
        .extend(projected.into_iter().map(|projection| LedgerEntry {
            to_primary,
            projection,
        }));
    baseline.generation = baseline.generation.checked_add(1).ok_or(Status::Limit)?;
    baseline.primary = Fingerprint::of(if to_primary { &next_bytes } else { &a });
    baseline.package = Fingerprint::of(if to_primary { &b } else { &next_bytes });
    verify_ledger(
        &baseline,
        if to_primary { &next_bytes } else { &a },
        if to_primary { &b } else { &next_bytes },
        budget,
    )?;
    budget.check()?;
    guard()?;
    if read(primary, MAX_FILE, budget)? != a || read(package, MAX_FILE, budget)? != b {
        return Err(Status::Changed);
    }
    if addition.is_empty() {
        save(&state, &baseline)?;
        return Ok(Status::Clean);
    }
    if preview {
        return Ok(Status::Ready);
    }
    // One retained preimage per pair; a pending journal prevents replacing it
    // on an uncertain retry. No official index/config file is a destination.
    write(&state_root.join(format!("{binding}.backup.jsonl")), target)?;
    save(
        &journal,
        &Journal {
            to_primary,
            before: Fingerprint::of(target),
            after: Fingerprint::of(&next_bytes),
            next: baseline.clone(),
        },
    )?;
    budget.check()?;
    guard()?;
    if read(primary, MAX_FILE, budget)? != a || read(package, MAX_FILE, budget)? != b {
        return Err(Status::Changed);
    }
    guard()?;
    write(destination, &next_bytes)?;
    guard()?;
    save(&state, &baseline)?;
    fs::remove_file(&journal).map_err(|_| Status::Failed)?;
    Ok(if to_primary {
        Status::SyncedToPrimary
    } else {
        Status::SyncedToPackage
    })
}

/// Only declared source/target digest pairs may differ at a shared UUID.
/// Physical prefix hashes separately reject rewritten history, including a
/// third payload, even if a caller subsequently supplies a different witness.
fn verify_ledger(baseline: &Baseline, a: &[u8], b: &[u8], budget: &Budget) -> Result<(), Status> {
    use std::collections::HashMap;
    let by_id = |bytes: &[u8]| -> Result<HashMap<String, serde_json::Value>, Status> {
        Ok(records::rows(bytes, budget)?
            .into_iter()
            .filter_map(|row| row["uuid"].as_str().map(str::to_owned).map(|id| (id, row)))
            .collect())
    };
    let left = by_id(a.get(..baseline.primary.len).ok_or(Status::Conflict)?)?;
    let right = by_id(b.get(..baseline.package.len).ok_or(Status::Conflict)?)?;
    for (source, target) in [(&left, &right), (&right, &left)] {
        for (id, row) in source {
            if matches!(row["type"].as_str(), Some("user" | "assistant"))
                && !target.contains_key(id)
            {
                return Err(Status::Conflict);
            }
        }
    }
    let mut declared = HashMap::new();
    for entry in &baseline.ledger {
        let projection = &entry.projection;
        if declared.insert(projection.uuid.as_str(), entry).is_some() {
            return Err(Status::Conflict);
        }
        let (source, target) = if entry.to_primary {
            (&right, &left)
        } else {
            (&left, &right)
        };
        let source_row = source.get(&projection.uuid).ok_or(Status::Conflict)?;
        let target_row = target.get(&projection.uuid).ok_or(Status::Conflict)?;
        let basis_row = target.get(&projection.basis_uuid).ok_or(Status::Conflict)?;
        if records::digest(source_row)? != projection.source_hash
            || records::digest(target_row)? != projection.target_hash
            || records::digest(basis_row)? != projection.basis_hash
        {
            return Err(Status::Conflict);
        }
        let mut expected = source_row.clone();
        if projection.parent_only {
            if !matches!(source_row["type"].as_str(), Some("user" | "assistant")) {
                return Err(Status::Conflict);
            }
            if projection.basis_uuid == projection.uuid {
                let target_bytes = if entry.to_primary { a } else { b };
                let first = records::rows(target_bytes, budget)?
                    .into_iter()
                    .find(|row| row["uuid"].is_string())
                    .ok_or(Status::Conflict)?;
                if first["uuid"] != projection.uuid || first["type"] != "user" {
                    return Err(Status::Conflict);
                }
                expected["parentUuid"] = serde_json::Value::Null;
            } else {
                expected["parentUuid"] = basis_row["uuid"].clone();
            }
            expected
                .as_object_mut()
                .ok_or(Status::Conflict)?
                .remove("permissionMode");
            expected
                .as_object_mut()
                .ok_or(Status::Conflict)?
                .remove("toolUseResult");
            expected
                .as_object_mut()
                .ok_or(Status::Conflict)?
                .remove("advisorModel");
        } else {
            if source_row["attachment"]["type"] != "prompt_snapshot"
                || target_row["attachment"] != basis_row["attachment"]
            {
                return Err(Status::Conflict);
            }
            expected["attachment"] = basis_row["attachment"].clone();
        }
        if expected != *target_row {
            return Err(Status::Conflict);
        }
    }
    for (id, row) in &left {
        if let Some(other) = right.get(id) {
            if row != other && !declared.contains_key(id.as_str()) {
                let mut a = row.clone();
                let mut b = other.clone();
                // This already-audited local permission field is never replayed.
                for field in ["permissionMode", "toolUseResult", "advisorModel"] {
                    a.as_object_mut().ok_or(Status::Conflict)?.remove(field);
                    b.as_object_mut().ok_or(Status::Conflict)?.remove(field);
                }
                if a != b {
                    return Err(Status::Conflict);
                }
            }
        }
    }
    Ok(())
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Registration {
    version: u8,
    catalog: Fingerprint,
    next: Baseline,
}

fn create(path: &Path, bytes: &[u8]) -> Result<bool, Status> {
    safe(path.parent().ok_or(Status::Changed)?, path)?;
    super::super::create_file_atomically(path, "Claude conversation registration", |file| {
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

/// Publish a new conversation only. An existing transcript is accepted solely
/// as the exact result of this scope's pending create journal, never adopted.
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
    // This only creates transcript parents inside the already authenticated
    // native home. No Claude identity, org, config or trust file is created.
    fs::create_dir_all(primary.parent().ok_or(Status::Changed)?).map_err(|_| Status::Failed)?;
    let _primary_lock = try_lock(primary)?;
    let _package_lock = try_lock(package)?;
    let _catalog_lock = try_lock(catalog)?;
    let source = read(package, MAX_FILE, budget)?;
    records::validate(&source, session, budget)?;
    for record in records::rows(&source, budget)? {
        if record["uuid"].is_string() && record["cwd"].as_str().map(Path::new) != Some(scope.cwd) {
            return Err(Status::Unsupported);
        }
    }
    let projected = records::project_conversation(&[], &source, &[], session, budget)?;
    records::validate(&projected.bytes, session, budget)?;
    let binding = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&(primary, package, session, Some(scope.binding)))
                .map_err(|_| Status::Failed)?
        )
    );
    let state = state_root.join(format!("{binding}.json"));
    let pending_path = state_root.join(format!("{binding}.register.json"));
    let backup = state_root.join(format!("{binding}.register.backup.jsonl"));
    let metadata = serde_json::to_vec(catalog_row).map_err(|_| Status::Unsupported)?;
    let next = Baseline {
        version: 2,
        binding: binding.clone(),
        primary: Fingerprint::of(&projected.bytes),
        package: Fingerprint::of(&source),
        generation: 0,
        ledger: projected
            .ledger
            .into_iter()
            .map(|projection| LedgerEntry {
                to_primary: true,
                projection,
            })
            .collect(),
    };
    verify_ledger(&next, &projected.bytes, &source, budget)?;
    let prior = load::<Registration>(&pending_path, budget)?;
    if let Some(prior) = &prior {
        if prior.version != 1
            || prior.catalog != Fingerprint::of(&metadata)
            || prior.next.binding != binding
            || prior.next.primary != next.primary
            || prior.next.package != next.package
        {
            return Err(Status::Conflict);
        }
        if read(&backup, MAX_FILE, budget)? != projected.bytes {
            return Err(Status::Conflict);
        }
    } else {
        if primary.try_exists().map_err(|_| Status::Failed)?
            || catalog.try_exists().map_err(|_| Status::Failed)?
            || state.try_exists().map_err(|_| Status::Failed)?
        {
            return Err(Status::Conflict);
        }
        guard()?;
        fs::create_dir_all(state_root).map_err(|_| Status::Failed)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(state_root, fs::Permissions::from_mode(0o700))
                .map_err(|_| Status::Failed)?;
        }
        // Retain only the safe projection, never the package runtime context.
        write(&backup, &projected.bytes)?;
        save(
            &pending_path,
            &Registration {
                version: 1,
                catalog: Fingerprint::of(&metadata),
                next: next.clone(),
            },
        )?;
    }
    guard()?;
    if read(package, MAX_FILE, budget)? != source {
        return Err(Status::Changed);
    }
    if !create(primary, &projected.bytes)?
        && (prior.is_none() || read(primary, MAX_FILE, budget)? != projected.bytes)
    {
        return Err(Status::Conflict);
    }
    guard()?;
    if read(primary, MAX_FILE, budget)? != projected.bytes
        || read(package, MAX_FILE, budget)? != source
    {
        return Err(Status::Changed);
    }
    save(&state, &next)?;
    guard()?;
    // Discovery is the final publication. Never expose a missing transcript.
    if !create(catalog, &metadata)?
        && (prior.is_none()
            || read(
                catalog,
                super::super::CLAUDE_DESKTOP_METADATA_MAX_BYTES,
                budget,
            )? != metadata)
    {
        return Err(Status::Conflict);
    }
    guard()?;
    fs::remove_file(&pending_path).map_err(|_| Status::Failed)?;
    Ok(())
}
