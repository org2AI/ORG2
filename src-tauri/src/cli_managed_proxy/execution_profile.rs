//! A normal runner owns its local proxy generation through cancellation and exit.
use super::{ensure_managed_proxy_running, resolve_proxy_context_for_selection, session_routes};
use crate::agent_sessions::cli::{persistence, types::KeySource};
use agent_cli::managed_config::{self, launch::ManagedLaunchProfile};

struct RouteOwner {
    session: String,
    token: String,
    cleanup_profile: bool,
}
impl Drop for RouteOwner {
    fn drop(&mut self) {
        // A stale owner must never revoke a newer generation for the same Session.
        if matches!(session_routes::release_token(&self.token), Ok(true)) && self.cleanup_profile {
            if let Err(error) = managed_config::launch::release(&self.session) {
                tracing::warn!("Could not release owned execution profile: {error}");
            }
        }
    }
}

pub(crate) struct ExecutionProfile {
    pub profile: ManagedLaunchProfile,
    _owner: RouteOwner,
}

pub(crate) async fn prepare_execution_profile(
    session: &persistence::CodeSession,
) -> Result<Option<ExecutionProfile>, String> {
    let Some(selection) = session.credential_source.clone() else {
        return Ok(None);
    };
    if session.account_id.is_some() || session.key_source != KeySource::OwnKey {
        return Err("Session has conflicting credential owners".into());
    }
    let agent = session
        .cli_agent_type
        .clone()
        .ok_or("Missing source client")?;
    let model = session
        .model
        .clone()
        .filter(|m| !m.is_empty() && m.len() <= 256)
        .ok_or("Missing source model")?;
    let context =
        resolve_proxy_context_for_selection(&agent, Some(&selection), Some(&model), String::new())?;
    ensure_managed_proxy_running().await?;
    let id = session.session_id.clone();
    tokio::task::spawn_blocking(move || prepare_owned(id, selection, agent, model, context))
        .await
        .map_err(|_| "Execution profile task failed")?
}

fn prepare_owned(
    id: String,
    selection: String,
    agent: String,
    model: String,
    context: super::ProxyContext,
) -> Result<Option<ExecutionProfile>, String> {
    let token = session_routes::reserve(&id, &agent, context)?;
    let mut owner = RouteOwner {
        session: id.clone(),
        token,
        cleanup_profile: false,
    };
    let current = persistence::get_session(&id)
        .map_err(|e| e.to_string())?
        .ok_or("Session was deleted")?;
    if current.credential_source.as_deref() != Some(&selection)
        || current.cli_agent_type.as_deref() != Some(&agent)
        || current.model.as_deref() != Some(&model)
        || current.account_id.is_some()
        || current.key_source != KeySource::OwnKey
    {
        return Err("Session execution source changed".into());
    }
    let profile = managed_config::launch::restore_with_proxy_token(
        &agent,
        &model,
        &id,
        &managed_config::managed_proxy_url(),
        &owner.token,
    )?;
    owner.cleanup_profile = true;
    Ok(Some(ExecutionProfile {
        profile,
        _owner: owner,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn context(agent: &str) -> super::super::ProxyContext {
        super::super::ProxyContext {
            authentication: crate::dynamic_credentials::Authentication::Bearer,
            key_id: "test:workspace".into(),
            provider: "test".into(),
            model: "model".into(),
            upstream_base_url: "https://example.invalid/v1".into(),
            api_key: String::new(),
            proxy_token: String::new(),
            protocol: if agent == "codex" {
                super::super::ProxyProtocol::OpenAi
            } else {
                super::super::ProxyProtocol::Anthropic
            },
        }
    }
    #[test]
    fn execution_owner_rebuilds_same_home_and_releases_only_its_generation() {
        let _sandbox = crate::test_utils::test_env::sandbox();
        for agent in ["codex", "claude_code"] {
            let id = format!("cli_execution_{agent}");
            let conn = database::db::get_connection().unwrap();
            conn.execute("INSERT INTO code_sessions(session_id,runner,cli_agent_type,model,created_at,updated_at) VALUES (?1,'tui',?2,'model','now','now')", rusqlite::params![id,agent]).unwrap();
            persistence::bind_credential_source(&id, "test:workspace", agent, "model").unwrap();
            let prepare = || {
                prepare_owned(
                    id.clone(),
                    "test:workspace".into(),
                    agent.into(),
                    "model".into(),
                    context(agent),
                )
            };
            let first = prepare().unwrap().unwrap();
            let token = first._owner.token.clone();
            assert!(!first.profile.args.iter().any(|arg| arg.contains(&token)));
            assert!(!first
                .profile
                .env
                .values()
                .any(|value| value.contains(&token)));
            assert!(session_routes::resolve(agent, &token).unwrap().is_some());
            assert!(prepare().is_err());
            let home = std::path::PathBuf::from(first.profile.env.values().next().unwrap());
            let transcript = home.join("retained-transcript.jsonl");
            std::fs::write(&transcript, b"original transcript").unwrap();
            drop(first);
            assert!(session_routes::resolve(agent, &token).is_err());
            let next = prepare().unwrap().unwrap();
            assert_eq!(
                next.profile.env.values().next().unwrap(),
                &home.to_string_lossy()
            );
            assert_ne!(next._owner.token, token);
            let stale = RouteOwner {
                session: id.clone(),
                token,
                cleanup_profile: true,
            };
            drop(stale);
            assert!(session_routes::resolve(agent, &next._owner.token)
                .unwrap()
                .is_some());
            assert!(home
                .join(if agent == "codex" {
                    "config.toml"
                } else {
                    "settings.json"
                })
                .exists());
            drop(next);
            assert_eq!(std::fs::read(&transcript).unwrap(), b"original transcript");
            assert!(prepare_owned(
                id.clone(),
                "test:other".into(),
                agent.into(),
                "model".into(),
                context(agent),
            )
            .is_err());
            // A rejected reconstruction must release its reservation for a retry.
            drop(prepare().unwrap());
        }
    }
}
