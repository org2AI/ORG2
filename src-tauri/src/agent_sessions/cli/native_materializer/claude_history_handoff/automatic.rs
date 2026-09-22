//! Bounded, writer-free handoff. Never selects an arbitrary account or org.
use super::*;

#[cfg(all(target_os = "macos", feature = "market-connect"))]
pub(crate) fn watch_roots(profile: &NativeAppProfile) -> Vec<PathBuf> {
    let official = claude_desktop_sessions_root();
    let mut roots = vec![
        official.clone(),
        app_paths::native_transcript_home_dir().join(".claude/projects"),
        profile.home().join("claude-code-sessions"),
        profile.home().join("config.json"),
        profile.system_home().join(".claude/projects"),
    ];
    if let Some(parent) = official.parent() {
        roots.push(parent.join("config.json"));
    }
    roots
}

#[cfg(all(target_os = "macos", feature = "market-connect"))]
pub(crate) fn run_automatic(
    profile: &NativeAppProfile,
    owner: &str,
    dirty_ids: Option<&HashSet<String>>,
    check_owner: impl Fn() -> Result<(), Status>,
    check_writers: impl Fn() -> Result<(), Status>,
) -> Report {
    let roots = Roots {
        official: claude_desktop_sessions_root(),
        isolated: profile.home().join("claude-code-sessions"),
        primary: app_paths::native_transcript_home_dir().join(".claude"),
        package: profile.system_home().join(".claude"),
        state: profile.root().join("history-handoff"),
    };
    run_at_automatic(
        profile,
        owner,
        dirty_ids,
        check_owner,
        check_writers,
        &roots,
    )
}

// Budget exhaustion is not a complete inventory: never treat truncation as
// proof that a UUID is absent. Metadata is bounded; only dirty transcripts parse.
fn entries(path: &Path, remaining: &mut usize) -> Result<Vec<PathBuf>, Status> {
    storage::safe(path, path)?;
    let mut found = Vec::new();
    for entry in fs::read_dir(path).map_err(|_| Status::Changed)? {
        if *remaining == 0 {
            return Err(Status::Limit);
        }
        *remaining -= 1;
        found.push(entry.map_err(|_| Status::Changed)?.path());
    }
    found.sort();
    Ok(found)
}

fn row(path: &Path, budget: &Budget) -> Result<Value, Status> {
    storage::catalog_row(path, budget)?.ok_or(Status::Unsupported)
}

fn session_row(path: &Path, budget: &Budget) -> Result<Option<Value>, Status> {
    // This exact vendor manifest is not a conversation. Backlog directories
    // are not traversed. Other JSON that claims a session must validate.
    if path.file_name().and_then(|name| name.to_str()) == Some("scheduled-tasks.json") {
        return Ok(None);
    }
    let value = row(path, budget)?;
    identity(&value)?;
    Ok(Some(value))
}

fn identity(value: &Value) -> Result<(&str, &str, &str), Status> {
    let id = value["cliSessionId"].as_str().ok_or(Status::Unsupported)?;
    let desktop = value["sessionId"].as_str().ok_or(Status::Unsupported)?;
    let cwd = value["cwd"].as_str().ok_or(Status::Unsupported)?;
    Uuid::parse_str(id).map_err(|_| Status::Unsupported)?;
    Uuid::parse_str(desktop.strip_prefix("local_").ok_or(Status::Unsupported)?)
        .map_err(|_| Status::Unsupported)?;
    if !Path::new(cwd).is_absolute()
        || Path::new(cwd)
            .components()
            .any(|p| matches!(p, std::path::Component::ParentDir))
    {
        return Err(Status::Unsupported);
    }
    Ok((id, desktop, cwd))
}

// Closed schema: recognize local controls to discard, never copy them.
fn registration_row(source: &Value) -> Result<Value, Status> {
    const KNOWN: &[&str] = &[
        "sessionId",
        "cliSessionId",
        "cwd",
        "originCwd",
        "title",
        "titleSource",
        "createdAt",
        "lastFocusedAt",
        "lastActivityAt",
        "model",
        "isArchived",
        "completedTurns",
        "permissionMode",
        "remoteMcpServersConfig",
        "alwaysAllowedReasons",
        "sessionPermissionUpdates",
        "classifierSummaryEnabled",
        "orgiiMaterialization",
        "cuAllowedApps",
        // Observed Claude 3P metadata, recognized only to discard. These
        // runtime/tool/launch controls never cross into the primary profile.
        "cliBinaryPin",
        "enabledMcpTools",
        "lastSpawnRootDetected",
        "latestUserFrameAt",
        "promptAppendSnapshot",
        "remoteControlAutoEligible",
        "reportFindingsCard",
        "spawnSeed",
        "titleTurn",
        "toolSurfaceSnapshot",
    ];
    let (id, desktop, cwd) = identity(source)?;
    if source
        .as_object()
        .is_none_or(|object| object.keys().any(|key| !KNOWN.contains(&key.as_str())))
    {
        return Err(Status::Unsupported);
    }
    if source.get("isArchived").is_some_and(|v| v != false) {
        return Err(Status::Conflict);
    }
    if source
        .get("originCwd")
        .is_some_and(|v| v.as_str() != Some(cwd))
    {
        return Err(Status::Unsupported);
    }
    let mut output = json!({
        "sessionId":desktop, "cliSessionId":id, "cwd":cwd, "originCwd":cwd,
        "title":source["title"].as_str().unwrap_or("Claude conversation").chars().take(200).collect::<String>(),
        "titleSource":match source["titleSource"].as_str() {
            Some("user") => "user", Some("tool") => "tool", _ => "auto",
        }, "isArchived":false, "permissionMode":"default",
        "remoteMcpServersConfig":[], "alwaysAllowedReasons":[], "sessionPermissionUpdates":[],
        "classifierSummaryEnabled":true, "orgiiMaterialization":true,
        "completedTurns":0,
    });
    for key in [
        "createdAt",
        "lastFocusedAt",
        "lastActivityAt",
        "completedTurns",
    ] {
        if let Some(value) = source.get(key) {
            if !value.is_u64() {
                return Err(Status::Unsupported);
            }
            output[key] = value.clone();
        }
    }
    Ok(output)
}

pub(super) fn run_at_automatic(
    profile: &NativeAppProfile,
    owner: &str,
    dirty_ids: Option<&HashSet<String>>,
    check_owner: impl Fn() -> Result<(), Status>,
    check_writers: impl Fn() -> Result<(), Status>,
    roots: &Roots,
) -> Report {
    let mut report = Report {
        status: Status::Clean,
        items: Vec::new(),
    };
    let result = (|| -> Result<(), Status> {
        check_owner()?;
        if dirty_ids.is_some_and(HashSet::is_empty) {
            return Ok(());
        }
        if dirty_ids.is_some_and(|ids| {
            ids.len() > MAX_PAIRS || ids.iter().any(|id| Uuid::parse_str(id).is_err())
        }) {
            return Err(Status::Limit);
        }
        profile
            .validate("claude_desktop")
            .map_err(|_| Status::ScopeChanged)?;
        check_writers()?;
        let budget = Budget::new();
        let account = active_account(&roots.official)?;
        let local_account = active_account(&roots.isolated)?;
        let project = local_project(&roots.isolated.join(&local_account))?;
        // Shared across isolated profiles so two ORG2 instances cannot both
        // infer an absent official UUID while registering different paths.
        let _catalog_lock = storage::try_lock(&roots.official.join("automatic-registration"))?;
        let mut account_budget = CLAUDE_DESKTOP_ACCOUNT_SCAN_LIMIT;
        let mut project_budget = CLAUDE_DESKTOP_PROJECT_SCAN_LIMIT;
        let mut metadata_budget = CLAUDE_DESKTOP_METADATA_SCAN_LIMIT;
        let mut primary_rows = Vec::new();
        let mut project_locks = Vec::new();
        let mut active_projects = Vec::new();
        for account_dir in entries(&roots.official, &mut account_budget)? {
            if !account_dir.is_dir() {
                continue;
            }
            for dir in entries(&account_dir, &mut project_budget)? {
                if !dir.is_dir() {
                    continue;
                }
                if project_locks.len() >= MAX_PAIRS {
                    return Err(Status::Limit);
                }
                project_locks.push(storage::try_catalog_lock(&dir)?);
                if account_dir == roots.official.join(&account) {
                    let org = dir
                        .file_name()
                        .and_then(|s| s.to_str())
                        .ok_or(Status::Unsupported)?;
                    Uuid::parse_str(org).map_err(|_| Status::Unsupported)?;
                    active_projects.push(dir.clone());
                }
                for path in entries(&dir, &mut metadata_budget)? {
                    budget.check()?;
                    if path.extension().and_then(|s| s.to_str()) != Some("json") {
                        continue;
                    }
                    if let Some(value) = session_row(&path, &budget)? {
                        primary_rows.push((path.clone(), value));
                    }
                }
            }
        }
        let mut local_budget = CLAUDE_DESKTOP_METADATA_SCAN_LIMIT;
        let mut candidates = Vec::new();
        let mut eligible = HashSet::new();
        let mut failures = Vec::new();
        let mut ids = HashSet::new();
        let mut desktop_ids = HashSet::new();
        for path in entries(&project, &mut local_budget)? {
            budget.check()?;
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let Some(source) = session_row(&path, &budget)? else {
                continue;
            };
            let (id, desktop, _) = identity(&source)?;
            if !ids.insert(id.to_owned()) || !desktop_ids.insert(desktop.to_owned()) {
                return Err(Status::Conflict);
            }
            if source["isArchived"] == true || dirty_ids.is_some_and(|ids| !ids.contains(id)) {
                continue;
            }
            if candidates.len() >= MAX_PAIRS {
                return Err(Status::Limit);
            }
            let matches = primary_rows
                .iter()
                .filter(|(_, r)| r["cliSessionId"] == id || r["sessionId"] == desktop)
                .collect::<Vec<_>>();
            if matches.len() > 1 {
                return Err(Status::Conflict);
            }
            let candidate = (|| -> Result<_, Status> {
                if let Some((target, existing)) = matches.first() {
                    if existing["isArchived"] == true
                        || identity(existing)? != identity(&source)?
                        || !target.starts_with(roots.official.join(&account))
                    {
                        return Err(Status::Conflict);
                    }
                    return Ok(None);
                }
                // No authoritative active-org setting exists in the known
                // schema; only a single existing org is safe for registration.
                if active_projects.len() != 1 {
                    return Err(Status::Unsupported);
                }
                let target = active_projects[0].join(format!("{desktop}.json"));
                if target.try_exists().map_err(|_| Status::Failed)? {
                    return Err(Status::Conflict);
                }
                Ok(Some((target, registration_row(&source)?)))
            })();
            match candidate {
                Ok(None) => {
                    eligible.insert(id.to_owned());
                }
                Ok(Some((target, output))) => candidates.push((path, source, target, output)),
                Err(status) => failures.push(failed_item(id, &source, status)),
            }
            if eligible.len() + candidates.len() + failures.len() > MAX_PAIRS {
                return Err(Status::Limit);
            }
        }
        let mut registered = HashSet::new();
        for (local_path, source, target, output) in candidates {
            let (id, _, cwd) = identity(&source)?;
            let relative = PathBuf::from("projects")
                .join(sanitize_claude_project_name(Path::new(cwd)))
                .join(format!("{id}.jsonl"));
            let scope = pair_scope(
                profile,
                owner,
                &account,
                &local_account,
                &source,
                &target,
                &local_path,
            )?;
            let guard = || {
                budget.check()?;
                check_owner()?;
                check_writers()?;
                profile
                    .validate("claude_desktop")
                    .map_err(|_| Status::ScopeChanged)?;
                let mut remaining = CLAUDE_DESKTOP_PROJECT_SCAN_LIMIT;
                let current_projects = entries(&roots.official.join(&account), &mut remaining)?
                    .into_iter()
                    .filter(|path| path.is_dir())
                    .collect::<Vec<_>>();
                if current_projects != active_projects {
                    return Err(Status::ScopeChanged);
                }
                if active_account(&roots.official)? != account
                    || active_account(&roots.isolated)? != local_account
                    || local_project(&roots.isolated.join(&local_account))? != project
                    || row(&local_path, &budget)? != source
                {
                    return Err(Status::ScopeChanged);
                }
                Ok(())
            };
            let result = storage::register_new(
                &roots.primary,
                &roots.primary.join(&relative),
                &roots.package,
                &roots.package.join(&relative),
                &roots.state,
                &target,
                &output,
                id,
                &budget,
                &guard,
                storage::Scope {
                    binding: &scope,
                    cwd: Path::new(cwd),
                },
            );
            match result {
                Ok(()) => {
                    registered.insert(id.to_owned());
                    eligible.insert(id.to_owned());
                }
                Err(
                    status @ (Status::ScopeChanged
                    | Status::Busy
                    | Status::WriterUnknown
                    | Status::Limit),
                ) => return Err(status),
                Err(status) => failures.push(failed_item(id, &source, status)),
            }
        }
        report = run_filtered_at(
            profile,
            owner,
            None,
            Mode::Sync,
            &check_owner,
            &check_writers,
            roots,
            Some(&eligible),
        );
        for item in &mut report.items {
            if item.status == Status::Clean && registered.contains(&item.session_id) {
                item.status = Status::SyncedToPrimary;
            }
        }
        if !matches!(
            report.status,
            Status::ScopeChanged | Status::Busy | Status::WriterUnknown
        ) {
            if let Some(failure) = failures.first() {
                report.status = failure.status;
            }
            report.items.extend(failures);
        }
        check_owner()?;
        Ok(())
    })();
    if let Err(status) = result {
        report.status = status;
        if status == Status::ScopeChanged {
            report.items.clear();
        }
    }
    report
}

fn failed_item(id: &str, row: &Value, status: Status) -> Item {
    Item {
        session_id: id.to_owned(),
        title: row["title"]
            .as_str()
            .unwrap_or("Claude conversation")
            .chars()
            .take(200)
            .collect(),
        status,
    }
}
