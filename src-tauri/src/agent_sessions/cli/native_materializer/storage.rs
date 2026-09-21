//! Resolve all native history effects from the persisted execution owner.
use super::*;
use crate::agent_sessions::cli::types::KeySource;

pub(super) struct NativeStorageOwner {
    account: Option<String>,
    home: Option<PathBuf>,
}

impl NativeStorageOwner {
    pub(super) fn for_session(session: &persistence::CodeSession) -> Result<Self, String> {
        let home = if session.credential_source.is_some() {
            if session.account_id.is_some() || session.key_source != KeySource::OwnKey {
                return Err("Session has conflicting native storage owners".into());
            }
            Some(agent_cli::managed_config::launch::native_home(
                &session.session_id,
            )?)
        } else {
            None
        };
        Ok(Self {
            account: session
                .account_id
                .clone()
                .filter(|id| !id.trim().is_empty()),
            home,
        })
    }

    pub(super) fn has_codex_store(&self) -> bool {
        self.home.is_some() || self.account.is_some()
    }

    // Managed histories never follow symlinks into a different owner's home.
    // Missing suffixes are allowed for fresh materialization; inspection does
    // not create directories, refresh credentials, or touch global selection.
    fn managed_path(&self, relative: &Path) -> Result<PathBuf, String> {
        let home = self.home.as_ref().ok_or("Missing Session native home")?;
        let root = app_paths::managed_cli_launch_root();
        let path = home.join(relative);
        let suffix = path
            .strip_prefix(&root)
            .map_err(|_| "Invalid native store root")?;
        let mut current = root;
        for component in std::iter::once(None).chain(suffix.components().map(Some)) {
            if let Some(component) = component {
                if !matches!(component, std::path::Component::Normal(_)) {
                    return Err("Invalid native store path".into());
                }
                current.push(component.as_os_str());
            }
            match fs::symlink_metadata(&current) {
                Ok(metadata) if metadata.file_type().is_symlink() => {
                    return Err("Session native store must not contain symlinks".into());
                }
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(format!("Inspect Session native store: {error}")),
            }
        }
        Ok(path)
    }

    pub(super) fn claude_paths(
        &self,
        cwd: &Path,
        id: &str,
    ) -> Result<NativeTranscriptPaths, String> {
        if self.home.is_none() {
            return Ok(claude_native_paths(self.account.as_deref(), cwd, id));
        }
        Uuid::parse_str(id).map_err(|_| "Invalid native transcript UUID")?;
        let path = self.managed_path(
            &PathBuf::from("projects")
                .join(sanitize_claude_project_name(cwd))
                .join(format!("{id}.jsonl")),
        )?;
        Ok(NativeTranscriptPaths {
            runner_path: path.clone(),
            native_path: path,
        })
    }

    pub(super) fn existing_claude(
        &self,
        cwd: &Path,
        id: &str,
    ) -> Result<Option<NativeTranscriptPaths>, String> {
        let paths = self.claude_paths(cwd, id)?;
        Ok((paths.native_path.is_file() || paths.runner_path.is_file()).then_some(paths))
    }

    pub(super) fn catalog_profile(&self) -> codex_native_catalog::CatalogProfile {
        if self.home.is_some() {
            codex_native_catalog::CatalogProfile::ManagedSession
        } else {
            codex_native_catalog::CatalogProfile::NativeApp
        }
    }

    pub(super) fn codex_home(&self) -> Result<PathBuf, String> {
        if self.home.is_some() {
            self.managed_path(Path::new(""))
        } else if self.account.is_some() {
            Ok(codex_native_app_home())
        } else {
            Err("Native Codex store requires an execution owner".into())
        }
    }

    pub(super) fn existing_codex(&self, id: &str) -> Result<Option<NativeTranscriptPaths>, String> {
        if self.home.is_none() {
            return existing_codex_native_paths(
                self.account
                    .as_deref()
                    .ok_or("Missing Codex storage owner")?,
                id,
            );
        }
        Uuid::parse_str(id).map_err(|_| "Invalid native transcript UUID")?;
        let root = self.managed_path(Path::new("sessions"))?;
        // One Session's store only; never fall back to all native/account history.
        find_codex_materialization(&root, id)?
            .map(|path| self.registered_codex(&path))
            .transpose()
    }

    pub(super) fn registered_codex(&self, path: &Path) -> Result<NativeTranscriptPaths, String> {
        if self.home.is_none() {
            return registered_codex_native_paths(
                self.account
                    .as_deref()
                    .ok_or("Missing Codex storage owner")?,
                path,
            );
        }
        let root = self.managed_path(Path::new("sessions"))?;
        let relative = match path.strip_prefix(&root) {
            Ok(relative) => relative.to_path_buf(),
            Err(_) => {
                // The provider may canonicalize ancestors such as macOS /var.
                let canonical_root = fs::canonicalize(&root).map_err(|e| e.to_string())?;
                fs::canonicalize(path)
                    .map_err(|e| e.to_string())?
                    .strip_prefix(&canonical_root)
                    .map(Path::to_path_buf)
                    .map_err(|_| "Codex registered transcript outside Session store")?
            }
        };
        let path = self.managed_path(&PathBuf::from("sessions").join(relative))?;
        Ok(NativeTranscriptPaths {
            runner_path: path.clone(),
            native_path: path,
        })
    }

    pub(super) fn cache_codex(&self, id: &str, paths: &NativeTranscriptPaths) {
        if let Some(account) = &self.account {
            cache_codex_native_paths(account, id, paths);
        }
    }
}
