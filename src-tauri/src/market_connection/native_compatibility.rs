//! Resolve one native installation and fence updates during an operation.
//! Versions are diagnostic and local generations fence updates; neither grants nor denies
//! a capability. Config, protocol, process and history checks live at the action
//! that actually consumes them.
mod catalog;
pub(super) use catalog::codex_bundled_catalog;
use std::{
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    time::SystemTime,
};

const MAX_BUNDLE_ENTRIES: usize = 512;
#[derive(Clone, Debug, PartialEq, Eq)]
struct Stamp {
    path: PathBuf,
    length: u64,
    modified: SystemTime,
    #[cfg(unix)]
    identity: (u64, u64, i64, i64),
}

impl Stamp {
    fn read(path: &Path) -> Result<Self, String> {
        let value = std::fs::symlink_metadata(path)
            .map_err(|_| "Cannot inspect the selected native App artifact")?;
        if !value.is_file() {
            return Err("Native App artifact is not a regular file".into());
        }
        Self::from_metadata(path, &value)
    }

    fn read_directory(path: &Path) -> Result<Self, String> {
        let value = std::fs::symlink_metadata(path)
            .map_err(|_| "Cannot inspect the selected native App directory")?;
        // Inspect the named directory itself. Following an internal symlink
        // would omit the replacement boundary from the generation fence.
        if !value.is_dir() {
            return Err("Native App directory is not a real directory".into());
        }
        Self::from_metadata(path, &value)
    }

    fn from_metadata(path: &Path, value: &std::fs::Metadata) -> Result<Self, String> {
        Ok(Self {
            path: path.into(),
            length: value.len(),
            modified: value
                .modified()
                .map_err(|_| "Cannot identify native App generation")?,
            #[cfg(unix)]
            identity: {
                use std::os::unix::fs::MetadataExt;
                (value.dev(), value.ino(), value.ctime(), value.ctime_nsec())
            },
        })
    }
}

#[derive(Clone, Debug)]
pub(crate) struct ResolvedNativeClient {
    #[cfg(target_os = "macos")]
    pub agent: String,
    pub bundle: PathBuf,
    #[cfg(any(target_os = "macos", test))]
    pub version: String,
    #[cfg(target_os = "macos")]
    pub executable: PathBuf,
    runtime: Option<PathBuf>,
    #[cfg(any(target_os = "macos", test))]
    pub generation: String,
    stamps: Vec<Stamp>,
    directories: Vec<Stamp>,
}

impl ResolvedNativeClient {
    pub fn runtime(&self) -> Result<&Path, String> {
        self.runtime
            .as_deref()
            .ok_or_else(|| "Native App bundled runtime is unavailable".into())
    }

    /// Exact file and directory identity fence on every write boundary.
    pub fn ensure_current(&self) -> Result<(), String> {
        for before in &self.directories {
            if Stamp::read_directory(&before.path).as_ref() != Ok(before) {
                return Err("native_app_changed".into());
            }
        }
        for before in &self.stamps {
            if Stamp::read(&before.path).as_ref() != Ok(before) {
                return Err("native_app_changed".into());
            }
        }
        Ok(())
    }

    /// A matching executable path cannot bind an older running image to an
    /// installation replaced in place. Conservatively reject processes that
    /// started before any observed artifact or containing-directory change.
    /// Staging an update before launch does not make its later rename safe.
    #[cfg(any(target_os = "macos", all(test, unix)))]
    pub(crate) fn artifacts_predate(&self, started: (u64, u64)) -> Result<(), String> {
        self.ensure_current()?;
        if self.stamps.is_empty()
            || self.directories.is_empty()
            || self
                .stamps
                .iter()
                .chain(&self.directories)
                .any(|stamp| !stamp.predates(started))
        {
            return Err("native_app_process_stale".into());
        }
        Ok(())
    }
}

#[cfg(any(target_os = "macos", all(test, unix)))]
impl Stamp {
    fn predates(&self, started: (u64, u64)) -> bool {
        use std::time::{Duration, UNIX_EPOCH};
        let (seconds, micros) = started;
        if micros >= 1_000_000 {
            return false;
        }
        let Some(started) = UNIX_EPOCH.checked_add(Duration::new(seconds, micros as u32 * 1000))
        else {
            return false;
        };
        let (_, _, change_seconds, change_nanos) = self.identity;
        let Ok(change_seconds) = u64::try_from(change_seconds) else {
            return false;
        };
        let Ok(change_nanos @ 0..1_000_000_000) = u32::try_from(change_nanos) else {
            return false;
        };
        let Some(changed) = UNIX_EPOCH.checked_add(Duration::new(change_seconds, change_nanos))
        else {
            return false;
        };
        self.modified < started && changed < started
    }
}

pub(super) fn bundle_id(agent: &str) -> Result<&'static str, String> {
    match agent {
        "codex" => Ok("com.openai.codex"),
        "claude_desktop" => Ok("com.anthropic.claudefordesktop"),
        _ => Err("Unsupported official App".into()),
    }
}

fn metadata(bundle: &Path, agent: &str) -> Result<(String, String), String> {
    let path = bundle.join("Contents/Info.plist");
    let stamp = Stamp::read(&path)?;
    if stamp.length > 128 * 1024 {
        return Err("Native App metadata exceeds limit".into());
    }
    let mut bytes = Vec::new();
    std::fs::File::open(&path)
        .map_err(|_| "Cannot read native App metadata")?
        .take(128 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read native App metadata")?;
    if bytes.len() > 128 * 1024 {
        return Err("Native App metadata exceeds limit".into());
    }
    let value = plist::Value::from_reader(std::io::Cursor::new(bytes))
        .map_err(|_| "Cannot read the selected official App metadata")?;
    let info = value
        .as_dictionary()
        .ok_or("Invalid official App metadata")?;
    if info
        .get("CFBundleIdentifier")
        .and_then(plist::Value::as_string)
        != Some(bundle_id(agent)?)
    {
        return Err("Official App bundle identity changed".into());
    }
    let version = info
        .get("CFBundleShortVersionString")
        .and_then(plist::Value::as_string)
        .filter(|v| !v.is_empty())
        .unwrap_or("unknown");
    let executable = info
        .get("CFBundleExecutable")
        .and_then(plist::Value::as_string)
        .filter(|v| !v.is_empty() && !v.contains('/') && !matches!(*v, "." | ".."))
        .ok_or("Invalid official App executable")?;
    Ok((version.into(), executable.into()))
}

fn contained(bundle: &Path, relative: &str) -> Result<PathBuf, String> {
    Stamp::read(&bundle.join(relative))?;
    let path = bundle
        .join(relative)
        .canonicalize()
        .map_err(|_| "Cannot resolve native App artifact")?;
    if !path.starts_with(bundle) {
        return Err("Native App artifact is outside its bundle".into());
    }
    Ok(path)
}

fn inspect(bundle: &Path, agent: &str) -> Result<ResolvedNativeClient, String> {
    let bundle = bundle
        .canonicalize()
        .map_err(|_| "Cannot resolve installed official App")?;
    // File timestamps alone miss a pre-staged bundle/Contents replacement.
    // Keep a fixed, bounded chain down to every artifact parent; reject
    // internal directory symlinks, but permit discovery aliases resolved above.
    // Generations are process-local cache identities, never persisted proofs.
    let directories = std::iter::once(bundle.clone())
        .chain(
            [
                "Contents",
                "Contents/MacOS",
                "Contents/Resources",
                "Contents/_CodeSignature",
            ]
            .iter()
            .map(|relative| bundle.join(relative)),
        )
        .map(|path| Stamp::read_directory(&path))
        .collect::<Result<Vec<_>, _>>()?;
    let metadata_before = Stamp::read(&bundle.join("Contents/Info.plist"))?;
    let (version, name) = metadata(&bundle, agent)?;
    let executable = contained(&bundle, &format!("Contents/MacOS/{name}"))?;
    let runtime = if agent == "codex" {
        Some(contained(&bundle, "Contents/Resources/codex")?)
    } else {
        None
    };
    let mut paths = vec![
        bundle.join("Contents/Info.plist"),
        executable.clone(),
        contained(&bundle, "Contents/Resources/app.asar")?,
        contained(&bundle, "Contents/_CodeSignature/CodeResources")?,
    ];
    if let Some(path) = &runtime {
        paths.push(path.clone());
    }
    let stamps = paths
        .iter()
        .map(|p| Stamp::read(p))
        .collect::<Result<Vec<_>, _>>()?;
    if stamps.first() != Some(&metadata_before) {
        return Err("native_app_changed".into());
    }
    // Only resolve() publishes inspected clients, and it reuses the cached
    // generation while every stamp is unchanged. No consumer needs a portable
    // digest: bindings and model caches live in this same process. A new local
    // generation avoids reading hundreds of MB from executable/App archives.
    static GENERATION: AtomicU64 = AtomicU64::new(1);
    let generation = GENERATION
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |v| v.checked_add(1))
        .map_err(|_| "Native App generation exhausted")?
        .to_string();
    #[cfg(not(any(target_os = "macos", test)))]
    let _ = (&version, &generation);
    let resolved = ResolvedNativeClient {
        #[cfg(target_os = "macos")]
        agent: agent.into(),
        bundle,
        #[cfg(any(target_os = "macos", test))]
        version: version.clone(),
        #[cfg(target_os = "macos")]
        executable,
        runtime,
        #[cfg(any(target_os = "macos", test))]
        generation,
        stamps,
        directories,
    };
    resolved.ensure_current()?;
    Ok(resolved)
}

fn discover(agent: &str, roots: &[PathBuf]) -> Result<PathBuf, String> {
    let expected = bundle_id(agent)?;
    for root in roots {
        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };
        let mut entries = entries.take(MAX_BUNDLE_ENTRIES + 1).collect::<Vec<_>>();
        if entries.len() > MAX_BUNDLE_ENTRIES {
            return Err("Too many installed App candidates".into());
        }
        entries.sort_by_key(|v| v.as_ref().ok().map(|v| v.path()));
        for entry in entries.into_iter().flatten() {
            let path = entry.path();
            if path.extension().is_none_or(|v| v != "app") {
                continue;
            }
            if !std::fs::symlink_metadata(path.join("Contents/Info.plist"))
                .is_ok_and(|m| m.is_file() && m.len() <= 128 * 1024)
            {
                continue;
            }
            let matches = plist::Value::from_file(path.join("Contents/Info.plist"))
                .ok()
                .and_then(|v| {
                    v.as_dictionary()?
                        .get("CFBundleIdentifier")?
                        .as_string()
                        .map(str::to_owned)
                })
                .is_some_and(|id| id == expected);
            if matches {
                return path
                    .canonicalize()
                    .map_err(|_| "Cannot resolve installed official App".into());
            }
        }
    }
    Err("Install the official desktop App before opening this connection".into())
}

pub(super) fn resolve(agent: &str) -> Result<ResolvedNativeClient, String> {
    // Exactly two cache slots. No timer, provider history, or owner credentials.
    static CACHE: OnceLock<Mutex<[Option<ResolvedNativeClient>; 2]>> = OnceLock::new();
    let index = match agent {
        "codex" => 0,
        "claude_desktop" => 1,
        _ => return Err("Unsupported official App".into()),
    };
    let bundle = discover(
        agent,
        &[
            app_paths::home_dir().join("Applications"),
            PathBuf::from("/Applications"),
        ],
    )?;
    let mut cache = CACHE
        .get_or_init(|| Mutex::new([None, None]))
        .lock()
        .unwrap_or_else(|v| v.into_inner());
    if let Some(current) = &cache[index] {
        if current.bundle == bundle && current.ensure_current().is_ok() {
            return Ok(current.clone());
        }
    }
    let value = inspect(&bundle, agent)?;
    cache[index] = Some(value.clone());
    Ok(value)
}

pub(super) async fn for_operation(agent: &str) -> Result<Option<ResolvedNativeClient>, String> {
    if agent == "claude_code" {
        crate::harness_connections::verify_installed_version(agent).await?;
        return Ok(None);
    }
    let agent = agent.to_owned();
    tokio::task::spawn_blocking(move || {
        let client = resolve(&agent)?;
        client.ensure_current()?;
        Ok(Some(client))
    })
    .await
    .map_err(|_| "Native App compatibility lookup stopped")?
}

/// Keeps native binary identity under the same commit fence as Market ownership.
pub(super) struct NativeOperation<G> {
    owner: G,
    client: Option<ResolvedNativeClient>,
}
impl<G: crate::dynamic_credentials::OperationAuthorization>
    crate::dynamic_credentials::OperationAuthorization for NativeOperation<G>
{
    fn check(&self) -> Result<(), String> {
        self.owner.check()?;
        if let Some(client) = &self.client {
            client.ensure_current()?;
        }
        Ok(())
    }
}
pub(super) async fn authorize<G: crate::dynamic_credentials::OperationAuthorization>(
    operation: impl std::future::Future<Output = Result<G, String>>,
    client: Option<ResolvedNativeClient>,
) -> Result<NativeOperation<G>, String> {
    Ok(NativeOperation {
        owner: operation.await?,
        client,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(root: &Path, name: &str, version: &str) -> PathBuf {
        let path = root.join(name);
        std::fs::create_dir_all(path.join("Contents/MacOS")).unwrap();
        std::fs::create_dir_all(path.join("Contents/Resources")).unwrap();
        std::fs::create_dir_all(path.join("Contents/_CodeSignature")).unwrap();
        let mut info = plist::Dictionary::new();
        for (key, value) in [
            ("CFBundleIdentifier", "com.openai.codex"),
            ("CFBundleExecutable", "Codex"),
            ("CFBundleShortVersionString", version),
        ] {
            info.insert(key.into(), value.into());
        }
        plist::Value::Dictionary(info)
            .to_file_xml(path.join("Contents/Info.plist"))
            .unwrap();
        for file in [
            "Contents/MacOS/Codex",
            "Contents/Resources/codex",
            "Contents/Resources/app.asar",
            "Contents/_CodeSignature/CodeResources",
        ] {
            std::fs::write(path.join(file), b"synthetic artifact").unwrap();
        }
        path
    }
    #[test]
    fn discovery_accepts_unlisted_versions_without_claiming_operation_success() {
        let root = tempfile::tempdir().unwrap();
        let unknown = fixture(root.path(), "A.app", "99.0.0");
        fixture(root.path(), "Z.app", "26.915.31945");
        let selected = discover("codex", &[root.path().into()]).unwrap();
        assert_eq!(selected, unknown.canonicalize().unwrap());
        let client = inspect(&selected, "codex").unwrap();
        assert_eq!(client.version, "99.0.0");
        assert!(client.ensure_current().is_ok());
        // Discovery does not manufacture successful config, protocol, process,
        // or history results for this synthetic bundle.
        assert!(client
            .runtime()
            .unwrap()
            .ends_with("Contents/Resources/codex"));
    }
    #[test]
    fn version_metadata_is_diagnostic_and_new_content_is_reinspected() {
        for agent in ["codex", "claude_desktop"] {
            for version in [Some("99.0.0"), Some("unreleased-build"), Some(""), None] {
                let root = tempfile::tempdir().unwrap();
                let bundle = fixture(root.path(), "Client.app", "placeholder");
                let path = bundle.join("Contents/Info.plist");
                let mut info = plist::Value::from_file(&path).unwrap();
                let info = info.as_dictionary_mut().unwrap();
                info.insert(
                    "CFBundleIdentifier".into(),
                    bundle_id(agent).unwrap().into(),
                );
                if let Some(version) = version {
                    info.insert("CFBundleShortVersionString".into(), version.into());
                } else {
                    info.remove("CFBundleShortVersionString");
                }
                plist::Value::Dictionary(info.clone())
                    .to_file_xml(&path)
                    .unwrap();
                let before = inspect(&bundle, agent).unwrap();
                assert!(before.ensure_current().is_ok());
                assert_eq!(
                    before.version,
                    version.filter(|v| !v.is_empty()).unwrap_or("unknown")
                );
                std::fs::write(
                    bundle.join("Contents/Resources/app.asar"),
                    b"new application content",
                )
                .unwrap();
                assert_eq!(before.ensure_current().unwrap_err(), "native_app_changed");
                let after = inspect(&bundle, agent).unwrap();
                assert_ne!(before.generation, after.generation);
                assert!(after.ensure_current().is_ok());
            }
        }
    }
    #[test]
    fn replacement_invalidates_the_same_version_and_runtime() {
        let root = tempfile::tempdir().unwrap();
        let bundle = fixture(root.path(), "Codex.app", "26.915.31945");
        let client = inspect(&bundle, "codex").unwrap();
        assert!(client.ensure_current().is_ok());
        assert_eq!(
            client.runtime().unwrap(),
            bundle
                .join("Contents/Resources/codex")
                .canonicalize()
                .unwrap()
        );
        std::fs::write(
            client.runtime().unwrap(),
            b"different signed release content",
        )
        .unwrap();
        assert_eq!(client.ensure_current().unwrap_err(), "native_app_changed");
        assert_ne!(
            client.generation,
            inspect(&bundle, "codex").unwrap().generation
        );
    }
    #[cfg(unix)]
    #[test]
    fn same_length_rewrite_with_restored_mtime_invalidates_generation() {
        use std::{fs::FileTimes, time::Duration};
        let root = tempfile::tempdir().unwrap();
        let bundle = fixture(root.path(), "Codex.app", "99.0.0");
        let client = inspect(&bundle, "codex").unwrap();
        let path = client.runtime().unwrap();
        let before = std::fs::metadata(path).unwrap();
        std::thread::sleep(Duration::from_millis(5));
        std::fs::write(path, vec![b'x'; before.len() as usize]).unwrap();
        std::fs::File::options()
            .write(true)
            .open(path)
            .unwrap()
            .set_times(FileTimes::new().set_modified(before.modified().unwrap()))
            .unwrap();
        assert_eq!(client.ensure_current().unwrap_err(), "native_app_changed");
        let current = inspect(&bundle, "codex").unwrap();
        assert_ne!(client.generation, current.generation);
        assert!(current.ensure_current().is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn artifact_change_time_rejects_old_process_even_with_older_mtime() {
        use std::time::{Duration, UNIX_EPOCH};
        let mut stamp = Stamp {
            path: "synthetic".into(),
            length: 1,
            modified: UNIX_EPOCH + Duration::from_secs(5),
            identity: (1, 1, 20, 500_000),
        };
        assert!(!stamp.predates((10, 0)));
        assert!(!stamp.predates((20, 500)));
        assert!(stamp.predates((20, 501)));
        stamp.modified = UNIX_EPOCH + Duration::from_secs(30);
        assert!(!stamp.predates((25, 0)));
        assert!(!stamp.predates((40, 1_000_000)));
        stamp.identity.3 = 1_000_000_000;
        assert!(!stamp.predates((40, 0)));
    }
    #[cfg(unix)]
    #[test]
    fn process_binding_rechecks_artifact_generation() {
        use std::time::{Duration, UNIX_EPOCH};
        let root = tempfile::tempdir().unwrap();
        let bundle = fixture(root.path(), "Codex.app", "26.915.31945");
        let client = inspect(&bundle, "codex").unwrap();
        let after = (SystemTime::now() + Duration::from_secs(1))
            .duration_since(UNIX_EPOCH)
            .unwrap();
        assert!(client.artifacts_predate((after.as_secs(), 0)).is_ok());
        assert_eq!(
            client.artifacts_predate((0, 0)).unwrap_err(),
            "native_app_process_stale"
        );
        std::fs::write(client.runtime().unwrap(), b"updated runtime").unwrap();
        assert_eq!(
            client.artifacts_predate((after.as_secs(), 0)).unwrap_err(),
            "native_app_changed"
        );
    }
    #[cfg(unix)]
    #[test]
    fn staged_bundle_or_contents_rename_cannot_bind_an_older_process() {
        use std::time::{Duration, UNIX_EPOCH};
        for contents_only in [false, true] {
            let root = tempfile::tempdir().unwrap();
            let bundle = fixture(root.path(), "Codex.app", "26.915.31945");
            let staged = fixture(root.path(), "Staged.app", "26.915.31945");
            let original = inspect(&bundle, "codex").unwrap();
            // Both complete installations exist before the process starts.
            // Preserve all staged artifact bytes, inode metadata and mtimes.
            std::thread::sleep(Duration::from_millis(5));
            let started = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
            let started = (started.as_secs(), u64::from(started.subsec_micros()));
            assert!(original.artifacts_predate(started).is_ok());
            std::thread::sleep(Duration::from_millis(5));
            let (installed, replacement) = if contents_only {
                (bundle.join("Contents"), staged.join("Contents"))
            } else {
                (bundle.clone(), staged)
            };
            std::fs::rename(&installed, root.path().join("Retired")).unwrap();
            std::fs::rename(&replacement, &installed).unwrap();
            assert_eq!(original.ensure_current().unwrap_err(), "native_app_changed");

            // A fresh inspection must reject the already-running image too,
            // even though the on-disk files alone look older than the process.
            let current = inspect(&bundle, "codex").unwrap();
            assert!(current.stamps.iter().all(|stamp| stamp.predates(started)));
            assert_ne!(current.generation, original.generation);
            assert_eq!(
                current.artifacts_predate(started).unwrap_err(),
                "native_app_process_stale"
            );
        }
    }
    #[cfg(unix)]
    #[test]
    fn internal_directory_symlinks_cannot_hide_replacement_boundaries() {
        for relative in [
            "Contents",
            "Contents/MacOS",
            "Contents/Resources",
            "Contents/_CodeSignature",
        ] {
            let root = tempfile::tempdir().unwrap();
            let bundle = fixture(root.path(), "Codex.app", "26.915.31945");
            let original = inspect(&bundle, "codex").unwrap();
            let directory = bundle.join(relative);
            let relocated = bundle.join("Relocated");
            std::fs::rename(&directory, &relocated).unwrap();
            std::os::unix::fs::symlink(&relocated, &directory).unwrap();
            assert_eq!(original.ensure_current().unwrap_err(), "native_app_changed");
            assert_eq!(
                inspect(&bundle, "codex").unwrap_err(),
                "Native App directory is not a real directory"
            );
        }
    }
    #[cfg(unix)]
    #[test]
    fn resolved_bundle_alias_does_not_allow_replacing_the_canonical_directory() {
        let root = tempfile::tempdir().unwrap();
        let bundle = fixture(root.path(), "Codex.app", "26.915.31945");
        let alias = root.path().join("Alias.app");
        std::os::unix::fs::symlink(&bundle, &alias).unwrap();
        let original = inspect(&alias, "codex").unwrap();
        assert_eq!(original.bundle, bundle.canonicalize().unwrap());
        assert!(original.ensure_current().is_ok());

        let relocated = root.path().join("Relocated.app");
        std::fs::rename(&bundle, &relocated).unwrap();
        std::os::unix::fs::symlink(&relocated, &bundle).unwrap();
        assert_eq!(original.ensure_current().unwrap_err(), "native_app_changed");
    }
    #[test]
    fn changed_code_signature_seal_invalidates_unchanged_runtime_and_version() {
        let root = tempfile::tempdir().unwrap();
        let bundle = fixture(root.path(), "Codex.app", "26.915.31945");
        let client = inspect(&bundle, "codex").unwrap();
        let runtime_before = std::fs::read(client.runtime().unwrap()).unwrap();
        std::fs::write(
            bundle.join("Contents/_CodeSignature/CodeResources"),
            b"updated nested framework seal",
        )
        .unwrap();
        assert_eq!(client.ensure_current().unwrap_err(), "native_app_changed");
        let changed = inspect(&bundle, "codex").unwrap();
        assert_eq!(client.version, changed.version);
        assert_eq!(
            std::fs::read(changed.runtime().unwrap()).unwrap(),
            runtime_before
        );
        assert_ne!(client.generation, changed.generation);
        assert!(changed.ensure_current().is_ok());
    }
    #[test]
    fn configuration_commit_requires_both_owner_and_original_binary() {
        use crate::dynamic_credentials::OperationAuthorization;
        struct Owner(bool);
        impl OperationAuthorization for Owner {
            fn check(&self) -> Result<(), String> {
                if self.0 {
                    Ok(())
                } else {
                    Err("owner retired".into())
                }
            }
        }
        let root = tempfile::tempdir().unwrap();
        let bundle = fixture(root.path(), "Codex.app", "26.915.31945");
        let client = inspect(&bundle, "codex").unwrap();
        assert_eq!(
            NativeOperation {
                owner: Owner(false),
                client: Some(client.clone())
            }
            .check()
            .unwrap_err(),
            "owner retired"
        );
        let operation = NativeOperation {
            owner: Owner(true),
            client: Some(client.clone()),
        };
        assert!(operation.check().is_ok());
        std::fs::write(
            client.runtime().unwrap(),
            b"replacement during network authorization",
        )
        .unwrap();
        assert_eq!(operation.check().unwrap_err(), "native_app_changed");
    }
}
