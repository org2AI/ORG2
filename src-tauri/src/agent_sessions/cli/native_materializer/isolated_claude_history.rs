//! Import Code history into one Market App profile. Only missing transcripts
//! and discovery rows cross the boundary; credentials/settings never do.
pub(super) mod namespace;
use super::*;
use agent_cli::managed_config::native_app::{NativeAppProfile, RECENT_CONVERSATIONS};
use std::io::Write;
use std::time::{Duration, Instant};

const MAX_TRANSCRIPT_BYTES: u64 = 128 * 1024 * 1024;
const MAX_PASS_BYTES: u64 = 1536 * 1024 * 1024;
const MAX_PASS_TIME: Duration = Duration::from_secs(15);

#[cfg(test)]
pub(crate) fn import(profile: &NativeAppProfile) -> Result<bool, String> {
    import_after_launch(profile, Instant::now() + MAX_PASS_TIME, &|| Ok(()))
}

/// Import only while the caller's guard proves owner/configuration validity and
/// native writer closure. The history coordinator owns this operation.
/// False means Desktop has not registered its local namespace. True does not
/// assert that a running GUI has loaded the imported rows.
pub(crate) fn import_after_launch(
    profile: &NativeAppProfile,
    deadline: Instant,
    check: &impl Fn() -> Result<(), String>,
) -> Result<bool, String> {
    check()?;
    profile.validate("claude_desktop")?;
    let Some(project) = confirmed_project(&profile.root(), &profile.home(), deadline)? else {
        return Ok(false);
    };
    import_into_checked(
        &claude_desktop_sessions_root(),
        &project,
        &app_paths::native_transcript_home_dir().join(".claude"),
        &profile.system_home().join(".claude"),
        MAX_PASS_BYTES,
        deadline.min(Instant::now() + MAX_PASS_TIME),
        check,
    )?;
    check()?;
    Ok(true)
}

fn confirmed_project(
    root: &Path,
    home: &Path,
    deadline: Instant,
) -> Result<Option<PathBuf>, String> {
    namespace::registered_project_until(root, home, deadline).map_err(|e| e.to_string())
}

fn safe_path(root: &Path, path: &Path) -> Result<(), String> {
    if !root.is_absolute()
        || !path.is_absolute()
        || root
            .components()
            .chain(path.components())
            .any(|part| matches!(part, std::path::Component::ParentDir))
        || !path.starts_with(root)
    {
        return Err("Claude history path escaped its profile".into());
    }
    for part in path.ancestors().take_while(|p| p.starts_with(root)) {
        match fs::symlink_metadata(part) {
            Ok(m) if m.file_type().is_symlink() => {
                return Err("Claude history import refuses symbolic links".into());
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("Inspect Claude history path: {e}")),
        }
    }
    Ok(())
}

#[cfg(test)]
fn import_between(
    official: &Path,
    catalog: &Path,
    source_home: &Path,
    target_home: &Path,
    remaining: u64,
    deadline: Instant,
) -> Result<usize, String> {
    let home = catalog.parent().ok_or("Invalid Claude history home")?;
    let Some(project) = namespace::registered_project(home, home).map_err(|e| e.to_string())?
    else {
        return Ok(0);
    };
    import_into(
        official,
        &project,
        source_home,
        target_home,
        remaining,
        deadline,
    )
}

#[cfg(test)]
fn import_into(
    official: &Path,
    project: &Path,
    source_home: &Path,
    target_home: &Path,
    remaining: u64,
    deadline: Instant,
) -> Result<usize, String> {
    import_into_checked(
        official,
        project,
        source_home,
        target_home,
        remaining,
        deadline,
        &|| Ok(()),
    )
}

fn import_into_checked(
    official: &Path,
    project: &Path,
    source_home: &Path,
    target_home: &Path,
    mut remaining: u64,
    deadline: Instant,
    check: &impl Fn() -> Result<(), String>,
) -> Result<usize, String> {
    // Reuse the standard catalog's active-account selection, grant stripping
    // and create-if-absent writer, but only for the newest conversations. Drop
    // the old model selection: the package's configured default must own the
    // first resumed request.
    let scan = CatalogScan::bounded(deadline);
    let guard = || scan.check(check);
    backfill_claude_desktop_catalog_into_checked(
        official,
        project,
        false,
        ClaudeDesktopBackfill::Recent(RECENT_CONVERSATIONS),
        &scan,
        check,
        |cwd, id| {
            guard()?;
            let relative = PathBuf::from("projects")
                .join(sanitize_claude_project_name(cwd))
                .join(format!("{id}.jsonl"));
            let source = source_home.join(&relative);
            let target = target_home.join(relative);
            if safe_path(source_home, &source).is_err() {
                return Ok(false);
            }
            safe_path(target_home, &target)?;
            // Existing content belongs to Desktop, even if an earlier import
            // crashed before publishing its discovery row. Never replace it.
            if let Ok(m) = fs::symlink_metadata(&target) {
                return Ok(m.is_file());
            }
            let mut options = fs::OpenOptions::new();
            options.read(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.custom_flags(libc::O_NOFOLLOW);
            }
            let mut source_file = match options.open(&source) {
                Ok(file) => file,
                Err(_) => return Ok(false),
            };
            let before = source_file.metadata().map_err(|e| e.to_string())?;
            if !before.is_file() || before.len() == 0 {
                return Ok(false);
            }
            if before.len() > MAX_TRANSCRIPT_BYTES.min(remaining) {
                return Err("claude_history_import_limit".into());
            }
            // Reserve the budget even if a concurrent provider write invalidates
            // this snapshot; retries may not turn the byte cap into unbounded I/O.
            remaining -= before.len();
            let mut unstable = false;
            let copied =
                create_file_atomically_checked(&target, "isolated Claude history", &guard, |out| {
                    guard()?;
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        out.set_permissions(fs::Permissions::from_mode(0o600))
                            .map_err(|e| e.to_string())?;
                    }
                    let mut buffer = [0_u8; 64 * 1024];
                    let mut left = before.len();
                    let mut last = 0;
                    while left > 0 {
                        guard()?;
                        let amount = (left as usize).min(buffer.len());
                        let n = source_file
                            .read(&mut buffer[..amount])
                            .map_err(|e| e.to_string())?;
                        if n == 0 {
                            unstable = true;
                            return Err("Claude history changed during import".into());
                        }
                        out.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
                        last = buffer[n - 1];
                        left -= n as u64;
                    }
                    let after = source_file.metadata().map_err(|e| e.to_string())?;
                    if last != b'\n'
                        || before.len() != after.len()
                        || before.modified().ok() != after.modified().ok()
                    {
                        unstable = true;
                        return Err("Claude history changed during import".into());
                    }
                    guard()
                });
            if unstable {
                return Ok(false);
            }
            copied?;
            safe_path(target_home, &target)?;
            Ok(fs::symlink_metadata(&target).is_ok_and(|m| m.is_file()))
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_vendor_registered_namespace_authorizes_history_import() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("Claude-3p");
        let account = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        let org = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        let project = home.join("claude-code-sessions").join(account).join(org);
        fs::create_dir_all(&project).unwrap();
        let discover = || confirmed_project(temp.path(), &home, Instant::now() + MAX_PASS_TIME);
        assert_eq!(discover().unwrap(), None);
        let config = json!({"lastKnownAccountUuid":account}).to_string();
        fs::write(home.join("config.json"), &config).unwrap();
        assert_eq!(discover().unwrap(), None);
        fs::write(
            project
                .parent()
                .unwrap()
                .join(format!("{org}.profile-origin.json")),
            json!({"mode":"local","org":org}).to_string(),
        )
        .unwrap();
        assert_eq!(discover().unwrap(), Some(project));
        assert_eq!(
            fs::read_to_string(home.join("config.json")).unwrap(),
            config
        );
        assert!(!home.join("ant-did").exists());
    }

    #[test]
    fn revoked_launch_cannot_import_into_a_registered_namespace() {
        let temp = tempfile::tempdir().unwrap();
        let (official, gateway, source, target, _) = fixture(temp.path());
        let project =
            namespace::registered_project(gateway.parent().unwrap(), gateway.parent().unwrap())
                .unwrap()
                .unwrap();
        assert_eq!(
            import_into_checked(
                &official,
                &project,
                &source,
                &target,
                MAX_PASS_BYTES,
                Instant::now() + MAX_PASS_TIME,
                &|| Err("market_identity_changed".into())
            ),
            Err("market_identity_changed".into())
        );
        assert!(!target.exists());
        assert_eq!(fs::read_dir(project).unwrap().count(), 0);
    }

    #[test]
    fn busy_native_writer_prevents_initial_history_import() {
        let temp = tempfile::tempdir().unwrap();
        let (official, gateway, source, target, _) = fixture(temp.path());
        let project =
            namespace::registered_project(gateway.parent().unwrap(), gateway.parent().unwrap())
                .unwrap()
                .unwrap();
        assert_eq!(
            import_into_checked(
                &official,
                &project,
                &source,
                &target,
                MAX_PASS_BYTES,
                Instant::now() + MAX_PASS_TIME,
                &|| Err("busy".into())
            ),
            Err("busy".into())
        );
        assert!(!target.exists());
        assert_eq!(fs::read_dir(project).unwrap().count(), 0);
    }

    #[test]
    fn invalidation_between_transcript_and_catalog_preserves_content_without_registering_it() {
        let temp = tempfile::tempdir().unwrap();
        let (official, gateway, source, target, relative) = fixture(temp.path());
        let project =
            namespace::registered_project(gateway.parent().unwrap(), gateway.parent().unwrap())
                .unwrap()
                .unwrap();
        let check = || {
            if target.join(&relative).exists() {
                Err("market_identity_changed".into())
            } else {
                Ok(())
            }
        };
        assert_eq!(
            import_into_checked(
                &official,
                &project,
                &source,
                &target,
                MAX_PASS_BYTES,
                Instant::now() + MAX_PASS_TIME,
                &check
            ),
            Err("market_identity_changed".into())
        );
        assert_eq!(
            fs::read(target.join(&relative)).unwrap(),
            fs::read(source.join(relative)).unwrap()
        );
        assert!(!project
            .join("local_cccccccc-cccc-4ccc-8ccc-cccccccccccc.json")
            .exists());
    }

    fn fixture(root: &Path) -> (PathBuf, PathBuf, PathBuf, PathBuf, String) {
        let official = root.join("official/claude-code-sessions");
        let gateway = root.join("gateway/claude-code-sessions");
        let account = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        let org = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        for base in [&official, &gateway] {
            fs::create_dir_all(base.join(account).join(org)).unwrap();
            fs::write(
                base.parent().unwrap().join("config.json"),
                json!({"lastKnownAccountUuid": account}).to_string(),
            )
            .unwrap();
        }
        fs::write(
            gateway
                .join(account)
                .join(format!("{org}.profile-origin.json")),
            json!({"mode":"local","org":org}).to_string(),
        )
        .unwrap();
        let source = root.join("source");
        let target = root.join("target");
        let id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
        let cwd = root.join("workspace");
        let relative = PathBuf::from("projects")
            .join(sanitize_claude_project_name(&cwd))
            .join(format!("{id}.jsonl"));
        fs::create_dir_all(source.join(&relative).parent().unwrap()).unwrap();
        fs::write(
            source.join(&relative),
            b"{\"type\":\"user\",\"message\":{\"content\":\"remember cedar\"}}\n",
        )
        .unwrap();
        fs::write(source.join(".credentials.json"), "DO NOT IMPORT").unwrap();
        fs::write(source.join("settings.json"), "DO NOT IMPORT").unwrap();
        fs::write(official.join(account).join(org).join(format!("local_{id}.json")),
            json!({"cliSessionId":id,"sessionId":format!("local_{id}"),"cwd":cwd,"title":"History",
                "model":"old-provider-model","permissionMode":"bypassPermissions","cuAllowedApps":["Finder"]}).to_string()).unwrap();
        (
            official,
            gateway,
            source,
            target,
            relative.to_string_lossy().into_owned(),
        )
    }

    #[test]
    fn imported_filename_preserves_desktop_identity_distinct_from_cli_uuid() {
        let temp = tempfile::tempdir().unwrap();
        let (official, gateway, source, target, _) = fixture(temp.path());
        let source_row = official.join("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/local_cccccccc-cccc-4ccc-8ccc-cccccccccccc.json");
        let mut value: Value = serde_json::from_slice(&fs::read(&source_row).unwrap()).unwrap();
        value["sessionId"] = json!("local_dddddddd-dddd-4ddd-8ddd-dddddddddddd");
        fs::write(&source_row, serde_json::to_vec(&value).unwrap()).unwrap();
        let original = fs::read(&source_row).unwrap();
        assert_eq!(
            import_between(
                &official,
                &gateway,
                &source,
                &target,
                MAX_PASS_BYTES,
                Instant::now() + MAX_PASS_TIME
            )
            .unwrap(),
            1
        );
        let dir = gateway
            .join("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
        assert!(dir
            .join("local_dddddddd-dddd-4ddd-8ddd-dddddddddddd.json")
            .is_file());
        assert!(!dir
            .join("local_cccccccc-cccc-4ccc-8ccc-cccccccccccc.json")
            .exists());
        assert_eq!(
            import_between(
                &official,
                &gateway,
                &source,
                &target,
                MAX_PASS_BYTES,
                Instant::now() + MAX_PASS_TIME
            )
            .unwrap(),
            0
        );
        assert_eq!(fs::read(source_row).unwrap(), original);
    }

    #[test]
    fn copies_resumable_content_without_credentials_or_overwriting_continuations() {
        let temp = tempfile::tempdir().unwrap();
        let (official, gateway, source, target, relative) = fixture(temp.path());
        let run = || {
            import_between(
                &official,
                &gateway,
                &source,
                &target,
                MAX_PASS_BYTES,
                Instant::now() + MAX_PASS_TIME,
            )
            .unwrap()
        };
        assert_eq!(run(), 1);
        assert_eq!(
            fs::read(target.join(&relative)).unwrap(),
            fs::read(source.join(&relative)).unwrap()
        );
        assert!(!target.join(".credentials.json").exists());
        assert!(!target.join("settings.json").exists());
        let row = gateway.join("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/local_cccccccc-cccc-4ccc-8ccc-cccccccccccc.json");
        let value: Value = serde_json::from_slice(&fs::read(&row).unwrap()).unwrap();
        assert_eq!(value["permissionMode"], "default");
        assert!(value.get("model").is_none());
        assert!(value.get("cuAllowedApps").is_none());
        fs::write(target.join(&relative), "package continuation\n").unwrap();
        let official_bytes = fs::read(source.join(&relative)).unwrap();
        assert_eq!(run(), 0);
        assert_eq!(
            fs::read(target.join(&relative)).unwrap(),
            b"package continuation\n"
        );
        assert_eq!(fs::read(source.join(&relative)).unwrap(), official_bytes);
        // Crash recovery: content already committed, discovery row not yet.
        fs::remove_file(&row).unwrap();
        assert_eq!(run(), 1);
        assert_eq!(
            fs::read(target.join(&relative)).unwrap(),
            b"package continuation\n"
        );
    }

    #[test]
    fn budget_or_partial_record_never_publishes_an_empty_history() {
        let temp = tempfile::tempdir().unwrap();
        let (official, gateway, source, target, relative) = fixture(temp.path());
        assert_eq!(
            import_between(
                &official,
                &gateway,
                &source,
                &target,
                1,
                Instant::now() + MAX_PASS_TIME
            ),
            Err("claude_history_import_limit".into())
        );
        assert!(!target.join(&relative).exists());
        fs::write(source.join(&relative), b"{unfinished").unwrap();
        assert_eq!(
            import_between(
                &official,
                &gateway,
                &source,
                &target,
                MAX_PASS_BYTES,
                Instant::now() + MAX_PASS_TIME
            )
            .unwrap(),
            0
        );
        assert!(!target.join(&relative).exists());
        assert_eq!(
            import_between(
                &official,
                &gateway,
                &source,
                &target,
                MAX_PASS_BYTES,
                Instant::now()
            ),
            Err("claude_history_import_limit".into())
        );
    }

    #[cfg(unix)]
    #[test]
    fn linked_transcript_cannot_cross_the_profile_boundary() {
        let temp = tempfile::tempdir().unwrap();
        let (official, gateway, source, target, relative) = fixture(temp.path());
        fs::remove_file(source.join(&relative)).unwrap();
        std::os::unix::fs::symlink(source.join(".credentials.json"), source.join(&relative))
            .unwrap();
        assert_eq!(
            import_between(
                &official,
                &gateway,
                &source,
                &target,
                MAX_PASS_BYTES,
                Instant::now() + MAX_PASS_TIME
            )
            .unwrap(),
            0
        );
        assert!(!target.join(&relative).exists());
    }
    #[test]
    fn oversized_history_is_reported_without_preparing_destination() {
        let temp = tempfile::tempdir().unwrap();
        let (official, gateway, source, target, relative) = fixture(temp.path());
        fs::OpenOptions::new()
            .write(true)
            .open(source.join(&relative))
            .unwrap()
            .set_len(MAX_TRANSCRIPT_BYTES + 1)
            .unwrap();
        assert_eq!(
            import_between(
                &official,
                &gateway,
                &source,
                &target,
                MAX_PASS_BYTES,
                Instant::now() + MAX_PASS_TIME
            ),
            Err("claude_history_import_limit".into())
        );
        assert!(!target.exists());
    }

    #[cfg(unix)]
    #[test]
    fn destination_link_is_rejected_without_writing_through_it() {
        let temp = tempfile::tempdir().unwrap();
        let (official, gateway, source, target, relative) = fixture(temp.path());
        fs::create_dir_all(&target).unwrap();
        std::os::unix::fs::symlink(source.join("projects"), target.join("projects")).unwrap();
        let before = fs::read(source.join(&relative)).unwrap();
        assert!(import_between(
            &official,
            &gateway,
            &source,
            &target,
            MAX_PASS_BYTES,
            Instant::now() + MAX_PASS_TIME
        )
        .is_err());
        assert_eq!(fs::read(source.join(&relative)).unwrap(), before);
    }
}
