//! Workspace-keyed server ownership. Callers retain a lease, never re-resolve a
//! language against the first app-wide process after awaiting another step.
use super::{
    config::{get_server_override, is_server_enabled},
    server::LspServer,
    server_defs::{servers_for_language_id, ServerDef},
};
use parking_lot::Mutex;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tokio::sync::watch;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ServerKey {
    pub root: PathBuf,
    pub server_id: String,
}
impl ServerKey {
    pub fn new(root: impl Into<PathBuf>, server_id: impl Into<String>) -> Self {
        let root = root.into();
        // Do not perform blocking filesystem canonicalization on this path.
        // URI/root spelling is retained consistently by the caller lease.
        Self {
            root,
            server_id: server_id.into(),
        }
    }
}
#[derive(Clone)]
pub struct ServerLease {
    key: ServerKey,
    server: Arc<LspServer>,
}
impl ServerLease {
    pub fn key(&self) -> &ServerKey {
        &self.key
    }
}
impl std::ops::Deref for ServerLease {
    type Target = LspServer;
    fn deref(&self) -> &LspServer {
        &self.server
    }
}
struct BrokenInfo {
    broken_at: Instant,
    error: String,
}
const MAX_SERVER_OWNERS: usize = 32;
const BROKEN_COOLDOWN: Duration = Duration::from_secs(300);
type SpawnResult = Result<Arc<LspServer>, String>;
struct SpawnEntry {
    id: u64,
    result: watch::Sender<Option<SpawnResult>>,
}
type Spawning = Arc<Mutex<HashMap<ServerKey, SpawnEntry>>>;
struct SpawnGuard {
    key: ServerKey,
    id: u64,
    spawning: Spawning,
}
impl Drop for SpawnGuard {
    fn drop(&mut self) {
        let mut spawning = self.spawning.lock();
        if spawning.get(&self.key).is_some_and(|e| e.id == self.id) {
            if let Some(entry) = spawning.remove(&self.key) {
                entry
                    .result
                    .send_replace(Some(Err("LSP startup cancelled".into())));
            }
        }
    }
}
#[derive(Clone)]
pub struct LspManager {
    servers: Arc<Mutex<HashMap<ServerKey, Arc<LspServer>>>>,
    spawning: Spawning,
    broken: Arc<Mutex<HashMap<ServerKey, BrokenInfo>>>,
    next_spawn: Arc<AtomicU64>,
}
impl Default for LspManager {
    fn default() -> Self {
        Self::new()
    }
}
impl LspManager {
    pub fn new() -> Self {
        Self {
            servers: Default::default(),
            spawning: Default::default(),
            broken: Default::default(),
            next_spawn: Arc::new(AtomicU64::new(1)),
        }
    }
    pub async fn start_server(
        &self,
        language: &str,
        root: &str,
        _app: tauri::AppHandle,
    ) -> Result<ServerLease, String> {
        let key = server_key_for_language(language, root)
            .ok_or_else(|| format!("No LSP server for {language}"))?;
        let defs = servers_for_language_id(language);
        let def = *defs
            .first()
            .ok_or_else(|| format!("No LSP server for {language}"))?;
        if !is_server_enabled(&key.server_id).await {
            return Err(format!("Server {} is disabled", key.server_id));
        }
        self.start_with(&key, self.do_spawn_server(&key, def)).await
    }
    pub(crate) async fn start_with(
        &self,
        key: &ServerKey,
        spawn: impl std::future::Future<Output = Result<LspServer, String>>,
    ) -> Result<ServerLease, String> {
        let (id, mut receiver, primary) = {
            let mut spawning = self.spawning.lock();
            self.servers.lock().retain(|_, server| !server.is_closed());
            if let Some(server) = self
                .servers
                .lock()
                .get(key)
                .filter(|s| !s.is_closed())
                .cloned()
            {
                return Ok(ServerLease {
                    key: key.clone(),
                    server,
                });
            }
            self.broken
                .lock()
                .retain(|_, entry| entry.broken_at.elapsed() < BROKEN_COOLDOWN);
            if let Some(info) = self.broken.lock().get(key) {
                return Err(format!(
                    "Server {} in cooldown: {}",
                    key.server_id, info.error
                ));
            }
            if let Some(entry) = spawning.get(key) {
                (entry.id, entry.result.subscribe(), false)
            } else {
                if self.servers.lock().len() + spawning.len() >= MAX_SERVER_OWNERS {
                    return Err("LSP server limit reached; stop an unused workspace server".into());
                }
                let id = self.next_spawn.fetch_add(1, Ordering::Relaxed);
                let (result, receiver) = watch::channel(None);
                spawning.insert(key.clone(), SpawnEntry { id, result });
                (id, receiver, true)
            }
        };
        if !primary {
            loop {
                if let Some(result) = receiver.borrow_and_update().clone() {
                    return result.map(|server| ServerLease {
                        key: key.clone(),
                        server,
                    });
                }
                receiver
                    .changed()
                    .await
                    .map_err(|_| "LSP startup cancelled".to_string())?;
            }
        }
        let _guard = SpawnGuard {
            key: key.clone(),
            id,
            spawning: self.spawning.clone(),
        };
        let result = tokio::select! {
            result = spawn => result.and_then(|server| {
                if server.is_closed() { Err("LSP exited during startup".into()) }
                else { Ok(Arc::new(server)) }
            }),
            _ = receiver.changed() => Err("LSP startup cancelled".into()),
        };
        {
            let mut spawning = self.spawning.lock();
            if !spawning.get(key).is_some_and(|e| e.id == id) {
                return Err("LSP startup superseded".into());
            }
            if let Ok(server) = &result {
                self.servers.lock().insert(key.clone(), server.clone());
                self.broken.lock().remove(key);
            } else if let Err(error) = &result {
                let mut broken = self.broken.lock();
                if broken.len() >= MAX_SERVER_OWNERS {
                    let oldest = broken
                        .iter()
                        .min_by_key(|(_, info)| info.broken_at)
                        .map(|(key, _)| key.clone());
                    if let Some(oldest) = oldest {
                        broken.remove(&oldest);
                    }
                }
                broken.insert(
                    key.clone(),
                    BrokenInfo {
                        broken_at: Instant::now(),
                        error: error.clone(),
                    },
                );
            }
            let entry = spawning.remove(key).expect("owned spawn entry");
            entry.result.send_replace(Some(result.clone()));
        }
        result.map(|server| ServerLease {
            key: key.clone(),
            server,
        })
    }
    pub async fn server(&self, key: &ServerKey) -> Result<ServerLease, String> {
        self.servers
            .lock()
            .get(key)
            .filter(|s| !s.is_closed())
            .cloned()
            .map(|server| ServerLease {
                key: key.clone(),
                server,
            })
            .ok_or_else(|| {
                format!(
                    "No running LSP server for {} at {}",
                    key.server_id,
                    key.root.display()
                )
            })
    }
    pub async fn is_server_running(&self, key: &ServerKey) -> bool {
        self.server(key).await.is_ok()
    }
    pub async fn get_running_servers(&self) -> Vec<String> {
        self.servers
            .lock()
            .iter()
            .filter(|(_, s)| !s.is_closed())
            .map(|(k, _)| k.server_id.clone())
            .collect()
    }
    pub async fn running_at(&self, root: &str) -> Vec<String> {
        self.servers
            .lock()
            .iter()
            .filter(|(k, s)| k.root == Path::new(root) && !s.is_closed())
            .map(|(k, _)| k.server_id.clone())
            .collect()
    }
    pub async fn stop_server(&self, key: &ServerKey) -> Result<(), String> {
        let server = {
            let mut spawning = self.spawning.lock();
            if let Some(entry) = spawning.remove(key) {
                entry
                    .result
                    .send_replace(Some(Err("LSP startup stopped".into())));
            }
            self.servers.lock().remove(key)
        };
        self.broken.lock().remove(key);
        if let Some(server) = server {
            server.close();
            server.shutdown().await;
        }
        Ok(())
    }
    pub async fn shutdown(&self) -> Result<(), String> {
        self.broken.lock().clear();
        let servers = {
            let mut spawning = self.spawning.lock();
            for (_, entry) in spawning.drain() {
                entry
                    .result
                    .send_replace(Some(Err("LSP manager shutdown".into())));
            }
            self.servers
                .lock()
                .drain()
                .map(|(_, s)| s)
                .collect::<Vec<_>>()
        };
        for server in &servers {
            server.close();
        }
        futures::future::join_all(servers.iter().map(|s| s.shutdown())).await;
        Ok(())
    }
    pub async fn get_server_log(&self, key: &ServerKey) -> Vec<crate::log_buffer::LogLine> {
        self.server(key)
            .await
            .map(|s| s.log_snapshot())
            .unwrap_or_default()
    }
    pub async fn revive_server(&self, server_id: &str) -> usize {
        let mut b = self.broken.lock();
        let before = b.len();
        b.retain(|k, _| k.server_id != server_id);
        before - b.len()
    }
    pub async fn revive_all(&self) -> usize {
        let mut b = self.broken.lock();
        let n = b.len();
        b.clear();
        n
    }
    pub async fn broken_snapshot(&self) -> Vec<(String, String, u64)> {
        self.broken
            .lock()
            .iter()
            .filter(|(_, i)| i.broken_at.elapsed() < BROKEN_COOLDOWN)
            .map(|(k, i)| {
                (
                    k.server_id.clone(),
                    i.error.clone(),
                    i.broken_at.elapsed().as_secs(),
                )
            })
            .collect()
    }
    #[cfg(debug_assertions)]
    pub async fn seed_broken_for_test(&self, key: ServerKey, error: String) {
        self.broken.lock().insert(
            key,
            BrokenInfo {
                broken_at: Instant::now(),
                error,
            },
        );
    }
    pub fn get_install_hint(language: &str) -> Option<String> {
        servers_for_language_id(language)
            .first()
            .map(|s| s.install_hint())
    }
    /// Actually spawn a server (called after deduplication checks).
    async fn do_spawn_server(
        &self,
        key: &ServerKey,
        server_def: &dyn ServerDef,
    ) -> Result<LspServer, String> {
        log::info!(
            "[LSP Manager] Starting {} server at {:?}",
            key.server_id,
            key.root
        );

        // Get binary path (with potential auto-install)
        let binary_path = self.resolve_binary(server_def).await?;

        // Get command args
        let args: Vec<String> = server_def
            .command_args()
            .iter()
            .map(|s| s.to_string())
            .collect();

        // Get any config overrides
        let override_config = get_server_override(&key.server_id).await;
        let final_args = override_config
            .as_ref()
            .and_then(|o| o.args.clone())
            .unwrap_or(args);

        // Get env vars
        let mut env_vars: HashMap<String, String> = server_def
            .env_vars()
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect();

        if let Some(ref config) = override_config {
            env_vars.extend(config.env.clone());
        }

        // Create and initialize server
        let root_str = key.root.to_string_lossy().to_string();

        let mut server = match LspServer::new_with_binary(
            &key.server_id,
            &binary_path,
            final_args,
            &root_str,
            env_vars,
        ) {
            Ok(server) => server,
            Err(err) => {
                return Err(err);
            }
        };

        // Spawn the stdout reader BEFORE sending `initialize`. The
        // reader is what resolves the `oneshot::Receiver` returned by
        // `send_request_with_response`; if `initialize` is sent first,
        // its response sits in the OS pipe with no consumer and the
        // 60s timeout always fires (the cooldown error users see as
        // "initialize timed out after 60s for typescript").
        if let Err(err) = server.start_stdio(key.server_id.clone()) {
            server.shutdown().await;
            return Err(err);
        }

        let init_options = server_def.initialization_options(&key.root);
        let workspace_config = server_def.workspace_configuration(&key.root);

        if let Err(err) = server
            .initialize_with_options(&root_str, init_options, workspace_config)
            .await
        {
            // The server we just spawned hasn't been published into
            // `self.servers` yet, so reap its child here instead of
            // leaving cleanup to the (sync) Drop impl.
            server.shutdown().await;
            return Err(err);
        }

        Ok(server)
    }

    /// Resolve the binary path for a server definition.
    async fn resolve_binary(&self, server_def: &dyn ServerDef) -> Result<PathBuf, String> {
        let binary_name = server_def.binary_name();

        // Check for config override
        if let Some(config) = get_server_override(server_def.id()).await {
            if let Some(ref custom_path) = config.binary_path {
                let path = PathBuf::from(custom_path);
                if path.exists() {
                    return Ok(path);
                }
                return Err(format!(
                    "Custom binary path does not exist: {}",
                    custom_path
                ));
            }
        }

        // Try to find on PATH or in lsp-bin
        if let Some(path) = super::find_binary(binary_name) {
            return Ok(path);
        }

        // Try auto-install if enabled
        if super::config::is_auto_install_enabled().await {
            let install_method = server_def.install_method();
            match super::ensure_binary(&install_method, binary_name).await {
                Ok(path) => return Ok(path),
                Err(e) => {
                    log::warn!(
                        "[LSP Manager] Auto-install failed for {}: {}",
                        binary_name,
                        e
                    );
                }
            }
        }

        Err(format!(
            "Binary '{}' not found. Install with: {}",
            binary_name,
            server_def.install_hint()
        ))
    }
}
pub fn server_key_for_language(language: &str, root: &str) -> Option<ServerKey> {
    servers_for_language_id(language)
        .first()
        .map(|s| ServerKey::new(root, s.id()))
}
#[cfg(test)]
#[path = "tests/manager_tests.rs"]
mod tests;
