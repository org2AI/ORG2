//! Explicit official-App destination. CLI/Direct callers keep native targets.
//! This descriptor contains no credentials or caller-selected filesystem paths.
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeAppProfile {
    version: u8,
    agent: String,
    scope: String,
}
impl NativeAppProfile {
    pub fn new(agent: &str, cloud: &str, user: &str) -> Result<Self, String> {
        if !matches!(agent, "codex" | "claude_desktop") || user.is_empty() || user.len() > 256 {
            return Err("Unsupported native App profile".into());
        }
        let url = url::Url::parse(cloud).map_err(|_| "Invalid native App Cloud scope")?;
        if url.scheme() != "https"
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err("Invalid native App Cloud scope".into());
        }
        let identity = serde_json::to_vec(&(url.as_str().trim_end_matches('/'), user))
            .map_err(|_| "Invalid native App owner")?;
        Ok(Self {
            version: 1,
            agent: agent.into(),
            scope: super::file_io::sha256_bytes(&identity)
                .trim_start_matches("sha256:")
                .into(),
        })
    }
    pub fn agent(&self) -> &str {
        &self.agent
    }
    pub(super) fn validate_target(&self, agent: &str, id: &str, path: &str) -> Result<(), String> {
        self.validate(agent)?;
        if Path::new(path) != self.target(id)? {
            return Err("Native App target does not match its isolated profile".into());
        }
        Ok(())
    }
    pub fn validate(&self, agent: &str) -> Result<(), String> {
        if self.version != 1
            || self.agent != agent
            || !matches!(agent, "codex" | "claude_desktop")
            || self.scope.len() != 64
            || !self.scope.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err("Invalid native App launch profile".into());
        }
        reject_symlinks(&self.root())
    }
    pub fn root(&self) -> PathBuf {
        app_paths::orgii_root()
            .join("native-app-profiles")
            .join(&self.agent)
            .join(&self.scope)
    }
    pub fn home(&self) -> PathBuf {
        self.root().join(if self.agent == "codex" {
            "home"
        } else {
            "Claude-3p"
        })
    }
    pub fn user_data(&self) -> PathBuf {
        if self.agent == "codex" {
            self.root().join("electron")
        } else {
            self.home()
        }
    }
    /// Foundation/native helpers must not resolve the primary user's Library.
    pub fn system_home(&self) -> PathBuf {
        self.root().join("system-home")
    }
    pub fn prepare_launch_directories(&self) -> Result<(), String> {
        self.validate(&self.agent)?;
        for path in [self.system_home(), self.user_data(), self.home()] {
            reject_symlinks(&path)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                std::fs::DirBuilder::new()
                    .recursive(true)
                    .mode(0o700)
                    .create(&path)
                    .map_err(|_| "Cannot prepare native App storage")?;
            }
            #[cfg(not(unix))]
            std::fs::create_dir_all(&path).map_err(|_| "Cannot prepare native App storage")?;
            reject_symlinks(&path)?;
        }
        Ok(())
    }
    pub fn helper(&self) -> PathBuf {
        self.root().join(if cfg!(windows) {
            "credential-helper.cmd"
        } else {
            "credential-helper.sh"
        })
    }
    pub(super) fn target(&self, id: &str) -> Result<PathBuf, String> {
        self.validate(&self.agent)?;
        let path = match (self.agent.as_str(), id) {
            ("codex", "config") => self.home().join("config.toml"),
            ("codex", super::model_catalog::TARGET_ID) => {
                self.home().join("org2-model-catalog.json")
            }
            ("claude_desktop", "desktop") => self.home().join("claude_desktop_config.json"),
            ("claude_desktop", "profile") => self
                .home()
                .join("configLibrary")
                .join(format!("{}.json", super::desktop::PROFILE_ID)),
            ("claude_desktop", "catalog") => self.home().join("configLibrary/_meta.json"),
            ("claude_desktop", "helper") => self.helper(),
            _ => return Err("Invalid native App target".into()),
        };
        reject_symlinks(&path)?;
        Ok(path)
    }
    pub fn validate_launch(&self, status: &super::CliConfigManagedStatus) -> Result<(), String> {
        self.validate(&status.agent_name)?;
        if status.native_app.as_ref() != Some(self)
            || status.mode != super::CliConfigMode::OrgiiManaged
            || status.conflict
        {
            return Err("Native App profile changed; reconnect before opening".into());
        }
        for file in &status.target_files {
            let optional_catalog =
                file.id == super::model_catalog::TARGET_ID && file.last_applied_hash.is_none();
            if Path::new(&file.target_path) != self.target(&file.id)?
                || (!file.target_exists && !optional_catalog)
            {
                return Err("Native App target changed; reconnect before opening".into());
            }
        }
        if status.target_files.is_empty() {
            return Err("Native App configuration missing".into());
        }
        reject_symlinks(&self.user_data())?;
        reject_symlinks(&self.system_home())
    }
}
fn reject_symlinks(path: &Path) -> Result<(), String> {
    let base = app_paths::orgii_root();
    if !path.starts_with(&base) {
        return Err("Native App path is outside this instance".into());
    }
    for parent in path
        .ancestors()
        .take_while(|parent| parent.starts_with(&base))
    {
        match std::fs::symlink_metadata(parent) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err("Native App profile must not traverse symbolic links".into())
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("Cannot inspect native App profile path".into()),
        }
    }
    Ok(())
}

pub(super) fn is_desktop_runtime_path(path: &Path) -> bool {
    let Some(scope) = path
        .parent()
        .and_then(Path::parent)
        .and_then(Path::file_name)
        .and_then(|v| v.to_str())
    else {
        return false;
    };
    let profile = NativeAppProfile {
        version: 1,
        agent: "claude_desktop".into(),
        scope: scope.into(),
    };
    profile.target("desktop").is_ok_and(|target| target == path)
}

/// Keep config/target ownership stable through LaunchServices dispatch.
pub fn with_launch<T>(
    agent: &str,
    profile: &NativeAppProfile,
    key: &str,
    model: &str,
    launch: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let _guard = super::config_operation_guard()?;
    let _locks = super::target_lock::lock_app_targets(agent, Some(profile))?;
    super::transaction::recover_pending_transaction_unlocked(agent)?;
    let status = super::operations::status_for_unlocked(agent)?;
    profile.validate_launch(&status)?;
    if status.selected_key_id.as_deref() != Some(key)
        || status.selected_model.as_deref() != Some(model)
    {
        return Err("Selected client configuration changed".into());
    }
    launch()
}

/// Read-only ownership inspection does not recover transactions, create a
/// profile, or alter account configuration. History callers can optionally
/// hold the existing configuration locks while committing their own files.
pub fn with_existing_profile<T>(
    profile: &NativeAppProfile,
    lock_targets: bool,
    action: impl FnOnce(&dyn Fn() -> Result<(), String>) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = super::CONFIG_OPERATION_LOCK
        .get_or_init(|| std::sync::Mutex::new(()))
        .try_lock()
        .map_err(|_| "Native App configuration is busy")?;
    let _locks = if lock_targets {
        super::target_lock::lock_app_targets(profile.agent(), Some(profile))?
    } else {
        Vec::new()
    };
    let check = || {
        let status = super::operations::status_read_only(profile.agent())?;
        profile.validate_launch(&status)
    };
    check()?;
    action(&check)
}

#[cfg(test)]
mod tests;
