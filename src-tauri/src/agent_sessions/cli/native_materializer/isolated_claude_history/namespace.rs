//! Vendor-owned local namespace evidence. A directory created by ORG2 alone is
//! never sufficient; config and one unambiguous origin marker must agree.
use super::super::{CLAUDE_DESKTOP_METADATA_MAX_BYTES, CLAUDE_DESKTOP_PROJECT_SCAN_LIMIT};
use serde_json::Value;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Error {
    Changed,
    Unsupported,
    Limit,
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Changed => "claude_history_namespace_changed",
            Self::Unsupported => "claude_history_namespace_unverified",
            Self::Limit => "claude_history_namespace_limit",
        })
    }
}

struct Budget {
    remaining: u64,
    deadline: Instant,
}
impl Budget {
    fn new() -> Self {
        Self {
            remaining: 8 * 1024 * 1024,
            deadline: Instant::now() + Duration::from_secs(2),
        }
    }
    fn check(&self) -> Result<(), Error> {
        if Instant::now() >= self.deadline {
            Err(Error::Limit)
        } else {
            Ok(())
        }
    }
}

fn read(root: &Path, path: &Path, budget: &mut Budget) -> Result<Option<Vec<u8>>, Error> {
    budget.check()?;
    super::safe_path(root, path).map_err(|_| Error::Changed)?;
    let before = match fs::symlink_metadata(path) {
        Ok(value) => value,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(Error::Changed),
    };
    if !before.is_file() {
        return Err(Error::Unsupported);
    }
    if before.len() > CLAUDE_DESKTOP_METADATA_MAX_BYTES || before.len() > budget.remaining {
        return Err(Error::Limit);
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::{fs::MetadataExt, fs::OpenOptionsExt};
        if before.nlink() != 1 || before.uid() != unsafe { libc::geteuid() } {
            return Err(Error::Changed);
        }
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let file = options.open(path).map_err(|_| Error::Changed)?;
    let opened = file.metadata().map_err(|_| Error::Changed)?;
    // Check the opened handle on every platform before reading. Unix adds its
    // stronger inode/device identity check below.
    if !opened.is_file()
        || before.len() != opened.len()
        || before.modified().ok() != opened.modified().ok()
    {
        return Err(Error::Changed);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if before.ino() != opened.ino() || before.dev() != opened.dev() {
            return Err(Error::Changed);
        }
    }
    let mut bytes = Vec::new();
    let mut reader = file.take(CLAUDE_DESKTOP_METADATA_MAX_BYTES + 1);
    reader.read_to_end(&mut bytes).map_err(|_| Error::Changed)?;
    budget.remaining = budget
        .remaining
        .checked_sub(bytes.len() as u64)
        .ok_or(Error::Limit)?;
    budget.check()?;
    let after = reader.get_ref().metadata().map_err(|_| Error::Changed)?;
    if bytes.len() as u64 != before.len()
        || before.len() != after.len()
        || before.modified().ok() != after.modified().ok()
    {
        return Err(Error::Changed);
    }
    Ok(Some(bytes))
}

fn object(bytes: &[u8]) -> Result<Value, Error> {
    let value: Value = serde_json::from_slice(bytes).map_err(|_| Error::Unsupported)?;
    if value.is_object() {
        Ok(value)
    } else {
        Err(Error::Unsupported)
    }
}

pub(crate) fn active_account(root: &Path, home: &Path) -> Result<Option<String>, Error> {
    let Some(bytes) = read(root, &home.join("config.json"), &mut Budget::new())? else {
        return Ok(None);
    };
    let value = object(&bytes)?;
    let Some(account) = value.get("lastKnownAccountUuid") else {
        return Ok(None);
    };
    let account = account.as_str().ok_or(Error::Unsupported)?;
    uuid::Uuid::parse_str(account).map_err(|_| Error::Unsupported)?;
    Ok(Some(account.to_owned()))
}

#[cfg(test)]
pub(crate) fn registered_project(root: &Path, home: &Path) -> Result<Option<PathBuf>, Error> {
    registered_project_until(root, home, Instant::now() + Duration::from_secs(2))
}

pub(crate) fn registered_project_until(
    root: &Path,
    home: &Path,
    deadline: Instant,
) -> Result<Option<PathBuf>, Error> {
    let mut budget = Budget::new();
    budget.deadline = budget.deadline.min(deadline);
    let config = home.join("config.json");
    let Some(before) = read(root, &config, &mut budget)? else {
        return Ok(None);
    };
    let value = object(&before)?;
    let Some(account) = value.get("lastKnownAccountUuid") else {
        return Ok(None);
    };
    let account = account.as_str().ok_or(Error::Unsupported)?;
    uuid::Uuid::parse_str(account).map_err(|_| Error::Unsupported)?;
    let project = local_project_with_budget(
        root,
        &home.join("claude-code-sessions").join(account),
        &mut budget,
    )?;
    if read(root, &config, &mut budget)?.as_deref() != Some(before.as_slice()) {
        return Err(Error::Changed);
    }
    Ok(project)
}

pub(crate) fn local_project(root: &Path, account: &Path) -> Result<Option<PathBuf>, Error> {
    local_project_with_budget(root, account, &mut Budget::new())
}

fn local_project_with_budget(
    root: &Path,
    account: &Path,
    budget: &mut Budget,
) -> Result<Option<PathBuf>, Error> {
    super::safe_path(root, account).map_err(|_| Error::Changed)?;
    let entries = match fs::read_dir(account) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(Error::Changed),
    };
    let mut selected = None;
    for (index, entry) in entries.enumerate() {
        budget.check()?;
        if index >= CLAUDE_DESKTOP_PROJECT_SCAN_LIMIT {
            return Err(Error::Limit);
        }
        let path = entry.map_err(|_| Error::Changed)?.path();
        let Some(name) = path.file_name().and_then(|v| v.to_str()) else {
            continue;
        };
        if !name.ends_with(".profile-origin.json") {
            continue;
        }
        let bytes = read(root, &path, budget)?.ok_or(Error::Changed)?;
        let row = object(&bytes)?;
        if row["mode"] != "local" {
            continue;
        }
        let org = row["org"].as_str().ok_or(Error::Unsupported)?;
        uuid::Uuid::parse_str(org).map_err(|_| Error::Unsupported)?;
        if name != format!("{org}.profile-origin.json") {
            return Err(Error::Unsupported);
        }
        let project = account.join(org);
        super::safe_path(root, &project).map_err(|_| Error::Changed)?;
        if !project.is_dir() {
            return Ok(None);
        }
        if selected.replace(project).is_some() {
            return Err(Error::Unsupported);
        }
    }
    Ok(selected)
}

#[cfg(test)]
mod tests {
    use super::*;
    const ACCOUNT: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const ORG: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    fn register(home: &Path, org: &str) -> PathBuf {
        let account = home.join("claude-code-sessions").join(ACCOUNT);
        let project = account.join(org);
        fs::create_dir_all(&project).unwrap();
        fs::write(
            home.join("config.json"),
            serde_json::json!({"lastKnownAccountUuid":ACCOUNT}).to_string(),
        )
        .unwrap();
        fs::write(
            account.join(format!("{org}.profile-origin.json")),
            serde_json::json!({"mode":"local","org":org}).to_string(),
        )
        .unwrap();
        project
    }
    #[test]
    fn directory_only_is_not_vendor_namespace_evidence() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("isolated");
        let project = home.join("claude-code-sessions").join(ACCOUNT).join(ORG);
        fs::create_dir_all(&project).unwrap();
        assert_eq!(registered_project(temp.path(), &home).unwrap(), None);
        fs::write(
            home.join("config.json"),
            serde_json::json!({"lastKnownAccountUuid":ACCOUNT}).to_string(),
        )
        .unwrap();
        assert_eq!(registered_project(temp.path(), &home).unwrap(), None);
        register(&home, ORG);
        assert_eq!(
            registered_project(temp.path(), &home).unwrap(),
            Some(project)
        );
    }
    #[test]
    fn ambiguous_local_namespaces_never_choose_the_first_marker() {
        let temp = tempfile::tempdir().unwrap();
        register(temp.path(), ORG);
        register(temp.path(), "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
        assert_eq!(
            registered_project(temp.path(), temp.path()),
            Err(Error::Unsupported)
        );
    }
    #[test]
    fn mismatching_marker_filename_cannot_select_another_project() {
        let temp = tempfile::tempdir().unwrap();
        let project = register(temp.path(), ORG);
        fs::rename(
            project
                .parent()
                .unwrap()
                .join(format!("{ORG}.profile-origin.json")),
            project.parent().unwrap().join("other.profile-origin.json"),
        )
        .unwrap();
        assert_eq!(
            registered_project(temp.path(), temp.path()),
            Err(Error::Unsupported)
        );
    }
    #[cfg(unix)]
    #[test]
    fn linked_vendor_config_is_not_evidence() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("isolated");
        register(&home, ORG);
        fs::rename(home.join("config.json"), temp.path().join("private.json")).unwrap();
        std::os::unix::fs::symlink(temp.path().join("private.json"), home.join("config.json"))
            .unwrap();
        assert_eq!(registered_project(temp.path(), &home), Err(Error::Changed));
    }
    #[test]
    fn inventory_overflow_is_not_a_verified_unique_namespace() {
        let temp = tempfile::tempdir().unwrap();
        let project = register(temp.path(), ORG);
        for index in 0..CLAUDE_DESKTOP_PROJECT_SCAN_LIMIT {
            fs::write(project.parent().unwrap().join(index.to_string()), b"").unwrap();
        }
        assert_eq!(
            registered_project(temp.path(), temp.path()),
            Err(Error::Limit)
        );
    }
    #[test]
    fn launch_deadline_is_not_reset_by_namespace_discovery() {
        let temp = tempfile::tempdir().unwrap();
        register(temp.path(), ORG);
        assert_eq!(
            registered_project_until(temp.path(), temp.path(), Instant::now()),
            Err(Error::Limit)
        );
    }
}
