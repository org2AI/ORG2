//! Import Code history into one Market App profile. Only missing transcripts
//! and discovery rows cross the boundary; credentials/settings never do.
use super::*;
use agent_cli::managed_config::native_app::NativeAppProfile;
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
    import_between(
        &claude_desktop_sessions_root(),
        &catalog,
        &app_paths::native_transcript_home_dir().join(".claude"),
        &profile.system_home().join(".claude"),
        MAX_PASS_BYTES,
        Instant::now() + MAX_PASS_TIME,
    )?;
    Ok(true)
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

fn import_between(
    official: &Path,
    catalog: &Path,
    source_home: &Path,
    target_home: &Path,
    mut remaining: u64,
    deadline: Instant,
) -> Result<usize, String> {
    // Reuse the standard catalog's active-account selection, grant stripping,
    // insertion cap and create-if-absent writer. Drop the old model selection:
    // the package's configured default must own the first resumed request.
    backfill_claude_desktop_catalog_with(official, catalog, false, |cwd, id| {
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
