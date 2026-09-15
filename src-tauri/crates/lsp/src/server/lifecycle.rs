//! Process lifecycle: the `LspServer` type itself, spawning, the
//! `initialize` handshake, and the shutdown / `Drop` teardown path.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use std::time::Duration;
use tokio::process::{ChildStderr, ChildStdin, ChildStdout, Command};
use tokio::sync::{Mutex, RwLock};

use super::super::types::*;
use super::diagnostics::DiagnosticsCache;
use super::transport::drain_pending_on_close;

/// Time we give a server to respond to `initialize` before we abort
/// startup. Some servers (rust-analyzer cold-start on a fresh workspace,
/// pyright with a large monorepo) genuinely need 20–30s here, so we
/// pick a generous bound rather than the per-request default.
const INITIALIZE_TIMEOUT: Duration = Duration::from_secs(60);

/// Time we give a server to acknowledge `shutdown` before we send `exit`
/// and terminate the process.
const SHUTDOWN_REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

/// A single server generation. Its supervisor owns/reaps the child; stop
/// wakes all pipe tasks, even while callers retain a lease after removal.
pub struct LspServer {
    #[cfg(test)]
    pub(super) process_id: u32,
    pub(super) language: String,
    pub(super) supervisor: Mutex<Option<tokio::task::JoinHandle<()>>>,
    pub(super) stop: Arc<super::control::Stop>,
    pub(super) pumps: Mutex<Vec<tokio::task::JoinHandle<()>>>,
    pub(super) workspace_settings: Arc<RwLock<serde_json::Value>>,
    pub(super) documents: Arc<Mutex<HashMap<String, i32>>>,
    pub(super) stdin: Arc<Mutex<Option<ChildStdin>>>,
    pub(super) stdout: Option<ChildStdout>,
    pub(super) stderr: Option<ChildStderr>,
    pub(super) next_request_id: Arc<AtomicU64>,
    pub(super) pending_requests: super::transport::Pending,
    pub(super) cancel_slots: Arc<tokio::sync::Semaphore>,
    pub(super) diagnostics_cache: Arc<RwLock<DiagnosticsCache>>,
    pub(super) capabilities: Arc<RwLock<Option<ServerCapabilities>>>,
    pub(super) log_buffer: crate::log_buffer::LogBuffer,
}

impl LspServer {
    /// Create and spawn a new LSP server process
    pub fn new(
        language: &str,
        command: &str,
        args: Vec<&str>,
        root_path: &str,
    ) -> Result<Self, String> {
        Self::new_with_binary(
            language,
            &std::path::PathBuf::from(command),
            args.into_iter().map(String::from).collect(),
            root_path,
            HashMap::new(),
        )
    }

    /// Create and spawn a new LSP server process with explicit binary path and env vars.
    pub fn new_with_binary(
        language: &str,
        binary_path: &std::path::Path,
        args: Vec<String>,
        root_path: &str,
        env_vars: HashMap<String, String>,
    ) -> Result<Self, String> {
        let command_str = binary_path.to_string_lossy();
        log::info!(
            "[LSP] Spawning {} server: {} {:?}",
            language,
            command_str,
            args
        );
        log::info!("[LSP] Working directory: {}", root_path);

        let mut cmd = Command::new(binary_path);
        cmd.args(&args)
            .current_dir(root_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        // Add environment variables
        for (key, value) in &env_vars {
            cmd.env(key, value);
        }

        // Suppress console window on Windows.
        #[cfg(windows)]
        cmd.creation_flags(app_platform::CREATE_NO_WINDOW);

        let mut process = cmd.spawn().map_err(|e| {
            format!(
                "Failed to spawn {} LSP server: {}. Is {} installed?",
                language, e, command_str
            )
        })?;

        let stdin = process
            .stdin
            .take()
            .ok_or_else(|| "Failed to get stdin".to_string())?;
        let stdout = process
            .stdout
            .take()
            .ok_or_else(|| "Failed to get stdout".to_string())?;
        let stderr = process
            .stderr
            .take()
            .ok_or_else(|| "Failed to get stderr".to_string())?;

        log::info!(
            "[LSP] Successfully spawned {} server (PID: {:?})",
            language,
            process.id()
        );

        let stop = super::control::Stop::new();
        let pending_requests = Arc::new(parking_lot::Mutex::new(HashMap::new()));
        let owner_stop = stop.clone();
        let owner_pending = pending_requests.clone();
        #[cfg(test)]
        let process_id = process.id().expect("spawned child has a pid");
        let supervisor = tokio::spawn(async move {
            tokio::select! {
                _ = owner_stop.cancelled() => { let _ = process.start_kill(); let _ = process.wait().await; }
                _ = process.wait() => {}
            }
            owner_stop.close();
            owner_pending.lock().clear();
        });

        Ok(Self {
            #[cfg(test)]
            process_id,
            language: language.to_string(),
            supervisor: Mutex::new(Some(supervisor)),
            stop,
            pumps: Mutex::new(Vec::new()),
            workspace_settings: Arc::new(RwLock::new(serde_json::Value::Null)),
            documents: Arc::new(Mutex::new(HashMap::new())),
            stdin: Arc::new(Mutex::new(Some(stdin))),
            stdout: Some(stdout),
            stderr: Some(stderr),
            next_request_id: Arc::new(AtomicU64::new(1)),
            pending_requests,
            cancel_slots: Arc::new(tokio::sync::Semaphore::new(16)),
            diagnostics_cache: Arc::new(tokio::sync::RwLock::new(DiagnosticsCache::default())),
            capabilities: Arc::new(RwLock::new(None)),
            log_buffer: crate::log_buffer::LogBuffer::new(),
        })
    }

    /// Snapshot of the recent stdio ring buffer. Used by
    /// `lsp_get_server_log` and the agent-core `manage_lsp` tool to
    /// surface server activity in the UI.
    pub fn log_snapshot(&self) -> Vec<crate::log_buffer::LogLine> {
        self.log_buffer.snapshot()
    }

    /// Initialize the LSP server with the given initialization options
    /// and post-init workspace configuration.
    ///
    /// Both `init_options` and `workspace_config` come from the
    /// caller-resolved `ServerDef` (typically via
    /// `LspManager::start_server`). The LSP host itself is
    /// language-agnostic and does NOT inspect `self.language` here —
    /// any server-specific defaults belong on the `ServerDef` impl.
    ///
    /// On success, `result.capabilities` from the `initialize`
    /// response is parsed into `self.capabilities` so subsequent
    /// `hover` / `goto_definition` / `find_references` calls can
    /// fail fast when the feature is not advertised.
    pub async fn initialize_with_options(
        &self,
        root_path: &str,
        init_options: Option<serde_json::Value>,
        workspace_config: Option<serde_json::Value>,
    ) -> Result<(), String> {
        log::info!(
            "[LSP] Initializing {} server for workspace: {}",
            self.language,
            root_path
        );

        let final_init_options = init_options.unwrap_or_else(|| serde_json::json!({}));
        *self.workspace_settings.write().await =
            workspace_config.clone().unwrap_or(serde_json::Value::Null);
        let root_uri = tauri::Url::from_directory_path(root_path)
            .map_err(|_| "Invalid workspace directory".to_string())?
            .to_string();

        let params = serde_json::json!({
            "processId": std::process::id(),
            "rootPath": root_path,
            "rootUri": root_uri,
            "capabilities": {
                "textDocument": {
                    "synchronization": {
                        "dynamicRegistration": false,
                        "willSave": false,
                        "willSaveWaitUntil": false,
                        "didSave": false
                    },
                    "completion": {
                        "dynamicRegistration": false,
                        "completionItem": {
                            "snippetSupport": false
                        }
                    },
                    "hover": { "dynamicRegistration": false },
                    "definition": { "dynamicRegistration": false },
                    "references": { "dynamicRegistration": false },
                    "documentSymbol": {
                        "dynamicRegistration": false,
                        "hierarchicalDocumentSymbolSupport": true
                    },
                    "documentHighlight": { "dynamicRegistration": false },
                    "publishDiagnostics": {
                        "relatedInformation": true
                    }
                },
                "workspace": {
                    "applyEdit": false,
                    "workspaceEdit": {
                        "documentChanges": true
                    },
                    "didChangeConfiguration": {
                        "dynamicRegistration": false
                    },
                    "didChangeWatchedFiles": {
                        "dynamicRegistration": false
                    },
                    "symbol": {
                        "dynamicRegistration": false
                    },
                    "configuration": true
                }
            },
            "initializationOptions": final_init_options,
            "workspaceFolders": [{
                "uri": root_uri,
                "name": "workspace"
            }]
        });

        let init_result = self
            .request_with_timeout("initialize", params, INITIALIZE_TIMEOUT)
            .await?;
        let capabilities = serde_json::from_value::<InitializeResult>(init_result)
            .map_err(|err| format!("Invalid initialize result: {err}"))?
            .capabilities;
        *self.capabilities.write().await = Some(capabilities);

        self.send_notification("initialized", Some(serde_json::json!({})))
            .await?;

        if let Some(settings) = workspace_config {
            self.send_notification(
                "workspace/didChangeConfiguration",
                Some(serde_json::json!({ "settings": settings })),
            )
            .await?;
        }

        log::info!("[LSP] {} server initialized successfully", self.language);
        Ok(())
    }

    pub fn close(&self) {
        self.stop.close();
    }
    pub fn is_closed(&self) -> bool {
        self.stop.is_closed()
    }

    /// Close remains independent of a stuck writer. Graceful protocol gets a
    /// short budget; then the process owner kills and reaps the child.
    pub async fn shutdown(&self) {
        let graceful = async {
            let _ = self
                .request_with_timeout(
                    "shutdown",
                    serde_json::Value::Null,
                    SHUTDOWN_REQUEST_TIMEOUT,
                )
                .await;
            let _ = self.send_notification("exit", None).await;
        };
        let _ = tokio::time::timeout(SHUTDOWN_REQUEST_TIMEOUT, graceful).await;
        self.stop.close();
        if let Some(task) = self.supervisor.lock().await.take() {
            let _ = task.await;
        }
        *self.stdin.lock().await = None;
        let pumps = std::mem::take(&mut *self.pumps.lock().await);
        for task in pumps {
            let _ = task.await;
        }
        drain_pending_on_close(&self.pending_requests, &self.language).await;
    }
}
impl Drop for LspServer {
    fn drop(&mut self) {
        self.stop.close();
    }
}
