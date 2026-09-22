//! Explicit offline handoff of existing Claude Desktop conversations. No watcher,
//! vendor index writes, new-session import, credential or configuration copying.
mod automatic;
mod records;
mod storage;
#[cfg(test)]
mod tests;

use super::*;
use agent_cli::managed_config::native_app::NativeAppProfile;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Status {
    Unchecked,
    Ready,
    RecoveryReady,
    Clean,
    SyncedToPrimary,
    SyncedToPackage,
    Conflict,
    Incomplete,
    Unsupported,
    Busy,
    WriterUnknown,
    Changed,
    ScopeChanged,
    Limit,
    Failed,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    List,
    Inspect,
    Sync,
}

#[cfg(all(target_os = "macos", feature = "market-connect"))]
pub(crate) use automatic::{run_automatic, watch_roots};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Item {
    pub session_id: String,
    pub title: String,
    pub status: Status,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Report {
    pub status: Status,
    pub items: Vec<Item>,
}

const MAX_PAIRS: usize = 128;
const MAX_PASS_BYTES: u64 = 128 * 1024 * 1024;
const MAX_PASS_TIME: std::time::Duration = std::time::Duration::from_secs(15);

/// A single request owns its finite I/O and elapsed-time allowance. There is no
/// retained task, retry timer or background watcher after this request returns.
struct Budget {
    remaining: std::cell::Cell<u64>,
    deadline: std::time::Instant,
}
impl Budget {
    fn new() -> Self {
        Self {
            remaining: std::cell::Cell::new(MAX_PASS_BYTES),
            deadline: std::time::Instant::now() + MAX_PASS_TIME,
        }
    }
    fn check(&self) -> Result<(), Status> {
        if std::time::Instant::now() >= self.deadline {
            Err(Status::Limit)
        } else {
            Ok(())
        }
    }
    fn charge(&self, bytes: u64) -> Result<(), Status> {
        self.check()?;
        let remaining = self
            .remaining
            .get()
            .checked_sub(bytes)
            .ok_or(Status::Limit)?;
        self.remaining.set(remaining);
        Ok(())
    }
}

/// The caller checks the current owner and that all Claude writers have quit.
/// These checks are repeated at each commit. They are a controlled-handoff
/// contract, not a claim that third-party processes honor ORG2's advisory lock.
#[cfg(test)]
pub(crate) fn run(
    profile: &NativeAppProfile,
    owner: &str,
    selected: Option<&str>,
    mode: Mode,
    check_owner: impl Fn() -> Result<(), Status>,
    check_writers: impl Fn() -> Result<(), Status>,
) -> Report {
    if (mode == Mode::List) != selected.is_none() {
        return Report {
            status: Status::Unsupported,
            items: Vec::new(),
        };
    }
    let roots = Roots {
        official: claude_desktop_sessions_root(),
        isolated: profile.home().join("claude-code-sessions"),
        primary: app_paths::native_transcript_home_dir().join(".claude"),
        package: profile.system_home().join(".claude"),
        state: profile.root().join("history-handoff"),
    };
    run_at(
        profile,
        owner,
        selected,
        mode,
        check_owner,
        check_writers,
        &roots,
    )
}

struct Roots {
    official: PathBuf,
    isolated: PathBuf,
    primary: PathBuf,
    package: PathBuf,
    state: PathBuf,
}
#[cfg(test)]
fn run_at(
    profile: &NativeAppProfile,
    owner: &str,
    selected: Option<&str>,
    mode: Mode,
    check_owner: impl Fn() -> Result<(), Status>,
    check_writers: impl Fn() -> Result<(), Status>,
    roots: &Roots,
) -> Report {
    run_filtered_at(
        profile,
        owner,
        selected,
        mode,
        check_owner,
        check_writers,
        roots,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
fn run_filtered_at(
    profile: &NativeAppProfile,
    owner: &str,
    selected: Option<&str>,
    mode: Mode,
    check_owner: impl Fn() -> Result<(), Status>,
    check_writers: impl Fn() -> Result<(), Status>,
    roots: &Roots,
    dirty_ids: Option<&HashSet<String>>,
) -> Report {
    let mut report = Report {
        status: Status::Clean,
        items: Vec::new(),
    };
    let result = (|| -> Result<(), Status> {
        check_owner()?;
        if selected.is_some_and(|id| Uuid::parse_str(id).is_err()) {
            return Err(Status::Unsupported);
        }
        profile
            .validate("claude_desktop")
            .map_err(|_| Status::Changed)?;
        let official = &roots.official;
        let account = active_account(official)?;
        let isolated = &roots.isolated;
        let local_account = active_account(isolated)?;
        let project = local_project(&isolated.join(&local_account))?;
        let root = &roots.state;
        storage::safe(root.parent().ok_or(Status::Changed)?, root)?;
        let budget = Budget::new();
        // Load the isolated roster exactly once; do not perform N × M file reads.
        let mut local_budget = CLAUDE_DESKTOP_METADATA_SCAN_LIMIT;
        let mut pairs = HashMap::new();
        for path in bounded_directory_paths(&project, &mut local_budget) {
            budget.check()?;
            let Some(row) = storage::catalog_row(&path, &budget)? else {
                continue;
            };
            if row["isArchived"] == true {
                continue;
            }
            if let (Some(id), Some(desktop), Some(cwd)) = (
                row["cliSessionId"].as_str(),
                row["sessionId"].as_str(),
                row["cwd"].as_str(),
            ) {
                pairs.insert((id.to_owned(), desktop.to_owned(), cwd.to_owned()), path);
            }
        }
        let mut matched = Vec::new();
        let mut seen = HashSet::new();
        let mut project_budget = CLAUDE_DESKTOP_PROJECT_SCAN_LIMIT;
        let mut metadata_budget = CLAUDE_DESKTOP_METADATA_SCAN_LIMIT;
        for dir in bounded_directory_paths(&official.join(&account), &mut project_budget) {
            for path in bounded_directory_paths(&dir, &mut metadata_budget) {
                budget.check()?;
                if seen.len() >= MAX_PAIRS {
                    return Err(Status::Limit);
                }
                let Some(row) = storage::catalog_row(&path, &budget)? else {
                    continue;
                };
                if row["isArchived"] == true {
                    continue;
                }
                let (Some(id), Some(cwd), Some(desktop_id)) = (
                    row["cliSessionId"].as_str(),
                    row["cwd"].as_str(),
                    row["sessionId"].as_str(),
                ) else {
                    continue;
                };
                if Uuid::parse_str(id).is_err()
                    || desktop_id
                        .strip_prefix("local_")
                        .is_none_or(|v| Uuid::parse_str(v).is_err())
                {
                    continue;
                }
                // Read-only pairing: never register a new primary row, choose a
                // different account, or resurrect an archived conversation.
                let Some(local_path) =
                    pairs.get(&(id.to_owned(), desktop_id.to_owned(), cwd.to_owned()))
                else {
                    continue;
                };
                if dirty_ids.is_some_and(|ids| !ids.contains(id)) {
                    continue;
                }
                if selected.is_some_and(|selected| selected != id) {
                    continue;
                }
                if !seen.insert(id.to_owned()) {
                    return Err(Status::Conflict);
                }
                matched.push((path, row, local_path.clone()));
            }
        }
        // Validate the whole bounded catalog selection before any transcript
        // write; a later duplicate must never be discovered after publication.
        for (path, row, local_path) in matched {
            let id = row["cliSessionId"].as_str().ok_or(Status::Unsupported)?;
            let cwd = row["cwd"].as_str().ok_or(Status::Unsupported)?;
            let desktop_id = row["sessionId"].as_str().ok_or(Status::Unsupported)?;
            let cwd_path = Path::new(cwd);
            if !cwd_path.is_absolute()
                || cwd_path
                    .components()
                    .any(|part| matches!(part, std::path::Component::ParentDir))
            {
                continue;
            }
            let primary_root = &roots.primary;
            let package_root = &roots.package;
            let relative = PathBuf::from("projects")
                .join(sanitize_claude_project_name(Path::new(cwd)))
                .join(format!("{id}.jsonl"));
            let primary = primary_root.join(&relative);
            let package = package_root.join(&relative);
            let status = if mode == Mode::List {
                Status::Unchecked
            } else {
                let scope = pair_scope(
                    profile,
                    owner,
                    &account,
                    &local_account,
                    &row,
                    &path,
                    &local_path,
                )?;
                let recheck = || {
                    check_owner()?;
                    profile
                        .validate("claude_desktop")
                        .map_err(|_| Status::ScopeChanged)?;
                    if active_account(official)? != account
                        || active_account(isolated)? != local_account
                        || local_project(&isolated.join(&local_account))? != project
                    {
                        return Err(Status::ScopeChanged);
                    }
                    for selected_row in [&path, &local_path] {
                        let current = storage::catalog_row(selected_row, &budget)?
                            .ok_or(Status::ScopeChanged)?;
                        if current["isArchived"] == true
                            || current["cliSessionId"] != id
                            || current["cwd"] != cwd
                            || current["sessionId"] != desktop_id
                        {
                            return Err(Status::ScopeChanged);
                        }
                    }
                    if mode == Mode::Sync {
                        check_writers()
                    } else {
                        Ok(())
                    }
                };
                storage::reconcile_scoped(
                    primary_root,
                    &primary,
                    package_root,
                    &package,
                    root,
                    id,
                    &budget,
                    &recheck,
                    storage::Scope {
                        binding: &scope,
                        cwd: cwd_path,
                    },
                    mode != Mode::Sync,
                )
                .unwrap_or_else(|status| status)
            };
            report.items.push(Item {
                session_id: id.to_owned(),
                title: row["title"]
                    .as_str()
                    .unwrap_or("Claude conversation")
                    .chars()
                    .take(200)
                    .collect(),
                status,
            });
            if status == Status::Unchecked && report.status == Status::Clean {
                report.status = Status::Unchecked;
            }
            if status == Status::Ready && report.status == Status::Clean {
                report.status = Status::Ready;
            }
            if !matches!(
                status,
                Status::Unchecked
                    | Status::Ready
                    | Status::Clean
                    | Status::SyncedToPrimary
                    | Status::SyncedToPackage
            ) {
                report.status = status;
            }
            if matches!(
                status,
                Status::Busy | Status::WriterUnknown | Status::ScopeChanged
            ) {
                return Err(status);
            }
        }
        check_owner()?;
        if selected.is_some() && report.items.is_empty() {
            return Err(Status::ScopeChanged);
        }
        Ok(())
    })();
    let result = match check_owner() {
        Ok(()) => result,
        Err(_) => Err(Status::ScopeChanged),
    };
    if let Err(status) = result {
        report.status = status;
        if status == Status::ScopeChanged {
            report.items.clear();
        }
    }
    report
}

fn active_account(root: &Path) -> Result<String, Status> {
    let path = root
        .parent()
        .ok_or(Status::ScopeChanged)?
        .join("config.json");
    let row = storage::catalog_row(&path, &Budget::new())?.ok_or(Status::Unsupported)?;
    let id = row["lastKnownAccountUuid"]
        .as_str()
        .ok_or(Status::Unsupported)?;
    Uuid::parse_str(id).map_err(|_| Status::Unsupported)?;
    Ok(id.to_owned())
}

fn local_project(account: &Path) -> Result<PathBuf, Status> {
    let mut count = CLAUDE_DESKTOP_PROJECT_SCAN_LIMIT;
    let budget = Budget::new();
    let mut selected = None;
    for marker in bounded_directory_paths(account, &mut count) {
        if !marker
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.ends_with(".profile-origin.json"))
        {
            continue;
        }
        let Some(row) = storage::catalog_row(&marker, &budget)? else {
            continue;
        };
        if row["mode"] != "local" {
            continue;
        }
        let id = row["org"].as_str().ok_or(Status::Unsupported)?;
        Uuid::parse_str(id).map_err(|_| Status::Unsupported)?;
        let project = account.join(id);
        storage::safe(account, &project)?;
        if project.is_dir() && selected.replace(project).is_some() {
            return Err(Status::Unsupported);
        }
    }
    if count == 0 {
        return Err(Status::Limit);
    }
    selected.ok_or(Status::Unsupported)
}

fn pair_scope(
    profile: &NativeAppProfile,
    owner: &str,
    account: &str,
    local_account: &str,
    row: &Value,
    primary_catalog: &Path,
    local_catalog: &Path,
) -> Result<String, Status> {
    serde_json::to_string(&(
        profile,
        owner,
        account,
        local_account,
        row["cliSessionId"].as_str().ok_or(Status::Unsupported)?,
        row["cwd"].as_str().ok_or(Status::Unsupported)?,
        row["sessionId"].as_str().ok_or(Status::Unsupported)?,
        primary_catalog.parent(),
        local_catalog.parent(),
    ))
    .map_err(|_| Status::Failed)
}
