//! Structured conversation -> provider-native transcript materialization.
//!
//! This is deliberately not a prompt bridge. Every supported target gets the
//! role/tool records its own resume protocol reads. Unsupported targets fail
//! closed before a process is launched.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use core_types::activity::ActivityChunk;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::codex_native_catalog;
use super::native_transcript::TRANSCRIPT_SOURCE_NATIVE;
use super::persistence;

const MAX_ITEMS: usize = 100_000;
const MAX_SERIALIZED_BYTES: usize = 64 * 1024 * 1024;
const MAX_PORTABLE_TOOL_CALL_ID_LENGTH: usize = 64;
const NATIVE_CATALOG_REFRESH_BACKOFFS: [Duration; 2] =
    [Duration::from_millis(150), Duration::from_millis(400)];
const CODEX_NATIVE_PATH_CACHE_MAX_ENTRIES: usize = 512;
// Claude's project catalog is one read-modify-write JSON document. Serialize
// those short critical sections so two Sessions completing together cannot
// overwrite each other's index entry.
static CLAUDE_PROJECT_INDEX_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
// Codex stores rollouts in a date-sharded directory tree. Resolving the same
// native UUID by walking that tree on every turn makes a long-running session
// progressively more expensive even though its path is immutable. Cache only
// successful resolutions and validate the provider file still exists before
// reusing one; deletion or profile cleanup naturally falls back to discovery.
static CODEX_NATIVE_PATH_CACHE: LazyLock<
    Mutex<HashMap<(String, String), NativeTranscriptPaths>>,
> = LazyLock::new(|| Mutex::new(HashMap::new()));
// Freeze the provider/account/workspace row that launched each active turn.
// Model/account pills may already show the next queued selection while the
// current provider is still running; terminal publication must resolve the
// runner UUID through this launch snapshot, never through the mutable row.
static ACTIVE_NATIVE_PUBLICATION_SESSIONS: LazyLock<
    Mutex<HashMap<String, persistence::CodeSession>>,
> = LazyLock::new(|| Mutex::new(HashMap::new()));
// Catalog publication is deliberately off the turn-critical path. Keep one
// worker per provider and coalesce repeated requests by native conversation so fast
// consecutive turns cannot retain an unbounded list of Tokio tasks behind a
// slow app-server call. Separate lanes keep a blocked Codex app-server from
// delaying Claude metadata (and vice versa).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum NativeCatalogProvider {
    ClaudeCode,
    Codex,
}

impl NativeCatalogProvider {
    fn from_agent(agent: &str) -> Option<Self> {
        match agent {
            "claude_code" => Some(Self::ClaudeCode),
            "codex" => Some(Self::Codex),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::ClaudeCode => "claude_code",
            Self::Codex => "codex",
        }
    }
}

#[derive(Debug, Default)]
struct NativeCatalogRefreshLane {
    pending: HashMap<NativeCatalogRefreshKey, NativeCatalogRefreshRequest>,
    // Requests whose native conversation is owned by a live turn wait here.
    // One async waiter per key re-enqueues the newest coalesced request after
    // identity becomes available, while this provider lane keeps advancing.
    deferred: HashMap<NativeCatalogRefreshKey, NativeCatalogRefreshRequest>,
    worker_running: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct NativeCatalogRefreshKey {
    provider: NativeCatalogProvider,
    native_id: String,
    native_path: PathBuf,
}

#[derive(Debug, Clone)]
struct NativeCatalogRefreshRequest {
    queued_at: Instant,
    context: CliNativePublicationContext,
    completed_turns_hint: Option<usize>,
}

impl NativeCatalogRefreshLane {
    fn key(
        provider: NativeCatalogProvider,
        context: &CliNativePublicationContext,
    ) -> NativeCatalogRefreshKey {
        NativeCatalogRefreshKey {
            provider,
            native_id: context.native_id.clone(),
            native_path: context.paths.native_path.clone(),
        }
    }

    fn merge_request(
        request: &mut NativeCatalogRefreshRequest,
        queued_at: Instant,
        context: CliNativePublicationContext,
        completed_turns_hint: Option<usize>,
    ) {
        request.queued_at = queued_at;
        // The native id is immutable, but title/model/branch metadata can
        // advance while requests are coalesced. Keep the newest snapshot and
        // the highest provider progress floor.
        request.context = context;
        request.completed_turns_hint =
            request.completed_turns_hint.max(completed_turns_hint);
    }

    fn enqueue(
        &mut self,
        provider: NativeCatalogProvider,
        context: CliNativePublicationContext,
        completed_turns_hint: Option<usize>,
    ) -> bool {
        let now = Instant::now();
        let key = Self::key(provider, &context);
        if let Some(request) = self.deferred.get_mut(&key) {
            Self::merge_request(request, now, context, completed_turns_hint);
            return false;
        }
        self.pending
            .entry(key)
            .and_modify(|request| {
                Self::merge_request(request, now, context.clone(), completed_turns_hint);
            })
            .or_insert(NativeCatalogRefreshRequest {
                queued_at: now,
                context,
                completed_turns_hint,
            });
        if self.worker_running {
            false
        } else {
            self.worker_running = true;
            true
        }
    }

    fn defer_until_identity_available(
        &mut self,
        provider: NativeCatalogProvider,
        mut request: NativeCatalogRefreshRequest,
    ) -> (NativeCatalogRefreshKey, bool) {
        let key = Self::key(provider, &request.context);
        // A newer request can be enqueued between the worker's try-lock and
        // this queue mutation. Fold it into the deferred slot as well.
        if let Some(pending) = self.pending.remove(&key) {
            Self::merge_request(
                &mut request,
                pending.queued_at,
                pending.context,
                pending.completed_turns_hint,
            );
        }
        if let Some(deferred) = self.deferred.get_mut(&key) {
            Self::merge_request(
                deferred,
                request.queued_at,
                request.context,
                request.completed_turns_hint,
            );
            (key, false)
        } else {
            self.deferred.insert(key.clone(), request);
            (key, true)
        }
    }

    fn take_deferred(
        &mut self,
        key: &NativeCatalogRefreshKey,
    ) -> Option<NativeCatalogRefreshRequest> {
        self.deferred.remove(key)
    }

    fn take_next(&mut self) -> Option<NativeCatalogRefreshRequest> {
        let next = self
            .pending
            .iter()
            .min_by_key(|(_, request)| request.queued_at)
            .map(|(key, _)| key.clone());
        if let Some(key) = next {
            Some(
                self.pending
                    .remove(&key)
                    .expect("selected catalog refresh request must still exist"),
            )
        } else {
            self.worker_running = false;
            None
        }
    }
}

#[derive(Debug, Default)]
struct NativeCatalogRefreshQueue {
    lanes: HashMap<NativeCatalogProvider, NativeCatalogRefreshLane>,
}

impl NativeCatalogRefreshQueue {
    fn lane_mut(&mut self, provider: NativeCatalogProvider) -> &mut NativeCatalogRefreshLane {
        self.lanes.entry(provider).or_default()
    }
}

static NATIVE_CATALOG_REFRESH_QUEUE: LazyLock<Mutex<NativeCatalogRefreshQueue>> =
    LazyLock::new(|| Mutex::new(NativeCatalogRefreshQueue::default()));

/// Filesystem/native-binding mutations need both short lifecycle exclusion and
/// provider-identity exclusion. Never wait for identity while a runner is
/// alive: its finalizer already owns identity and briefly takes control for
/// terminal publication, so doing so would invert the lock order.
struct NativeMutationGuards {
    _control: tokio::sync::OwnedMutexGuard<()>,
    _identity: tokio::sync::OwnedMutexGuard<()>,
}

async fn lock_idle_native_mutation(
    session_id: &str,
) -> Result<NativeMutationGuards, String> {
    let control = super::session_runner::session_control_lock(session_id)
        .await
        .lock_owned()
        .await;
    let has_live_runner = {
        let sessions = super::session_runner::RUNNING_SESSIONS.lock().await;
        sessions
            .get(session_id)
            .is_some_and(|handle| !handle.is_finished())
    };
    if has_live_runner {
        return Err(format!(
            "Session {session_id} still has a running provider turn"
        ));
    }
    let identity = super::session_runner::session_identity_lock(session_id)
        .await
        .lock_owned()
        .await;
    Ok(NativeMutationGuards {
        _control: control,
        _identity: identity,
    })
}

fn is_portable_tool_call_id(value: &str) -> bool {
    !value.is_empty()
        && value.chars().count() <= MAX_PORTABLE_TOOL_CALL_ID_LENGTH
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum NativeConversationItem {
    Message {
        id: String,
        role: String,
        text: String,
        #[serde(default)]
        images: Vec<String>,
        created_at: String,
        #[serde(default)]
        turn_id: Option<String>,
    },
    ToolCall {
        id: String,
        call_id: String,
        name: String,
        arguments: String,
        created_at: String,
    },
    ToolResult {
        id: String,
        call_id: String,
        name: String,
        output: String,
        created_at: String,
    },
    Compaction {
        id: String,
        summary: String,
        created_at: String,
    },
}

impl NativeConversationItem {
    fn id(&self) -> &str {
        match self {
            Self::Message { id, .. }
            | Self::ToolCall { id, .. }
            | Self::ToolResult { id, .. }
            | Self::Compaction { id, .. } => id,
        }
    }

    fn created_at(&self) -> &str {
        match self {
            Self::Message { created_at, .. }
            | Self::ToolCall { created_at, .. }
            | Self::ToolResult { created_at, .. }
            | Self::Compaction { created_at, .. } => created_at,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMaterializationReceipt {
    native_session_id: String,
    item_count: usize,
}

fn validate_items(items: &[NativeConversationItem]) -> Result<(), String> {
    if items.len() > MAX_ITEMS {
        return Err(format!(
            "native transcript has {} items; limit is {MAX_ITEMS}",
            items.len()
        ));
    }
    struct SerializedSize(usize);

    impl Write for SerializedSize {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0 = self
                .0
                .checked_add(bytes.len())
                .ok_or_else(|| std::io::Error::other("native transcript size overflow"))?;
            Ok(bytes.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    // Measure the wire representation without allocating a second copy of a
    // potentially 64 MiB transcript on every materialize/synchronize call.
    let mut encoded_size = SerializedSize(0);
    serde_json::to_writer(&mut encoded_size, items)
        .map_err(|err| format!("serialize native transcript input: {err}"))?;
    if encoded_size.0 > MAX_SERIALIZED_BYTES {
        return Err(format!(
            "native transcript is {} bytes; limit is {MAX_SERIALIZED_BYTES}",
            encoded_size.0
        ));
    }
    let mut item_ids = HashSet::with_capacity(items.len());
    for item in items {
        if item.id().trim().is_empty() {
            return Err("native transcript item id is required".to_string());
        }
        if !item_ids.insert(item.id()) {
            return Err(format!(
                "native transcript contains duplicate canonical item id {:?}",
                item.id()
            ));
        }
        match item {
            NativeConversationItem::Message {
                id, role, images, ..
            } => {
                if !matches!(role.as_str(), "user" | "assistant") {
                    return Err(format!("unsupported native message role {role:?}"));
                }
                if role == "assistant" && !images.is_empty() {
                    return Err(format!(
                        "assistant historical images cannot be transferred losslessly to this native target: item={id:?}, images={}",
                        images.len()
                    ));
                }
                for image in images {
                    if !image.starts_with("data:image/") {
                        return Err(format!(
                            "historical images must be embedded data URLs for exact native transfer: item={id:?}"
                        ));
                    }
                }
            }
            NativeConversationItem::ToolCall {
                call_id,
                name,
                arguments,
                ..
            } => {
                if call_id.trim().is_empty() || name.trim().is_empty() {
                    return Err("native tool call requires callId and name".to_string());
                }
                if !is_portable_tool_call_id(call_id) {
                    return Err(format!(
                        "native tool call id must match [A-Za-z0-9_-] and be at most {MAX_PORTABLE_TOOL_CALL_ID_LENGTH} characters"
                    ));
                }
                serde_json::from_str::<Value>(arguments).map_err(|err| {
                    format!("native tool call {call_id} has invalid JSON arguments: {err}")
                })?;
            }
            NativeConversationItem::ToolResult { call_id, name, .. } => {
                if call_id.trim().is_empty() || name.trim().is_empty() {
                    return Err("native tool result requires callId and name".to_string());
                }
                if !is_portable_tool_call_id(call_id) {
                    return Err(format!(
                        "native tool result id must match [A-Za-z0-9_-] and be at most {MAX_PORTABLE_TOOL_CALL_ID_LENGTH} characters"
                    ));
                }
            }
            NativeConversationItem::Compaction { .. } => {}
        }
    }
    Ok(())
}

fn atomic_jsonl(path: &Path, records: &[Value]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("native transcript path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|err| format!("create native transcript dir {}: {err}", parent.display()))?;
    let tmp = path.with_extension(format!("jsonl.tmp-{}", Uuid::new_v4().simple()));
    let result = (|| -> Result<(), String> {
        let mut file = fs::File::create(&tmp)
            .map_err(|err| format!("create native transcript {}: {err}", tmp.display()))?;
        for record in records {
            serde_json::to_writer(&mut file, record)
                .map_err(|err| format!("write native transcript {}: {err}", tmp.display()))?;
            file.write_all(b"\n")
                .map_err(|err| format!("write native transcript {}: {err}", tmp.display()))?;
        }
        file.sync_all()
            .map_err(|err| format!("sync native transcript {}: {err}", tmp.display()))?;
        atomic_replace_file(&tmp, path, "native transcript")?;
        sync_parent_directory(path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

#[cfg(test)]
fn append_jsonl(path: &Path, records: &[Value]) -> Result<(), String> {
    // Serialize the complete suffix before opening the shared provider file.
    // This keeps the append to one payload and, critically, means an error
    // never needs a blind set_len rollback that could truncate bytes another
    // native App process appended concurrently.
    let payload = serialize_jsonl(records)?;
    append_jsonl_payload(path, &payload)
}

fn serialize_jsonl(records: &[Value]) -> Result<Vec<u8>, String> {
    let mut payload = Vec::new();
    for record in records {
        serde_json::to_writer(&mut payload, record)
            .map_err(|err| format!("serialize native transcript suffix: {err}"))?;
        payload.push(b'\n');
    }
    Ok(payload)
}

fn append_jsonl_payload(path: &Path, payload: &[u8]) -> Result<(), String> {
    let mut file = fs::OpenOptions::new()
        .append(true)
        .open(path)
        .map_err(|err| {
            format!(
                "open native transcript {} for append: {err}",
                path.display()
            )
        })?;
    file.write_all(payload)
        .map_err(|err| format!("append native transcript {}: {err}", path.display()))?;
    file.sync_all()
        .map_err(|err| format!("sync native transcript {}: {err}", path.display()))
}

fn rollback_jsonl_suffix(path: &Path, original_len: u64, suffix: &[u8]) -> Result<(), String> {
    let expected_len = original_len.saturating_add(suffix.len() as u64);
    let mut file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .map_err(|error| format!("open native transcript {} for rollback: {error}", path.display()))?;
    let actual_len = file
        .metadata()
        .map_err(|error| format!("inspect native transcript {} for rollback: {error}", path.display()))?
        .len();
    if actual_len != expected_len {
        return Err(format!(
            "native transcript {} advanced concurrently; expected {expected_len} bytes, found {actual_len}",
            path.display()
        ));
    }
    file.seek(SeekFrom::Start(original_len))
        .map_err(|error| format!("seek native transcript {} for rollback: {error}", path.display()))?;
    let mut actual_suffix = vec![0; suffix.len()];
    file.read_exact(&mut actual_suffix)
        .map_err(|error| format!("read native transcript {} for rollback: {error}", path.display()))?;
    if actual_suffix != suffix {
        return Err(format!(
            "native transcript {} suffix changed concurrently; refusing rollback",
            path.display()
        ));
    }
    file.set_len(original_len)
        .map_err(|error| format!("truncate native transcript {} during rollback: {error}", path.display()))?;
    file.sync_all()
        .map_err(|error| format!("sync native transcript {} after rollback: {error}", path.display()))
}

/// Count actual human/user prompts in a Claude transcript without loading the
/// JSONL into memory. Claude represents tool results as `type=user` records as
/// well, so the outer type alone would wildly over-count long tool-heavy turns.
fn claude_completed_turns_from_transcript(path: &Path) -> Result<usize, String> {
    let file = fs::File::open(path)
        .map_err(|error| format!("open Claude transcript {}: {error}", path.display()))?;
    let mut count = 0usize;
    for (index, line) in BufReader::new(file).lines().enumerate() {
        if index >= MAX_ITEMS {
            return Err(format!(
                "Claude transcript {} exceeds {MAX_ITEMS} records",
                path.display()
            ));
        }
        let line = line.map_err(|error| {
            format!("read Claude transcript {}: {error}", path.display())
        })?;
        if line.trim().is_empty() {
            continue;
        }
        let record: Value = serde_json::from_str(&line).map_err(|error| {
            format!("parse Claude transcript {}: {error}", path.display())
        })?;
        if record["type"] != "user"
            || record["message"]["role"] != "user"
            || record["isMeta"].as_bool() == Some(true)
            || record["isCompactSummary"].as_bool() == Some(true)
            || !record["toolUseResult"].is_null()
        {
            continue;
        }
        let content = &record["message"]["content"];
        let is_tool_result_only = content.as_array().is_some_and(|blocks| {
            !blocks.is_empty()
                && blocks
                    .iter()
                    .all(|block| block["type"] == "tool_result")
        });
        if !is_tool_result_only {
            count += 1;
        }
    }
    Ok(count)
}

#[cfg(test)]
fn claude_active_leaf_uuid(path: &Path) -> Option<String> {
    fs::read_to_string(path)
        .ok()?
        .lines()
        .rev()
        .find_map(|line| {
            let record = serde_json::from_str::<Value>(line).ok()?;
            if record["type"] == "last-prompt" {
                return record["leafUuid"]
                    .as_str()
                    .filter(|value| !value.trim().is_empty())
                    .map(str::to_string);
            }
            record["uuid"]
                .as_str()
                .filter(|value| !value.trim().is_empty())
                .map(str::to_string)
        })
}

fn atomic_json(path: &Path, value: &Value) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("native metadata path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|err| format!("create native metadata dir {}: {err}", parent.display()))?;
    let tmp = path.with_extension(format!("json.tmp-{}", Uuid::new_v4().simple()));
    let result = (|| -> Result<(), String> {
        let mut file = fs::File::create(&tmp)
            .map_err(|err| format!("create native metadata {}: {err}", tmp.display()))?;
        serde_json::to_writer_pretty(&mut file, value)
            .map_err(|err| format!("write native metadata {}: {err}", tmp.display()))?;
        file.write_all(b"\n")
            .map_err(|err| format!("write native metadata {}: {err}", tmp.display()))?;
        file.sync_all()
            .map_err(|err| format!("sync native metadata {}: {err}", tmp.display()))?;
        atomic_replace_file(&tmp, path, "native metadata")?;
        sync_parent_directory(path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

#[derive(Debug, Clone)]
struct NativeTranscriptPaths {
    /// Real provider file discovered by the official CLI and desktop app.
    native_path: PathBuf,
    /// Account-profile alias used by ORGII's isolated provider process.
    runner_path: PathBuf,
}

fn remove_file_if_present(path: &Path) -> Result<bool, String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!(
            "remove native transcript {}: {error}",
            path.display()
        )),
    }
}

#[cfg(unix)]
fn sync_parent_directory(path: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("path has no parent to sync: {}", path.display()))?;
    fs::File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("sync directory {}: {error}", parent.display()))
}

#[cfg(not(unix))]
fn sync_parent_directory(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
fn atomic_replace_file(staged: &Path, destination: &Path, label: &str) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let staged_wide = staged
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination_wide = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    unsafe {
        MoveFileExW(
            PCWSTR(staged_wide.as_ptr()),
            PCWSTR(destination_wide.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(|error| {
        format!(
            "commit {label} {} -> {}: {error}",
            staged.display(),
            destination.display()
        )
    })
}

#[cfg(not(windows))]
fn atomic_replace_file(staged: &Path, destination: &Path, label: &str) -> Result<(), String> {
    fs::rename(staged, destination).map_err(|error| {
        format!(
            "commit {label} {} -> {}: {error}",
            staged.display(),
            destination.display()
        )
    })
}

fn replace_runner_link(native_path: &Path, runner_path: &Path) -> Result<(), String> {
    // Ambient local CLIs already read the provider's official transcript
    // path. There is no isolated profile alias to create in that case.
    if native_path == runner_path {
        return Ok(());
    }
    let parent = runner_path.parent().ok_or_else(|| {
        format!(
            "native runner transcript path has no parent: {}",
            runner_path.display()
        )
    })?;
    fs::create_dir_all(parent).map_err(|err| {
        format!(
            "create native runner transcript dir {}: {err}",
            parent.display()
        )
    })?;
    let tmp = runner_path.with_extension(format!("jsonl.link-{}", Uuid::new_v4().simple()));

    #[cfg(unix)]
    std::os::unix::fs::symlink(native_path, &tmp).map_err(|err| {
        format!(
            "link native runner transcript {} -> {}: {err}",
            tmp.display(),
            native_path.display()
        )
    })?;

    // Windows file symlinks commonly require an elevated process. A hard link
    // keeps the same append semantics while both stores live on the user's
    // home volume. Synchronization replaces it after each atomic rewrite.
    #[cfg(windows)]
    fs::hard_link(native_path, &tmp).map_err(|err| {
        format!(
            "link native runner transcript {} -> {}: {err}",
            tmp.display(),
            native_path.display()
        )
    })?;

    #[cfg(not(any(unix, windows)))]
    fs::hard_link(native_path, &tmp).map_err(|err| {
        format!(
            "link native runner transcript {} -> {}: {err}",
            tmp.display(),
            native_path.display()
        )
    })?;

    let result = atomic_replace_file(&tmp, runner_path, "native runner transcript link")
        .and_then(|()| sync_parent_directory(runner_path));
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

fn validate_provider_jsonl(path: &Path, expected_native_id: &str) -> Result<(), String> {
    let file = fs::File::open(path)
        .map_err(|error| format!("open provider transcript {}: {error}", path.display()))?;
    let mut records = 0usize;
    let mut identity_seen = false;
    for (index, line) in BufReader::new(file).lines().enumerate() {
        let line = line.map_err(|error| {
            format!("read provider transcript {}: {error}", path.display())
        })?;
        if line.trim().is_empty() {
            continue;
        }
        let record: Value = serde_json::from_str(&line).map_err(|error| {
            format!(
                "provider transcript {} has invalid JSON at line {}: {error}",
                path.display(),
                index + 1
            )
        })?;
        records += 1;
        identity_seen |= record["sessionId"].as_str() == Some(expected_native_id)
            || record["session_id"].as_str() == Some(expected_native_id)
            || record["payload"]["session_id"].as_str() == Some(expected_native_id)
            || record["payload"]["id"].as_str() == Some(expected_native_id);
    }
    if records == 0 {
        return Err(format!("provider transcript {} is empty", path.display()));
    }
    if !identity_seen {
        return Err(format!(
            "provider transcript {} does not contain expected native id {expected_native_id}",
            path.display()
        ));
    }
    Ok(())
}

fn file_is_byte_prefix(prefix: &Path, complete: &Path) -> Result<bool, String> {
    let mut prefix_file = fs::File::open(prefix)
        .map_err(|error| format!("open transcript {}: {error}", prefix.display()))?;
    let mut complete_file = fs::File::open(complete)
        .map_err(|error| format!("open transcript {}: {error}", complete.display()))?;
    let mut left = [0u8; 64 * 1024];
    let mut right = [0u8; 64 * 1024];
    loop {
        let left_len = prefix_file
            .read(&mut left)
            .map_err(|error| format!("read transcript {}: {error}", prefix.display()))?;
        if left_len == 0 {
            return Ok(true);
        }
        let mut right_len = 0usize;
        while right_len < left_len {
            let read = complete_file
                .read(&mut right[right_len..left_len])
                .map_err(|error| format!("read transcript {}: {error}", complete.display()))?;
            if read == 0 {
                return Ok(false);
            }
            right_len += read;
        }
        if left[..left_len] != right[..left_len] {
            return Ok(false);
        }
    }
}

fn publish_runner_transcript(
    paths: &NativeTranscriptPaths,
    expected_native_id: &str,
) -> Result<(), String> {
    validate_provider_jsonl(&paths.runner_path, expected_native_id)?;
    if paths.native_path == paths.runner_path {
        return fs::File::open(&paths.native_path)
            .and_then(|native| native.sync_all())
            .map_err(|error| {
                format!(
                    "sync provider-native transcript {}: {error}",
                    paths.native_path.display()
                )
            });
    }
    let runner_metadata = fs::symlink_metadata(&paths.runner_path).map_err(|err| {
        format!(
            "inspect native runner transcript {}: {err}",
            paths.runner_path.display()
        )
    })?;
    // The normal steady state is a link into the provider App store. Codex
    // can replace that link with a regular rollout while resuming inside an
    // account-isolated CODEX_HOME; in that case the runner copy contains the
    // provider's newest native-only state and must be published before the App
    // catalog is refreshed.
    if runner_metadata.file_type().is_symlink() {
        return fs::File::open(&paths.native_path)
            .and_then(|native| native.sync_all())
            .map_err(|error| {
                format!(
                    "sync provider-native transcript {}: {error}",
                    paths.native_path.display()
                )
            });
    }
    if !runner_metadata.is_file() {
        return Err(format!(
            "native runner transcript is not a file: {}",
            paths.runner_path.display()
        ));
    }
    if paths.native_path.is_file() {
        if file_is_byte_prefix(&paths.native_path, &paths.runner_path)? {
            // The isolated provider copy is an append-only extension of the
            // native App copy; replacing it preserves every native byte.
        } else if file_is_byte_prefix(&paths.runner_path, &paths.native_path)? {
            // The native App advanced while ORGII's isolated copy did not.
            // Keep the strictly newer native transcript and converge the
            // runner alias without rewriting the official file.
            replace_runner_link(&paths.native_path, &paths.runner_path)?;
            return Ok(());
        } else if preferred_materialized_transcript_path(paths)
            == Some(paths.runner_path.as_path())
        {
            // Codex may replace the runner symlink with a complete new
            // rollout instead of appending bytes. The interrupted-turn read
            // rule already proved this generation is newer by mtime (or equal
            // mtime plus a larger file), so it is safe to publish.
        } else {
            // Both sides advanced from the same UUID. There is no safe total
            // order for provider-private state, so preserve both artifacts and
            // fail closed. A later continuation can materialize the canonical
            // portable transcript into a fresh native UUID.
            return Err(format!(
                "provider-native transcript conflict for {expected_native_id}: native App and isolated runner both advanced"
            ));
        }
    }
    let parent = paths.native_path.parent().ok_or_else(|| {
        format!(
            "native transcript path has no parent: {}",
            paths.native_path.display()
        )
    })?;
    fs::create_dir_all(parent)
        .map_err(|err| format!("create native transcript dir {}: {err}", parent.display()))?;
    let tmp = paths
        .native_path
        .with_extension(format!("jsonl.tmp-{}", Uuid::new_v4().simple()));

    // The account profile and native App store normally live on the same home
    // volume. Stage a hard link and atomically replace the App copy in O(1).
    // Crucially, the runner name remains valid throughout, so a crash between
    // staging and publication cannot strand the only current transcript under
    // a temporary filename. Cross-filesystem roots use the copy fallback.
    match fs::File::open(&paths.runner_path)
        .and_then(|source| source.sync_all())
        .and_then(|()| fs::hard_link(&paths.runner_path, &tmp))
    {
        Ok(()) => {
            if let Err(error) = atomic_replace_file(&tmp, &paths.native_path, "native transcript") {
                let _ = fs::remove_file(&tmp);
                return Err(error);
            }
            sync_parent_directory(&paths.native_path)?;

            if let Err(link_error) = replace_runner_link(&paths.native_path, &paths.runner_path) {
                // The provider transcript is already durable. Recover a
                // regular runner copy so the next native resume still works;
                // the following publication will retry converting it to the
                // steady-state link.
                let recovery = fs::copy(&paths.native_path, &paths.runner_path)
                    .and_then(|_| fs::File::open(&paths.runner_path)?.sync_all())
                    .and_then(|()| sync_parent_directory(&paths.runner_path).map_err(std::io::Error::other))
                    .map_err(|error| error.to_string());
                return match recovery {
                    Ok(_) => {
                        tracing::warn!(
                            runner_path = %paths.runner_path.display(),
                            native_path = %paths.native_path.display(),
                            error = %link_error,
                            "native transcript published but runner link recovery fell back to a regular file"
                        );
                        Ok(())
                    }
                    Err(recovery_error) => Err(format!(
                        "restore native runner transcript {} after link failure ({link_error}): {recovery_error}",
                        paths.runner_path.display()
                    )),
                };
            }
            return Ok(());
        }
        Err(error) => {
            tracing::debug!(
                runner_path = %paths.runner_path.display(),
                native_path = %paths.native_path.display(),
                error = %error,
                "native transcript hard-link staging unavailable; falling back to copy"
            );
        }
    }

    let result = (|| -> Result<(), String> {
        let mut source = fs::File::open(&paths.runner_path).map_err(|err| {
            format!(
                "open native runner transcript {}: {err}",
                paths.runner_path.display()
            )
        })?;
        let mut destination = fs::File::create(&tmp)
            .map_err(|err| format!("create native transcript {}: {err}", tmp.display()))?;
        std::io::copy(&mut source, &mut destination)
            .map_err(|err| format!("copy native transcript {}: {err}", tmp.display()))?;
        destination
            .sync_all()
            .map_err(|err| format!("sync native transcript {}: {err}", tmp.display()))?;
        atomic_replace_file(&tmp, &paths.native_path, "native transcript")?;
        sync_parent_directory(&paths.native_path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
        return result;
    }
    replace_runner_link(&paths.native_path, &paths.runner_path)
}

fn write_native_store_jsonl(
    paths: &NativeTranscriptPaths,
    records: &[Value],
) -> Result<(), String> {
    atomic_jsonl(&paths.native_path, records)?;
    replace_runner_link(&paths.native_path, &paths.runner_path)
}

fn stable_uuid(namespace: &str, native_id: &str, item_id: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(namespace.as_bytes());
    digest.update([0]);
    digest.update(native_id.as_bytes());
    digest.update([0]);
    digest.update(item_id.as_bytes());
    let hash = digest.finalize();
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&hash[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Uuid::from_bytes(bytes).to_string()
}

fn image_block(data_url: &str) -> Result<Value, String> {
    let Some((header, data)) = data_url.split_once(',') else {
        return Err("historical image data URL is malformed".to_string());
    };
    let media_type = header
        .strip_prefix("data:")
        .and_then(|value| value.strip_suffix(";base64"))
        .filter(|value| value.starts_with("image/"))
        .ok_or_else(|| "historical image must be a base64 image data URL".to_string())?;
    Ok(json!({
        "type": "image",
        "source": {"type": "base64", "media_type": media_type, "data": data}
    }))
}

fn native_agent_messages(target_session_id: &str, items: &[NativeConversationItem]) -> Vec<Value> {
    items
        .iter()
        .map(|item| match item {
            NativeConversationItem::Message {
                id,
                role,
                text,
                images,
                created_at,
                turn_id,
            } => {
                let row_id = native_agent_row_id(target_session_id, id, turn_id.as_deref());
                let mut message =
                    if role == "user" && !images.is_empty() {
                        let mut content = vec![json!({"type": "text", "text": text})];
                        content.extend(images.iter().map(
                            |image| json!({"type": "image_url", "image_url": {"url": image}}),
                        ));
                        json!({"role": role, "content": content})
                    } else {
                        json!({"role": role, "content": text})
                    };
                message["__orgiiNativeMessageId"] = json!(row_id);
                message["__orgiiNativeCreatedAt"] = json!(created_at);
                message
            }
            NativeConversationItem::ToolCall {
                id,
                call_id,
                name,
                arguments,
                created_at,
            } => {
                let mut message = json!({
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [{
                        "id": call_id,
                        "type": "function",
                        "function": {"name": name, "arguments": arguments}
                    }]
                });
                message["__orgiiNativeMessageId"] =
                    json!(native_agent_row_id(target_session_id, id, None));
                message["__orgiiNativeCreatedAt"] = json!(created_at);
                message
            }
            NativeConversationItem::ToolResult {
                id,
                call_id,
                name,
                output,
                created_at,
            } => {
                let mut message = json!({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": name,
                    "content": output
                });
                message["__orgiiNativeMessageId"] =
                    json!(native_agent_row_id(target_session_id, id, None));
                message["__orgiiNativeCreatedAt"] = json!(created_at);
                message
            }
            NativeConversationItem::Compaction {
                id,
                summary,
                created_at,
            } => {
                let mut message = json!({
                    "role": "system",
                    "content": format!(
                        "[Conversation summary — earlier messages compacted]\n\n{summary}"
                    ),
                    "__orgiiNativeCompactBoundary": true,
                });
                message["__orgiiNativeMessageId"] =
                    json!(native_agent_row_id(target_session_id, id, None));
                message["__orgiiNativeCreatedAt"] = json!(created_at);
                message
            }
        })
        .collect()
}

fn native_agent_row_id(target_session_id: &str, source_id: &str, turn_id: Option<&str>) -> String {
    let source = URL_SAFE_NO_PAD.encode(source_id.as_bytes());
    // The target is part of the stable suffix because agent_messages.id is a
    // database-wide primary key: importing the same canonical source into two
    // different execution Sessions must not collide, while retrying the same
    // target append must resolve to the exact same durable rows.
    let target_tag = stable_uuid("orgii-agent-native-row", target_session_id, source_id);
    match turn_id.filter(|value| !value.is_empty()) {
        Some(turn_id) => format!(
            "org2-turn-v1.{}.{}.{}",
            URL_SAFE_NO_PAD.encode(turn_id.as_bytes()),
            source,
            target_tag
        ),
        None => format!("org2-native-v1.{source}.{target_tag}"),
    }
}

fn sanitize_claude_project_name(path: &Path) -> String {
    path.to_string_lossy()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect()
}

fn claude_native_paths(
    account_id: Option<&str>,
    cwd: &Path,
    native_id: &str,
) -> NativeTranscriptPaths {
    let relative = PathBuf::from("projects")
        .join(sanitize_claude_project_name(cwd))
        .join(format!("{native_id}.jsonl"));
    let native_path = app_paths::native_transcript_home_dir()
        .join(".claude")
        .join(&relative);
    NativeTranscriptPaths {
        runner_path: account_id
            .map(|account_id| app_paths::claude_code_cli_profile_dir(account_id).join(relative))
            .unwrap_or_else(|| native_path.clone()),
        native_path,
    }
}

fn codex_sessions_root() -> PathBuf {
    app_paths::native_transcript_home_dir()
        .join(".codex")
        .join("sessions")
}

fn codex_native_paths_for_relative(account_id: &str, relative: &Path) -> NativeTranscriptPaths {
    NativeTranscriptPaths {
        native_path: codex_sessions_root().join(relative),
        runner_path: app_paths::codex_cli_profile_dir(account_id)
            .join("sessions")
            .join(relative),
    }
}

fn cache_codex_native_paths(
    account_id: &str,
    native_id: &str,
    paths: &NativeTranscriptPaths,
) {
    let Ok(mut cache) = CODEX_NATIVE_PATH_CACHE.lock() else {
        return;
    };
    let key = (account_id.to_string(), native_id.to_string());
    if cache.len() >= CODEX_NATIVE_PATH_CACHE_MAX_ENTRIES && !cache.contains_key(&key) {
        if let Some(evicted) = cache.keys().next().cloned() {
            cache.remove(&evicted);
        }
    }
    cache.insert(key, paths.clone());
}

fn existing_codex_native_paths(account_id: &str, native_id: &str) -> Option<NativeTranscriptPaths> {
    let cache_key = (account_id.to_string(), native_id.to_string());
    if let Some(paths) = CODEX_NATIVE_PATH_CACHE
        .lock()
        .ok()
        .and_then(|cache| cache.get(&cache_key).cloned())
    {
        if paths.native_path.is_file() {
            return Some(paths);
        }
        if let Ok(mut cache) = CODEX_NATIVE_PATH_CACHE.lock() {
            cache.remove(&cache_key);
        }
    }

    let runner_root = app_paths::codex_cli_profile_dir(account_id).join("sessions");
    let app_root = codex_sessions_root();
    let (found, root) = find_codex_materialization(&runner_root, native_id)
        .map(|path| (path, runner_root))
        .or_else(|| {
            find_codex_materialization(&app_root, native_id).map(|path| (path, app_root))
        })?;
    let relative = found.strip_prefix(root).ok()?;
    let paths = codex_native_paths_for_relative(account_id, relative);
    cache_codex_native_paths(account_id, native_id, &paths);
    Some(paths)
}

fn registered_codex_native_paths(
    account_id: &str,
    native_path: &Path,
) -> Result<NativeTranscriptPaths, String> {
    let root = codex_sessions_root();
    let relative = match native_path.strip_prefix(&root) {
        Ok(relative) => relative.to_path_buf(),
        Err(_) => {
            let canonical_root = fs::canonicalize(&root).map_err(|error| {
                format!(
                    "canonicalize Codex sessions root {}: {error}",
                    root.display()
                )
            })?;
            let canonical_path = fs::canonicalize(native_path).map_err(|error| {
                format!(
                    "canonicalize Codex rollout {}: {error}",
                    native_path.display()
                )
            })?;
            canonical_path
                .strip_prefix(&canonical_root)
                .map(Path::to_path_buf)
                .map_err(|error| {
                    format!(
                        "Codex app-server registered rollout outside the native profile: path={} root={} ({error})",
                        native_path.display(),
                        root.display()
                    )
                })?
        }
    };
    Ok(codex_native_paths_for_relative(account_id, &relative))
}

/// Read one freshly bound provider transcript directly by its exact UUID.
///
/// The imported-history cache is eventually refreshed and remains the normal
/// reader. Materialization, however, must prove its write synchronously before
/// the provider process starts. Requiring a global history scan here makes a
/// single continuation depend on every unrelated native transcript on disk.
pub(super) fn load_materialized_cli_transcript(
    session: &persistence::CodeSession,
    native_id: &str,
) -> Result<Option<Vec<ActivityChunk>>, String> {
    let agent = session.cli_agent_type.as_deref().unwrap_or_default();
    let account_id = session
        .account_id
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    let cwd = execution_cwd(session)?;
    let paths = match agent {
        "claude_code" => claude_native_paths(account_id, &cwd, native_id),
        "codex" => {
            let account_id = account_id.ok_or_else(|| {
                "native Codex transcript read requires an explicit local account".to_string()
            })?;
            let Some(paths) = existing_codex_native_paths(account_id, native_id) else {
                return Ok(None);
            };
            paths
        }
        _ => return Ok(None),
    };
    let Some(path) = preferred_materialized_transcript_path(&paths) else {
        return Ok(None);
    };
    let chunks = match agent {
        "claude_code" => {
            orgtrack_core::sources::claude_code::history::load_claude_code_history_from_path(
                &session.session_id,
                path,
            )?
        }
        "codex" => {
            orgtrack_core::sources::codex::app::load_codex_app_from_path(&session.session_id, path)?
        }
        _ => unreachable!("unsupported targets returned above"),
    };
    Ok(Some(chunks))
}

/// Select the authoritative readable copy after an interrupted provider turn.
///
/// The steady state is one identity (a symlink on Unix; commonly a hard link
/// on Windows). Some providers atomically replace the isolated runner file,
/// leaving the App copy behind until publication. In that diverged state a
/// strictly newer runner -- or an equal-timestamp append with a larger size --
/// is the only copy that can contain the just-finished partial/tool suffix.
/// Never prefer a merely different runner: the native App may itself have
/// advanced a conversation, and coarse filesystem timestamps cannot prove the
/// isolated copy is newer.
fn preferred_materialized_transcript_path(paths: &NativeTranscriptPaths) -> Option<&Path> {
    let native_metadata = fs::metadata(&paths.native_path).ok();
    let runner_metadata = fs::metadata(&paths.runner_path).ok();
    match (native_metadata, runner_metadata) {
        (None, None) => None,
        (Some(_), None) => Some(&paths.native_path),
        (None, Some(_)) => Some(&paths.runner_path),
        (Some(native), Some(runner)) => {
            if paths_match(&paths.native_path, &paths.runner_path) {
                return Some(&paths.native_path);
            }
            let runner_is_newer = match (native.modified(), runner.modified()) {
                (Ok(native_modified), Ok(runner_modified)) => {
                    runner_modified > native_modified
                        || (runner_modified == native_modified && runner.len() > native.len())
                }
                _ => false,
            };
            if runner_is_newer {
                tracing::warn!(
                    native_path = %paths.native_path.display(),
                    runner_path = %paths.runner_path.display(),
                    "reading newer unpublished provider transcript from isolated runner"
                );
                Some(&paths.runner_path)
            } else {
                Some(&paths.native_path)
            }
        }
    }
}

fn paths_match(left: &Path, right: &Path) -> bool {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

fn git_common_dir(path: &Path) -> Option<PathBuf> {
    let mut directory = fs::canonicalize(path).ok()?;
    loop {
        let dot_git = directory.join(".git");
        if dot_git.is_dir() {
            return fs::canonicalize(dot_git).ok();
        }
        if dot_git.is_file() {
            let raw = fs::read_to_string(&dot_git).ok()?;
            let raw_git_dir = raw.trim().strip_prefix("gitdir:")?.trim();
            let git_dir = PathBuf::from(raw_git_dir);
            let git_dir = if git_dir.is_absolute() {
                git_dir
            } else {
                directory.join(git_dir)
            };
            let git_dir = fs::canonicalize(git_dir).ok()?;
            let common_dir_file = git_dir.join("commondir");
            if !common_dir_file.is_file() {
                return Some(git_dir);
            }
            let raw_common_dir = fs::read_to_string(common_dir_file).ok()?;
            let common_dir = PathBuf::from(raw_common_dir.trim());
            let common_dir = if common_dir.is_absolute() {
                common_dir
            } else {
                git_dir.join(common_dir)
            };
            return fs::canonicalize(common_dir).ok();
        }
        directory = directory.parent()?.to_path_buf();
    }
}

fn paths_share_git_repository(left: &Path, right: &Path, left_common_dir: Option<&Path>) -> bool {
    let left_common_dir = left_common_dir
        .map(Path::to_path_buf)
        .or_else(|| git_common_dir(left));
    left_common_dir
        .zip(git_common_dir(right))
        .is_some_and(|(left, right)| left == right)
}

fn claude_desktop_sessions_roots() -> Vec<PathBuf> {
    let mut roots = [
        app_paths::native_transcript_data_dir(),
        app_paths::native_transcript_data_local_dir(),
        app_paths::native_transcript_config_dir(),
    ]
    .into_iter()
    .map(|root| root.join("Claude").join("claude-code-sessions"))
    .collect::<Vec<_>>();
    roots.sort();
    roots.dedup();
    roots
}

fn claude_desktop_active_account_id(sessions_root: &Path) -> Option<String> {
    let config_path = sessions_root.parent()?.join("config.json");
    let config = fs::read_to_string(config_path).ok()?;
    let config = serde_json::from_str::<Value>(&config).ok()?;
    let account_id = config["lastKnownAccountUuid"].as_str()?;
    Uuid::parse_str(account_id).ok()?;
    Some(account_id.to_string())
}

fn publish_claude_project_index(
    cwd: &Path,
    native_id: &str,
    items: &[NativeConversationItem],
    completed_turns: Option<usize>,
    git_branch: Option<&str>,
) -> Result<PathBuf, String> {
    let _index_guard = CLAUDE_PROJECT_INDEX_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let (index_path, index) = prepare_claude_project_index(
        cwd,
        native_id,
        items,
        completed_turns,
        git_branch,
    )?;
    atomic_json(&index_path, &index)?;
    Ok(index_path)
}

fn prepare_claude_project_index(
    cwd: &Path,
    native_id: &str,
    items: &[NativeConversationItem],
    completed_turns: Option<usize>,
    git_branch: Option<&str>,
) -> Result<(PathBuf, Value), String> {
    let transcript_path = claude_native_paths(None, cwd, native_id).native_path;
    let project_dir = transcript_path.parent().ok_or_else(|| {
        format!(
            "Claude native transcript has no project directory: {}",
            transcript_path.display()
        )
    })?;
    fs::create_dir_all(project_dir).map_err(|error| {
        format!(
            "create Claude native project directory {}: {error}",
            project_dir.display()
        )
    })?;
    let index_path = project_dir.join("sessions-index.json");
    let mut index = match fs::read_to_string(&index_path) {
        Ok(raw) => serde_json::from_str::<Value>(&raw).map_err(|error| {
            format!(
                "decode existing Claude project index {}: {error}",
                index_path.display()
            )
        })?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            json!({"version": 1, "entries": []})
        }
        Err(error) => {
            return Err(format!(
                "read Claude project index {}: {error}",
                index_path.display()
            ))
        }
    };
    let object = index.as_object_mut().ok_or_else(|| {
        format!(
            "Claude project index is not an object: {}",
            index_path.display()
        )
    })?;
    object
        .entry("version".to_string())
        .or_insert_with(|| Value::Number(1.into()));
    let entries = object
        .entry("entries".to_string())
        .or_insert_with(|| Value::Array(Vec::new()))
        .as_array_mut()
        .ok_or_else(|| {
            format!(
                "Claude project index entries are not an array: {}",
                index_path.display()
            )
        })?;
    let previous = entries
        .iter()
        .find(|entry| entry["sessionId"].as_str() == Some(native_id))
        .cloned();
    entries.retain(|entry| entry["sessionId"].as_str() != Some(native_id));
    let now = Utc::now();
    let now_iso = now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let created = previous
        .as_ref()
        .and_then(|entry| entry["created"].as_str())
        .unwrap_or(&now_iso)
        .to_string();
    let first_prompt = items
        .iter()
        .find_map(|item| match item {
            NativeConversationItem::Message { role, text, .. } if role == "user" => {
                Some(text.trim())
            }
            _ => None,
        })
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            previous
                .as_ref()
                .and_then(|entry| entry["firstPrompt"].as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "Imported conversation".to_string());
    let projected_message_count = items
        .iter()
        .filter(|item| matches!(item, NativeConversationItem::Message { .. }))
        .count();
    let previous_message_count = previous
        .as_ref()
        .and_then(|entry| entry["messageCount"].as_u64())
        .unwrap_or_default() as usize;
    let completed_message_count = completed_turns.unwrap_or_default().saturating_mul(2);
    let message_count = projected_message_count
        .max(previous_message_count)
        .max(completed_message_count);
    entries.push(json!({
        "sessionId": native_id,
        "fullPath": transcript_path,
        "fileMtime": now.timestamp_millis(),
        "firstPrompt": first_prompt,
        "messageCount": message_count,
        "created": created,
        "modified": now_iso,
        "gitBranch": git_branch.unwrap_or_default(),
        "workspacePath": cwd,
    }));
    Ok((index_path, index))
}

fn remove_claude_project_index_entry(cwd: &Path, native_id: &str) -> Result<(), String> {
    let index_path = claude_native_paths(None, cwd, native_id)
        .native_path
        .parent()
        .map(|project| project.join("sessions-index.json"))
        .ok_or_else(|| "Claude native transcript has no project directory".to_string())?;
    let _index_guard = CLAUDE_PROJECT_INDEX_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if !index_path.is_file() {
        return Ok(());
    }
    let mut index = fs::read_to_string(&index_path)
        .map_err(|error| {
            format!(
                "read Claude project index {}: {error}",
                index_path.display()
            )
        })
        .and_then(|raw| {
            serde_json::from_str::<Value>(&raw)
                .map_err(|error| format!("decode Claude project index: {error}"))
        })?;
    let Some(entries) = index["entries"].as_array_mut() else {
        return Err(format!(
            "Claude project index entries are not an array: {}",
            index_path.display()
        ));
    };
    let previous_len = entries.len();
    entries.retain(|entry| entry["sessionId"].as_str() != Some(native_id));
    if entries.len() != previous_len {
        atomic_json(&index_path, &index)?;
    }
    Ok(())
}

#[derive(Debug, Default)]
struct ClaudeDesktopCatalogResolution {
    active_account_root: bool,
    existing_session_path: Option<PathBuf>,
    matching_project_dir: Option<PathBuf>,
}

impl ClaudeDesktopCatalogResolution {
    fn priority(&self) -> u8 {
        if self.existing_session_path.is_some() {
            0
        } else if self.active_account_root {
            1
        } else if self.matching_project_dir.is_some() {
            2
        } else {
            3
        }
    }

    fn target_path(&self, native_id: &str) -> Option<PathBuf> {
        self.existing_session_path.clone().or_else(|| {
            self.matching_project_dir
                .as_ref()
                .map(|project_dir| project_dir.join(format!("local_{native_id}.json")))
        })
    }
}

fn resolve_claude_desktop_catalog(
    root: &Path,
    cwd: &Path,
    native_id: &str,
) -> ClaudeDesktopCatalogResolution {
    let active_account_id = claude_desktop_active_account_id(root);
    let active_account_root = active_account_id.is_some();
    let mut existing_session: Option<(i64, PathBuf)> = None;
    let mut matching_project: Option<(i64, PathBuf)> = None;
    let mut visited = 0usize;
    let cwd_common_dir = git_common_dir(cwd);
    let organization_dirs = match active_account_id {
        Some(account_id) => vec![root.join(account_id)],
        None => match fs::read_dir(root) {
            Ok(entries) => entries.flatten().map(|entry| entry.path()).collect(),
            Err(_) => Vec::new(),
        },
    };
    for organization_dir in organization_dirs {
        if !organization_dir.is_dir() {
            continue;
        }
        let Ok(projects) = fs::read_dir(organization_dir) else {
            continue;
        };
        for project in projects.flatten() {
            let project_path = project.path();
            if !project_path.is_dir() {
                continue;
            }
            let Ok(entries) = fs::read_dir(&project_path) else {
                continue;
            };
            for entry in entries.flatten() {
                visited += 1;
                if visited > MAX_ITEMS {
                    return ClaudeDesktopCatalogResolution {
                        active_account_root,
                        existing_session_path: existing_session.map(|(_, path)| path),
                        matching_project_dir: matching_project.map(|(_, path)| path),
                    };
                }
                let path = entry.path();
                if path.extension().and_then(|value| value.to_str()) != Some("json") {
                    continue;
                }
                let Ok(value) = fs::read_to_string(&path)
                    .ok()
                    .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
                    .ok_or(())
                else {
                    continue;
                };
                let exact_cwd = ["cwd", "originCwd"].into_iter().any(|field| {
                    value[field]
                        .as_str()
                        .is_some_and(|record_cwd| paths_match(Path::new(record_cwd), cwd))
                });
                let matches_project = exact_cwd
                    || ["cwd", "originCwd"].into_iter().any(|field| {
                        value[field].as_str().is_some_and(|record_cwd| {
                            paths_share_git_repository(
                                cwd,
                                Path::new(record_cwd),
                                cwd_common_dir.as_deref(),
                            )
                        })
                    });
                let activity = value["lastActivityAt"]
                    .as_i64()
                    .or_else(|| value["createdAt"].as_i64())
                    .unwrap_or_default();
                if exact_cwd
                    && value["cliSessionId"].as_str() == Some(native_id)
                    && existing_session
                        .as_ref()
                        .is_none_or(|(best_activity, _)| activity > *best_activity)
                {
                    existing_session = Some((activity, path));
                }
                if matches_project
                    && matching_project
                        .as_ref()
                        .is_none_or(|(best_activity, _)| activity > *best_activity)
                {
                    matching_project = Some((activity, project_path.clone()));
                }
            }
        }
    }
    ClaudeDesktopCatalogResolution {
        active_account_root,
        existing_session_path: existing_session.map(|(_, path)| path),
        matching_project_dir: matching_project.map(|(_, path)| path),
    }
}

fn first_user_title(items: &[NativeConversationItem]) -> String {
    let title = items.iter().find_map(|item| match item {
        NativeConversationItem::Message { role, text, .. } if role == "user" => Some(text.trim()),
        _ => None,
    });
    let title = title
        .filter(|value| !value.is_empty())
        .unwrap_or("Imported conversation");
    title.chars().take(120).collect()
}

fn assistant_turn_count(items: &[NativeConversationItem]) -> usize {
    items
        .iter()
        .filter(|item| {
            matches!(item, NativeConversationItem::Message { role, .. } if role == "assistant")
        })
        .count()
}

fn publish_claude_desktop_session(
    cwd: &Path,
    native_id: &str,
    model: Option<&str>,
    title: Option<&str>,
    items: &[NativeConversationItem],
    materialized_by_orgii: bool,
    completed_turns: Option<usize>,
) -> Result<Option<PathBuf>, String> {
    let mut catalogs = claude_desktop_sessions_roots()
        .into_iter()
        .map(|sessions_root| resolve_claude_desktop_catalog(&sessions_root, cwd, native_id))
        .collect::<Vec<_>>();
    // Prefer an exact provider-owned row, then the root of Desktop's active
    // account, then any existing matching project. Filesystem path ordering
    // is not an account-selection policy.
    catalogs.sort_by_key(ClaudeDesktopCatalogResolution::priority);
    for resolution in catalogs {
        let Some(path) = resolution.target_path(native_id) else {
            continue;
        };
        if let Some(path) = publish_claude_desktop_session_to_path(
            path,
            cwd,
            native_id,
            model,
            title,
            items,
            materialized_by_orgii,
            completed_turns,
        )? {
            return Ok(Some(path));
        }
    }
    Ok(None)
}

#[cfg(test)]
#[derive(Clone, Copy)]
struct ClaudeDesktopPublicationState {
    materialized_by_orgii: bool,
    completed_turns: Option<usize>,
}

#[cfg(test)]
fn publish_claude_desktop_session_at(
    sessions_root: &Path,
    cwd: &Path,
    native_id: &str,
    model: Option<&str>,
    title: Option<&str>,
    items: &[NativeConversationItem],
    state: ClaudeDesktopPublicationState,
) -> Result<Option<PathBuf>, String> {
    let resolution = resolve_claude_desktop_catalog(sessions_root, cwd, native_id);
    let Some(path) = resolution.target_path(native_id) else {
        // Native Claude Code JSONL remains independently valid, but this
        // function is specifically the Desktop catalog adapter. Do not
        // manufacture account/project UUIDs and call the result App-visible
        // when Desktop has never registered them.
        return Ok(None);
    };
    publish_claude_desktop_session_to_path(
        path,
        cwd,
        native_id,
        model,
        title,
        items,
        state.materialized_by_orgii,
        state.completed_turns,
    )
}

#[allow(clippy::too_many_arguments)]
fn publish_claude_desktop_session_to_path(
    path: PathBuf,
    cwd: &Path,
    native_id: &str,
    model: Option<&str>,
    title: Option<&str>,
    items: &[NativeConversationItem],
    materialized_by_orgii: bool,
    completed_turns: Option<usize>,
) -> Result<Option<PathBuf>, String> {
    let mut metadata = match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str::<Value>(&raw).map_err(|error| {
            format!(
                "decode existing Claude Desktop metadata {}: {error}",
                path.display()
            )
        })?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => json!({}),
        Err(error) => {
            return Err(format!(
                "read Claude Desktop metadata {}: {error}",
                path.display()
            ))
        }
    };
    let object = metadata.as_object_mut().ok_or_else(|| {
        format!(
            "Claude Desktop metadata is not an object: {}",
            path.display()
        )
    })?;
    let now = Utc::now().timestamp_millis();
    let existing_completed_turns = object
        .get("completedTurns")
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok());
    let projected_completed_turns = (!items.is_empty()).then(|| assistant_turn_count(items));
    let Some(completed_turns) = [
        completed_turns,
        existing_completed_turns,
        projected_completed_turns,
    ]
    .into_iter()
    .flatten()
    .max() else {
        // A metadata-only refresh has no safe progress value when neither the
        // queue nor an existing provider row carries one. Leave the catalog
        // untouched instead of resetting completedTurns to zero.
        return Ok(None);
    };

    object
        .entry("sessionId".to_string())
        .or_insert_with(|| Value::String(format!("local_{native_id}")));
    object.insert(
        "cliSessionId".to_string(),
        Value::String(native_id.to_string()),
    );
    object.insert(
        "cwd".to_string(),
        Value::String(cwd.to_string_lossy().into()),
    );
    object
        .entry("originCwd".to_string())
        .or_insert_with(|| Value::String(cwd.to_string_lossy().into()));
    object
        .entry("createdAt".to_string())
        .or_insert_with(|| Value::Number(now.into()));
    object.insert("lastFocusedAt".to_string(), Value::Number(now.into()));
    object.insert("lastActivityAt".to_string(), Value::Number(now.into()));
    object.entry("title".to_string()).or_insert_with(|| {
        Value::String(
            title
                .filter(|value| !value.trim().is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| first_user_title(items)),
        )
    });
    object
        .entry("titleSource".to_string())
        .or_insert_with(|| Value::String("orgii".to_string()));
    object
        .entry("permissionMode".to_string())
        .or_insert_with(|| Value::String("auto".to_string()));
    object
        .entry("isArchived".to_string())
        .or_insert(Value::Bool(false));
    object
        .entry("remoteMcpServersConfig".to_string())
        .or_insert_with(|| Value::Array(Vec::new()));
    object.insert(
        "completedTurns".to_string(),
        Value::Number(completed_turns.into()),
    );
    object
        .entry("alwaysAllowedReasons".to_string())
        .or_insert_with(|| Value::Array(Vec::new()));
    object
        .entry("sessionPermissionUpdates".to_string())
        .or_insert_with(|| Value::Array(Vec::new()));
    object
        .entry("classifierSummaryEnabled".to_string())
        .or_insert(Value::Bool(true));
    if materialized_by_orgii {
        object.insert("orgiiMaterialization".to_string(), Value::Bool(true));
    }
    if let Some(model) = model.filter(|value| !value.trim().is_empty()) {
        object
            .entry("model".to_string())
            .or_insert_with(|| Value::String(model.to_string()));
    }
    atomic_json(&path, &metadata)?;
    // Read through the same provider-owned metadata boundary before reporting
    // success. This is deliberately stronger than trusting our in-memory JSON:
    // malformed/redirected writes remain native-format-only and materialize
    // fails closed instead of promising an App-visible catalog row.
    let published = fs::read_to_string(&path)
        .map_err(|error| {
            format!(
                "read back Claude Desktop session {}: {error}",
                path.display()
            )
        })
        .and_then(|raw| {
            serde_json::from_str::<Value>(&raw).map_err(|error| {
                format!(
                    "decode published Claude Desktop session {}: {error}",
                    path.display()
                )
            })
        })?;
    let published_cwd_matches = ["cwd", "originCwd"].into_iter().any(|field| {
        published[field]
            .as_str()
            .is_some_and(|value| paths_match(Path::new(value), cwd))
    });
    if published["cliSessionId"].as_str() != Some(native_id)
        || !published_cwd_matches
        || !published["title"].is_string()
        || !published["completedTurns"].is_number()
    {
        return Err(format!(
            "Claude Desktop catalog read-back rejected {}",
            path.display()
        ));
    }
    Ok(Some(path))
}

fn remove_claude_desktop_session(native_id: &str) -> Result<(), String> {
    for root in claude_desktop_sessions_roots() {
        remove_claude_desktop_session_at(&root, native_id)?;
    }
    Ok(())
}

fn remove_claude_desktop_session_at(root: &Path, native_id: &str) -> Result<(), String> {
    if !root.is_dir() {
        return Ok(());
    }
    let filename = format!("local_{native_id}.json");
    for organization in fs::read_dir(root)
        .map_err(|err| format!("read Claude Desktop sessions {}: {err}", root.display()))?
        .flatten()
    {
        for project in fs::read_dir(organization.path())
            .into_iter()
            .flatten()
            .flatten()
        {
            let path = project.path().join(&filename);
            if !path.is_file() {
                continue;
            }
            let matches_native_id = fs::read_to_string(&path)
                .ok()
                .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
                .and_then(|value| value["cliSessionId"].as_str().map(str::to_string))
                .as_deref()
                == Some(native_id);
            if matches_native_id {
                fs::remove_file(&path).map_err(|err| {
                    format!("remove Claude Desktop session {}: {err}", path.display())
                })?;
            }
        }
    }
    Ok(())
}

fn claude_records(
    native_id: &str,
    cwd: &Path,
    items: &[NativeConversationItem],
) -> Result<Vec<Value>, String> {
    let mut records = Vec::with_capacity(items.len().saturating_mul(2));
    let mut parent_uuid: Option<String> = None;
    for item in items {
        if let NativeConversationItem::Compaction {
            id,
            summary,
            created_at,
        } = item
        {
            let boundary_uuid = stable_uuid("orgii-claude-native-compact-boundary", native_id, id);
            records.push(json!({
                "type": "system",
                "subtype": "compact_boundary",
                "content": "Conversation compacted",
                "uuid": boundary_uuid,
                "parentUuid": parent_uuid,
                "isSidechain": false,
                "isMeta": false,
                "sessionId": native_id,
                "cwd": cwd,
                "timestamp": created_at,
                "entrypoint": "orgii",
                "orgiiMaterialization": true,
                "compactMetadata": {"trigger": "orgii_native_transfer"},
            }));
            let summary_uuid = stable_uuid("orgii-claude-native-compact-summary", native_id, id);
            records.push(json!({
                "type": "user",
                "uuid": summary_uuid,
                "parentUuid": boundary_uuid,
                "isSidechain": false,
                "isCompactSummary": true,
                "userType": "external",
                "sessionId": native_id,
                "cwd": cwd,
                "timestamp": created_at,
                "message": {"role": "user", "content": summary},
                "entrypoint": "orgii",
                "orgiiMaterialization": true,
            }));
            parent_uuid = Some(summary_uuid);
            continue;
        }
        let record_uuid = stable_uuid("orgii-claude-native", native_id, item.id());
        let (record_type, message, extra) = match item {
            NativeConversationItem::Message {
                role, text, images, ..
            } => {
                let content = if role == "assistant" {
                    Value::Array(vec![json!({"type": "text", "text": text})])
                } else if images.is_empty() {
                    Value::String(text.clone())
                } else {
                    let mut blocks = vec![json!({"type": "text", "text": text})];
                    for image in images {
                        blocks.push(image_block(image)?);
                    }
                    Value::Array(blocks)
                };
                (
                    role.clone(),
                    json!({"role": role, "content": content}),
                    None,
                )
            }
            NativeConversationItem::ToolCall {
                call_id,
                name,
                arguments,
                ..
            } => (
                "assistant".to_string(),
                json!({
                    "role": "assistant",
                    "content": [{
                        "type": "tool_use",
                        "id": call_id,
                        "name": name,
                        "input": serde_json::from_str::<Value>(arguments)
                            .map_err(|err| format!("parse tool arguments: {err}"))?
                    }]
                }),
                None,
            ),
            NativeConversationItem::ToolResult {
                call_id, output, ..
            } => (
                "user".to_string(),
                json!({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": call_id,
                        "content": output
                    }]
                }),
                Some(json!({"toolUseResult": output})),
            ),
            NativeConversationItem::Compaction { .. } => {
                unreachable!("compaction handled before message projection")
            }
        };
        let mut record = json!({
            "type": record_type,
            "uuid": record_uuid,
            "parentUuid": parent_uuid,
            "isSidechain": false,
            "userType": "external",
            "sessionId": native_id,
            "cwd": cwd,
            "timestamp": item.created_at(),
            "message": message,
            "entrypoint": "orgii",
            "orgiiMaterialization": true
        });
        if let Some(Value::Object(extra)) = extra {
            record.as_object_mut().expect("record object").extend(extra);
        }
        parent_uuid = Some(record_uuid);
        records.push(record);
    }
    Ok(records)
}

fn claude_resume_checkpoint(
    native_id: &str,
    leaf_uuid: &str,
    items: &[NativeConversationItem],
) -> Value {
    let last_prompt = items
        .iter()
        .rev()
        .find_map(|item| match item {
            NativeConversationItem::Message { role, text, .. }
                if role == "user" && !text.trim().is_empty() =>
            {
                Some(text.as_str())
            }
            _ => None,
        })
        .unwrap_or_default();
    json!({
        "type": "last-prompt",
        "lastPrompt": last_prompt,
        "leafUuid": leaf_uuid,
        "sessionId": native_id,
        "orgiiMaterialization": true,
    })
}

fn claude_records_with_resume_checkpoint(
    native_id: &str,
    cwd: &Path,
    items: &[NativeConversationItem],
) -> Result<Vec<Value>, String> {
    let mut records = claude_records(native_id, cwd, items)?;
    if let Some(leaf_uuid) = records
        .last()
        .and_then(|record| record["uuid"].as_str())
        .map(str::to_string)
    {
        records.push(claude_resume_checkpoint(native_id, &leaf_uuid, items));
    }
    Ok(records)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NativeSuffixApplication {
    Missing,
    AlreadyApplied,
}

fn inspect_claude_suffix_application(
    path: &Path,
    expected_records: &[Value],
) -> Result<(NativeSuffixApplication, Option<String>), String> {
    let mut expected_records_by_id = HashMap::with_capacity(expected_records.len());
    for record in expected_records {
        let id = record["uuid"]
            .as_str()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                "projected Claude native suffix record has no stable uuid".to_string()
            })?;
        let mut normalized = record.clone();
        normalized
            .as_object_mut()
            .ok_or_else(|| "projected Claude native suffix record is not an object".to_string())?
            .remove("parentUuid");
        if expected_records_by_id
            .insert(id.to_string(), normalized)
            .is_some()
        {
            return Err(format!(
                "projected Claude native suffix contains duplicate uuid {id}"
            ));
        }
    }
    if expected_records_by_id.is_empty() {
        return Err("projected Claude native suffix is empty".to_string());
    }

    let file = fs::File::open(path)
        .map_err(|error| format!("open Claude native transcript {}: {error}", path.display()))?;
    let mut found_ids = HashSet::with_capacity(expected_records_by_id.len());
    let mut active_leaf_uuid = None;
    for (line_index, line) in BufReader::new(file).lines().enumerate() {
        let line = line.map_err(|error| {
            format!(
                "read Claude native transcript {} line {}: {error}",
                path.display(),
                line_index + 1
            )
        })?;
        if line.trim().is_empty() {
            continue;
        }
        let record = serde_json::from_str::<Value>(&line).map_err(|error| {
            format!(
                "decode Claude native transcript {} line {}: {error}",
                path.display(),
                line_index + 1
            )
        })?;
        if record["type"] == "last-prompt" {
            if let Some(leaf_uuid) = record["leafUuid"]
                .as_str()
                .filter(|value| !value.trim().is_empty())
            {
                active_leaf_uuid = Some(leaf_uuid.to_string());
            }
        } else if let Some(uuid) = record["uuid"]
            .as_str()
            .filter(|value| !value.trim().is_empty())
        {
            active_leaf_uuid = Some(uuid.to_string());
            if let Some(expected) = expected_records_by_id.get(uuid) {
                let mut normalized = record.clone();
                normalized
                    .as_object_mut()
                    .ok_or_else(|| {
                        format!(
                            "Claude native transcript {} contains non-object stable suffix record {uuid}",
                            path.display()
                        )
                    })?
                    .remove("parentUuid");
                if &normalized != expected {
                    return Err(format!(
                        "Claude native transcript {} contains stable suffix uuid {uuid} with conflicting content",
                        path.display()
                    ));
                }
                if !found_ids.insert(uuid.to_string()) {
                    return Err(format!(
                        "Claude native transcript {} contains duplicate stable suffix uuid {uuid}",
                        path.display()
                    ));
                }
            }
        }
    }

    if found_ids.is_empty() {
        Ok((NativeSuffixApplication::Missing, active_leaf_uuid))
    } else if found_ids.len() == expected_records_by_id.len() {
        Ok((NativeSuffixApplication::AlreadyApplied, active_leaf_uuid))
    } else {
        Err(format!(
            "Claude native transcript {} contains {} of {} stable suffix records; refusing a mixed retry",
            path.display(),
            found_ids.len(),
            expected_records_by_id.len()
        ))
    }
}

fn codex_response_items(items: &[NativeConversationItem]) -> Vec<Value> {
    const MATERIALIZED_ARGUMENT_KEY: &str = "__orgiiMaterializedNative";
    const CANONICAL_ARGUMENT_KEY: &str = "__orgiiCanonicalArguments";
    const MATERIALIZED_COMPACTION_TURN_PREFIX: &str = "orgii-materialized-compaction:";

    let mut projected = Vec::with_capacity(items.len().saturating_add(2));
    for item in items {
        match item {
            NativeConversationItem::Message {
                id,
                role,
                text,
                images,
                ..
            } => {
                let text_type = if role == "user" {
                    "input_text"
                } else {
                    "output_text"
                };
                let mut content = vec![json!({"type": text_type, "text": text})];
                if role == "user" {
                    content.extend(
                        images
                            .iter()
                            .map(|image| json!({"type": "input_image", "image_url": image})),
                    );
                }
                let mut message =
                    json!({"type": "message", "id": id, "role": role, "content": content});
                if role == "user" {
                    // `thread/inject_items` persists only response items; it
                    // does not synthesize the event_msg/UserMessage mirror
                    // found after an ordinary Codex UI submission. Stamp the
                    // supported passthrough turn id so our native reader can
                    // distinguish these canonical user rows from Codex's
                    // user-role system/context prefix messages.
                    message["internal_chat_message_metadata_passthrough"] = json!({
                        "turn_id": format!("orgii-materialization-{id}")
                    });
                }
                projected.push(message);
            }
            NativeConversationItem::ToolCall {
                call_id,
                name,
                arguments,
                ..
            } => {
                // `thread/inject_items` drops unknown response-item fields, so
                // the legacy `orgii_materialization` boolean cannot survive a
                // real app-server round trip. Arguments are protocol data and
                // survive verbatim. The `__orgii` namespace is already
                // excluded from portable user tool arguments; the reader
                // removes this marker before publishing canonical history.
                let canonical = serde_json::from_str::<Value>(arguments)
                    .expect("validated native tool arguments");
                let marked_arguments = match canonical {
                    Value::Object(mut object) => {
                        object.insert(MATERIALIZED_ARGUMENT_KEY.to_string(), Value::Bool(true));
                        Value::Object(object)
                    }
                    canonical => {
                        let mut object = serde_json::Map::new();
                        object.insert(MATERIALIZED_ARGUMENT_KEY.to_string(), Value::Bool(true));
                        object.insert(CANONICAL_ARGUMENT_KEY.to_string(), canonical);
                        Value::Object(object)
                    }
                };
                projected.push(json!({
                    "type": "function_call",
                    "name": name,
                    "arguments": marked_arguments.to_string(),
                    "call_id": call_id
                }));
            }
            NativeConversationItem::ToolResult {
                call_id, output, ..
            } => projected.push(json!({
                "type": "function_call_output",
                "call_id": call_id,
                "output": output
            })),
            NativeConversationItem::Compaction { id, summary, .. } => {
                // `thread/inject_items` supports the Responses API's native
                // `context_compaction` item. A cross-provider source cannot
                // forge Codex's provider-encrypted compact payload, so carry
                // the portable summary as an adjacent model-visible assistant
                // item and tag both with the supported passthrough turn id.
                // The native reader folds this exact pair back into one
                // canonical compaction boundary; it is never projected as a
                // fake user prompt.
                let marker = format!("{MATERIALIZED_COMPACTION_TURN_PREFIX}{id}");
                projected.push(json!({
                    "type": "message",
                    "id": format!("{id}-summary"),
                    "role": "assistant",
                    "content": [{"type": "output_text", "text": summary}],
                    "internal_chat_message_metadata_passthrough": {
                        "turn_id": marker
                    }
                }));
                projected.push(json!({
                    "type": "context_compaction",
                    "id": id,
                    "encrypted_content": null,
                    "internal_chat_message_metadata_passthrough": {
                        "turn_id": marker
                    }
                }));
            }
        }
    }
    if let Some(first) = projected.first_mut().and_then(Value::as_object_mut) {
        first.insert("orgii_materialization".to_string(), Value::Bool(true));
    }
    projected
}

fn provider_canonical_cwd(cwd: PathBuf) -> PathBuf {
    fs::canonicalize(&cwd).unwrap_or(cwd)
}

fn execution_cwd(session: &persistence::CodeSession) -> Result<PathBuf, String> {
    let value = session
        .worktree_path
        .as_deref()
        .or(session.repo_path.as_deref())
        .filter(|value| !value.trim().is_empty());
    let cwd = match value {
        Some(value) => PathBuf::from(value),
        None => std::env::current_dir().map_err(|err| format!("resolve execution cwd: {err}"))?,
    };

    // Provider CLIs identify projects by the canonical working directory.
    // This matters on macOS where `/tmp` is a symlink to `/private/tmp`:
    // writing a Claude transcript below `projects/-tmp-...` looks correct to
    // our reader, but `claude --resume` searches `projects/-private-tmp-...`
    // and rejects the freshly materialized UUID.  Use the same identity the
    // child process observes, while retaining the configured path for a
    // not-yet-created workspace so materialization still fails/rolls back at
    // the normal launch boundary.
    Ok(provider_canonical_cwd(cwd))
}

fn find_codex_materialization(root: &Path, native_id: &str) -> Option<PathBuf> {
    let suffix = format!("-{native_id}.jsonl");
    let mut pending = vec![root.to_path_buf()];
    let mut visited = 0usize;
    while let Some(directory) = pending.pop() {
        let entries = fs::read_dir(directory).ok()?;
        for entry in entries.flatten() {
            visited += 1;
            if visited > MAX_ITEMS {
                return None;
            }
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else if path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.ends_with(&suffix))
            {
                return Some(path);
            }
        }
    }
    None
}

fn has_orgii_materialization_marker(path: &Path, agent: &str) -> bool {
    let Ok(file) = fs::File::open(path) else {
        return false;
    };
    let mut lines = BufReader::new(file).lines().take(MAX_ITEMS);
    match agent {
        "claude_code" => lines
            .next()
            .and_then(Result::ok)
            .and_then(|line| serde_json::from_str::<Value>(&line).ok())
            .is_some_and(|record| record["orgiiMaterialization"] == true),
        "codex" => lines.filter_map(Result::ok).any(|line| {
            serde_json::from_str::<Value>(&line)
                .ok()
                .is_some_and(|record| codex_record_has_orgii_materialization_marker(&record))
        }),
        _ => false,
    }
}

fn codex_record_has_orgii_materialization_marker(record: &Value) -> bool {
    if record["type"] == "session_meta" && record["payload"]["originator"] == "orgii" {
        return true;
    }
    if record["type"] != "response_item" {
        return false;
    }
    let payload = &record["payload"];
    if payload["orgii_materialization"] == true {
        return true;
    }
    if payload["internal_chat_message_metadata_passthrough"]["turn_id"]
        .as_str()
        .is_some_and(|turn_id| {
            turn_id.starts_with("orgii-materialization-")
                || turn_id.starts_with("orgii-materialized-compaction:")
        })
    {
        return true;
    }
    payload["type"] == "function_call"
        && payload["arguments"]
            .as_str()
            .and_then(|arguments| serde_json::from_str::<Value>(arguments).ok())
            .is_some_and(|arguments| arguments["__orgiiMaterializedNative"] == true)
}

fn discard_cli_materialization(session_id: &str, native_id: &str) -> Result<bool, String> {
    let session = persistence::get_session(session_id)
        .map_err(|err| format!("load CLI session {session_id}: {err}"))?
        .ok_or_else(|| format!("CLI session {session_id} does not exist"))?;
    let account_id = session
        .account_id
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    let bound = persistence::get_cli_session_id_for_account(session_id, account_id)
        .map_err(|err| format!("read native binding for {session_id}: {err}"))?;
    if bound.as_deref() != Some(native_id) {
        return Err(
            "refusing to remove a native transcript that is not the episode's current binding"
                .to_string(),
        );
    }
    let agent = session.cli_agent_type.as_deref().unwrap_or_default();
    let cwd = execution_cwd(&session)?;
    let paths = match agent {
        "claude_code" => claude_native_paths(account_id, &cwd, native_id),
        "codex" => {
            let account_id = account_id
                .ok_or_else(|| "native Codex materialization has no account binding".to_string())?;
            let Some(paths) = existing_codex_native_paths(account_id, native_id) else {
                // A previous rollback may have removed the rollout and then
                // failed while clearing the DB binding. Treat the missing
                // marked artifact as already removed so retry can finish the
                // durable state transition instead of wedging the episode.
                persistence::clear_cli_resume_state(session_id, "native_materialization_rollback")
                    .map_err(|err| format!("clear native materialization binding: {err}"))?;
                return Ok(false);
            };
            paths
        }
        _ => return Ok(false),
    };
    for path in [&paths.native_path, &paths.runner_path] {
        if fs::symlink_metadata(path).is_ok() && !has_orgii_materialization_marker(path, agent) {
            return Err(format!(
                "refusing to remove unmarked provider transcript {}",
                path.display()
            ));
        }
    }
    let removed = match agent {
        "codex" => {
            codex_native_catalog::archive_thread(&paths.native_path, native_id, &cwd)?;
            remove_file_if_present(&paths.runner_path)?;
            // `thread/archive` removes the catalog row, not necessarily the
            // rollout file. The marker checks above prove this is ORGII-owned.
            remove_file_if_present(&paths.native_path)?;
            true
        }
        "claude_code" => {
            let mut removed = false;
            for path in [&paths.runner_path, &paths.native_path] {
                if fs::symlink_metadata(path).is_ok() {
                    fs::remove_file(path).map_err(|err| {
                        format!("remove native materialization {}: {err}", path.display())
                    })?;
                    removed = true;
                }
            }
            remove_claude_desktop_session(native_id)?;
            remove_claude_project_index_entry(&cwd, native_id)?;
            removed
        }
        _ => false,
    };
    persistence::clear_cli_resume_state(session_id, "native_materialization_rollback")
        .map_err(|err| format!("clear native materialization binding: {err}"))?;
    Ok(removed)
}

fn materialize_cli(
    session_id: &str,
    items: &[NativeConversationItem],
) -> Result<NativeMaterializationReceipt, String> {
    let session = persistence::get_session(session_id)
        .map_err(|err| format!("load CLI session {session_id}: {err}"))?
        .ok_or_else(|| format!("CLI session {session_id} does not exist"))?;
    if session.transcript_source != TRANSCRIPT_SOURCE_NATIVE {
        return Err(format!(
            "CLI target {:?} has no native transcript reader/writer contract",
            session.cli_agent_type
        ));
    }
    if session.cli_session_id.is_some() {
        return Err("native materialization requires a fresh empty execution episode".to_string());
    }
    let account_id = session
        .account_id
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    let cwd = execution_cwd(&session)?;
    let agent = session.cli_agent_type.as_deref().unwrap_or_default();
    let (native_id, paths) = match agent {
        "claude_code" => {
            let native_id = Uuid::new_v4().to_string();
            let paths = claude_native_paths(account_id, &cwd, &native_id);
            if let Err(error) = write_native_store_jsonl(
                &paths,
                &claude_records_with_resume_checkpoint(&native_id, &cwd, items)?,
            ) {
                // `atomic_jsonl` may already have committed the provider file
                // before creating the account-profile alias fails. Nothing is
                // bound yet, so clean both paths here rather than leave an
                // unreachable ORGII-marked UUID behind.
                let _ = remove_file_if_present(&paths.runner_path);
                let _ = remove_file_if_present(&paths.native_path);
                return Err(error);
            }
            (native_id, paths)
        }
        "codex" => {
            let account_id = account_id.ok_or_else(|| {
                "native Codex materialization requires an explicit local account".to_string()
            })?;
            let title = if session.name.trim().is_empty() {
                first_user_title(items)
            } else {
                session.name.clone()
            };
            let registered =
                codex_native_catalog::register_thread(&cwd, &title, &codex_response_items(items))?;
            let paths = match registered_codex_native_paths(account_id, &registered.path) {
                Ok(paths) => paths,
                Err(error) => {
                    let _ = codex_native_catalog::archive_thread(
                        &registered.path,
                        &registered.id,
                        &cwd,
                    );
                    let _ = remove_file_if_present(&registered.path);
                    return Err(error);
                }
            };
            cache_codex_native_paths(account_id, &registered.id, &paths);
            if let Err(error) = replace_runner_link(&paths.native_path, &paths.runner_path) {
                let _ =
                    codex_native_catalog::archive_thread(&paths.native_path, &registered.id, &cwd);
                let _ = remove_file_if_present(&paths.runner_path);
                let _ = remove_file_if_present(&paths.native_path);
                return Err(error);
            }
            (registered.id, paths)
        }
        other => {
            return Err(format!(
                "CLI target {other:?} cannot write a provider-native role/tool transcript"
            ))
        }
    };
    if agent == "claude_code" {
        // Claude Code owns the executable resume contract: the native JSONL
        // and its project session index. Claude Desktop metadata is a separate
        // discovery projection and is refreshed best-effort after the binding
        // is durable; a machine without Desktop must still run the CLI.
        if let Err(error) =
            publish_claude_project_index(&cwd, &native_id, items, None, session.branch.as_deref())
        {
            let _ = fs::remove_file(&paths.runner_path);
            let _ = fs::remove_file(&paths.native_path);
            let _ = remove_claude_project_index_entry(&cwd, &native_id);
            return Err(error);
        }
    }
    // Bind the provider UUID before the caller round-trips the transcript.
    // Both native readers already fall back to resolving the exact provider
    // file by UUID when their list cache misses; synchronously rebuilding the
    // entire imported-history index here turns a one-file continuation into
    // an O(all historical transcripts) operation on the send path.
    let register_result = (|| -> Result<(), String> {
        let bound =
            persistence::update_cli_session_id_for_account(session_id, account_id, &native_id)
                .map_err(|err| {
                    format!("bind native transcript {native_id} to {session_id}: {err}")
                })?;
        if !bound {
            return Err(format!(
                "bind native transcript {native_id}: target session {session_id} disappeared"
            ));
        }
        Ok(())
    })();
    if let Err(error) = register_result {
        if agent == "codex" {
            let _ = codex_native_catalog::archive_thread(&paths.native_path, &native_id, &cwd);
            let _ = remove_file_if_present(&paths.runner_path);
            let _ = remove_file_if_present(&paths.native_path);
        } else {
            let _ = fs::remove_file(&paths.runner_path);
            let _ = fs::remove_file(&paths.native_path);
            let _ = remove_claude_project_index_entry(&cwd, &native_id);
        }
        return Err(error);
    }
    tracing::info!(
        session_id,
        native_session_id = native_id,
        target = agent,
        native_path = %paths.native_path.display(),
        runner_path = %paths.runner_path.display(),
        item_count = items.len(),
        "materialized provider-native conversation transcript"
    );
    Ok(NativeMaterializationReceipt {
        native_session_id: native_id,
        item_count: items.len(),
    })
}

fn materialize_native_agent(
    session_id: &str,
    items: &[NativeConversationItem],
) -> Result<NativeMaterializationReceipt, String> {
    agent_core::session::persistence::get_session(session_id)
        .map_err(|err| format!("load native Agent session {session_id}: {err}"))?
        .ok_or_else(|| format!("native Agent session {session_id} does not exist"))?;
    agent_core::session::persistence::seed_session_with_messages(
        session_id,
        &native_agent_messages(session_id, items),
    )
    .map_err(|err| format!("seed native Agent transcript {session_id}: {err}"))?;
    Ok(NativeMaterializationReceipt {
        native_session_id: session_id.to_string(),
        item_count: items.len(),
    })
}

fn synchronize_cli(
    session_id: &str,
    complete_items: &[NativeConversationItem],
    append_items: &[NativeConversationItem],
) -> Result<NativeMaterializationReceipt, String> {
    let session = persistence::get_session(session_id)
        .map_err(|err| format!("load CLI session {session_id}: {err}"))?
        .ok_or_else(|| format!("CLI session {session_id} does not exist"))?;
    if session.transcript_source != TRANSCRIPT_SOURCE_NATIVE {
        return Err(format!(
            "CLI target {:?} has no native transcript reader/writer contract",
            session.cli_agent_type
        ));
    }
    let account_id = session
        .account_id
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    let native_id = persistence::get_cli_session_id_for_account(session_id, account_id)
        .map_err(|err| format!("read native binding for {session_id}: {err}"))?
        .ok_or_else(|| format!("CLI session {session_id} has no native resume binding"))?;
    let cwd = execution_cwd(&session)?;
    let agent = session.cli_agent_type.as_deref().unwrap_or_default();
    let paths = match agent {
        "claude_code" => claude_native_paths(account_id, &cwd, &native_id),
        "codex" => {
            let account_id = account_id
                .ok_or_else(|| "native Codex synchronization has no account binding".to_string())?;
            existing_codex_native_paths(account_id, &native_id)
                .ok_or_else(|| format!("materialized Codex transcript {native_id} was not found"))?
        }
        other => {
            return Err(format!(
                "CLI target {other:?} cannot write a provider-native role/tool transcript"
            ))
        }
    };
    let mut found = false;
    for path in [&paths.native_path, &paths.runner_path] {
        if fs::symlink_metadata(path).is_err() {
            continue;
        }
        found = true;
    }
    if !found {
        return Err(format!(
            "materialized {agent} transcript {native_id} was not found"
        ));
    }
    // A provider UUID is append-only after its first materialization. Claude
    // and Codex may add compact checkpoints, encrypted context, queue rows,
    // usage, or other native-only state between ORGII turns. Rewriting even
    // an ORGII-created file from `complete_items` would destroy that state and
    // make the provider compact the same conversation again. The TypeScript
    // caller already proved the portable transcript is an exact semantic
    // prefix, so append only its verified suffix for every existing UUID.
    if !paths.native_path.is_file() && paths.runner_path.is_file() {
        let parent = paths.native_path.parent().ok_or_else(|| {
            format!(
                "native transcript path has no parent: {}",
                paths.native_path.display()
            )
        })?;
        fs::create_dir_all(parent)
            .map_err(|err| format!("create native transcript dir {}: {err}", parent.display()))?;
        fs::copy(&paths.runner_path, &paths.native_path).map_err(|err| {
            format!(
                "publish provider transcript {} -> {}: {err}",
                paths.runner_path.display(),
                paths.native_path.display()
            )
        })?;
    }
    if !paths.native_path.is_file() {
        return Err(format!(
            "provider transcript {} was not found",
            paths.native_path.display()
        ));
    }
    replace_runner_link(&paths.native_path, &paths.runner_path)?;
    match agent {
        "claude_code" => {
            // Validate and prepare Claude's index before mutating the JSONL,
            // then keep ORGII index writers serialized until both commit.
            let _index_guard = CLAUDE_PROJECT_INDEX_LOCK
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let (index_path, index) = prepare_claude_project_index(
                &cwd,
                &native_id,
                complete_items,
                None,
                session.branch.as_deref(),
            )?;
            let mut records = claude_records(&native_id, &cwd, append_items)?;
            let (suffix_application, parent_uuid) =
                inspect_claude_suffix_application(&paths.native_path, &records)?;
            let appended = suffix_application == NativeSuffixApplication::Missing;
            let mut appended_suffix = None;
            if appended {
                if let Some(first) = records.first_mut() {
                    first["parentUuid"] = parent_uuid.map(Value::String).unwrap_or(Value::Null);
                }
                if let Some(leaf_uuid) = records
                    .last()
                    .and_then(|record| record["uuid"].as_str())
                    .map(str::to_string)
                {
                    records.push(claude_resume_checkpoint(
                        &native_id,
                        &leaf_uuid,
                        complete_items,
                    ));
                }
                let original_len = fs::metadata(&paths.native_path)
                    .map_err(|error| {
                        format!(
                            "inspect native transcript {} before append: {error}",
                            paths.native_path.display()
                        )
                    })?
                    .len();
                let payload = serialize_jsonl(&records)?;
                append_jsonl_payload(&paths.native_path, &payload)?;
                appended_suffix = Some((original_len, payload));
            }
            if let Err(index_error) = atomic_json(&index_path, &index) {
                if let Some((original_len, payload)) = appended_suffix {
                    if let Err(rollback_error) =
                        rollback_jsonl_suffix(&paths.native_path, original_len, &payload)
                    {
                        return Err(format!(
                            "{index_error}; additionally failed to roll back Claude transcript: {rollback_error}"
                        ));
                    }
                }
                return Err(index_error);
            }
        }
        "codex" => {
            let title = if session.name.trim().is_empty() {
                first_user_title(complete_items)
            } else {
                session.name.clone()
            };
            codex_native_catalog::synchronize_thread(
                &paths.native_path,
                &native_id,
                &cwd,
                &title,
                &codex_response_items(append_items),
            )?;
        }
        _ => unreachable!("unsupported targets returned above"),
    }
    Ok(NativeMaterializationReceipt {
        native_session_id: native_id,
        item_count: complete_items.len(),
    })
}

#[derive(Debug, Clone)]
struct CliNativePublicationContext {
    session_id: String,
    name: String,
    model: Option<String>,
    branch: Option<String>,
    native_id: String,
    cwd: PathBuf,
    agent: String,
    paths: NativeTranscriptPaths,
}

fn cli_native_publication_context(
    session_id: &str,
) -> Result<Option<CliNativePublicationContext>, String> {
    let session = persistence::get_session(session_id)
        .map_err(|err| format!("load CLI session {session_id}: {err}"))?
        .ok_or_else(|| format!("CLI session {session_id} does not exist"))?;
    cli_native_publication_context_from_session(session_id, session)
}

fn cli_native_publication_context_from_session(
    session_id: &str,
    session: persistence::CodeSession,
) -> Result<Option<CliNativePublicationContext>, String> {
    let account_id = session
        .account_id
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    let Some(native_id) = persistence::get_cli_session_id_for_account(session_id, account_id)
        .map_err(|err| format!("read native binding for {session_id}: {err}"))?
    else {
        return Ok(None);
    };
    let cwd = execution_cwd(&session)?;
    let agent = session.cli_agent_type.clone().unwrap_or_default();
    let paths = match agent.as_str() {
        "claude_code" => claude_native_paths(account_id, &cwd, &native_id),
        "codex" => {
            let account_id = account_id
                .ok_or_else(|| "native Codex catalog refresh has no account binding".to_string())?;
            existing_codex_native_paths(account_id, &native_id)
                .ok_or_else(|| format!("materialized Codex transcript {native_id} was not found"))?
        }
        _ => return Ok(None),
    };
    Ok(Some(CliNativePublicationContext {
        session_id: session.session_id,
        name: session.name,
        model: session.model,
        branch: session.branch,
        native_id,
        cwd,
        agent,
        paths,
    }))
}

pub(super) fn freeze_cli_native_publication_context(session_id: &str) -> Result<(), String> {
    let session = persistence::get_session(session_id);
    let mut snapshots = ACTIVE_NATIVE_PUBLICATION_SESSIONS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    match session {
        Ok(Some(session))
            if session.key_source == super::types::KeySource::OwnKey
                && matches!(
                    session.cli_agent_type.as_deref(),
                    Some("claude_code" | "codex")
                ) =>
        {
            snapshots.insert(session_id.to_string(), session);
            Ok(())
        }
        Ok(Some(_)) => {
            snapshots.remove(session_id);
            Ok(())
        }
        Ok(None) => {
            snapshots.remove(session_id);
            Err(format!("CLI session {session_id} does not exist"))
        }
        Err(err) => {
            snapshots.remove(session_id);
            Err(format!("load CLI session {session_id}: {err}"))
        }
    }
}

pub(super) fn clear_cli_native_publication_context(session_id: &str) {
    ACTIVE_NATIVE_PUBLICATION_SESSIONS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(session_id);
}

fn take_cli_native_publication_context(
    session_id: &str,
) -> Option<persistence::CodeSession> {
    ACTIVE_NATIVE_PUBLICATION_SESSIONS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(session_id)
}

/// Copy a runner-replaced provider transcript into the real native App store.
///
/// This is the only operation that must finish before a follow-up may replace
/// the runner. App catalog discovery is metadata and is intentionally kept out
/// of this boundary so Send Now / runtime switches never wait on app-server.
fn publish_cli_native_transcript_after_turn_blocking(
    session_id: &str,
    frozen: Option<persistence::CodeSession>,
) -> Result<Option<CliNativePublicationContext>, String> {
    let context = match frozen {
        Some(session) => cli_native_publication_context_from_session(session_id, session)?,
        None => cli_native_publication_context(session_id)?,
    };
    let Some(context) = context else {
        return Ok(None);
    };
    publish_runner_transcript(&context.paths, &context.native_id)?;
    tracing::info!(
        session_id,
        native_session_id = context.native_id,
        "published provider-native transcript"
    );
    Ok(Some(context))
}

pub(super) async fn publish_cli_native_transcript_after_turn(
    session_id: &str,
) -> Result<bool, String> {
    // Take ownership before spawning blocking work. Context resolution,
    // validation, filesystem publication, a panicking worker, or runtime
    // shutdown can then fail without retaining a stale active-turn snapshot.
    let frozen = take_cli_native_publication_context(session_id);
    let session_id = session_id.to_string();
    let context = tokio::task::spawn_blocking(move || {
        publish_cli_native_transcript_after_turn_blocking(&session_id, frozen)
    })
    .await
    .map_err(|error| format!("provider-native transcript snapshot task failed: {error}"))??;
    if let Some(context) = context {
        schedule_cli_native_catalog_refresh_context(context, None);
        Ok(true)
    } else {
        Ok(false)
    }
}

fn refresh_cli_native_conversation_metadata(
    context: &CliNativePublicationContext,
    expected_provider: NativeCatalogProvider,
    completed_turns_hint: Option<usize>,
) -> Result<bool, String> {
    if context.agent != expected_provider.as_str() {
        return Err(format!(
            "native catalog snapshot provider {} does not match queued lane {}",
            context.agent,
            expected_provider.as_str()
        ));
    }
    let published = match context.agent.as_str() {
        "claude_code" => {
            // Claude Code's own session index is part of the CLI-native
            // transcript contract and must advance even when Claude Desktop
            // is not installed, signed in, or able to accept its sidecar.
            publish_claude_project_index(
                &context.cwd,
                &context.native_id,
                &[],
                completed_turns_hint,
                context.branch.as_deref(),
            )?;
            let materialized_by_orgii = [&context.paths.native_path, &context.paths.runner_path]
                .into_iter()
                .any(|path| has_orgii_materialization_marker(path, "claude_code"));
            publish_claude_desktop_session(
                &context.cwd,
                &context.native_id,
                context.model.as_deref(),
                Some(context.name.as_str()),
                &[],
                materialized_by_orgii,
                completed_turns_hint,
            )?
            .is_some()
        }
        "codex" => {
            let title = if context.name.trim().is_empty() {
                "Imported conversation"
            } else {
                context.name.as_str()
            };
            let entry = codex_native_catalog::refresh_catalog(
                &context.paths.native_path,
                &context.native_id,
                &context.cwd,
                title,
            )?;
            entry.id == context.native_id && paths_match(&entry.cwd, &context.cwd)
        }
        _ => false,
    };
    tracing::info!(
        session_id = %context.session_id,
        native_session_id = %context.native_id,
        published,
        completed_turns_hint = ?completed_turns_hint,
        "refreshed provider-native conversation metadata"
    );
    Ok(published)
}

/// Refresh native App discovery after the runner transcript was safely
/// published by `publish_cli_native_transcript_after_turn`.
fn refresh_cli_native_conversation_after_turn(
    context: CliNativePublicationContext,
    provider: NativeCatalogProvider,
    completed_turns_hint: Option<usize>,
) -> Result<bool, String> {
    // Ordinary final/cancel paths do not carry the materializer's absolute
    // count. Resolve it once per coalesced background refresh, then reuse the
    // same value across retries so Claude Desktop and projects.json advance
    // after every native turn without repeated full-file reads.
    let completed_turns_hint = if provider == NativeCatalogProvider::ClaudeCode
        && completed_turns_hint.is_none()
    {
        let path = preferred_materialized_transcript_path(&context.paths).ok_or_else(|| {
            format!(
                "Claude transcript {} has no readable native copy",
                context.native_id
            )
        })?;
        Some(claude_completed_turns_from_transcript(path)?)
    } else {
        completed_turns_hint
    };
    let mut last_error = None;
    for attempt in 0..=NATIVE_CATALOG_REFRESH_BACKOFFS.len() {
        match refresh_cli_native_conversation_metadata(&context, provider, completed_turns_hint) {
            Ok(true) => return Ok(true),
            Ok(false) => {
                if let Some(delay) = NATIVE_CATALOG_REFRESH_BACKOFFS.get(attempt) {
                    std::thread::sleep(*delay);
                    continue;
                }
                return Ok(false);
            }
            Err(error) => {
                last_error = Some(error);
                if let Some(delay) = NATIVE_CATALOG_REFRESH_BACKOFFS.get(attempt) {
                    std::thread::sleep(*delay);
                }
            }
        }
    }
    Err(last_error.unwrap_or_else(|| {
        format!(
            "provider-native catalog refresh failed for {}",
            context.session_id
        )
    }))
}

fn native_catalog_refresh_is_current(context: &CliNativePublicationContext) -> bool {
    matches!(
        cli_native_publication_context(&context.session_id),
        Ok(Some(current))
            if current.agent == context.agent
                && current.native_id == context.native_id
                && current.paths.native_path == context.paths.native_path
                && current.paths.runner_path == context.paths.runner_path
    )
}

/// Coalesce slow native App discovery behind a background boundary. Transcript
/// durability is handled synchronously before this is scheduled; catalog
/// availability may catch up without extending the provider turn or blocking
/// the next message.
fn schedule_cli_native_catalog_refresh_with_hint(
    session_id: &str,
    agent: &str,
    completed_turns_hint: Option<usize>,
) {
    let Some(provider) = NativeCatalogProvider::from_agent(agent) else {
        tracing::warn!(
            session_id,
            agent,
            "ignored catalog refresh for unsupported provider"
        );
        return;
    };
    let context = match cli_native_publication_context(session_id) {
        Ok(Some(context)) if context.agent == provider.as_str() => context,
        Ok(Some(context)) => {
            tracing::warn!(
                session_id,
                requested_provider = provider.as_str(),
                snapshot_provider = context.agent,
                snapshot_native_session_id = context.native_id,
                "ignored stale native catalog refresh after a runtime switch"
            );
            return;
        }
        Ok(None) => {
            tracing::warn!(
                session_id,
                provider = provider.as_str(),
                "ignored native catalog refresh without a native binding"
            );
            return;
        }
        Err(error) => {
            tracing::warn!(
                session_id,
                provider = provider.as_str(),
                error = %error,
                "failed to capture provider-native catalog snapshot"
            );
            return;
        }
    };
    schedule_cli_native_catalog_refresh_context(context, completed_turns_hint);
}

fn schedule_cli_native_catalog_refresh_context(
    context: CliNativePublicationContext,
    completed_turns_hint: Option<usize>,
) {
    let Some(provider) = NativeCatalogProvider::from_agent(&context.agent) else {
        return;
    };
    let should_spawn = NATIVE_CATALOG_REFRESH_QUEUE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .lane_mut(provider)
        .enqueue(provider, context, completed_turns_hint);
    if !should_spawn {
        return;
    }
    tokio::spawn(async move {
        loop {
            let next = {
                let mut queue = NATIVE_CATALOG_REFRESH_QUEUE
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                queue.lane_mut(provider).take_next()
            };
            let Some(request) = next else {
                return;
            };
            let session_id = request.context.session_id.clone();
            // The managed session is the live owner of this native UUID. Do
            // not await a busy identity inside the one-per-provider worker:
            // one long turn would head-of-line block every other session.
            let identity_lock = super::session_runner::session_identity_lock(&session_id).await;
            let native_identity_guard = match identity_lock.clone().try_lock_owned() {
                Ok(guard) => guard,
                Err(_) => {
                    let (key, should_spawn_waiter) = {
                        let mut queue = NATIVE_CATALOG_REFRESH_QUEUE
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner());
                        queue
                            .lane_mut(provider)
                            .defer_until_identity_available(provider, request)
                    };
                    if should_spawn_waiter {
                        tokio::spawn(async move {
                            // Await the lifecycle edge without polling, then
                            // release immediately so a queued user turn is not
                            // held behind metadata publication.
                            let identity_guard = identity_lock.lock_owned().await;
                            drop(identity_guard);
                            let deferred = {
                                let mut queue = NATIVE_CATALOG_REFRESH_QUEUE
                                    .lock()
                                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                                queue.lane_mut(provider).take_deferred(&key)
                            };
                            if let Some(request) = deferred {
                                schedule_cli_native_catalog_refresh_context(
                                    request.context,
                                    request.completed_turns_hint,
                                );
                            }
                        });
                    }
                    continue;
                }
            };
            let result = tokio::task::spawn_blocking(move || {
                let _native_identity_guard = native_identity_guard;
                // A queued request is only a projection hint. Delete,
                // truncate, discard, or a runtime/account switch may replace
                // the binding while it waits; never resurrect that stale UUID
                // in a provider App catalog.
                if !native_catalog_refresh_is_current(&request.context) {
                    tracing::info!(
                        session_id,
                        native_session_id = %request.context.native_id,
                        "discarded stale provider-native catalog refresh"
                    );
                    return;
                }
                match refresh_cli_native_conversation_after_turn(
                    request.context,
                    provider,
                    request.completed_turns_hint,
                ) {
                    Ok(true) => {}
                    Ok(false) => tracing::warn!(
                        session_id,
                        "provider-native App catalog is unavailable; CLI transcript remains resumable"
                    ),
                    Err(error) => tracing::warn!(
                        session_id,
                        error = %error,
                        "failed to refresh provider-native App catalog"
                    ),
                }
            })
            .await;
            if let Err(error) = result {
                tracing::warn!(
                    error = %error,
                    "provider-native App catalog worker failed"
                );
            }
        }
    });
}

fn synchronize_native_agent(
    session_id: &str,
    complete_items: &[NativeConversationItem],
    append_items: &[NativeConversationItem],
) -> Result<NativeMaterializationReceipt, String> {
    agent_core::session::persistence::get_session(session_id)
        .map_err(|err| format!("load native Agent session {session_id}: {err}"))?
        .ok_or_else(|| format!("native Agent session {session_id} does not exist"))?;
    agent_core::session::persistence::append_session_with_messages(
        session_id,
        &native_agent_messages(session_id, append_items),
    )
    .map_err(|err| format!("append native Agent transcript {session_id}: {err}"))?;
    Ok(NativeMaterializationReceipt {
        native_session_id: session_id.to_string(),
        item_count: complete_items.len(),
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn materialize_native_conversation(
    session_id: String,
    items: Vec<NativeConversationItem>,
) -> Result<NativeMaterializationReceipt, String> {
    validate_items(&items)?;
    // Move both guards into the blocking mutation. If the IPC future is
    // cancelled after spawning, the filesystem/DB work stays serialized until
    // it actually finishes instead of racing a follow-up or catalog refresh.
    let mutation_guards = lock_idle_native_mutation(&session_id).await?;
    let receipt = tokio::task::spawn_blocking(move || {
        let _mutation_guards = mutation_guards;
        if session_id.starts_with(core_types::session::CLI_SESSION_PREFIX) {
            materialize_cli(&session_id, &items)
        } else {
            materialize_native_agent(&session_id, &items)
        }
    })
    .await
    .map_err(|err| format!("native materialization task failed: {err}"))??;
    Ok(receipt)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn synchronize_native_conversation(
    session_id: String,
    complete_items: Vec<NativeConversationItem>,
    prefix_item_count: usize,
) -> Result<NativeMaterializationReceipt, String> {
    validate_items(&complete_items)?;
    if prefix_item_count >= complete_items.len() {
        return Err("native transcript synchronization requires a non-empty suffix".to_string());
    }
    let mutation_guards = lock_idle_native_mutation(&session_id).await?;
    let receipt = tokio::task::spawn_blocking(move || {
        let _mutation_guards = mutation_guards;
        // The TypeScript caller has already verified semantic prefix growth.
        // Derive the append-only suffix from the one complete IPC payload so
        // large conversations are not cloned and decoded twice.
        let append_items = &complete_items[prefix_item_count..];
        if session_id.starts_with(core_types::session::CLI_SESSION_PREFIX) {
            synchronize_cli(&session_id, &complete_items, append_items)
        } else {
            synchronize_native_agent(&session_id, &complete_items, append_items)
        }
    })
    .await
    .map_err(|err| format!("native synchronization task failed: {err}"))??;
    Ok(receipt)
}

/// Commit App discovery only after the frontend has round-tripped and
/// semantically verified the newly materialized provider transcript. Keeping
/// this separate from the write IPC prevents a failed verification + discard
/// from racing a background metadata worker that would recreate a ghost
/// catalog entry.
#[tauri::command(rename_all = "camelCase")]
pub async fn commit_native_conversation_materialization(
    session_id: String,
    native_session_id: String,
) -> Result<bool, String> {
    if !session_id.starts_with(core_types::session::CLI_SESSION_PREFIX) {
        return Ok(false);
    }
    let _mutation_guards = lock_idle_native_mutation(&session_id).await?;
    let Some(context) = cli_native_publication_context(&session_id)? else {
        return Ok(false);
    };
    if context.native_id != native_session_id {
        return Err(format!(
            "native materialization binding changed before commit: expected {native_session_id}, found {}",
            context.native_id
        ));
    }
    if context.agent != "claude_code" {
        return Ok(false);
    }
    // This call freezes the same context while the session control lock is
    // still held; later account/model patches cannot retarget the worker.
    schedule_cli_native_catalog_refresh_with_hint(
        &session_id,
        &context.agent,
        None,
    );
    Ok(true)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn discard_native_conversation_materialization(
    session_id: String,
    native_session_id: String,
) -> Result<bool, String> {
    let mutation_guards = lock_idle_native_mutation(&session_id).await?;
    let result = tokio::task::spawn_blocking(move || {
        let _mutation_guards = mutation_guards;
        discard_cli_materialization(&session_id, &native_session_id)
    })
    .await
    .map_err(|err| format!("native materialization rollback task failed: {err}"))?;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::test_env;

    fn create_claude_session(session_id: &str, account_id: &str) {
        create_claude_session_with_account(session_id, Some(account_id));
    }

    fn create_claude_session_with_account(session_id: &str, account_id: Option<&str>) {
        persistence::create_session(
            session_id,
            &persistence::CreateCodeSessionParams {
                name: Some("native synchronization test".to_string()),
                flow: None,
                runner: None,
                cli_agent_type: "claude_code".to_string(),
                model: Some("claude-sonnet-4-6".to_string()),
                tier: None,
                account_id: account_id.map(str::to_string),
                repo_path: Some("/repo".to_string()),
                branch: None,
                worktree_path: None,
                worktree_base_ref: None,
                proxy_token: None,
                proxy_url: None,
                hosted_token: None,
                proxy_session_id: None,
                isolate: Some(false),
                background: Some(false),
                key_source: Some("own_key".to_string()),
                additional_directories: None,
                parent_session_id: None,
                org_member_id: None,
                agent_definition_id: None,
                org_id: None,
                project_id: None,
                project_name: None,
                project_slug: None,
                work_item_id: None,
                agent_role: None,
                product_mode: Some("build".to_string()),
            },
        )
        .expect("create Claude CLI session");
    }

    fn create_codex_session(session_id: &str, account_id: &str, repo_path: &Path) {
        persistence::create_session(
            session_id,
            &persistence::CreateCodeSessionParams {
                name: Some("native Codex synchronization test".to_string()),
                flow: None,
                runner: None,
                cli_agent_type: "codex".to_string(),
                model: Some("gpt-5.4".to_string()),
                tier: None,
                account_id: Some(account_id.to_string()),
                repo_path: Some(repo_path.to_string_lossy().into_owned()),
                branch: None,
                worktree_path: None,
                worktree_base_ref: None,
                proxy_token: None,
                proxy_url: None,
                hosted_token: None,
                proxy_session_id: None,
                isolate: Some(false),
                background: Some(false),
                key_source: Some("own_key".to_string()),
                additional_directories: None,
                parent_session_id: None,
                org_member_id: None,
                agent_definition_id: None,
                org_id: None,
                project_id: None,
                project_name: None,
                project_slug: None,
                work_item_id: None,
                agent_role: None,
                product_mode: Some("build".to_string()),
            },
        )
        .expect("create Codex CLI session");
        let profile = app_paths::codex_cli_profile_dir(account_id);
        fs::create_dir_all(&profile).expect("create Codex test profile");
        fs::write(profile.join("config.toml"), "model_provider = \"openai\"\n")
            .expect("write Codex test profile");
    }

    fn message() -> NativeConversationItem {
        NativeConversationItem::Message {
            id: "u1".to_string(),
            role: "user".to_string(),
            text: "hello".to_string(),
            images: Vec::new(),
            created_at: "2026-08-26T00:00:00Z".to_string(),
            turn_id: None,
        }
    }

    fn assistant_message() -> NativeConversationItem {
        NativeConversationItem::Message {
            id: "a1".to_string(),
            role: "assistant".to_string(),
            text: "done".to_string(),
            images: Vec::new(),
            created_at: "2026-08-26T00:00:03Z".to_string(),
            turn_id: None,
        }
    }

    #[test]
    fn native_materialization_rejects_duplicate_canonical_item_ids() {
        let duplicate = message();
        let error = validate_items(&[duplicate.clone(), duplicate])
            .expect_err("duplicate canonical ids must fail closed");
        assert!(error.contains("duplicate canonical item id"));
    }

    #[test]
    fn diverged_transcript_prefers_only_the_provably_newer_copy() {
        let sandbox = test_env::sandbox();
        let paths = NativeTranscriptPaths {
            native_path: sandbox.path().join("native.jsonl"),
            runner_path: sandbox.path().join("runner.jsonl"),
        };
        fs::write(&paths.native_path, "native").expect("write native transcript");
        fs::write(&paths.runner_path, "runner").expect("write runner transcript");
        let base = std::time::SystemTime::now() - std::time::Duration::from_secs(120);
        std::fs::File::options()
            .write(true)
            .open(&paths.native_path)
            .expect("open native transcript")
            .set_modified(base)
            .expect("set native mtime");
        std::fs::File::options()
            .write(true)
            .open(&paths.runner_path)
            .expect("open runner transcript")
            .set_modified(base + std::time::Duration::from_secs(1))
            .expect("set runner mtime");
        assert_eq!(
            preferred_materialized_transcript_path(&paths),
            Some(paths.runner_path.as_path())
        );

        std::fs::File::options()
            .write(true)
            .open(&paths.native_path)
            .expect("reopen native transcript")
            .set_modified(base + std::time::Duration::from_secs(2))
            .expect("advance native mtime");
        assert_eq!(
            preferred_materialized_transcript_path(&paths),
            Some(paths.native_path.as_path())
        );
    }

    #[test]
    fn claude_materialization_is_native_role_history() {
        let records = claude_records(
            "00000000-0000-4000-8000-000000000001",
            Path::new("/repo"),
            &[message()],
        )
        .expect("claude records");
        assert_eq!(records[0]["type"], "user");
        assert_eq!(records[0]["message"]["role"], "user");
        assert_eq!(records[0]["message"]["content"], "hello");
        assert_eq!(records[0]["entrypoint"], "orgii");
        assert_eq!(records[0]["orgiiMaterialization"], true);
        let assistant = claude_records(
            "00000000-0000-4000-8000-000000000001",
            Path::new("/repo"),
            &[assistant_message()],
        )
        .expect("claude assistant records");
        assert_eq!(assistant[0]["message"]["content"][0]["type"], "text");
        assert_eq!(assistant[0]["message"]["content"][0]["text"], "done");
    }

    #[test]
    fn claude_suffix_inspection_distinguishes_missing_applied_and_mixed() {
        let sandbox = test_env::sandbox();
        let path = sandbox.path().join("claude-suffix.jsonl");
        let expected = claude_records(
            "00000000-0000-4000-8000-000000000001",
            Path::new("/repo"),
            &[message(), assistant_message()],
        )
        .expect("project Claude suffix");

        atomic_jsonl(&path, &[json!({"type": "last-prompt", "leafUuid": "prior"})])
            .expect("write prefix");
        assert_eq!(
            inspect_claude_suffix_application(&path, &expected)
                .expect("inspect missing suffix")
                .0,
            NativeSuffixApplication::Missing
        );

        append_jsonl(&path, std::slice::from_ref(&expected[0])).expect("append mixed suffix");
        assert!(inspect_claude_suffix_application(&path, &expected).is_err());

        atomic_jsonl(&path, &expected).expect("write complete suffix");
        assert_eq!(
            inspect_claude_suffix_application(&path, &expected)
                .expect("inspect applied suffix")
                .0,
            NativeSuffixApplication::AlreadyApplied
        );
    }

    #[test]
    fn claude_active_leaf_prefers_the_latest_branch_checkpoint_or_newer_partial_record() {
        let temp_dir = std::env::temp_dir().join(format!(
            "orgii-native-claude-active-leaf-{}-{}",
            std::process::id(),
            Uuid::new_v4().simple()
        ));
        let path = temp_dir.join("session.jsonl");
        atomic_jsonl(
            &path,
            &[
                json!({"type": "assistant", "uuid": "native-leaf-1"}),
                json!({
                    "type": "last-prompt",
                    "lastPrompt": "first turn",
                    "leafUuid": "native-leaf-1",
                    "sessionId": "native-session"
                }),
                json!({"type": "mode", "mode": "build"}),
            ],
        )
        .expect("write native checkpoint fixture");
        assert_eq!(
            claude_active_leaf_uuid(&path).as_deref(),
            Some("native-leaf-1")
        );

        append_jsonl(
            &path,
            &[json!({
                "type": "assistant",
                "uuid": "interrupted-partial-leaf",
                "parentUuid": "native-leaf-1"
            })],
        )
        .expect("append partial native turn");
        assert_eq!(
            claude_active_leaf_uuid(&path).as_deref(),
            Some("interrupted-partial-leaf"),
            "a partial provider record written after the last checkpoint is the active branch"
        );

        fs::remove_dir_all(temp_dir).expect("remove active leaf fixture");
    }

    #[test]
    fn claude_materialization_round_trips_through_the_existing_reader() {
        let native_id = "00000000-0000-4000-8000-000000000001";
        let items = vec![
            message(),
            NativeConversationItem::ToolCall {
                id: "tool-1:call".to_string(),
                call_id: "call-1".to_string(),
                name: "read_file".to_string(),
                arguments: r#"{"path":"/repo/README.md"}"#.to_string(),
                created_at: "2026-08-26T00:00:01Z".to_string(),
            },
            NativeConversationItem::ToolResult {
                id: "tool-1:result".to_string(),
                call_id: "call-1".to_string(),
                name: "read_file".to_string(),
                output: "contents".to_string(),
                created_at: "2026-08-26T00:00:02Z".to_string(),
            },
            assistant_message(),
            NativeConversationItem::Compaction {
                id: "compact-1".to_string(),
                summary: "Native compact summary".to_string(),
                created_at: "2026-08-26T00:00:04Z".to_string(),
            },
        ];
        let temp_dir = std::env::temp_dir().join(format!(
            "orgii-native-claude-roundtrip-{}-{}",
            std::process::id(),
            Uuid::new_v4().simple()
        ));
        let path = temp_dir.join(format!("{native_id}.jsonl"));
        atomic_jsonl(
            &path,
            &claude_records(native_id, Path::new("/repo"), &items)
                .expect("build native Claude transcript"),
        )
        .expect("write native Claude transcript");

        let chunks =
            orgtrack_core::sources::claude_code::history::load_claude_code_history_from_path(
                "claudecodeapp-native-roundtrip",
                &path,
            )
            .expect("read native Claude transcript");
        assert_eq!(
            chunks
                .iter()
                .filter(|chunk| chunk.function == "user_message")
                .count(),
            1
        );
        assert_eq!(
            chunks
                .iter()
                .filter(|chunk| chunk.function == "assistant")
                .count(),
            1
        );
        let tool = chunks
            .iter()
            .find(|chunk| chunk.action_type == "tool_call")
            .expect("tool call");
        assert_eq!(tool.args["path"], "/repo/README.md");
        assert_eq!(tool.result["output"], "contents");
        let compact = chunks
            .iter()
            .find(|chunk| chunk.function == "context_compacted")
            .expect("native compact boundary");
        assert_eq!(compact.result["observation"], "Native compact summary");

        std::fs::remove_dir_all(&temp_dir).expect("remove temp dir");
    }

    #[test]
    fn codex_app_server_projection_marks_user_rows_for_native_replay() {
        let items = codex_response_items(&[
            message(),
            NativeConversationItem::ToolCall {
                id: "tool-1:call".to_string(),
                call_id: "call-1".to_string(),
                name: "grep".to_string(),
                arguments: r#"{"pattern":"needle"}"#.to_string(),
                created_at: "2026-08-26T00:00:01Z".to_string(),
            },
            NativeConversationItem::ToolResult {
                id: "tool-1:result".to_string(),
                call_id: "call-1".to_string(),
                name: "grep".to_string(),
                output: "match".to_string(),
                created_at: "2026-08-26T00:00:02Z".to_string(),
            },
        ]);
        assert_eq!(items.len(), 3);
        assert!(
            items[0]["internal_chat_message_metadata_passthrough"]["turn_id"]
                .as_str()
                .is_some_and(|turn_id| turn_id.starts_with("orgii-materialization-"))
        );
        assert_eq!(items[1]["call_id"], "call-1");
        assert_eq!(items[2]["call_id"], "call-1");
        let arguments =
            serde_json::from_str::<Value>(items[1]["arguments"].as_str().expect("arguments"))
                .expect("marked arguments");
        assert_eq!(arguments["pattern"], "needle");
        assert_eq!(arguments["__orgiiMaterializedNative"], true);
    }

    #[test]
    fn codex_materialization_marker_uses_fields_preserved_by_app_server() {
        let projected = codex_response_items(&[
            message(),
            NativeConversationItem::ToolCall {
                id: "tool-1:call".to_string(),
                call_id: "call-1".to_string(),
                name: "grep".to_string(),
                arguments: r#"{"pattern":"needle"}"#.to_string(),
                created_at: "2026-08-26T00:00:01Z".to_string(),
            },
        ]);
        let user_record = json!({"type": "response_item", "payload": projected[0]});
        let tool_record = json!({"type": "response_item", "payload": projected[1]});

        assert!(codex_record_has_orgii_materialization_marker(&user_record));
        assert!(codex_record_has_orgii_materialization_marker(&tool_record));
        assert!(!codex_record_has_orgii_materialization_marker(&json!({
            "type": "response_item",
            "payload": {
                "type": "function_call",
                "arguments": "{\"pattern\":\"needle\"}"
            }
        })));
    }

    #[test]
    fn codex_app_server_projection_uses_supported_native_compaction_items() {
        let items = codex_response_items(&[NativeConversationItem::Compaction {
            id: "compact-1".to_string(),
            summary: "Canonical compact summary".to_string(),
            created_at: "2026-08-31T00:00:00Z".to_string(),
        }]);

        assert_eq!(items.len(), 2);
        assert_eq!(items[0]["type"], "message");
        assert_eq!(items[0]["role"], "assistant");
        assert_eq!(items[1]["type"], "context_compaction");
        assert!(items[1]["encrypted_content"].is_null());
        let summary_turn_id = items[0]["internal_chat_message_metadata_passthrough"]["turn_id"]
            .as_str()
            .expect("materialized compact summary marker");
        let compact_turn_id = items[1]["internal_chat_message_metadata_passthrough"]["turn_id"]
            .as_str()
            .expect("materialized compact boundary marker");
        assert_eq!(summary_turn_id, compact_turn_id);
        assert!(summary_turn_id.starts_with("orgii-materialized-compaction:"));
        assert!(!items.iter().any(|item| item["role"] == "user"));
    }

    #[test]
    fn claude_synchronization_preserves_native_compact_state_and_uuid() {
        let _sandbox = test_env::sandbox();
        let session_id = "cliagent-native-claude-sync";
        let account_id = "native-sync-account";
        create_claude_session(session_id, account_id);
        let prefix = vec![message(), assistant_message()];
        let first = materialize_cli(session_id, &prefix).expect("materialize Claude prefix");
        let paths = claude_native_paths(
            Some(account_id),
            Path::new("/repo"),
            &first.native_session_id,
        );
        append_jsonl(
            &paths.native_path,
            &[
                json!({
                    "type": "system",
                    "subtype": "compact_boundary",
                    "uuid": "provider-compact-boundary",
                    "parentUuid": Value::Null,
                    "sessionId": first.native_session_id.clone(),
                    "timestamp": "2026-08-26T00:00:03.500Z",
                    "compactMetadata": {"trigger": "auto"}
                }),
                json!({
                    "type": "user",
                    "uuid": "provider-compact-summary",
                    "parentUuid": "provider-compact-boundary",
                    "isCompactSummary": true,
                    "sessionId": first.native_session_id.clone(),
                    "timestamp": "2026-08-26T00:00:03.500Z",
                    "message": {"role": "user", "content": "provider-native summary sentinel"}
                }),
                json!({
                    "type": "last-prompt",
                    "lastPrompt": "hello",
                    "leafUuid": "provider-compact-summary",
                    "sessionId": first.native_session_id.clone()
                }),
                json!({
                    "type": "mode",
                    "mode": "build",
                    "sessionId": first.native_session_id.clone()
                }),
            ],
        )
        .expect("append provider-native Claude compact state");
        let remote_user = NativeConversationItem::Message {
            id: "u2".to_string(),
            role: "user".to_string(),
            text: "remote canonical delta".to_string(),
            images: Vec::new(),
            created_at: "2026-08-26T00:00:04Z".to_string(),
            turn_id: None,
        };
        let complete = vec![message(), assistant_message(), remote_user];
        let second = synchronize_cli(session_id, &complete, &complete[2..])
            .expect("synchronize Claude native history");

        assert_eq!(second.native_session_id, first.native_session_id);
        assert_eq!(second.item_count, complete.len());
        let path = &paths.runner_path;
        assert!(paths.native_path.is_file());
        #[cfg(unix)]
        assert_eq!(
            fs::read_link(path).expect("runner transcript symlink"),
            paths.native_path
        );
        let records = fs::read_to_string(path)
            .expect("read synchronized Claude JSONL")
            .lines()
            .map(|line| serde_json::from_str::<Value>(line).expect("decode Claude record"))
            .collect::<Vec<_>>();
        let user_messages = records
            .iter()
            .filter(|record| {
                record["type"] == "user" && record["isCompactSummary"] != Value::Bool(true)
            })
            .map(|record| record["message"]["content"].as_str().unwrap_or_default())
            .collect::<Vec<_>>();
        assert_eq!(user_messages, vec!["hello", "remote canonical delta"]);
        assert!(records.iter().any(|record| {
            record["subtype"] == "compact_boundary" && record["uuid"] == "provider-compact-boundary"
        }));
        assert!(records.iter().any(|record| {
            record["isCompactSummary"] == true
                && record["message"]["content"] == "provider-native summary sentinel"
        }));
        let appended_user = records
            .iter()
            .find(|record| record["message"]["content"] == "remote canonical delta")
            .expect("appended canonical suffix");
        assert_eq!(appended_user["parentUuid"], "provider-compact-summary");
        let appended_user_uuid = appended_user["uuid"]
            .as_str()
            .expect("materialized user uuid");
        let resume_checkpoint = records
            .iter()
            .rev()
            .find(|record| record["type"] == "last-prompt")
            .expect("materialized resume checkpoint");
        assert_eq!(resume_checkpoint["leafUuid"], appended_user_uuid);
        assert_eq!(resume_checkpoint["lastPrompt"], "remote canonical delta");
        assert_eq!(
            claude_active_leaf_uuid(&paths.native_path).as_deref(),
            Some(appended_user_uuid),
            "the next native --resume must attach to the remote canonical suffix"
        );

        let chunks =
            orgtrack_core::sources::claude_code::history::load_claude_code_history_from_path(
                "claudecodeapp-native-sync-roundtrip",
                path,
            )
            .expect("round-trip synchronized Claude transcript");
        assert_eq!(
            chunks
                .iter()
                .filter(|chunk| chunk.function == "user_message")
                .count(),
            2
        );
        assert_eq!(
            chunks
                .iter()
                .filter(|chunk| chunk.function == "context_compacted")
                .count(),
            1
        );
        assert_eq!(
            chunks
                .iter()
                .filter(|chunk| chunk.function == "assistant")
                .map(|chunk| chunk.result["observation"].as_str().unwrap_or_default())
                .collect::<Vec<_>>(),
            vec!["done"]
        );
        assert_eq!(
            fs::read_to_string(path).expect("read runner transcript"),
            fs::read_to_string(&paths.native_path).expect("read provider transcript")
        );
    }

    #[test]
    fn claude_synchronization_rolls_back_jsonl_when_project_index_is_invalid() {
        let _sandbox = test_env::sandbox();
        let session_id = "cliagent-native-claude-index-rollback";
        let account_id = "native-index-rollback-account";
        create_claude_session(session_id, account_id);
        let prefix = vec![message(), assistant_message()];
        let first = materialize_cli(session_id, &prefix).expect("materialize Claude prefix");
        let paths = claude_native_paths(
            Some(account_id),
            Path::new("/repo"),
            &first.native_session_id,
        );
        let before = fs::read(&paths.native_path).expect("read prefix transcript");
        let index_path = claude_native_paths(None, Path::new("/repo"), &first.native_session_id)
            .native_path
            .parent()
            .expect("Claude project directory")
            .join("sessions-index.json");
        atomic_json(
            &index_path,
            &json!({"version": 1, "entries": "not-an-array"}),
        )
        .expect("poison project index shape");

        let suffix = NativeConversationItem::Message {
            id: "u2".to_string(),
            role: "user".to_string(),
            text: "must roll back".to_string(),
            images: Vec::new(),
            created_at: "2026-08-26T00:00:04Z".to_string(),
            turn_id: None,
        };
        let complete = vec![message(), assistant_message(), suffix];
        let error = synchronize_cli(session_id, &complete, &complete[2..])
            .expect_err("invalid project index must fail synchronization");

        assert!(error.contains("entries are not an array"));
        assert_eq!(
            fs::read(&paths.native_path).expect("read rolled-back transcript"),
            before,
            "a failed index update must not leave the canonical suffix appended"
        );
    }

    #[test]
    fn codex_synchronization_preserves_native_compact_state_and_uuid() {
        let sandbox = test_env::sandbox();
        let _catalog = codex_native_catalog::use_direct_test_catalog();
        let session_id = "cliagent-native-codex-sync";
        let account_id = "native-codex-sync-account";
        let repo_path = sandbox.path().join("repo");
        fs::create_dir_all(&repo_path).expect("create native Codex test workspace");
        create_codex_session(session_id, account_id, &repo_path);
        let prefix = vec![message(), assistant_message()];
        let first = materialize_cli(session_id, &prefix).expect("materialize Codex prefix");
        let paths = existing_codex_native_paths(account_id, &first.native_session_id)
            .expect("materialized Codex paths");
        append_jsonl(
            &paths.native_path,
            &[json!({
                "timestamp": "2026-08-26T00:00:03.500Z",
                "type": "compacted",
                "payload": {
                    "message": "",
                    "replacement_history": [{
                        "item": {
                            "type": "compaction",
                            "encrypted_content": "provider-native-encrypted-sentinel"
                        }
                    }],
                    "window_number": 2,
                    "first_window_id": "provider-window-1",
                    "previous_window_id": "provider-window-1",
                    "window_id": "provider-window-2"
                }
            })],
        )
        .expect("append provider-native Codex compact state");
        let remote_user = NativeConversationItem::Message {
            id: "u2".to_string(),
            role: "user".to_string(),
            text: "remote canonical delta".to_string(),
            images: Vec::new(),
            created_at: "2026-08-26T00:00:04Z".to_string(),
            turn_id: None,
        };
        let complete = vec![message(), assistant_message(), remote_user];

        let second = synchronize_cli(session_id, &complete, &complete[2..])
            .expect("synchronize Codex native history");

        assert_eq!(second.native_session_id, first.native_session_id);
        assert_eq!(second.item_count, complete.len());
        let raw = fs::read_to_string(&paths.native_path).expect("read synchronized Codex JSONL");
        assert!(raw.contains("provider-native-encrypted-sentinel"));
        assert!(raw.contains("remote canonical delta"));
        let chunks = orgtrack_core::sources::codex::app::load_codex_app_from_path(
            "codexapp-native-sync-roundtrip",
            &paths.native_path,
        )
        .expect("round-trip synchronized Codex transcript");
        let human_messages = chunks
            .iter()
            .filter(|chunk| chunk.function == "user_message")
            .map(|chunk| {
                chunk.result["message"]["content"]
                    .as_str()
                    .unwrap_or_default()
            })
            .collect::<Vec<_>>();
        assert_eq!(human_messages, vec!["hello", "remote canonical delta"]);
        let assistant_messages = chunks
            .iter()
            .filter(|chunk| chunk.function == "assistant")
            .map(|chunk| chunk.result["observation"].as_str().unwrap_or_default())
            .collect::<Vec<_>>();
        assert_eq!(assistant_messages, vec!["done"]);
        assert_eq!(
            chunks
                .iter()
                .filter(|chunk| chunk.function == "context_compacted")
                .count(),
            1
        );
        assert_eq!(
            fs::read_to_string(&paths.runner_path).expect("read Codex runner transcript"),
            raw
        );
    }

    #[test]
    fn synchronization_migrates_a_managed_only_transcript_to_the_app_store() {
        let _sandbox = test_env::sandbox();
        let session_id = "cliagent-native-claude-managed-migration";
        let account_id = "native-managed-migration-account";
        let native_id = "00000000-0000-4000-8000-000000000088";
        create_claude_session(session_id, account_id);
        assert!(persistence::update_cli_session_id_for_account(
            session_id,
            Some(account_id),
            native_id,
        )
        .expect("bind legacy native transcript"));
        let paths = claude_native_paths(Some(account_id), Path::new("/repo"), native_id);
        atomic_jsonl(
            &paths.runner_path,
            &claude_records(native_id, Path::new("/repo"), &[message()])
                .expect("legacy Claude records"),
        )
        .expect("write managed-only transcript");
        assert!(!paths.native_path.exists());

        let complete = [message(), assistant_message()];
        synchronize_cli(session_id, &complete, &complete[1..])
            .expect("migrate and synchronize native transcript");

        assert!(paths.native_path.is_file());
        #[cfg(unix)]
        assert_eq!(
            fs::read_link(&paths.runner_path).expect("migrated runner symlink"),
            paths.native_path
        );
        assert!(fs::read_to_string(&paths.native_path)
            .expect("read migrated app transcript")
            .contains("done"));
    }

    #[test]
    fn discard_removes_both_native_paths() {
        let _sandbox = test_env::sandbox();
        let session_id = "cliagent-native-claude-discard";
        let account_id = "native-discard-account";
        create_claude_session(session_id, account_id);
        let receipt = materialize_cli(session_id, &[message()]).expect("materialize transcript");
        let paths = claude_native_paths(
            Some(account_id),
            Path::new("/repo"),
            &receipt.native_session_id,
        );
        assert!(paths.native_path.is_file());
        assert!(fs::symlink_metadata(&paths.runner_path).is_ok());

        assert!(
            discard_cli_materialization(session_id, &receipt.native_session_id)
                .expect("discard transcript")
        );
        assert!(fs::symlink_metadata(&paths.native_path).is_err());
        assert!(fs::symlink_metadata(&paths.runner_path).is_err());
    }

    #[test]
    fn provider_store_jsonl_keeps_the_runner_on_the_same_native_file() {
        let temp_dir = std::env::temp_dir().join(format!(
            "orgii-native-visible-{}-{}",
            std::process::id(),
            Uuid::new_v4().simple()
        ));
        let paths = NativeTranscriptPaths {
            native_path: temp_dir.join("provider/session.jsonl"),
            runner_path: temp_dir.join("runner/session.jsonl"),
        };
        write_native_store_jsonl(&paths, &[json!({"generation": 1})])
            .expect("write initial app-visible transcript");
        #[cfg(unix)]
        assert_eq!(
            fs::read_link(&paths.runner_path).expect("runner transcript symlink"),
            paths.native_path
        );
        assert_eq!(
            fs::read_to_string(&paths.native_path).expect("read provider transcript"),
            fs::read_to_string(&paths.runner_path).expect("read runner transcript")
        );

        write_native_store_jsonl(&paths, &[json!({"generation": 2})])
            .expect("replace app-visible transcript");
        assert!(fs::read_to_string(&paths.runner_path)
            .expect("read replaced runner transcript")
            .contains("\"generation\":2"));
        #[cfg(unix)]
        assert_eq!(
            fs::read_link(&paths.runner_path).expect("replaced runner transcript symlink"),
            paths.native_path
        );

        fs::remove_dir_all(temp_dir).expect("remove temp dir");
    }

    #[test]
    fn provider_refresh_republishes_a_runner_replaced_codex_link() {
        let temp_dir = std::env::temp_dir().join(format!(
            "orgii-native-runner-publish-{}-{}",
            std::process::id(),
            Uuid::new_v4().simple()
        ));
        let paths = NativeTranscriptPaths {
            native_path: temp_dir.join("provider/session.jsonl"),
            runner_path: temp_dir.join("runner/session.jsonl"),
        };
        write_native_store_jsonl(&paths, &[json!({"generation": 1})])
            .expect("write initial provider transcript");
        fs::remove_file(&paths.runner_path).expect("remove runner symlink");
        atomic_jsonl(
            &paths.runner_path,
            &[json!({"generation": 2, "sessionId": "native-publish"})],
        )
            .expect("simulate Codex replacing the runner link");

        publish_runner_transcript(&paths, "native-publish").expect("publish runner transcript");

        assert!(fs::read_to_string(&paths.native_path)
            .expect("read republished provider transcript")
            .contains("\"generation\":2"));
        #[cfg(unix)]
        assert_eq!(
            fs::read_link(&paths.runner_path).expect("restored runner symlink"),
            paths.native_path
        );
        fs::remove_dir_all(temp_dir).expect("remove temp dir");
    }

    #[test]
    fn ambient_claude_uses_the_official_profile_without_an_alias() {
        let _sandbox = test_env::sandbox();
        let session_id = "cliagent-native-claude-ambient";
        create_claude_session_with_account(session_id, None);

        let receipt = materialize_cli(session_id, &[message()])
            .expect("materialize through ambient Claude profile");
        let paths = claude_native_paths(None, Path::new("/repo"), &receipt.native_session_id);

        assert_eq!(paths.runner_path, paths.native_path);
        assert!(paths.native_path.is_file());
        assert_eq!(
            persistence::get_cli_session_id_for_account(session_id, None)
                .expect("read ambient native binding")
                .as_deref(),
            Some(receipt.native_session_id.as_str())
        );
        assert!(
            discard_cli_materialization(session_id, &receipt.native_session_id)
                .expect("discard ambient transcript")
        );
        assert!(!paths.native_path.exists());
    }

    #[test]
    fn claude_cli_materialization_does_not_require_a_desktop_catalog() {
        let _sandbox = test_env::sandbox();
        let session_id = "cliagent-native-claude-no-desktop";
        let account_id = "native-no-desktop-account";
        create_claude_session(session_id, account_id);
        assert!(
            claude_desktop_sessions_roots()
                .iter()
                .all(|root| !root.exists()),
            "sandbox must not contain provider-owned Claude Desktop metadata"
        );

        let receipt = materialize_cli(session_id, &[message()])
            .expect("Claude CLI materialization must not depend on Desktop");
        let paths = claude_native_paths(
            Some(account_id),
            Path::new("/repo"),
            &receipt.native_session_id,
        );
        assert!(paths.native_path.is_file());
        let project_index =
            claude_native_paths(None, Path::new("/repo"), &receipt.native_session_id)
                .native_path
                .parent()
                .expect("Claude project directory")
                .join("sessions-index.json");
        assert!(
            project_index.is_file(),
            "CLI project index is the success boundary"
        );
        assert!(
            claude_desktop_sessions_roots()
                .iter()
                .all(|root| !root.exists()),
            "CLI materialization must not synthesize a Desktop catalog"
        );
    }

    #[test]
    fn claude_desktop_sidecar_registers_the_same_cli_session() {
        let temp_dir = std::env::temp_dir().join(format!(
            "orgii-native-claude-desktop-{}-{}",
            std::process::id(),
            Uuid::new_v4().simple()
        ));
        let sessions_root = temp_dir.join("claude-code-sessions");
        let project_dir = sessions_root.join("organization").join("project");
        let cwd = temp_dir.join("repo");
        fs::create_dir_all(&cwd).expect("create repo");
        atomic_json(
            &project_dir.join("local-existing.json"),
            &json!({
                "sessionId": "local-existing",
                "cliSessionId": "existing",
                "cwd": cwd,
                "lastActivityAt": 1
            }),
        )
        .expect("seed Claude Desktop project");

        let native_id = "00000000-0000-4000-8000-000000000099";
        let sidecar = publish_claude_desktop_session_at(
            &sessions_root,
            &cwd,
            native_id,
            Some("claude-sonnet-4-6"),
            None,
            &[message(), assistant_message()],
            ClaudeDesktopPublicationState {
                materialized_by_orgii: true,
                completed_turns: None,
            },
        )
        .expect("publish Claude Desktop session")
        .expect("matching Claude Desktop project");
        let metadata: Value = serde_json::from_str(
            &fs::read_to_string(&sidecar).expect("read Claude Desktop sidecar"),
        )
        .expect("decode Claude Desktop sidecar");
        assert_eq!(metadata["sessionId"], format!("local_{native_id}"));
        assert_eq!(metadata["cliSessionId"], native_id);
        assert_eq!(metadata["title"], "hello");
        assert_eq!(metadata["completedTurns"], 1);
        assert_eq!(metadata["orgiiMaterialization"], true);

        fs::remove_dir_all(temp_dir).expect("remove temp dir");
    }

    #[test]
    fn native_agent_row_ids_are_stable_per_target_session() {
        let first = native_agent_row_id("target-a", "source-a", Some("turn-a"));
        assert_eq!(
            first,
            native_agent_row_id("target-a", "source-a", Some("turn-a"))
        );
        assert_ne!(
            first,
            native_agent_row_id("target-b", "source-a", Some("turn-a")),
            "the same source may be materialized into multiple target Sessions"
        );
        assert!(first.starts_with("org2-turn-v1.dHVybi1h.c291cmNlLWE."));
    }

    fn catalog_refresh_context(
        session_id: &str,
        native_id: &str,
        provider: NativeCatalogProvider,
    ) -> CliNativePublicationContext {
        CliNativePublicationContext {
            session_id: session_id.to_string(),
            name: format!("title-{native_id}"),
            model: None,
            branch: None,
            native_id: native_id.to_string(),
            cwd: PathBuf::from(format!("/tmp/{session_id}")),
            agent: provider.as_str().to_string(),
            paths: NativeTranscriptPaths {
                native_path: PathBuf::from(format!("/tmp/{native_id}.jsonl")),
                runner_path: PathBuf::from(format!("/tmp/{native_id}.runner.jsonl")),
            },
        }
    }

    #[test]
    fn catalog_refresh_queue_coalesces_native_conversations() {
        let mut queue = NativeCatalogRefreshQueue::default();
        let provider = NativeCatalogProvider::Codex;
        let lane = queue.lane_mut(provider);
        assert!(lane.enqueue(
            provider,
            catalog_refresh_context("session-a", "native-a", provider),
            Some(2)
        ));
        assert!(!lane.enqueue(
            provider,
            catalog_refresh_context("session-a", "native-a", provider),
            Some(3)
        ));
        assert!(!lane.enqueue(
            provider,
            catalog_refresh_context("session-a", "native-b", provider),
            None
        ));
        assert_eq!(
            lane.pending.len(),
            2,
            "an account switch must retain both immutable native bindings"
        );

        let first = lane.take_next().expect("first pending session");
        let second = lane.take_next().expect("second pending session");
        assert!(matches!(
            (
                first.context.native_id.as_str(),
                second.context.native_id.as_str()
            ),
            ("native-a", "native-b") | ("native-b", "native-a")
        ));
        let native_a = if first.context.native_id == "native-a" {
            first
        } else {
            second
        };
        assert_eq!(
            native_a.completed_turns_hint,
            Some(3),
            "coalescing keeps the newest floor"
        );
        assert!(lane.worker_running);
        assert!(lane.take_next().is_none());
        assert!(!lane.worker_running);
    }

    #[test]
    fn catalog_refresh_provider_lanes_advance_independently() {
        let mut queue = NativeCatalogRefreshQueue::default();
        let claude = NativeCatalogProvider::ClaudeCode;
        let codex = NativeCatalogProvider::Codex;
        assert!(queue.lane_mut(claude).enqueue(
            claude,
            catalog_refresh_context("claude-session", "claude-native", claude),
            None
        ));
        assert!(
            queue.lane_mut(codex).enqueue(
                codex,
                catalog_refresh_context("codex-session", "codex-native", codex),
                None
            ),
            "a running Claude worker must not suppress the Codex worker"
        );

        assert_eq!(
            queue
                .lane_mut(claude)
                .take_next()
                .as_ref()
                .map(|request| request.context.session_id.as_str()),
            Some("claude-session")
        );
        assert!(queue.lane_mut(codex).worker_running);
        assert_eq!(
            queue
                .lane_mut(codex)
                .take_next()
                .as_ref()
                .map(|request| request.context.session_id.as_str()),
            Some("codex-session")
        );
    }

    #[test]
    fn catalog_refresh_lane_never_silently_evicts_pending_native_bindings() {
        let mut lane = NativeCatalogRefreshLane::default();
        let provider = NativeCatalogProvider::Codex;
        for index in 0..300 {
            let spawn = lane.enqueue(
                provider,
                catalog_refresh_context(
                    &format!("session-{index:03}"),
                    &format!("native-{index:03}"),
                    provider,
                ),
                None,
            );
            assert_eq!(spawn, index == 0);
        }
        assert_eq!(lane.pending.len(), 300);
    }

    #[test]
    fn claude_desktop_sidecar_refuses_an_empty_catalog() {
        let temp_dir = std::env::temp_dir().join(format!(
            "orgii-native-claude-desktop-empty-{}-{}",
            std::process::id(),
            Uuid::new_v4().simple()
        ));
        let sessions_root = temp_dir.join("Claude").join("claude-code-sessions");
        let cwd = temp_dir.join("new-repo");
        fs::create_dir_all(&cwd).expect("create repo");

        let native_id = "00000000-0000-4000-8000-000000000097";
        let sidecar = publish_claude_desktop_session_at(
            &sessions_root,
            &cwd,
            native_id,
            Some("claude-opus-5"),
            None,
            &[message(), assistant_message()],
            ClaudeDesktopPublicationState {
                materialized_by_orgii: true,
                completed_turns: None,
            },
        )
        .expect("inspect empty Claude Desktop catalog");

        assert!(sidecar.is_none());
        assert!(!sessions_root.exists());

        fs::remove_dir_all(temp_dir).expect("remove temp dir");
    }

    #[test]
    fn claude_desktop_sidecar_groups_a_linked_worktree_with_its_repository() {
        let temp_dir = std::env::temp_dir().join(format!(
            "orgii-native-claude-desktop-worktree-{}-{}",
            std::process::id(),
            Uuid::new_v4().simple()
        ));
        let sessions_root = temp_dir.join("claude-code-sessions");
        let project_dir = sessions_root.join("organization").join("project");
        let repository = temp_dir.join("repository");
        let worktree = temp_dir.join("worktree");
        let worktree_git_dir = repository.join(".git/worktrees/pr939");
        fs::create_dir_all(&worktree_git_dir).expect("create worktree git dir");
        fs::create_dir_all(&worktree).expect("create linked worktree");
        fs::write(worktree_git_dir.join("commondir"), "../..\n").expect("write common dir pointer");
        fs::write(
            worktree.join(".git"),
            format!("gitdir: {}\n", worktree_git_dir.display()),
        )
        .expect("write worktree git pointer");
        atomic_json(
            &project_dir.join("local-existing.json"),
            &json!({
                "sessionId": "local-existing",
                "cliSessionId": "existing",
                "cwd": repository,
                "lastActivityAt": 1
            }),
        )
        .expect("seed Claude Desktop project");

        let native_id = "00000000-0000-4000-8000-000000000098";
        let sidecar = publish_claude_desktop_session_at(
            &sessions_root,
            &worktree,
            native_id,
            Some("claude-opus-5"),
            None,
            &[message(), assistant_message()],
            ClaudeDesktopPublicationState {
                materialized_by_orgii: true,
                completed_turns: None,
            },
        )
        .expect("publish linked-worktree Claude Desktop session")
        .expect("matching Claude Desktop repository project");

        assert_eq!(sidecar.parent(), Some(project_dir.as_path()));
        let metadata: Value =
            serde_json::from_str(&fs::read_to_string(sidecar).expect("read worktree sidecar"))
                .expect("decode worktree sidecar");
        assert_eq!(metadata["cliSessionId"], native_id);
        assert_eq!(metadata["cwd"], worktree.to_string_lossy().as_ref());

        fs::remove_dir_all(temp_dir).expect("remove temp dir");
    }

    #[test]
    fn claude_desktop_refresh_reuses_provider_sidecar_by_cli_session_id() {
        let temp_dir = std::env::temp_dir().join(format!(
            "orgii-native-claude-desktop-refresh-{}-{}",
            std::process::id(),
            Uuid::new_v4().simple()
        ));
        let sessions_root = temp_dir.join("claude-code-sessions");
        let project_dir = sessions_root.join("organization").join("project");
        let cwd = temp_dir.join("repo");
        let native_id = "00000000-0000-4000-8000-000000000099";
        let provider_path = project_dir.join("local-provider-owned.json");
        let unrelated_project_dir = sessions_root
            .join("newer-organization")
            .join("newer-project");
        fs::create_dir_all(&cwd).expect("create repo");
        atomic_json(
            &provider_path,
            &json!({
                "sessionId": "local-provider-owned",
                "cliSessionId": native_id,
                "title": "Provider title",
                "cwd": cwd,
                "lastActivityAt": 1,
                "completedTurns": 0
            }),
        )
        .expect("seed provider-owned Claude Desktop session");
        atomic_json(
            &unrelated_project_dir.join("local-unrelated.json"),
            &json!({
                "sessionId": "local-unrelated",
                "cliSessionId": "different-native-session",
                "title": "Unrelated newer project",
                "cwd": cwd,
                "lastActivityAt": 999,
                "completedTurns": 10
            }),
        )
        .expect("seed newer unrelated Claude Desktop project");

        let sidecar = publish_claude_desktop_session_at(
            &sessions_root,
            &cwd,
            native_id,
            Some("claude-opus-5"),
            None,
            &[message(), assistant_message()],
            ClaudeDesktopPublicationState {
                materialized_by_orgii: false,
                completed_turns: Some(1),
            },
        )
        .expect("refresh Claude Desktop session")
        .expect("matching Claude Desktop project");

        assert_eq!(sidecar, provider_path);
        assert!(!project_dir.join(format!("local_{native_id}.json")).exists());
        assert!(!unrelated_project_dir
            .join(format!("local_{native_id}.json"))
            .exists());
        let metadata: Value =
            serde_json::from_str(&fs::read_to_string(&sidecar).expect("read refreshed sidecar"))
                .expect("decode refreshed sidecar");
        assert_eq!(metadata["sessionId"], "local-provider-owned");
        assert_eq!(metadata["cliSessionId"], native_id);
        assert_eq!(metadata["title"], "Provider title");
        assert_eq!(metadata["completedTurns"], 1);
        assert!(metadata.get("orgiiMaterialization").is_none());

        publish_claude_desktop_session_at(
            &sessions_root,
            &cwd,
            native_id,
            Some("claude-opus-5"),
            None,
            &[],
            ClaudeDesktopPublicationState {
                materialized_by_orgii: false,
                completed_turns: None,
            },
        )
        .expect("metadata-only refresh")
        .expect("existing provider sidecar");
        let metadata: Value = serde_json::from_str(
            &fs::read_to_string(&sidecar).expect("read metadata-only refresh"),
        )
        .expect("decode metadata-only refresh");
        assert_eq!(
            metadata["completedTurns"], 1,
            "unknown refreshes must not reset provider progress"
        );

        fs::remove_dir_all(temp_dir).expect("remove temp dir");
    }

    #[cfg(unix)]
    #[test]
    fn provider_cwd_uses_the_identity_seen_by_the_native_cli() {
        let temp_dir = std::env::temp_dir().join(format!(
            "orgii-native-canonical-cwd-{}-{}",
            std::process::id(),
            Uuid::new_v4().simple()
        ));
        let real = temp_dir.join("real");
        let alias = temp_dir.join("alias");
        fs::create_dir_all(&real).expect("create canonical cwd");
        std::os::unix::fs::symlink(&real, &alias).expect("create cwd alias");

        assert_eq!(
            provider_canonical_cwd(alias),
            fs::canonicalize(&real).expect("canonicalize fixture")
        );

        fs::remove_dir_all(temp_dir).expect("remove canonical cwd fixture");
    }

    #[test]
    fn unsupported_historical_image_fails_closed() {
        let mut item = message();
        if let NativeConversationItem::Message { images, .. } = &mut item {
            images.push("/tmp/image.png".to_string());
        }
        assert!(validate_items(&[item]).is_err());
    }

    #[test]
    fn unsupported_assistant_image_fails_closed() {
        let mut item = assistant_message();
        if let NativeConversationItem::Message { images, .. } = &mut item {
            images.push("data:image/png;base64,AAAA".to_string());
        }
        assert!(validate_items(&[item]).is_err());
    }

    #[test]
    fn portable_tool_call_ids_accept_64_characters_and_reject_65() {
        let tool_call = |call_id: String| NativeConversationItem::ToolCall {
            id: "tool-1:call".to_string(),
            call_id,
            name: "read_file".to_string(),
            arguments: r#"{"path":"/repo/README.md"}"#.to_string(),
            created_at: "2026-08-26T00:00:01Z".to_string(),
        };
        let tool_result = |call_id: String| NativeConversationItem::ToolResult {
            id: "tool-1:result".to_string(),
            call_id,
            name: "read_file".to_string(),
            output: "contents".to_string(),
            created_at: "2026-08-26T00:00:02Z".to_string(),
        };

        assert!(validate_items(&[tool_call("x".repeat(64)), tool_result("x".repeat(64)),]).is_ok());
        assert!(validate_items(&[tool_call("x".repeat(65))]).is_err());
        assert!(validate_items(&[tool_result("x".repeat(65))]).is_err());
        assert!(validate_items(&[tool_call("call:part-0".to_string())]).is_err());
        assert!(validate_items(&[tool_result("call:part-0".to_string())]).is_err());
    }
}
