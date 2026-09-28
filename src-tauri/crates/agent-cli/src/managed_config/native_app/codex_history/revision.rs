//! Stable raw-data revisions. No message or tool vocabulary is interpreted.
use super::{files, store::ThreadRecord, version, Version};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs::File, io::Read, path::Path, time::SystemTime};

#[cfg(test)]
thread_local! { pub(super) static HASH_READS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) }; }

pub(super) const MAX_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Revision {
    pub raw: String,
    pub metadata: String,
    /// The native revision's clock, never the time ORG2 published its copy.
    pub written_ns: u128,
}

impl Revision {
    pub fn same_data(&self, other: &Self) -> bool {
        self.raw == other.raw && self.metadata == other.metadata
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Observation {
    pub version: Version,
    pub revision: Revision,
}

/// Waiting can only defer work. A new target revision or writer transition
/// invalidates it; it never authorizes publishing a previously selected source.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Wait {
    pub target: Version,
    pub to_package: bool,
    pub writers: u8,
}

pub(super) fn writer_state(
    homes: [&Path; 2],
    id: &str,
    versions: [Option<&Version>; 2],
) -> Result<u8, String> {
    let mut state = 0;
    for (side, home) in homes.into_iter().enumerate() {
        let Some(version) = versions[side] else {
            continue;
        };
        let _store = match files::NativeStoreWriter::exclusive(home) {
            Ok(guard) => guard,
            Err(error) if error == "busy" => {
                state |= 1 << side;
                continue;
            }
            Err(error) => return Err(error),
        };
        let keys = [id.to_owned(), files::physical_id(&version.path)?]
            .into_iter()
            .collect::<std::collections::BTreeSet<_>>();
        let mut held = Vec::new();
        for key in keys {
            match files::WriterLock::acquire(home, &key) {
                Ok(lock) => held.push(lock),
                Err(error) if error == "busy" => {
                    state |= 1 << side;
                    break;
                }
                Err(error) => return Err(error),
            }
        }
    }
    Ok(state)
}

pub(super) fn terminal(home: &Path, row: &ThreadRecord) -> Result<bool, String> {
    if row.history_mode != "paginated" {
        return Ok(false);
    }
    let segments = super::lineage(home, row)?;
    let prepared = super::store::prepare(
        home,
        &row.id,
        &segments
            .iter()
            .map(|segment| segment.id.clone())
            .collect::<Vec<_>>(),
    )?;
    if prepared.record().metadata_hash != row.metadata_hash || !prepared.terminal_rollouts()? {
        return Ok(false);
    }
    for segment in &segments {
        let length = files::stamp(&segment.path)?.len;
        let next = files::tail(&segment.path)?["ordinal"]
            .as_u64()
            .and_then(|value| value.checked_add(1));
        let checkpoint = prepared
            .projections()
            .iter()
            .find(|projection| projection.rollout_id == segment.id)
            .ok_or("Missing Codex source projection")?;
        if next.is_none()
            || checkpoint
                .next_byte_offset
                .and_then(|value| u64::try_from(value).ok())
                != Some(length)
            || checkpoint
                .next_ordinal
                .and_then(|value| u64::try_from(value).ok())
                != next
        {
            return Ok(false);
        }
    }
    Ok(true)
}

#[derive(Default)]
pub(super) struct Budget {
    attempts: usize,
    bytes: u64,
}

impl Budget {
    pub fn take(&mut self, length: u64) -> Result<bool, String> {
        if length > MAX_BYTES {
            return Err("Codex raw revision exceeds the bounded snapshot limit".into());
        }
        if self.attempts == 16 || self.bytes.saturating_add(length) > MAX_BYTES {
            return Ok(false);
        }
        self.attempts += 1;
        self.bytes += length;
        Ok(true)
    }
}

pub(super) fn valid_time(time: u128) -> Result<u128, String> {
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_err(|_| "Invalid system clock for Codex revision")?
        .as_nanos();
    if time == 0 || time > now {
        return Err("Codex revision has no valid stable write time".into());
    }
    Ok(time)
}

/// Hash exactly the observed prefix, with bounded memory and mutation fences.
/// Prefix mode is used only to recover the source bytes in our own published
/// snapshot, before the destination routing event appended by ORG2.
pub(super) fn hash(
    path: &Path,
    length: u64,
    check: &impl Fn() -> Result<(), String>,
) -> Result<String, String> {
    #[cfg(test)]
    HASH_READS.with(|value| value.set(value.get() + 1));
    check()?;
    let before = files::stamp(path)?;
    if length > MAX_BYTES || length > before.len {
        return Err("Codex raw revision exceeds the bounded snapshot limit".into());
    }
    let mut file = File::open(path).map_err(|_| "Cannot read Codex raw revision")?;
    let mut remaining = length;
    let mut hasher = Sha256::new();
    let mut bytes = [0; 64 * 1024];
    while remaining != 0 {
        check()?;
        let count = remaining.min(bytes.len() as u64) as usize;
        file.read_exact(&mut bytes[..count])
            .map_err(|_| "busy".to_string())?;
        hasher.update(&bytes[..count]);
        remaining -= count as u64;
    }
    check()?;
    if files::stamp(path)? != before {
        return Err("busy".into());
    }
    Ok(format!("{:x}", hasher.finalize()))
}

pub(super) fn observe(
    home: &Path,
    row: &ThreadRecord,
    current: &Version,
    previous: Option<&Observation>,
    check: &impl Fn() -> Result<(), String>,
) -> Result<Observation, String> {
    check()?;
    let raw = hash(&row.rollout_path, current.file.len, check)?;
    // A complete last record is required; unknown payload keys remain opaque.
    files::tail(&row.rollout_path)?;
    let metadata = row.revision_metadata_hash()?;
    let previous = previous.map(|value| &value.revision);
    let written_ns = if let Some(prior) =
        previous.filter(|prior| prior.raw == raw && prior.metadata == metadata)
    {
        prior.written_ns
    } else if previous.is_some_and(|prior| prior.raw == raw) {
        valid_time(row.revision_metadata_time()?)?
    } else {
        let raw_time = valid_time(current.file.modified_ns())?;
        // On first observation (or when both data domains changed), the
        // thread's own clock is independent evidence of a later metadata edit.
        // Unchanged bookkeeping clocks never advance an established revision.
        if previous.is_none_or(|prior| prior.metadata != metadata) {
            raw_time.max(valid_time(row.revision_metadata_time()?)?)
        } else {
            raw_time
        }
    };
    let fresh = super::store::list_threads(home, Some(std::slice::from_ref(&row.id)))?
        .pop()
        .ok_or("Codex conversation disappeared during revision capture")?;
    if version(home, &fresh)? != *current {
        return Err("busy".into());
    }
    check()?;
    Ok(Observation {
        version: current.clone(),
        revision: Revision {
            raw,
            metadata,
            written_ns,
        },
    })
}

/// Deterministic raw revision ordering, with primary winning an exact tie.
pub(super) fn primary_wins(left: &Revision, right: &Revision) -> bool {
    left.written_ns >= right.written_ns
}
