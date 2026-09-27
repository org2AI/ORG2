//! Canonical file-resource path resolution for provenance records.
//!
//! This adapter is deliberately host-side: it resolves filesystem aliases and
//! Git worktree roots, then returns only normalized metadata to Orgtrack.

use std::fs;
use std::path::{Component, Path, PathBuf};

use orgtrack_core::repo_sync::paths::record_id;

// Repository identity is persisted on each provenance record. Resolve the
// current filesystem at that boundary: git init, a nested repository, removal,
// and linked-worktree pointer changes can all happen while ORGII is running.
// Discovery only probes ancestor .git paths (no directory scan or subprocess),
// so a process-lifetime cache no longer justifies returning a stale identity.
struct RepoResolution {
    workspace: PathBuf,
    repository_record_id: Option<String>,
}

fn resolve_repo_for_cwd(cwd_path: &Path) -> RepoResolution {
    match discover_git_repo(cwd_path) {
        Some(repo) => RepoResolution {
            workspace: repo.worktree_root,
            repository_record_id: Some(record_id(&[
                "git_repository",
                &repo.common_dir.to_string_lossy(),
            ])),
        },
        None => RepoResolution {
            workspace: cwd_path.to_path_buf(),
            repository_record_id: None,
        },
    }
}

struct DiscoveredGitRepo {
    worktree_root: PathBuf,
    /// The repository's common `.git` directory — shared across all linked
    /// worktrees, so it is a stable identity for the repository itself.
    common_dir: PathBuf,
}

/// Filesystem equivalent of `git rev-parse --show-toplevel` +
/// `--git-common-dir`, without spawning a subprocess: walk up from `start`
/// until a `.git` entry is found, then resolve the worktree/submodule
/// `gitdir:` pointer file and the linked-worktree `commondir` file (both
/// plain text) to the shared `.git` directory. Bare repositories (a cwd
/// inside a repo with no worktree) are not detected — same outcome as the
/// old subprocess path failing: caller falls back to cwd-as-workspace.
fn discover_git_repo(start: &Path) -> Option<DiscoveredGitRepo> {
    let mut dir = start;
    loop {
        let dot_git = dir.join(".git");
        let git_dir = if dot_git.is_dir() {
            Some(dot_git.clone())
        } else if dot_git.is_file() {
            // Linked worktree or submodule: `.git` is a one-line pointer
            // file of the form `gitdir: <path>` (possibly relative).
            fs::read_to_string(&dot_git)
                .ok()
                .and_then(|content| {
                    content.lines().find_map(|line| {
                        line.strip_prefix("gitdir:")
                            .map(str::trim)
                            .map(String::from)
                    })
                })
                .map(|pointer| absolute_lexical_path(Path::new(&pointer), Some(dir)))
        } else {
            None
        };

        if let Some(git_dir) = git_dir {
            let git_dir = canonicalize_existing_prefix(&git_dir);
            // Linked worktrees carry a `commondir` file pointing (usually
            // relatively) at the repository's shared `.git` directory.
            let common_dir = fs::read_to_string(git_dir.join("commondir"))
                .ok()
                .map(|content| {
                    canonicalize_existing_prefix(&absolute_lexical_path(
                        Path::new(content.trim()),
                        Some(&git_dir),
                    ))
                })
                .unwrap_or(git_dir);
            return Some(DiscoveredGitRepo {
                worktree_root: dir.to_path_buf(),
                common_dir,
            });
        }

        dir = dir.parent()?;
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResolvedFileResource {
    pub(crate) repository_id: Option<String>,
    pub(crate) workspace_path: String,
    pub(crate) repo_relative_path: String,
    pub(crate) display_path: String,
}

pub(crate) fn resolve_file_resource(cwd: &str, file_path: &str) -> ResolvedFileResource {
    // Resolve aliases such as macOS `/tmp` -> `/private/tmp` on both sides
    // before comparing them. For create/delete events the leaf may not exist,
    // so canonicalize the longest existing prefix and reattach the tail.
    let cwd_path = canonicalize_existing_prefix(&absolute_lexical_path(Path::new(cwd), None));
    let file_path = canonicalize_existing_prefix(&absolute_lexical_path(
        Path::new(file_path),
        Some(&cwd_path),
    ));
    let RepoResolution {
        workspace,
        repository_record_id,
    } = resolve_repo_for_cwd(&cwd_path);
    let within_workspace = file_path.strip_prefix(&workspace).ok();
    let repository_id = within_workspace.and(repository_record_id);
    let relative = within_workspace
        .unwrap_or(&file_path)
        .to_string_lossy()
        .trim_start_matches(['/', '\\'])
        .replace('\\', "/");
    ResolvedFileResource {
        repository_id,
        workspace_path: workspace.to_string_lossy().into_owned(),
        display_path: relative.clone(),
        repo_relative_path: relative,
    }
}

fn absolute_lexical_path(path: &Path, base: Option<&Path>) -> PathBuf {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        base.map(Path::to_path_buf)
            .or_else(|| std::env::current_dir().ok())
            .unwrap_or_else(|| PathBuf::from("."))
            .join(path)
    };
    let mut normalized = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

pub(crate) fn canonicalize_existing_prefix(path: &Path) -> PathBuf {
    let lexical = absolute_lexical_path(path, None);
    let mut cursor = lexical.clone();
    let mut missing_tail = Vec::new();
    loop {
        match fs::canonicalize(&cursor) {
            Ok(mut canonical) => {
                for component in missing_tail.iter().rev() {
                    canonical.push(component);
                }
                return absolute_lexical_path(&canonical, None);
            }
            Err(_) => {
                let Some(component) = cursor.file_name().map(|name| name.to_os_string()) else {
                    return lexical;
                };
                missing_tail.push(component);
                if !cursor.pop() {
                    return lexical;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn observes_git_creation_and_removal_without_a_restart() {
        let temp = tempfile::tempdir().unwrap();
        let cwd = temp.path().to_str().unwrap();
        assert!(resolve_file_resource(cwd, "file.txt")
            .repository_id
            .is_none());
        fs::create_dir(temp.path().join(".git")).unwrap();
        let first = resolve_file_resource(cwd, "file.txt");
        assert!(first.repository_id.is_some());
        assert_eq!(first, resolve_file_resource(cwd, "file.txt"));
        fs::remove_dir(temp.path().join(".git")).unwrap();
        assert!(resolve_file_resource(cwd, "file.txt")
            .repository_id
            .is_none());
    }

    #[test]
    fn a_new_nested_repository_replaces_the_parent_identity() {
        let temp = tempfile::tempdir().unwrap();
        fs::create_dir(temp.path().join(".git")).unwrap();
        let child = temp.path().join("nested");
        fs::create_dir(&child).unwrap();
        let before = resolve_file_resource(child.to_str().unwrap(), "file.txt");
        assert_eq!(before.repo_relative_path, "nested/file.txt");
        fs::create_dir(child.join(".git")).unwrap();
        let after = resolve_file_resource(child.to_str().unwrap(), "file.txt");
        assert_ne!(before.repository_id, after.repository_id);
        assert_eq!(after.repo_relative_path, "file.txt");
    }

    #[test]
    fn observes_worktree_pointer_and_common_directory_changes() {
        let temp = tempfile::tempdir().unwrap();
        let worktree = temp.path().join("worktree");
        for dir in [
            "worktree",
            "metadata-a",
            "metadata-b",
            "common-a",
            "common-b",
        ] {
            fs::create_dir(temp.path().join(dir)).unwrap();
        }
        fs::write(worktree.join(".git"), "gitdir: ../metadata-a\n").unwrap();
        fs::write(temp.path().join("metadata-a/commondir"), "../common-a\n").unwrap();
        let first = resolve_file_resource(worktree.to_str().unwrap(), "file.txt");
        fs::write(temp.path().join("metadata-a/commondir"), "../common-b\n").unwrap();
        let second = resolve_file_resource(worktree.to_str().unwrap(), "file.txt");
        assert_ne!(first.repository_id, second.repository_id);
        fs::write(worktree.join(".git"), "gitdir: ../metadata-b\n").unwrap();
        fs::write(temp.path().join("metadata-b/commondir"), "../common-a\n").unwrap();
        let third = resolve_file_resource(worktree.to_str().unwrap(), "file.txt");
        assert_eq!(first.repository_id, third.repository_id);
        assert_ne!(second.repository_id, third.repository_id);
    }

    #[test]
    fn outside_workspace_paths_do_not_inherit_a_repository() {
        let temp = tempfile::tempdir().unwrap();
        fs::create_dir(temp.path().join(".git")).unwrap();
        let other = tempfile::tempdir().unwrap();
        let result = resolve_file_resource(
            temp.path().to_str().unwrap(),
            other.path().join("file.txt").to_str().unwrap(),
        );
        assert!(result.repository_id.is_none());
    }
    #[test]
    fn persistence_records_current_repository_without_rewriting_prior_observations() {
        use orgtrack_core::canonical::{
            AttributionPrecision, ResourceAction, ResourceInteractionCaptureMethod,
            ResourceInteractionOutcome,
        };
        use orgtrack_core::store::sqlite::SqliteRecordStore;
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        SqliteRecordStore::init_tables(&conn).unwrap();
        let store = SqliteRecordStore::new(&conn);
        let temp = tempfile::tempdir().unwrap();
        let persist = |event: &str| {
            super::super::interaction_store::persist_file_interaction(
                &store,
                "claude_code",
                None,
                "session",
                Some(event),
                None,
                None,
                temp.path().to_str().unwrap(),
                "file.txt",
                ResourceAction::Read,
                ResourceInteractionOutcome::Succeeded,
                "2026-09-14T00:00:00Z",
                ResourceInteractionCaptureMethod::Hook,
                AttributionPrecision::Exact,
            )
            .unwrap();
        };
        let repository_for = |event: &str| -> Option<String> {
            conn.query_row(
                "SELECT r.repository_id FROM orgtrack_core_file_resources r
                 JOIN orgtrack_core_resource_interactions i ON i.resource_id = r.resource_id
                 WHERE i.source_event_id = ?1",
                [event],
                |row| row.get(0),
            )
            .unwrap()
        };
        persist("before-init");
        assert_eq!(repository_for("before-init"), None);
        fs::create_dir(temp.path().join(".git")).unwrap();
        persist("after-init");
        assert!(repository_for("after-init").is_some());
        assert_eq!(repository_for("before-init"), None);
        fs::remove_dir(temp.path().join(".git")).unwrap();
        persist("after-remove");
        assert_eq!(repository_for("after-remove"), None);
        assert!(repository_for("after-init").is_some());
    }
}
