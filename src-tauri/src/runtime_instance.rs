//! Runtime identity derived from Tauri's configured application identifier.
//!
//! Build scripts still create the per-instance Tauri config, but the binary
//! must remain isolated when it is launched directly (Explorer, a shortcut,
//! or a test runner). Runtime services and the local data root therefore
//! derive their defaults from the identifier embedded in that config instead
//! of depending on launcher environment variables.

use std::path::{Path, PathBuf};

const PRIMARY_IDE_SERVER_PORT: u16 = 13_847;
const PRIMARY_CLI_PROXY_PORT: u16 = 17_888;

// Independent fork: keep all TCP defaults outside upstream's 13847..13946
// and 17888..17987 instance ranges (including the reserved dev slot).
const FORK_IDENTIFIER: &str = "com.theerasakping.tpagentstudio";
const FORK_DEV_IDENTIFIER: &str = "com.theerasakping.tpagentstudio.dev";
const FORK_IDE_SERVER_PORT: u16 = 23_847;
const FORK_CLI_PROXY_PORT: u16 = 27_888;
const FORK_INSTANCE_ID_BIAS: u16 = 1000;
const FORK_INSTANCE_IDENTIFIER_PREFIXES: &[&str] = &[
    "com.theerasakping.tpagentstudio.instance",
    "com.theerasakping.tpagentstudio.e2e.instance",
];
// Dedicated dev slot, outside the numbered bundle range (2..=99).
const DEV_INSTANCE_ID: u16 = 100;
const INSTANCE_IDENTIFIER_PREFIXES: &[&str] = &["org2ai.org2.instance", "org2ai.org2.e2e.instance"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RuntimeInstanceProfile {
    pub(crate) instance_id: u16,
    pub(crate) ide_server_port: u16,
    pub(crate) cli_proxy_port: u16,
}

impl RuntimeInstanceProfile {
    pub(crate) fn is_fork(self) -> bool {
        self.instance_id > FORK_INSTANCE_ID_BIAS
    }

    fn for_fork_instance(instance_id: u16) -> Self {
        Self {
            instance_id: FORK_INSTANCE_ID_BIAS + instance_id,
            ide_server_port: FORK_IDE_SERVER_PORT + instance_id - 1,
            cli_proxy_port: FORK_CLI_PROXY_PORT + instance_id - 1,
        }
    }

    pub(crate) fn validate_explicit_home(self, user_home: &Path, configured: &Path) -> Result<(), &'static str> {
        if !self.is_fork() {
            return Ok(());
        }
        if !configured.is_absolute() || configured.as_os_str().is_empty() {
            return Err("Fork data root must be an absolute path");
        }
        let upstream = user_home.join(".orgii");
        // Normalize '..' even when a directory has not been created yet and
        // resolve the nearest existing ancestor. A plain canonicalize()
        // fallback on the raw path let non-existent paths hide traversal or
        // parent symlinks into the upstream profile.
        let configured_real = resolve_profile_candidate(configured)?;
        let upstream_real = resolve_profile_candidate(&upstream)?;
        if profile_path_contains(&upstream_real, &configured_real) {
            return Err("Fork data root must not point to the upstream ORG2 profile");
        }
        Ok(())
    }

    pub(crate) fn from_identifier(identifier: &str) -> Self {
        if identifier == FORK_IDENTIFIER {
            return Self::for_fork_instance(1);
        }
        if identifier == FORK_DEV_IDENTIFIER {
            return Self::for_fork_instance(DEV_INSTANCE_ID);
        }
        if let Some(instance_id) = parse_fork_instance_id(identifier) {
            return Self::for_fork_instance(instance_id);
        }
        let instance_id = if identifier == "org2ai.org2.dev" {
            DEV_INSTANCE_ID
        } else {
            parse_instance_id(identifier).unwrap_or(1)
        };
        Self {
            instance_id,
            ide_server_port: PRIMARY_IDE_SERVER_PORT + instance_id - 1,
            cli_proxy_port: PRIMARY_CLI_PROXY_PORT + instance_id - 1,
        }
    }

    /// Numbered test identities own a sibling data root on direct launch.
    /// Primary and dev intentionally share `~/.orgii`, including sessions.db
    /// and its attachments/replays, by returning `None`.
    pub(crate) fn default_orgii_home(self, user_home: &Path) -> Option<PathBuf> {
        if self.is_fork() {
            let slot = self.instance_id - FORK_INSTANCE_ID_BIAS;
            let folder = match slot {
                1 => ".tp-agent-studio".to_string(),
                DEV_INSTANCE_ID => ".tp-agent-studio-dev".to_string(),
                id => format!(".tp-agent-studio-instance{id}"),
            };
            return Some(user_home.join(folder));
        }
        if self.instance_id == DEV_INSTANCE_ID {
            return None;
        }
        (self.instance_id > 1)
            .then(|| user_home.join(format!(".orgii-instance{}", self.instance_id)))
    }

    /// Numbered test identities must not scan the real user's histories.
    /// Dev shares the primary session store and its provider history sources.
    pub(crate) fn default_external_history_home(
        self,
        resolved_orgii_home: &Path,
    ) -> Option<PathBuf> {
        (self.is_fork() || (self.instance_id > 1 && self.instance_id != DEV_INSTANCE_ID))
            .then(|| resolved_orgii_home.join("external-history-home"))
    }
}

/// Normalize a full, absolute profile path before consulting the filesystem.
/// No filesystem modifications are made: existing symlinks are resolved, while
/// missing trailing components retain their identity under an existing parent.
/// This guards accidental overlaps; it is not a symlink-race sandbox.
fn resolve_profile_candidate(path: &Path) -> Result<PathBuf, &'static str> {
    use std::path::Component;
    if !path.is_absolute() {
        return Err("Profile path must be absolute");
    }
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::Normal(part) => normalized.push(part),
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err("Profile path escapes the filesystem root");
                }
            }
        }
    }

    let mut parent = normalized;
    let mut missing = Vec::new();
    loop {
        match std::fs::symlink_metadata(&parent) {
            Ok(_) => {
                let mut real = parent
                    .canonicalize()
                    .map_err(|_| "Cannot resolve a symlink in the profile path")?;
                for suffix in missing.iter().rev() {
                    real.push(suffix);
                }
                return Ok(real);
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                let Some(name) = parent.file_name() else {
                    return Err("Cannot resolve the profile path root");
                };
                missing.push(name.to_os_string());
                if !parent.pop() {
                    return Err("Cannot resolve the profile path parent");
                }
            }
            Err(_) => return Err("Cannot inspect the profile path"),
        }
    }
}

/// Windows paths are case-insensitive even when a not-yet-created child
/// does not exist for std::fs::canonicalize to normalize its final segment.
fn profile_path_contains(parent: &Path, candidate: &Path) -> bool {
    #[cfg(windows)]
    {
        let p = parent.to_string_lossy().to_ascii_lowercase();
        let c = candidate.to_string_lossy().to_ascii_lowercase();
        let sep = std::path::MAIN_SEPARATOR;
        c == p || c.starts_with(&format!("{p}{sep}"))
    }
    #[cfg(not(windows))]
    {
        candidate.starts_with(parent)
    }
}

fn parse_fork_instance_id(identifier: &str) -> Option<u16> {
    FORK_INSTANCE_IDENTIFIER_PREFIXES
        .iter()
        .find_map(|prefix| identifier.strip_prefix(prefix))?
        .parse::<u16>()
        .ok()
        .filter(|id| (2..=99).contains(id))
}

fn parse_instance_id(identifier: &str) -> Option<u16> {
    INSTANCE_IDENTIFIER_PREFIXES
        .iter()
        .find_map(|prefix| identifier.strip_prefix(prefix))?
        .parse::<u16>()
        .ok()
        .filter(|id| (2..=99).contains(id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_missing_suffix_and_parent_traversal_into_upstream_data() {
        let tmp = tempfile::tempdir().unwrap();
        let user_home = tmp.path();
        let upstream = user_home.join(".orgii");
        std::fs::create_dir_all(&upstream).unwrap();

        let fork = RuntimeInstanceProfile::from_identifier(FORK_IDENTIFIER);
        assert!(fork.validate_explicit_home(user_home, &upstream).is_err());
        assert!(fork
            .validate_explicit_home(user_home, &user_home.join("scratch/../.orgii/secrets"))
            .is_err());
        assert!(fork
            .validate_explicit_home(user_home, &upstream.join("not-yet-created/sessions.db"))
            .is_err());
        assert!(fork
            .validate_explicit_home(user_home, &user_home.join(".orgii-suffix"))
            .is_ok());
        assert!(fork
            .validate_explicit_home(user_home, &user_home.join(".tp-agent-studio"))
            .is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_parent_into_upstream_profile() {
        use std::os::unix::fs::symlink;
        let tmp = tempfile::tempdir().unwrap();
        let upstream = tmp.path().join(".orgii");
        std::fs::create_dir_all(&upstream).unwrap();
        let link = tmp.path().join("alias");
        symlink(&upstream, &link).unwrap();
        let fork = RuntimeInstanceProfile::from_identifier(FORK_IDENTIFIER);
        assert!(fork.validate_explicit_home(tmp.path(), &link).is_err());
        assert!(fork
            .validate_explicit_home(tmp.path(), &link.join("new-profile"))
            .is_err());
    }

    #[test]
    fn independent_fork_uses_distinct_ports_and_profiles() {
        let upstream = RuntimeInstanceProfile::from_identifier("org2ai.org2");
        let fork = RuntimeInstanceProfile::from_identifier(FORK_IDENTIFIER);
        let fork_dev = RuntimeInstanceProfile::from_identifier(FORK_DEV_IDENTIFIER);
        assert!(fork.is_fork());
        assert!(fork_dev.is_fork());
        assert_ne!(fork.ide_server_port, upstream.ide_server_port);
        assert_ne!(fork.cli_proxy_port, upstream.cli_proxy_port);
        assert_eq!(fork.ide_server_port, 23_847);
        assert_eq!(fork.cli_proxy_port, 27_888);
        assert_eq!(fork.default_orgii_home(Path::new("/home/test")), Some(PathBuf::from("/home/test/.tp-agent-studio")));
        assert_eq!(fork_dev.default_orgii_home(Path::new("/home/test")), Some(PathBuf::from("/home/test/.tp-agent-studio-dev")));
        assert_ne!(fork.ide_server_port, fork_dev.ide_server_port);
        assert_eq!(fork.default_external_history_home(Path::new("/home/test/.tp-agent-studio")), Some(PathBuf::from("/home/test/.tp-agent-studio/external-history-home")));
        let temp_home = tempfile::tempdir().unwrap();
        assert!(fork.validate_explicit_home(temp_home.path(), &temp_home.path().join(".orgii")).is_err());
        assert!(fork.validate_explicit_home(temp_home.path(), Path::new("relative")).is_err());
        assert!(fork.validate_explicit_home(temp_home.path(), &temp_home.path().join(".tp-agent-studio-e2e")).is_ok());
    }

    #[test]
    fn fork_numbered_instances_preserve_separate_profiles() {
        let primary = RuntimeInstanceProfile::from_identifier(FORK_IDENTIFIER);
        for id in 2..=99 {
            let identifier = format!("com.theerasakping.tpagentstudio.instance{id}");
            let other = RuntimeInstanceProfile::from_identifier(&identifier);
            assert!(other.is_fork());
            assert_ne!(other.ide_server_port, primary.ide_server_port);
            assert_ne!(other.cli_proxy_port, primary.cli_proxy_port);
            assert!(other.default_orgii_home(Path::new("/home/test")).unwrap().to_string_lossy().contains("tp-agent-studio-instance"));
        }
        let webdriver = RuntimeInstanceProfile::from_identifier("com.theerasakping.tpagentstudio.e2e.instance2");
        assert_eq!(webdriver.ide_server_port, 23_848);
        assert_eq!(webdriver.cli_proxy_port, 27_889);
    }

    #[test]
    fn dev_identifier_shares_primary_data_with_separate_service_defaults() {
        let dev = RuntimeInstanceProfile::from_identifier("org2ai.org2.dev");
        let primary = RuntimeInstanceProfile::from_identifier("org2ai.org2");
        assert_eq!(dev.ide_server_port, 13_946);
        assert_eq!(dev.cli_proxy_port, 17_987);
        let user_home = Path::new("/home/test");
        assert_eq!(dev.default_orgii_home(user_home), None);
        assert_eq!(
            dev.default_orgii_home(user_home),
            primary.default_orgii_home(user_home)
        );
        assert_eq!(
            dev.default_external_history_home(&user_home.join(".orgii")),
            None
        );
        for id in 1..=99 {
            let other =
                RuntimeInstanceProfile::from_identifier(&format!("org2ai.org2.instance{id}"));
            assert_ne!(dev.ide_server_port, other.ide_server_port);
            assert_ne!(dev.cli_proxy_port, other.cli_proxy_port);
            if id > 1 {
                assert!(other.default_orgii_home(user_home).is_some());
            }
        }
    }

    #[test]
    fn primary_identifier_uses_primary_ports() {
        assert_eq!(
            RuntimeInstanceProfile::from_identifier("org2ai.org2"),
            RuntimeInstanceProfile {
                instance_id: 1,
                ide_server_port: 13_847,
                cli_proxy_port: 17_888,
            }
        );
    }

    #[test]
    fn isolated_identifier_offsets_both_runtime_ports() {
        let profile = RuntimeInstanceProfile::from_identifier("org2ai.org2.instance2");
        assert_eq!(
            profile,
            RuntimeInstanceProfile {
                instance_id: 2,
                ide_server_port: 13_848,
                cli_proxy_port: 17_889,
            }
        );
        assert_eq!(
            profile.default_orgii_home(Path::new("C:/Users/Test")),
            Some(PathBuf::from("C:/Users/Test/.orgii-instance2"))
        );
        assert_eq!(
            profile.default_external_history_home(Path::new("C:/Users/Test/.orgii-instance2")),
            Some(PathBuf::from(
                "C:/Users/Test/.orgii-instance2/external-history-home"
            ))
        );
    }

    #[test]
    fn webdriver_secondary_identifier_keeps_the_same_isolation_profile() {
        let profile = RuntimeInstanceProfile::from_identifier("org2ai.org2.e2e.instance2");
        assert_eq!(profile.instance_id, 2);
        assert_eq!(profile.ide_server_port, 13_848);
        assert_eq!(profile.cli_proxy_port, 17_889);
        assert_eq!(
            profile.default_external_history_home(Path::new("/tmp/e2e-home")),
            Some(PathBuf::from("/tmp/e2e-home/external-history-home"))
        );
    }

    #[test]
    fn primary_identifier_keeps_the_production_data_root() {
        let profile = RuntimeInstanceProfile::from_identifier("org2ai.org2");
        assert_eq!(profile.default_orgii_home(Path::new("/home/test")), None);
    }

    #[test]
    fn malformed_or_unbounded_identifiers_fall_back_to_primary() {
        for identifier in [
            "org2ai.org2.instance1",
            "org2ai.org2.instance0",
            "org2ai.org2.instance100",
            "org2ai.org2.instance2.extra",
            "other.orgii.instance2",
        ] {
            assert_eq!(
                RuntimeInstanceProfile::from_identifier(identifier).instance_id,
                1,
                "{identifier}"
            );
        }
    }
}
