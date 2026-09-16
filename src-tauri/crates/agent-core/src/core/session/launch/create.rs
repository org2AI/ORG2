//! Persisted session creation owned by the launch application service.

use crate::definitions::prefix_lookup::PENDING_SESSION_PLACEHOLDER;
use crate::session::persistence as session_persistence;
use core_types::key_source::KeySource;
use core_types::providers::NativeHarnessType;
use project_management::projects::types::PERSONAL_ORG_ID;

/// Default agent type when none is provided by the caller.
const DEFAULT_AGENT_TYPE: &str = "sde";

/// Map session context to a session ID prefix.
///
/// When an explicit agent definition is provided we look it up in the
/// `BUILTIN_PREFIX_REGISTRY`; otherwise we fall back to the legacy
/// heuristic (workspace_path → SDE, no workspace_path → OS).
pub(super) fn resolve_session_prefix(
    agent_definition_id: Option<&str>,
    has_workspace_path: bool,
) -> &'static str {
    crate::definitions::prefix_lookup::session_prefix_for_launch(
        agent_definition_id,
        has_workspace_path,
    )
}

/// Internal creation result. No serialization/JSON lookup is involved between
/// creation and launch; the command adapter owns external response serialization.
pub(super) struct CreatedSession {
    pub session_id: String,
    pub product_mode: Option<String>,
}

pub(super) struct CreateSessionRequest {
    pub agent_type: Option<String>,
    pub workspace_path: String,
    pub model: Option<String>,
    pub account_id: Option<String>,
    pub name: Option<String>,
    pub org_id: Option<String>,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub work_item_id: Option<String>,
    pub agent_role: Option<String>,
    pub worktree_path: Option<String>,
    pub project_slug: Option<String>,
    pub agent_definition_id: Option<String>,
    pub key_source: Option<String>,
    pub agent_exec_mode: Option<String>,
    pub product_mode: Option<String>,
    pub native_harness_type: Option<String>,
    pub parent_session_id: Option<String>,
    pub durable_session_key: Option<String>,
}

/// Create or recover the durable session row before runtime materialization.
pub(super) async fn create_session(
    request: CreateSessionRequest,
) -> Result<CreatedSession, String> {
    tokio::task::spawn_blocking(move || create_session_on_worker(request))
        .await
        .map_err(|error| format!("Session creation worker failed: {error}"))?
}

fn create_session_on_worker(request: CreateSessionRequest) -> Result<CreatedSession, String> {
    let CreateSessionRequest {
        agent_type,
        workspace_path,
        model,
        account_id,
        name,
        org_id,
        project_id,
        project_name,
        work_item_id,
        agent_role,
        worktree_path,
        project_slug,
        agent_definition_id,
        key_source,
        agent_exec_mode,
        product_mode,
        native_harness_type,
        parent_session_id,
        durable_session_key,
    } = request;
    // Trace the incoming key_source so drift between frontend and
    // backend posture is visible in logs. The field is now persisted
    // end-to-end on the rust-agent path (`agent_sessions.key_source`
    // column + typed `UnifiedSessionRecord.key_source`), wired below.
    if let Some(ref ks) = key_source {
        tracing::debug!(key_source = %ks, "[session] create_session key_source");
    }

    // Wire-typo guard for `key_source` — same fail-closed posture as the
    // CLI session create path. Accepting an unvalidated string here would
    // leave us with two failure modes downstream: either the row mapper
    // would reject the row at every read (session "created but
    // unloadable") or — pre-typed-mapper — the value would silently
    // default to `own_key` and mis-bill a market session.
    let resolved_key_source = match key_source.as_deref().filter(|s| !s.is_empty()) {
        Some(raw) => KeySource::parse(raw).ok_or_else(|| format!("Unknown key_source: {raw:?}"))?,
        None => KeySource::default(),
    };

    let resolved_native_harness_type =
        match native_harness_type.as_deref().filter(|s| !s.is_empty()) {
            Some(raw) => Some(
                NativeHarnessType::parse(raw)
                    .ok_or_else(|| format!("Unknown native_harness_type: {raw:?}"))?
                    .as_str()
                    .to_string(),
            ),
            None => None,
        };

    let has_project = !workspace_path.is_empty();
    let effective_agent_type = match agent_type.as_deref().filter(|s| !s.is_empty()) {
        Some(t) => t,
        None => {
            let default = if has_project {
                DEFAULT_AGENT_TYPE
            } else {
                session_persistence::session_type::DESKTOP
            };
            tracing::debug!(
                "[session] No agent_type provided, defaulting to '{}'",
                default
            );
            default
        }
    };
    let prefix = resolve_session_prefix(agent_definition_id.as_deref(), has_project);
    let session_id = match durable_session_key.as_deref() {
        Some(key)
            if !key.is_empty()
                && key.len() <= 128
                && key
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')) =>
        {
            format!("{prefix}{key}")
        }
        Some(_) => return Err("durable_session_key contains unsupported characters".to_string()),
        None => format!("{}{}", prefix, uuid::Uuid::new_v4()),
    };
    let now = chrono::Utc::now().to_rfc3339();
    let effective_model = match model {
        Some(m) if !m.is_empty() => m,
        _ => return Err("model is required when creating a session".into()),
    };

    let resolved_org_id = org_id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| PERSONAL_ORG_ID.to_string());
    let wid_for_link = work_item_id.clone();
    let slug_for_link = project_slug.clone();
    let requested_product_mode = if wid_for_link.is_some() {
        "project".to_string()
    } else {
        product_mode
            .filter(|mode| matches!(mode.as_str(), "build" | "plan" | "ask" | "project"))
            .unwrap_or_else(|| "build".to_string())
    };
    let requested_exec_mode = if requested_product_mode == "project" {
        crate::session::AgentExecMode::Build
    } else {
        match agent_exec_mode
            .as_deref()
            .map(str::trim)
            .filter(|mode| !mode.is_empty())
        {
            Some(mode) => crate::session::AgentExecMode::parse(mode)
                .ok_or_else(|| format!("Unknown agent_exec_mode: {mode:?}"))?,
            None => crate::session::AgentExecMode::Build,
        }
    };

    let existing = if durable_session_key.is_some() {
        session_persistence::get_session(&session_id).map_err(|err| err.to_string())?
    } else {
        None
    };
    let resolved_product_mode = if let Some(existing) = existing {
        if existing.work_item_id != wid_for_link || existing.project_slug != slug_for_link {
            return Err(format!(
                "durable session {} belongs to a different Work Item",
                session_id
            ));
        }
        let canonical_existing_mode = if existing.product_mode.as_deref() == Some("project") {
            crate::session::AgentExecMode::Build
        } else {
            existing
                .agent_exec_mode
                .as_deref()
                .and_then(crate::session::AgentExecMode::parse)
                .unwrap_or(crate::session::AgentExecMode::Build)
        };
        if existing.agent_exec_mode.as_deref() != Some(canonical_existing_mode.as_str()) {
            session_persistence::update_agent_exec_mode(
                &session_id,
                canonical_existing_mode.as_str(),
            )
            .map_err(|err| format!("normalize durable session mode: {err}"))?;
        }
        tracing::info!("[agent_session] Reusing durable session: {}", session_id);
        existing.product_mode
    } else {
        let session = session_persistence::UnifiedSessionRecord {
            session_id: session_id.clone(),
            name: name.unwrap_or_else(|| "New coding session".to_string()),
            status: crate::session::SessionStatus::Idle.as_str().to_owned(),
            model: Some(effective_model.clone()),
            account_id,
            workspace_path: Some(workspace_path.clone()),
            org_id: Some(resolved_org_id),
            project_id,
            project_name,
            user_input: None,
            total_tokens: 0,
            created_at: now.clone(),
            updated_at: now,
            session_type: effective_agent_type.to_string(),
            work_item_id,
            agent_role,
            worktree_path,
            project_slug,
            agent_definition_id,
            parent_session_id,
            key_source: resolved_key_source,
            // Persist a canonical mode from the first byte of the session.
            // Project is the product axis and always executes with Build's
            // tool policy; it must never inherit a previous creator Ask mode.
            agent_exec_mode: Some(requested_exec_mode.as_str().to_string()),
            // Product-mode resolver (orgtrack/v1 frozen decisions §1), fixed
            // precedence: launched from a WorkItem/Routine → project; the
            // user's explicit launch-time choice; else explicit build. Never
            // inferred from exec mode, query length or agent judgment.
            product_mode: Some(requested_product_mode),
            native_harness_type: resolved_native_harness_type,
            ..Default::default()
        };
        let resolved_product_mode = session.product_mode.clone();

        session_persistence::upsert_session(&session).map_err(|err| err.to_string())?;

        tracing::info!("[agent_session] Created session: {}", session_id);
        resolved_product_mode
    };

    if let Some(ref wid) = wid_for_link {
        let sid = session_id.clone();
        let wid = wid.clone();
        let slug = slug_for_link;
        let link_result = (|| {
            use project_management::orchestrator::state_machine;
            use project_management::projects::io as projects_io;

            let replace_pending = |project_slug: &str| -> Result<(), String> {
                state_machine::mutate_work_item(project_slug, &wid, |fm| {
                    if let Some(pending) = fm
                        .linked_sessions
                        .iter_mut()
                        .rev()
                        .find(|ls| ls.session_id == PENDING_SESSION_PLACEHOLDER)
                    {
                        pending.session_id = sid.clone();
                    }
                    state_machine::TransitionResult::Completed
                })?;
                Ok(())
            };

            if let Some(ref slug) = slug {
                replace_pending(slug)
            } else {
                let projects = projects_io::read_all_projects()
                    .map_err(|err| format!("Failed to read projects: {}", err))?;
                for project in &projects {
                    let items = projects_io::read_all_work_items(&project.slug).map_err(|err| {
                        format!("Failed to read work items for {}: {}", project.slug, err)
                    })?;
                    if items.iter().any(|wi| wi.frontmatter.short_id == wid) {
                        return replace_pending(&project.slug);
                    }
                }
                Err("Work item not found in any project".to_string())
            }
        })();
        match link_result {
            Ok(()) => {}
            Err(err) => {
                tracing::error!(
                    "[agent_session] Failed to replace pending session link: {}",
                    err
                );
            }
        }
    }

    Ok(CreatedSession {
        session_id,
        product_mode: resolved_product_mode,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(workspace: &Path) -> CreateSessionRequest {
        CreateSessionRequest {
            agent_type: None,
            workspace_path: workspace.to_string_lossy().into_owned(),
            model: Some("test-model".into()),
            account_id: Some("test-account".into()),
            name: Some("typed creation".into()),
            org_id: None,
            project_id: None,
            project_name: None,
            work_item_id: None,
            agent_role: None,
            worktree_path: None,
            project_slug: None,
            agent_definition_id: Some(crate::definitions::SDE_AGENT_ID.into()),
            key_source: Some("own_key".into()),
            agent_exec_mode: Some("ask".into()),
            product_mode: Some("ask".into()),
            native_harness_type: None,
            parent_session_id: None,
            durable_session_key: Some("typed_create_regression".into()),
        }
    }

    use std::path::Path;

    #[tokio::test]
    async fn typed_creation_persists_and_reuses_the_same_session_without_resetting_draft() {
        let _sandbox = test_helpers::test_env::sandbox();
        let workspace = tempfile::tempdir().unwrap();
        {
            let conn = database::db::get_connection().unwrap();
            crate::persistence::test_schema::ensure_agent_sessions_schema(&conn);
            session_persistence::init(&conn).unwrap();
        }
        let created = create_session(request(workspace.path())).await.unwrap();
        assert_eq!(created.product_mode.as_deref(), Some("ask"));
        let row = session_persistence::get_session(&created.session_id)
            .unwrap()
            .unwrap();
        assert_eq!(row.model.as_deref(), Some("test-model"));
        assert_eq!(row.account_id.as_deref(), Some("test-account"));
        assert_eq!(row.agent_exec_mode.as_deref(), Some("ask"));
        session_persistence::update_draft_text(&created.session_id, Some("keep draft")).unwrap();
        let again = create_session(request(workspace.path())).await.unwrap();
        assert_eq!(again.session_id, created.session_id);
        let row = session_persistence::get_session(&again.session_id)
            .unwrap()
            .unwrap();
        assert_eq!(row.draft_text.as_deref(), Some("keep draft"));
    }

    #[tokio::test]
    async fn invalid_creation_is_rejected_before_any_session_row_exists() {
        let _sandbox = test_helpers::test_env::sandbox();
        let workspace = tempfile::tempdir().unwrap();
        let mut invalid = request(workspace.path());
        invalid.key_source = Some("invalid-key-source".into());
        let error = create_session(invalid)
            .await
            .err()
            .expect("invalid key must fail");
        assert!(error.contains("Unknown key_source"));
        let conn = database::db::get_connection().unwrap();
        crate::persistence::test_schema::ensure_agent_sessions_schema(&conn);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM agent_sessions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }
}
