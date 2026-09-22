//! Import Code history into one Market App profile. Only missing transcripts
//! and discovery rows cross the boundary; credentials/settings never do.
use super::*;
use agent_cli::managed_config::native_app::NativeAppProfile;
use base64::engine::general_purpose::STANDARD;
use std::io::Write;
use std::time::{Duration, Instant};

const MAX_TRANSCRIPT_BYTES: u64 = 128 * 1024 * 1024;
const MAX_PASS_BYTES: u64 = 1536 * 1024 * 1024;
const MAX_PASS_TIME: Duration = Duration::from_secs(15);

/// False means Desktop has not registered its first local profile yet. The
/// caller may retry during its bounded, user-triggered launch action.
pub(crate) fn import(profile: &NativeAppProfile) -> Result<bool, String> {
    profile.validate("claude_desktop")?;
    let catalog = profile.home().join("claude-code-sessions");
    safe_path(&profile.root(), &catalog)?;
    let Some(account) = claude_desktop_active_account_id(&catalog) else {
        return Ok(false);
    };
    let account_dir = catalog.join(account);
    safe_path(&profile.root(), &account_dir)?;
    let Some(project) = claude_desktop_local_profile_project_dir(&account_dir) else {
        return Ok(false);
    };
    safe_path(&profile.root(), &project)?;
    import_into(
        &claude_desktop_sessions_root(),
        &project,
        &app_paths::native_transcript_home_dir().join(".claude"),
        &profile.system_home().join(".claude"),
        MAX_PASS_BYTES,
        Instant::now() + MAX_PASS_TIME,
    )?;
    Ok(true)
}

/// Claude 2.2553.1's local Gateway identity is its base64 installation UUID
/// (`ant-did`) and the local placeholder organization. Seed only our isolated
/// installation, before its first process reads the Code catalog. Never copy
/// the primary installation ID, account settings, or permission grants.
pub(crate) fn prepare_before_launch(profile: &NativeAppProfile) -> Result<(), String> {
    profile.validate("claude_desktop")?;
    let project = prepare_local_catalog(&profile.root(), &profile.home())?;
    import_into(
        &claude_desktop_sessions_root(),
        &project,
        &app_paths::native_transcript_home_dir().join(".claude"),
        &profile.system_home().join(".claude"),
        MAX_PASS_BYTES,
        Instant::now() + MAX_PASS_TIME,
    )?;
    Ok(())
}

fn prepare_local_catalog(root: &Path, home: &Path) -> Result<PathBuf, String> {
    const LOCAL_ORG: &str = "00000000-0000-4000-8000-000000000001";
    let catalog = home.join("claude-code-sessions");
    let install = home.join("ant-did");
    safe_path(root, &catalog)?;
    safe_path(root, &install)?;
    // Existing vendor identities and organization choices remain authoritative.
    let known_account = claude_desktop_active_account_id(&catalog);
    if let Some(account) = &known_account {
        let account_dir = catalog.join(account);
        safe_path(root, &account_dir)?;
        if let Some(project) = claude_desktop_local_profile_project_dir(&account_dir) {
            safe_path(root, &project)?;
            if read_installation_identity(&install)? != *account {
                return Err("Claude local history identity changed".into());
            }
            return Ok(project);
        }
    }
    if !install.try_exists().map_err(|e| e.to_string())? {
        if home.join("config.json").exists() {
            return Err("Cannot determine Claude's existing local history identity".into());
        }
        let id = STANDARD.encode(Uuid::new_v4().to_string());
        create_file_atomically(&install, "Claude installation identity", |out| {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                out.set_permissions(fs::Permissions::from_mode(0o600))
                    .map_err(|e| e.to_string())?;
            }
            out.write_all(id.as_bytes()).map_err(|e| e.to_string())
        })?;
    }
    safe_path(root, &install)?;
    let account = read_installation_identity(&install)?;
    if known_account
        .as_deref()
        .is_some_and(|known| known != account)
    {
        return Err("Claude local history identity changed".into());
    }
    let project = catalog.join(&account).join(LOCAL_ORG);
    safe_path(root, &project)?;
    fs::create_dir_all(&project).map_err(|e| e.to_string())?;
    safe_path(root, &project)?;
    Ok(project)
}

fn read_installation_identity(install: &Path) -> Result<String, String> {
    let metadata = fs::symlink_metadata(install).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > 128 {
        return Err("Invalid Claude installation identity".into());
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let mut bytes = Vec::new();
    options
        .open(install)
        .map_err(|e| e.to_string())?
        .take(129)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    let decoded = STANDARD
        .decode(bytes)
        .map_err(|_| "Invalid Claude installation identity")?;
    let account =
        std::str::from_utf8(&decoded).map_err(|_| "Invalid Claude installation identity")?;
    if account.len() != 36 || Uuid::parse_str(account).is_err() {
        return Err("Invalid Claude installation identity".into());
    }
    Ok(account.to_owned())
}

fn safe_path(root: &Path, path: &Path) -> Result<(), String> {
    if !path.starts_with(root) {
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
    let Some(account) = claude_desktop_active_account_id(catalog) else {
        return Ok(0);
    };
    let Some(project) = claude_desktop_local_profile_project_dir(&catalog.join(account)) else {
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

fn import_into(
    official: &Path,
    project: &Path,
    source_home: &Path,
    target_home: &Path,
    mut remaining: u64,
    deadline: Instant,
) -> Result<usize, String> {
    // Reuse the standard catalog's active-account selection, grant stripping,
    // insertion cap and create-if-absent writer. Drop the old model selection:
    // the package's configured default must own the first resumed request.
    backfill_claude_desktop_catalog_into(official, project, false, |cwd, id| {
        if Instant::now() >= deadline {
            return Ok(false);
        }
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
        if !before.is_file()
            || before.len() == 0
            || before.len() > MAX_TRANSCRIPT_BYTES.min(remaining)
        {
            return Ok(false);
        }
        // Reserve the budget even if a concurrent provider write invalidates
        // this snapshot; retries may not turn the byte cap into unbounded I/O.
        remaining -= before.len();
        let mut unstable = false;
        let copied = create_file_atomically(&target, "isolated Claude history", |out| {
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
                if Instant::now() >= deadline {
                    unstable = true;
                    return Err("Claude history snapshot exceeded its time budget".into());
                }
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
            Ok(())
        });
        if unstable {
            return Ok(false);
        }
        copied?;
        safe_path(target_home, &target)?;
        Ok(fs::symlink_metadata(&target).is_ok_and(|m| m.is_file()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn first_open_has_resumable_rows_before_desktop_creates_its_account_config() {
        let temp = tempfile::tempdir().unwrap();
        let (official, gateway, source, target, relative) = fixture(temp.path());
        let fresh_home = temp.path().join("fresh/Claude-3p");
        let project = prepare_local_catalog(temp.path(), &fresh_home).unwrap();
        assert!(!fresh_home.join("config.json").exists());
        let identity_before = fs::read(fresh_home.join("ant-did")).unwrap();
        assert_eq!(
            import_into(
                &official,
                &project,
                &source,
                &target,
                MAX_PASS_BYTES,
                Instant::now() + MAX_PASS_TIME
            )
            .unwrap(),
            1
        );
        let row_path = project.join("local_cccccccc-cccc-4ccc-8ccc-cccccccccccc.json");
        let row: Value = serde_json::from_slice(&fs::read(&row_path).unwrap()).unwrap();
        assert_eq!(
            row_path.file_stem().unwrap().to_str(),
            row["sessionId"].as_str()
        );
        assert!(target.join(relative).is_file());
        assert_eq!(
            prepare_local_catalog(temp.path(), &fresh_home).unwrap(),
            project
        );
        assert_eq!(
            fs::read(fresh_home.join("ant-did")).unwrap(),
            identity_before
        );
        assert_eq!(
            import_into(
                &official,
                &project,
                &source,
                &target,
                MAX_PASS_BYTES,
                Instant::now() + MAX_PASS_TIME
            )
            .unwrap(),
            0
        );
        // Existing vendor namespaces are reused without creating another identity.
        assert!(prepare_local_catalog(temp.path(), gateway.parent().unwrap()).is_err());
        assert!(!gateway.parent().unwrap().join("ant-did").exists());
        let existing_identity = STANDARD.encode("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
        fs::write(
            gateway.parent().unwrap().join("ant-did"),
            &existing_identity,
        )
        .unwrap();
        assert!(
            prepare_local_catalog(temp.path(), gateway.parent().unwrap())
                .unwrap()
                .is_dir()
        );
        assert_eq!(
            fs::read_to_string(gateway.parent().unwrap().join("ant-did")).unwrap(),
            existing_identity
        );
        fs::write(
            gateway.parent().unwrap().join("ant-did"),
            STANDARD.encode("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
        )
        .unwrap();
        assert!(prepare_local_catalog(temp.path(), gateway.parent().unwrap()).is_err());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(fresh_home.join("ant-did"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
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
    fn interrupted_vendor_initialization_reuses_installation_without_rewriting_config() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("Claude-3p");
        fs::create_dir_all(&home).unwrap();
        let account = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        fs::write(home.join("ant-did"), STANDARD.encode(account)).unwrap();
        let config = json!({"lastKnownAccountUuid":account,"locale":"en-US"}).to_string();
        fs::write(home.join("config.json"), &config).unwrap();
        let project = prepare_local_catalog(temp.path(), &home).unwrap();
        assert_eq!(project.parent().unwrap().file_name().unwrap(), account);
        assert_eq!(
            fs::read_to_string(home.join("config.json")).unwrap(),
            config
        );
        fs::write(
            home.join("config.json"),
            json!({"lastKnownAccountUuid":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}).to_string(),
        )
        .unwrap();
        assert!(prepare_local_catalog(temp.path(), &home).is_err());
        assert_eq!(
            fs::read_to_string(home.join("ant-did")).unwrap(),
            STANDARD.encode(account)
        );
    }

    #[test]
    fn bootstrap_does_not_repair_or_replace_an_existing_invalid_identity() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("Claude-3p");
        fs::create_dir_all(&home).unwrap();
        let identity = home.join("ant-did");
        fs::write(&identity, b"invalid").unwrap();
        assert!(prepare_local_catalog(temp.path(), &home).is_err());
        assert_eq!(fs::read(&identity).unwrap(), b"invalid");
        fs::write(
            &identity,
            STANDARD.encode(" aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa "),
        )
        .unwrap();
        assert!(prepare_local_catalog(temp.path(), &home).is_err());
        assert!(!home.join("claude-code-sessions").exists());
        fs::remove_file(identity).unwrap();
        fs::write(home.join("config.json"), b"{}").unwrap();
        assert!(prepare_local_catalog(temp.path(), &home).is_err());
        assert!(!home.join("ant-did").exists());
    }

    #[cfg(unix)]
    #[test]
    fn bootstrap_rejects_linked_installation_identity() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("Claude-3p");
        fs::create_dir_all(&home).unwrap();
        let other = temp.path().join("primary-ant-did");
        fs::write(&other, b"primary identity untouched").unwrap();
        std::os::unix::fs::symlink(&other, home.join("ant-did")).unwrap();
        assert!(prepare_local_catalog(temp.path(), &home).is_err());
        assert_eq!(fs::read(other).unwrap(), b"primary identity untouched");
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
            )
            .unwrap(),
            0
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
            )
            .unwrap(),
            0
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
    fn oversized_history_is_skipped_without_preparing_destination() {
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
            )
            .unwrap(),
            0
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
