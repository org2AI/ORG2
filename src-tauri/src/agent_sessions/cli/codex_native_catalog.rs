//! Supported Codex app-server registration for provider-native continuations.
//!
//! A rollout file alone is not a Codex App conversation: the App reads its
//! catalog through the app-server, and intentionally hides catalog rows that
//! have never acquired a user turn.  This module owns the supported JSON-RPC
//! path used to create/resume the real profile and to inject canonical raw
//! response items.  It never reads or writes Codex's private SQLite state.

use std::collections::{HashMap, HashSet};
#[cfg(test)]
use std::cell::Cell;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use key_vault::key_store::ModelType;
use serde_json::{json, Value};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const CATALOG_LOOKUP_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_CATALOG_PAGES: usize = 50;

#[cfg(test)]
thread_local! {
    static DIRECT_TEST_CATALOG: Cell<bool> = const { Cell::new(false) };
}

/// Hermetic catalog adapter for materializer tests whose subject is durable
/// JSONL synchronization rather than the external Codex executable. Real
/// app-server protocol coverage remains in this module's dedicated tests.
#[cfg(test)]
pub(super) struct DirectTestCatalogGuard {
    previous: bool,
}

#[cfg(test)]
impl Drop for DirectTestCatalogGuard {
    fn drop(&mut self) {
        DIRECT_TEST_CATALOG.set(self.previous);
    }
}

#[cfg(test)]
pub(super) fn use_direct_test_catalog() -> DirectTestCatalogGuard {
    let previous = DIRECT_TEST_CATALOG.replace(true);
    DirectTestCatalogGuard { previous }
}

#[cfg(test)]
fn direct_test_catalog_enabled() -> bool {
    DIRECT_TEST_CATALOG.get()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct CodexCatalogEntry {
    pub id: String,
    pub path: PathBuf,
    pub title: String,
    pub cwd: PathBuf,
    pub model_provider: String,
}

struct CodexAppServerClient {
    child: Child,
    stdin: Option<ChildStdin>,
    lines: Receiver<Result<String, String>>,
    reader: Option<JoinHandle<()>>,
    next_id: u64,
}

impl CodexAppServerClient {
    fn launch(cwd: &Path) -> Result<Self, String> {
        let codex_home = app_paths::native_transcript_home_dir().join(".codex");
        // Codex deliberately refuses to start when an explicit CODEX_HOME does
        // not already exist. A brand-new ORG2/native profile therefore has to
        // create the supported profile root before the app-server can register
        // its first thread. Existing user profiles are left untouched.
        std::fs::create_dir_all(&codex_home).map_err(|error| {
            format!(
                "create Codex native profile {}: {error}",
                codex_home.display()
            )
        })?;
        let launch_profile =
            super::launch_profile_store::resolve_cli_launch_profile(&ModelType::Codex)?;
        let command = launch_profile.command;
        let mut child = Command::new(&command)
            .arg("app-server")
            .envs(launch_profile.env)
            // The native catalog always belongs to the real Codex App
            // profile, even when ORGII's runner uses an isolated account home.
            .env("CODEX_HOME", &codex_home)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // The protocol is stdout-only. Discarding stderr also prevents a
            // verbose provider install from filling a pipe while this
            // blocking helper waits for a JSON-RPC response.
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| {
                format!(
                    "start Codex app-server {} for native catalog {}: {error}",
                    command,
                    codex_home.display(),
                )
            })?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Codex app-server stdin was not piped".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Codex app-server stdout was not piped".to_string())?;
        let (sender, lines) = mpsc::channel();
        let reader = std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                if sender
                    .send(line.map_err(|error| error.to_string()))
                    .is_err()
                {
                    break;
                }
            }
        });
        let mut client = Self {
            child,
            stdin: Some(stdin),
            lines,
            reader: Some(reader),
            next_id: 0,
        };
        client.request(
            "initialize",
            json!({
                "clientInfo": {
                    "name": "orgii",
                    "title": "ORGII",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "capabilities": {"experimentalApi": true}
            }),
        )?;
        client.notify("initialized", json!({}))?;
        Ok(client)
    }

    fn write_message(&mut self, value: &Value) -> Result<(), String> {
        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| "Codex app-server stdin is closed".to_string())?;
        serde_json::to_writer(&mut *stdin, value)
            .map_err(|error| format!("encode Codex app-server request: {error}"))?;
        stdin
            .write_all(b"\n")
            .and_then(|_| stdin.flush())
            .map_err(|error| format!("write Codex app-server request: {error}"))
    }

    fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        self.write_message(&json!({"method": method, "params": params}))
    }

    fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.request_until(method, params, Instant::now() + REQUEST_TIMEOUT)
    }

    fn request_until(
        &mut self,
        method: &str,
        params: Value,
        deadline: Instant,
    ) -> Result<Value, String> {
        self.next_id += 1;
        let id = self.next_id;
        self.write_message(&json!({"id": id, "method": method, "params": params}))?;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(format!(
                    "Codex app-server {method} reached its request deadline"
                ));
            }
            let line = self
                .lines
                .recv_timeout(remaining)
                .map_err(|error| format!("Codex app-server {method} ended: {error}"))??;
            let response: Value = serde_json::from_str(&line)
                .map_err(|error| format!("decode Codex app-server response: {error}"))?;
            if response["id"].as_u64() != Some(id) {
                continue;
            }
            if let Some(error) = response.get("error") {
                return Err(format!("Codex app-server {method} failed: {error}"));
            }
            return response
                .get("result")
                .cloned()
                .ok_or_else(|| format!("Codex app-server {method} returned no result"));
        }
    }
}

impl Drop for CodexAppServerClient {
    fn drop(&mut self) {
        self.stdin.take();
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }
}

fn entry_from_thread(thread: &Value) -> Result<CodexCatalogEntry, String> {
    let id = thread["id"]
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Codex app-server thread has no id".to_string())?;
    let path = thread["path"]
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("Codex app-server thread {id} has no rollout path"))?;
    let title = thread["name"]
        .as_str()
        .or_else(|| thread["title"].as_str())
        .unwrap_or_default();
    let cwd = thread["cwd"]
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("Codex app-server thread {id} has no cwd"))?;
    let model_provider = thread["modelProvider"]
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("Codex app-server thread {id} has no model provider"))?;
    Ok(CodexCatalogEntry {
        id: id.to_string(),
        path: PathBuf::from(path),
        title: title.to_string(),
        cwd: PathBuf::from(cwd),
        model_provider: model_provider.to_string(),
    })
}

fn effective_model_provider(
    client: &mut CodexAppServerClient,
    cwd: &Path,
) -> Result<String, String> {
    let result = client.request("config/read", json!({"cwd": cwd, "includeLayers": false}))?;
    Ok(result["config"]["model_provider"]
        .as_str()
        .filter(|value| !value.is_empty())
        // `openai` is Codex's built-in provider when config.toml omits an
        // explicit provider. Keep that default local to the native profile;
        // never borrow the ORGII runner profile's custom provider here.
        .unwrap_or("openai")
        .to_string())
}

fn validate_target_profile(
    entry: CodexCatalogEntry,
    expected_id: &str,
    expected_cwd: &Path,
    expected_title: &str,
    expected_provider: &str,
) -> Result<CodexCatalogEntry, String> {
    if entry.id != expected_id
        || !paths_have_same_identity(&entry.cwd, expected_cwd)
        || entry.title != expected_title
        || entry.model_provider != expected_provider
    {
        return Err(format!(
            "Codex native profile mismatch: expected id={expected_id} cwd={} title={expected_title:?} provider={expected_provider:?}, got id={} cwd={} title={:?} provider={:?}",
            expected_cwd.display(),
            entry.id,
            entry.cwd.display(),
            entry.title,
            entry.model_provider
        ));
    }
    Ok(entry)
}

fn paths_have_same_identity(left: &Path, right: &Path) -> bool {
    if left == right {
        return true;
    }
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

fn find_catalog_entry(
    client: &mut CodexAppServerClient,
    expected_id: &str,
) -> Result<Option<CodexCatalogEntry>, String> {
    let mut cursor: Option<String> = None;
    let deadline = Instant::now() + CATALOG_LOOKUP_TIMEOUT;
    for _ in 0..MAX_CATALOG_PAGES {
        let result = client.request_until(
            "thread/list",
            json!({
                "cursor": cursor,
                "limit": 100,
                "sortDirection": "desc",
                "modelProviders": [],
                "archived": false,
                "useStateDbOnly": false
            }),
            deadline,
        )?;
        let rows = result["data"]
            .as_array()
            .ok_or_else(|| "Codex app-server thread/list returned no data array".to_string())?;
        for row in rows {
            let entry = entry_from_thread(row)?;
            if entry.id == expected_id {
                return Ok(Some(entry));
            }
        }
        cursor = result["nextCursor"].as_str().map(str::to_string);
        if cursor.is_none() {
            return Ok(None);
        }
    }
    Err(format!(
        "Codex app-server thread/list exceeded {MAX_CATALOG_PAGES} pages within {}s",
        CATALOG_LOOKUP_TIMEOUT.as_secs()
    ))
}

fn read_thread(
    client: &mut CodexAppServerClient,
    thread_id: &str,
) -> Result<CodexCatalogEntry, String> {
    let result = client.request(
        "thread/read",
        // Catalog validation only needs id/path/name/cwd/provider metadata.
        // Loading every turn here makes a runtime switch O(full transcript)
        // for exactly the large conversations this adapter must support.
        json!({"threadId": thread_id, "includeTurns": false}),
    )?;
    entry_from_thread(&result["thread"])
}

fn set_thread_name(
    client: &mut CodexAppServerClient,
    thread_id: &str,
    title: &str,
) -> Result<(), String> {
    client.request(
        "thread/name/set",
        json!({"threadId": thread_id, "name": title}),
    )?;
    Ok(())
}

fn inject_items(
    client: &mut CodexAppServerClient,
    thread_id: &str,
    items: &[Value],
) -> Result<(), String> {
    if items.is_empty() {
        return Ok(());
    }
    client.request(
        "thread/inject_items",
        json!({"threadId": thread_id, "items": items}),
    )?;
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SuffixApplication {
    Missing,
    AlreadyApplied,
}

fn response_item_identity(item: &Value) -> Option<String> {
    let item_type = item["type"].as_str()?;
    match item_type {
        "message" | "context_compaction" => item["id"]
            .as_str()
            .filter(|value| !value.is_empty())
            .map(|id| format!("{item_type}:{id}")),
        "function_call" | "function_call_output" => item["call_id"]
            .as_str()
            .filter(|value| !value.is_empty())
            .map(|call_id| format!("{item_type}:{call_id}")),
        _ => None,
    }
}

fn normalized_injected_item(item: &Value) -> Result<Value, String> {
    let mut normalized = item.clone();
    normalized
        .as_object_mut()
        .ok_or_else(|| "Codex native suffix item is not an object".to_string())?
        // `thread/inject_items` accepts this request marker but does not
        // persist unknown top-level response-item fields.
        .remove("orgii_materialization");
    Ok(normalized)
}

fn inspect_suffix_application(
    path: &Path,
    expected_items: &[Value],
) -> Result<SuffixApplication, String> {
    if expected_items.is_empty() {
        return Ok(SuffixApplication::AlreadyApplied);
    }
    let mut expected = HashMap::with_capacity(expected_items.len());
    for item in expected_items {
        let identity = response_item_identity(item).ok_or_else(|| {
            format!(
                "Codex native suffix item has no stable identity: type={:?}",
                item["type"].as_str()
            )
        })?;
        if expected
            .insert(identity.clone(), normalized_injected_item(item)?)
            .is_some()
        {
            return Err(format!(
                "Codex native suffix contains duplicate stable identity {identity}"
            ));
        }
    }

    let file = std::fs::File::open(path)
        .map_err(|error| format!("open Codex rollout {}: {error}", path.display()))?;
    let mut found = HashSet::with_capacity(expected.len());
    for (line_index, line) in BufReader::new(file).lines().enumerate() {
        let line = line.map_err(|error| {
            format!(
                "read Codex rollout {} line {}: {error}",
                path.display(),
                line_index + 1
            )
        })?;
        if line.trim().is_empty() {
            continue;
        }
        let record = serde_json::from_str::<Value>(&line).map_err(|error| {
            format!(
                "decode Codex rollout {} line {}: {error}",
                path.display(),
                line_index + 1
            )
        })?;
        if record["type"] != "response_item" {
            continue;
        }
        let Some(identity) = response_item_identity(&record["payload"]) else {
            continue;
        };
        if let Some(expected_item) = expected.get(&identity) {
            let normalized = normalized_injected_item(&record["payload"])?;
            if &normalized != expected_item {
                return Err(format!(
                    "Codex rollout {} contains stable suffix identity {identity} with conflicting content",
                    path.display()
                ));
            }
            if !found.insert(identity.clone()) {
                return Err(format!(
                    "Codex rollout {} contains duplicate stable suffix identity {identity}",
                    path.display()
                ));
            }
        }
    }

    if found.is_empty() {
        Ok(SuffixApplication::Missing)
    } else if found.len() == expected.len() {
        Ok(SuffixApplication::AlreadyApplied)
    } else {
        Err(format!(
            "Codex rollout {} contains {} of {} stable suffix items; refusing a mixed retry",
            path.display(),
            found.len(),
            expected.len()
        ))
    }
}

#[cfg(test)]
fn append_direct_test_items(path: &Path, items: &[Value]) -> Result<(), String> {
    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(path)
        .map_err(|error| format!("open direct-test Codex rollout {}: {error}", path.display()))?;
    for item in items {
        let record = json!({
            "timestamp": "2026-08-26T00:00:00Z",
            "type": "response_item",
            "payload": normalized_injected_item(item)?,
        });
        serde_json::to_writer(&mut file, &record).map_err(|error| {
            format!(
                "write direct-test Codex rollout {}: {error}",
                path.display()
            )
        })?;
        file.write_all(b"\n").map_err(|error| {
            format!(
                "write direct-test Codex rollout {}: {error}",
                path.display()
            )
        })?;
    }
    file.sync_all().map_err(|error| {
        format!(
            "sync direct-test Codex rollout {}: {error}",
            path.display()
        )
    })
}

#[cfg(test)]
fn register_direct_test_thread(
    cwd: &Path,
    title: &str,
    items: &[Value],
) -> Result<CodexCatalogEntry, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let path = app_paths::native_transcript_home_dir()
        .join(".codex")
        .join("sessions")
        .join("test")
        .join(format!("rollout-{id}.jsonl"));
    let parent = path
        .parent()
        .ok_or_else(|| format!("direct-test Codex rollout has no parent: {}", path.display()))?;
    std::fs::create_dir_all(parent).map_err(|error| {
        format!(
            "create direct-test Codex rollout directory {}: {error}",
            parent.display()
        )
    })?;
    let metadata = json!({
        "timestamp": "2026-08-26T00:00:00Z",
        "type": "session_meta",
        "payload": {
            "id": id,
            "cwd": cwd,
            "originator": "orgii",
            "model_provider": "openai",
        }
    });
    let mut file = std::fs::File::create(&path).map_err(|error| {
        format!(
            "create direct-test Codex rollout {}: {error}",
            path.display()
        )
    })?;
    serde_json::to_writer(&mut file, &metadata).map_err(|error| {
        format!(
            "write direct-test Codex rollout {}: {error}",
            path.display()
        )
    })?;
    file.write_all(b"\n").map_err(|error| {
        format!(
            "write direct-test Codex rollout {}: {error}",
            path.display()
        )
    })?;
    file.sync_all().map_err(|error| {
        format!(
            "sync direct-test Codex rollout {}: {error}",
            path.display()
        )
    })?;
    append_direct_test_items(&path, items)?;
    Ok(CodexCatalogEntry {
        id,
        path,
        title: title.to_string(),
        cwd: cwd.to_path_buf(),
        model_provider: "openai".to_string(),
    })
}

pub(super) fn register_thread(
    cwd: &Path,
    title: &str,
    items: &[Value],
) -> Result<CodexCatalogEntry, String> {
    #[cfg(test)]
    if direct_test_catalog_enabled() {
        return register_direct_test_thread(cwd, title, items);
    }
    let mut client = CodexAppServerClient::launch(cwd)?;
    let model_provider = effective_model_provider(&mut client, cwd)?;
    let result = client.request(
        "thread/start",
        json!({
            "cwd": cwd,
            "modelProvider": model_provider,
            "ephemeral": false,
            "historyMode": "legacy",
            "experimentalRawEvents": false
        }),
    )?;
    let started_id = result["thread"]["id"]
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Codex app-server thread/start returned no thread id".to_string())?
        .to_string();
    let registered = (|| -> Result<CodexCatalogEntry, String> {
        set_thread_name(&mut client, &started_id, title)?;
        let registered = read_thread(&mut client, &started_id)?;
        let registered =
            validate_target_profile(registered, &started_id, cwd, title, &model_provider)?;
        // Injection is deliberately last. Once this request succeeds there
        // are no later fallible validation steps that could make a caller
        // retry and duplicate the same canonical suffix.
        inject_items(&mut client, &started_id, items)?;
        Ok(registered)
    })();
    if registered.is_err() {
        let _ = client.request("thread/archive", json!({"threadId": &started_id}));
    }
    registered
}

pub(super) fn synchronize_thread(
    path: &Path,
    expected_id: &str,
    cwd: &Path,
    title: &str,
    items: &[Value],
) -> Result<CodexCatalogEntry, String> {
    // Inspect the durable rollout before any app-server mutation. A timed-out
    // `thread/inject_items` may have committed even when ORGII lost the reply;
    // retries must therefore prove all-missing or all-applied, never inject a
    // mixed/unknown suffix blindly.
    let suffix_application = inspect_suffix_application(path, items)?;
    #[cfg(test)]
    if direct_test_catalog_enabled() {
        if suffix_application == SuffixApplication::Missing {
            append_direct_test_items(path, items)?;
        }
        return Ok(CodexCatalogEntry {
            id: expected_id.to_string(),
            path: path.to_path_buf(),
            title: title.to_string(),
            cwd: cwd.to_path_buf(),
            model_provider: "openai".to_string(),
        });
    }
    let mut client = CodexAppServerClient::launch(cwd)?;
    let model_provider = effective_model_provider(&mut client, cwd)?;
    let result = client.request(
        "thread/resume",
        json!({
            "threadId": expected_id,
            "path": path,
            "cwd": cwd,
            "modelProvider": model_provider
        }),
    )?;
    let resumed = entry_from_thread(&result["thread"])?;
    if resumed.id != expected_id {
        return Err(format!(
            "Codex resumed the wrong native thread: expected {expected_id}, got {}",
            resumed.id
        ));
    }
    set_thread_name(&mut client, expected_id, title)?;
    let synchronized = read_thread(&mut client, expected_id)?;
    let synchronized =
        validate_target_profile(synchronized, expected_id, cwd, title, &model_provider)?;
    // Keep injection as the terminal mutation. If its response is lost, the
    // next call re-inspects the durable rollout before deciding to inject.
    if suffix_application == SuffixApplication::Missing {
        inject_items(&mut client, expected_id, items)?;
    }
    Ok(synchronized)
}

pub(super) fn refresh_catalog(
    path: &Path,
    expected_id: &str,
    cwd: &Path,
    title: &str,
) -> Result<CodexCatalogEntry, String> {
    let mut client = CodexAppServerClient::launch(cwd)?;
    let model_provider = effective_model_provider(&mut client, cwd)?;
    let result = client.request(
        "thread/resume",
        json!({
            "threadId": expected_id,
            "path": path,
            "cwd": cwd,
            "modelProvider": model_provider
        }),
    )?;
    let resumed = entry_from_thread(&result["thread"])?;
    if resumed.id != expected_id {
        return Err(format!(
            "Codex catalog refresh resumed {0} instead of {expected_id}",
            resumed.id
        ));
    }
    set_thread_name(&mut client, expected_id, title)?;
    let listed = find_catalog_entry(&mut client, expected_id)?.ok_or_else(|| {
        format!(
            "Codex App catalog does not list native thread {expected_id}; the rollout is not user-openable"
        )
    })?;
    validate_target_profile(listed, expected_id, cwd, title, &model_provider)
}

pub(super) fn archive_thread(path: &Path, expected_id: &str, cwd: &Path) -> Result<(), String> {
    let mut client = CodexAppServerClient::launch(cwd)?;
    let model_provider = effective_model_provider(&mut client, cwd)?;
    let result = client.request(
        "thread/resume",
        json!({
            "threadId": expected_id,
            "path": path,
            "cwd": cwd,
            "modelProvider": model_provider
        }),
    )?;
    let resumed = entry_from_thread(&result["thread"])?;
    if resumed.id != expected_id {
        return Err(format!(
            "refusing to archive Codex thread {} while rolling back {expected_id}",
            resumed.id
        ));
    }
    client.request("thread/archive", json!({"threadId": expected_id}))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_thread_catalog_shape() {
        let entry = entry_from_thread(&json!({
            "id": "thread-1",
            "path": "/tmp/rollout-thread-1.jsonl",
            "name": "Native title",
            "cwd": "/tmp/repo",
            "modelProvider": "openai"
        }))
        .expect("catalog entry");
        assert_eq!(entry.id, "thread-1");
        assert_eq!(entry.title, "Native title");
        assert_eq!(entry.cwd, PathBuf::from("/tmp/repo"));
        assert_eq!(entry.model_provider, "openai");
    }

    #[test]
    fn rejects_catalog_rows_without_provider_identity() {
        let error = entry_from_thread(&json!({"cwd": "/tmp/repo"}))
            .expect_err("missing identity must fail");
        assert!(error.contains("no id"));
    }

    #[test]
    fn rejects_runner_provider_identity_in_native_profile() {
        let entry = CodexCatalogEntry {
            id: "thread-1".to_string(),
            path: PathBuf::from("/tmp/rollout-thread-1.jsonl"),
            title: "Native title".to_string(),
            cwd: PathBuf::from("/tmp/repo"),
            model_provider: "orgii_compatible".to_string(),
        };
        let error = validate_target_profile(
            entry,
            "thread-1",
            Path::new("/tmp/repo"),
            "Native title",
            "openai",
        )
        .expect_err("runner-only provider must not enter the native catalog");
        assert!(error.contains("orgii_compatible"));
        assert!(error.contains("openai"));
    }

    #[test]
    fn suffix_inspection_distinguishes_missing_applied_and_mixed() {
        let temp = tempfile::tempdir().expect("temp Codex rollout root");
        let path = temp.path().join("rollout.jsonl");
        let expected = vec![
            json!({"type": "message", "id": "message-1"}),
            json!({"type": "function_call", "call_id": "call-1"}),
        ];
        let rollout = |items: &[Value]| {
            items
                .iter()
                .map(|payload| json!({"type": "response_item", "payload": payload}).to_string())
                .collect::<Vec<_>>()
                .join("\n")
        };

        std::fs::write(
            &path,
            rollout(&[json!({"type": "message", "id": "unrelated"})]),
        )
        .expect("write missing suffix fixture");
        assert_eq!(
            inspect_suffix_application(&path, &expected).expect("inspect missing suffix"),
            SuffixApplication::Missing
        );

        std::fs::write(&path, rollout(&expected[..1])).expect("write mixed suffix fixture");
        assert!(inspect_suffix_application(&path, &expected).is_err());

        std::fs::write(&path, rollout(&expected)).expect("write applied suffix fixture");
        assert_eq!(
            inspect_suffix_application(&path, &expected).expect("inspect applied suffix"),
            SuffixApplication::AlreadyApplied
        );
    }

    #[cfg(unix)]
    #[test]
    fn accepts_filesystem_equivalent_catalog_cwd() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().expect("temp native catalog root");
        let canonical = temp.path().join("canonical-workspace");
        let alias = temp.path().join("workspace-alias");
        std::fs::create_dir(&canonical).expect("canonical workspace");
        symlink(&canonical, &alias).expect("workspace alias");
        let entry = CodexCatalogEntry {
            id: "thread-1".to_string(),
            path: temp.path().join("rollout-thread-1.jsonl"),
            title: "Native title".to_string(),
            cwd: alias,
            model_provider: "openai".to_string(),
        };

        validate_target_profile(entry, "thread-1", &canonical, "Native title", "openai")
            .expect("filesystem-equivalent cwd must preserve native identity");
    }
}
