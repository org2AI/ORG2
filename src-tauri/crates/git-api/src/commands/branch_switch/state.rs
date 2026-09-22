use super::types::*;
use fs2::FileExt;
use git2::{ObjectType, Oid, Repository, RepositoryState, StatusOptions};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

pub fn git(path: &Path, args: &[&str]) -> Result<String, String> {
    // Never retry a mutation: a failed response need not mean nothing happened.
    let out = git::util::run_git_with_timeout(path, args, 1, std::time::Duration::from_secs(60))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_owned());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim_end().to_owned())
}

pub fn open(path: &Path) -> Result<Repository, String> {
    Repository::open(path).map_err(|e| e.to_string())
}

pub fn lock(repo: &Repository) -> Result<File, String> {
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(repo.commondir().join("orgii-branch-switch.lock"))
        .map_err(|e| e.to_string())?;
    file.try_lock_exclusive()
        .map_err(|_| "Another ORGII branch operation is running in this repository".to_string())?;
    // OS lock releases on drop/process exit, including app crashes.
    Ok(file)
}

pub fn branch(repo: &Repository) -> String {
    repo.head()
        .ok()
        .map(|h| {
            if h.is_branch() {
                h.shorthand().unwrap_or("HEAD").to_owned()
            } else {
                format!(
                    "Detached at {}",
                    h.target()
                        .map(|v| v.to_string()[..8].to_owned())
                        .unwrap_or_default()
                )
            }
        })
        .unwrap_or_else(|| "Unborn branch".to_owned())
}

pub fn head(repo: &Repository) -> Result<String, String> {
    repo.head()
        .and_then(|h| h.peel_to_commit())
        .map(|c| c.id().to_string())
        .map_err(|e| e.to_string())
}

pub fn operation_block(repo: &Repository) -> Option<Blocked> {
    let (operation, message) = match repo.state() {
        RepositoryState::Clean => return None,
        RepositoryState::Merge => (
            "merge",
            "Finish or abort the merge before switching branches",
        ),
        RepositoryState::Rebase
        | RepositoryState::RebaseInteractive
        | RepositoryState::RebaseMerge => (
            "rebase",
            "Finish or abort the rebase before switching branches",
        ),
        RepositoryState::CherryPick | RepositoryState::CherryPickSequence => (
            "cherry_pick",
            "Finish or abort the cherry-pick before switching branches",
        ),
        RepositoryState::Revert | RepositoryState::RevertSequence => (
            "revert",
            "Finish or abort the revert before switching branches",
        ),
        _ => (
            "other",
            "Finish the current Git operation before switching branches",
        ),
    };
    Some(Blocked {
        detail: Some(operation.into()),
        ..blocked("operation_in_progress", message)
    })
}

pub fn blocked(code: &str, message: &str) -> Blocked {
    Blocked {
        code: code.into(),
        message: message.into(),
        detail: None,
        worktree_path: None,
    }
}

/// Content-aware token, not only porcelain status (an M can change while a dialog is open).
pub fn status(repo: &Repository) -> Result<(Vec<String>, String, Option<Blocked>), String> {
    let root = repo
        .workdir()
        .ok_or("Bare repositories cannot switch workspaces")?;
    let mut options = StatusOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);
    let statuses = repo
        .statuses(Some(&mut options))
        .map_err(|e| e.to_string())?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    index.read(true).map_err(|e| e.to_string())?;
    let mut token = format!("{}\0{}", branch(repo), head(repo).unwrap_or_default());
    let mut files = Vec::new();
    let mut block = operation_block(repo);
    if index.has_conflicts() {
        block = Some(blocked(
            "conflicts",
            "Resolve the existing conflicts before switching branches",
        ));
    }
    for entry in statuses.iter() {
        let name = entry
            .path()
            .ok_or("A changed filename is not valid UTF-8; handle this worktree with Git")?;
        let path = root.join(name);
        if (!path.is_symlink() && path.is_dir())
            || index
                .get_path(Path::new(name), 0)
                .is_some_and(|e| e.mode == 0o160000)
        {
            block = Some(blocked(
                "nested_repository",
                "Commit or save changes in the submodule or nested repository first",
            ));
        }
        let content = if path.is_symlink() {
            fs::read_link(&path)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .into_owned()
        } else if path.is_file() {
            Oid::hash_file(ObjectType::Blob, &path)
                .map_err(|e| e.to_string())?
                .to_string()
        } else {
            String::new()
        };
        #[cfg(unix)]
        let mode = {
            use std::os::unix::fs::PermissionsExt;
            fs::symlink_metadata(&path)
                .map(|m| m.permissions().mode())
                .unwrap_or(0)
        };
        #[cfg(not(unix))]
        let mode = 0;
        token.push_str(&format!("\0{mode}"));
        let indexed = index
            .get_path(Path::new(name), 0)
            .map(|e| format!("{}:{}", e.id, e.mode))
            .unwrap_or_default();
        token.push_str(&format!(
            "\0{}\0{}\0{}\0{}",
            name,
            entry.status().bits(),
            indexed,
            content
        ));
        files.push(name.to_owned());
    }
    Ok((files, token, block))
}

pub fn directory(repo: &Repository) -> PathBuf {
    repo.commondir().join("orgii-branch-switch")
}
pub fn record_path(repo: &Repository, id: &str) -> Result<PathBuf, String> {
    uuid::Uuid::parse_str(id).map_err(|_| "Invalid saved-change ID")?;
    Ok(directory(repo).join(format!("{id}.json")))
}
pub fn save(repo: &Repository, snapshot: &Snapshot) -> Result<(), String> {
    fs::create_dir_all(directory(repo)).map_err(|e| e.to_string())?;
    let path = record_path(repo, &snapshot.id)?;
    let temp = path.with_extension("tmp");
    let mut file = File::create(&temp).map_err(|e| e.to_string())?;
    file.write_all(&serde_json::to_vec(snapshot).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    fs::rename(temp, path).map_err(|e| e.to_string())
}
pub fn load(repo: &Repository, id: &str) -> Result<Snapshot, String> {
    let mut s: Snapshot =
        serde_json::from_slice(&fs::read(record_path(repo, id)?).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if s.oid.is_none() {
        // Recover a crash between stash creation and journal update by unique operation ID.
        let marker = format!("orgii-switch:{}", s.id);
        let mut repository = Repository::open(repo.path()).map_err(|e| e.to_string())?;
        repository
            .stash_foreach(|_, message, oid| {
                if message.contains(&marker) {
                    s.oid = Some(oid.to_string());
                }
                true
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(s)
}
pub fn snapshot_ref(id: &str) -> String {
    format!("refs/orgii/branch-switch/{id}")
}
