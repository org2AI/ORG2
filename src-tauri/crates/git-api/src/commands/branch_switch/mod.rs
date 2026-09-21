//! Recoverable, user-directed branch switching. All writes stay behind this boundary.
mod state;
pub mod types;
use git2::{BranchType, ObjectType, Oid, Reference, Repository};
use state::*;
use std::path::Path;
pub use types::*;

#[cfg(test)]
mod tests;

struct Target {
    local: String,
    oid: String,
    tracking: Option<String>,
}
/// Raw Git failures while resolving; the UI shows the Git text itself.
fn git_blocked(error: impl ToString) -> Blocked {
    let detail = error.to_string();
    Blocked {
        detail: Some(detail.clone()),
        ..blocked("git_error", &detail)
    }
}

fn resolve(repo: &Repository, target: &SwitchTarget) -> Result<Target, Blocked> {
    // HEAD is the explicit "Checkout detached" action, never a branch name.
    if target.branch == "HEAD" && !target.create {
        let oid = head(repo).map_err(git_blocked)?;
        return Ok(Target {
            local: format!("Detached at {}", &oid[..8]),
            oid,
            tracking: None,
        });
    }
    if target.branch.starts_with('-')
        || !Reference::is_valid_name(&format!("refs/heads/{}", target.branch))
    {
        return Err(blocked("invalid_branch_name", "Choose a valid branch name"));
    }
    if target.create {
        if repo.find_branch(&target.branch, BranchType::Local).is_ok() {
            return Err(blocked("branch_exists", "That branch already exists"));
        }
        let base = target.start_point.as_deref().unwrap_or("HEAD");
        let oid = repo
            .revparse_single(base)
            .and_then(|o| o.peel_to_commit())
            .map_err(git_blocked)?
            .id()
            .to_string();
        return Ok(Target {
            local: target.branch.clone(),
            oid,
            tracking: None,
        });
    }
    if let Ok(b) = repo.find_branch(&target.branch, BranchType::Local) {
        return Ok(Target {
            local: target.branch.clone(),
            oid: b
                .get()
                .peel_to_commit()
                .map_err(git_blocked)?
                .id()
                .to_string(),
            tracking: None,
        });
    }
    let remote = if repo.find_branch(&target.branch, BranchType::Remote).is_ok() {
        target.branch.clone()
    } else {
        let matches = repo
            .branches(Some(BranchType::Remote))
            .map_err(git_blocked)?
            .filter_map(|b| b.ok())
            .filter_map(|(b, _)| b.name().ok().flatten().map(str::to_owned))
            .filter(|n| {
                n.split_once('/')
                    .is_some_and(|(_, name)| name == target.branch)
            })
            .collect::<Vec<_>>();
        if matches.len() != 1 {
            return Err(blocked("branch_not_found", "Branch not found or ambiguous. Refresh branches and select an explicit remote branch"));
        }
        matches[0].clone()
    };
    let local = remote
        .split_once('/')
        .ok_or_else(|| blocked("branch_not_found", "Invalid remote branch"))?
        .1
        .to_owned();
    if let Ok(b) = repo.find_branch(&local, BranchType::Local) {
        if b.upstream()
            .ok()
            .and_then(|u| u.name().ok().flatten().map(str::to_owned))
            .as_deref()
            != Some(&remote)
        {
            return Err(blocked("upstream_mismatch", "A local branch with that name tracks a different upstream. Choose the local branch explicitly"));
        }
        return Ok(Target {
            local,
            oid: b
                .get()
                .peel_to_commit()
                .map_err(git_blocked)?
                .id()
                .to_string(),
            tracking: None,
        });
    }
    let oid = repo
        .find_branch(&remote, BranchType::Remote)
        .and_then(|b| b.get().peel_to_commit())
        .map_err(git_blocked)?
        .id()
        .to_string();
    Ok(Target {
        local,
        oid,
        tracking: Some(remote),
    })
}

pub fn prepare(path: &Path, target: &SwitchTarget) -> Result<Preparation, String> {
    let repo = open(path)?;
    let (files, mut token, mut block) = status(&repo)?;
    let current = branch(&repo);
    if repo.head_detached().unwrap_or(false) && !target.create {
        block = Some(blocked("detached_head", "Create a branch from the current commit before switching, so detached work remains reachable"));
    }
    if repo.head().is_err() {
        block = Some(blocked(
            "unborn",
            "Create the first commit before using saved branch changes",
        ));
    }
    let resolved = resolve(&repo, target);
    let target_name = resolved
        .as_ref()
        .map(|t| t.local.clone())
        .unwrap_or_else(|_| target.branch.clone());
    if let Ok(ref resolved) = resolved {
        token.push_str(&format!(
            "\0{}\0{}\0{:?}\0{}",
            resolved.local, resolved.oid, resolved.tracking, target.create
        ));
        // Git normally overwrites ignored files during checkout. Detect that before saving work.
        let tree = repo
            .find_commit(Oid::from_str(&resolved.oid).map_err(|e| e.to_string())?)
            .and_then(|c| c.tree())
            .map_err(|e| e.to_string())?;
        let root = repo.workdir().ok_or("No worktree")?;
        let index = repo.index().map_err(|e| e.to_string())?;
        tree.walk(git2::TreeWalkMode::PreOrder, |prefix, entry| {
            if entry.kind() == Some(ObjectType::Blob) {
                let name = format!("{}{}", prefix, entry.name().unwrap_or_default());
                if root.join(&name).exists() && repo.status_should_ignore(Path::new(&name)).unwrap_or(false)
                    && index.get_path(Path::new(&name), 0).is_none() {
                    block = Some(blocked("ignored_collision", "An ignored file would be overwritten. Move it out of the way before switching"));
                }
            }
            git2::TreeWalkResult::Ok
        }).map_err(|e| e.to_string())?;
        let listing = git(path, &["worktree", "list", "--porcelain"])?;
        for item in listing.split("\n\n") {
            if item
                .lines()
                .any(|l| l == format!("branch refs/heads/{}", resolved.local))
            {
                if let Some(other) = item.lines().find_map(|l| l.strip_prefix("worktree ")) {
                    if std::fs::canonicalize(other).ok() != std::fs::canonicalize(root).ok() {
                        block = Some(Blocked {
                            worktree_path: Some(other.into()),
                            ..blocked(
                                "worktree_branch_in_use",
                                "This branch is already open in another worktree",
                            )
                        });
                    }
                }
            }
        }
    } else if block.is_none() {
        block = resolved.as_ref().err().cloned();
    }
    let default_strategy = if target.create
        && resolved
            .as_ref()
            .is_ok_and(|t| Some(&t.oid) == head(&repo).ok().as_ref())
    {
        Strategy::Bring
    } else {
        Strategy::Leave
    };
    Ok(Preparation {
        same_branch: !target.create && current == target_name,
        current_branch: current,
        target_branch: target_name,
        fingerprint: Oid::hash_object(ObjectType::Blob, token.as_bytes())
            .map_err(|e| e.to_string())?
            .to_string(),
        changed_files: files,
        default_strategy,
        blocked: block,
    })
}

fn result(
    repo: &Repository,
    outcome: Outcome,
    code: &str,
    message: String,
    detail: Option<String>,
    snapshot: Option<&Snapshot>,
) -> SwitchResult {
    SwitchResult {
        outcome,
        current_branch: branch(repo),
        code: code.into(),
        message,
        detail,
        snapshot_id: snapshot.map(|s| s.id.clone()),
        conflicts: repo
            .index()
            .ok()
            .and_then(|mut i| {
                i.read(true).ok()?;
                i.conflicts().ok().map(|cs| {
                    cs.filter_map(|c| c.ok())
                        .filter_map(|c| c.our.or(c.their).or(c.ancestor))
                        .map(|e| String::from_utf8_lossy(&e.path).into_owned())
                        .collect()
                })
            })
            .unwrap_or_default(),
    }
}

pub fn execute(path: &Path, request: ExecuteRequest) -> Result<SwitchResult, String> {
    let repo = open(path)?;
    let _lock = lock(&repo)?;
    let preparation = prepare(path, &request.target)?;
    if preparation.same_branch {
        return Ok(result(
            &repo,
            Outcome::Switched,
            "",
            String::new(),
            None,
            None,
        ));
    }
    if let Some(block) = preparation.blocked {
        return Ok(result(
            &repo,
            Outcome::Blocked,
            &block.code,
            block.message,
            block.detail,
            None,
        ));
    }
    if preparation.fingerprint != request.fingerprint {
        return Ok(result(&repo, Outcome::Blocked, "stale", "The files or branches changed while the dialog was open. Review the latest changes and try again".into(), None, None));
    }
    let target = resolve(&repo, &request.target).map_err(|b| b.message)?;
    let mut snapshot = None;
    if !preparation.changed_files.is_empty() {
        let mut s = Snapshot {
            id: uuid::Uuid::new_v4().to_string(),
            source_branch: preparation.current_branch,
            source_head: head(&repo)?,
            worktree_path: repo
                .workdir()
                .ok_or("No worktree")?
                .to_string_lossy()
                .into_owned(),
            target_branch: target.local.clone(),
            created_at: chrono::Utc::now().to_rfc3339(),
            files: preparation.changed_files,
            oid: None,
            phase: SnapshotPhase::Saving,
        };
        save(&repo, &s)?;
        let message = format!("orgii-switch:{} Saved on {}", s.id, s.source_branch);
        if let Err(error) = git(
            path,
            &["stash", "push", "--include-untracked", "-m", &message],
        ) {
            return Ok(result(&repo, Outcome::RecoveryRequired, "save_failed", format!("Could not finish saving changes: {error}. Review the working tree and saved changes before retrying"), Some(error), Some(&s)));
        }
        s = load(&repo, &s.id)?;
        let oid = s
            .oid
            .as_deref()
            .ok_or("Git did not create a recovery snapshot; checkout was not attempted")?;
        repo.reference(
            &snapshot_ref(&s.id),
            Oid::from_str(oid).map_err(|e| e.to_string())?,
            false,
            "ORGII branch switch recovery",
        )
        .map_err(|e| e.to_string())?;
        s.phase = SnapshotPhase::Saved;
        save(&repo, &s)?;
        snapshot = Some(s);
        if !status(&repo)?.0.is_empty() {
            return Ok(result(&repo, Outcome::RecoveryRequired, "changed_while_saving", "Files changed while saving. Checkout was not attempted; your snapshot is available".into(), None, snapshot.as_ref()));
        }
    }
    if let Some(s) = snapshot.as_mut() {
        s.phase = SnapshotPhase::Switching;
        save(&repo, s)?;
    }
    let mut args = vec!["checkout", "--no-overwrite-ignore"];
    if request.target.branch == "HEAD" && !request.target.create {
        args.extend(["--detach", &target.oid]);
    } else if request.target.create {
        args.extend(["-b", &target.local, &target.oid]);
    } else if let Some(remote) = target.tracking.as_deref() {
        args.extend(["-b", &target.local, "--track", remote]);
    } else {
        args.push(&target.local);
    }
    if let Err(error) = git(path, &args) {
        if let Some(s) = snapshot.as_mut() {
            if head(&repo).ok().as_deref() == Some(&s.source_head)
                && branch(&repo) == s.source_branch
                && status(&repo)?.0.is_empty()
            {
                s.phase = SnapshotPhase::Restoring;
                save(&repo, s)?;
                if git(
                    path,
                    &[
                        "stash",
                        "apply",
                        "--index",
                        s.oid.as_deref().ok_or("Missing snapshot")?,
                    ],
                )
                .is_ok()
                {
                    s.phase = SnapshotPhase::Restored;
                    save(&repo, s)?;
                    return Ok(result(
                        &repo,
                        Outcome::Blocked,
                        "checkout_failed_restored",
                        format!("Checkout failed; your changes were restored: {error}"),
                        Some(error),
                        Some(s),
                    ));
                }
            }
            return Ok(result(
                &repo,
                Outcome::RecoveryRequired,
                "checkout_failed_saved",
                format!("Checkout failed. Your changes are saved: {error}"),
                Some(error),
                Some(s),
            ));
        }
        return Ok(result(
            &repo,
            Outcome::Blocked,
            "git_error",
            error.clone(),
            Some(error),
            None,
        ));
    }
    if let Some(s) = snapshot.as_mut() {
        if request.strategy == Strategy::Bring {
            if branch(&repo) != target.local
                || head(&repo).ok().as_deref() != Some(&target.oid)
                || !status(&repo)?.0.is_empty()
            {
                return Ok(result(&repo, Outcome::RecoveryRequired, "worktree_changed", "The worktree changed during checkout. Your original changes are saved; review the current files before restoring".into(), None, Some(s)));
            }
            s.phase = SnapshotPhase::Applying;
            save(&repo, s)?;
            if let Err(error) = git(
                path,
                &[
                    "stash",
                    "apply",
                    "--index",
                    s.oid.as_deref().ok_or("Missing snapshot")?,
                ],
            ) {
                s.phase = SnapshotPhase::NeedsResolution;
                save(&repo, s)?;
                return Ok(result(&repo, Outcome::SwitchedWithConflicts, "restore_conflicts", format!("Switched to {}. Some changes could not be restored: {error}. Your original changes are saved", branch(&repo)), Some(error), Some(s)));
            }
            s.phase = SnapshotPhase::Brought;
        } else {
            s.phase = SnapshotPhase::Saved;
        }
        save(&repo, s)?;
    }
    let (code, message) = match (&snapshot, &request.strategy) {
        (None, _) => ("", ""),
        (Some(_), Strategy::Leave) => ("saved_on_previous", "Changes saved on the previous branch"),
        (Some(_), Strategy::Bring) => ("brought", "Your changes followed you to this branch"),
    };
    Ok(result(
        &repo,
        Outcome::Switched,
        code,
        message.into(),
        None,
        snapshot.as_ref(),
    ))
}
