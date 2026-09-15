//! Temporary MCP files live with the terminal's already-bounded route owner.
use crate::agent_sessions::cli::mcp_config::{
    ClaudeMcpConfigFile, CodexMcpProfileFile, SessionMcpServers,
};
use agent_cli::managed_config::launch::ManagedLaunchProfile;
use agent_core::mcp::config::McpServerConfig;
use std::path::Path;

pub(super) enum Files {
    Claude { _file: ClaudeMcpConfigFile },
    Codex { _file: CodexMcpProfileFile },
}

pub(super) fn prepare(
    agent: &str,
    working_dir: &str,
    agent_definition: Option<&str>,
    connection: McpServerConfig,
    profile: &mut ManagedLaunchProfile,
) -> Result<Files, String> {
    if !Path::new(working_dir).is_dir() {
        return Err("MCP workspace directory is unavailable".into());
    }
    let servers =
        SessionMcpServers::resolve_with_connection(working_dir, agent_definition, Some(connection))
            .map_err(|error| error.to_string())?;
    match agent {
        "claude_code" => {
            let file = servers.write_claude_mcp_config()?;
            profile.args.extend([
                "--strict-mcp-config".into(),
                "--mcp-config".into(),
                file.path().to_string_lossy().into_owned(),
            ]);
            Ok(Files::Claude { _file: file })
        }
        "codex" => {
            let home = profile.env.get("CODEX_HOME").ok_or("Missing Codex home")?;
            let file = servers
                .write_codex_mcp_profile(Path::new(home))?
                .ok_or("Missing purchased MCP configuration")?;
            profile
                .args
                .extend(["--profile".into(), file.profile_name().into()]);
            Ok(Files::Codex { _file: file })
        }
        _ => Err("Unsupported MCP terminal client".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli_managed_proxy::{mcp, session_routes, ProxyContext, ProxyProtocol};
    use crate::dynamic_credentials::Authentication;

    #[test]
    fn terminal_files_follow_route_lifetime_without_exposing_credentials_or_deleting_history() {
        let _sandbox = crate::test_utils::test_env::sandbox();
        let workspace = tempfile::tempdir().unwrap();
        for agent in ["claude_code", "codex"] {
            let id = format!("tui-mcp-{}", uuid::Uuid::new_v4());
            let token = session_routes::reserve(
                &id,
                agent,
                ProxyContext {
                    authentication: Authentication::Bearer,
                    key_id: "test:workspace".into(),
                    provider: "test".into(),
                    model: "model".into(),
                    upstream_base_url: "https://unused.invalid".into(),
                    api_key: String::new(),
                    proxy_token: String::new(),
                    protocol: ProxyProtocol::OpenAi,
                },
            )
            .unwrap();
            let home = tempfile::tempdir().unwrap();
            let history = home.path().join("history.jsonl");
            std::fs::write(&history, "retained history").unwrap();
            let mut profile = ManagedLaunchProfile {
                args: vec![],
                env: std::collections::BTreeMap::from([(
                    "CODEX_HOME".into(),
                    home.path().to_string_lossy().into_owned(),
                )]),
            };
            let files = prepare(
                agent,
                workspace.path().to_str().unwrap(),
                None,
                mcp::server_config(agent, &token),
                &mut profile,
            )
            .unwrap();
            let path = match &files {
                Files::Claude { _file } => _file.path().to_path_buf(),
                Files::Codex { _file } => _file.path().to_path_buf(),
            };
            assert!(std::fs::read_to_string(&path).unwrap().contains(&token));
            assert!(!profile
                .args
                .iter()
                .chain(profile.env.values())
                .any(|value| value.contains(&token)));
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                assert_eq!(
                    std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                    0o600
                );
            }
            session_routes::attach_mcp(&token, files).unwrap();
            assert!(path.is_file());
            session_routes::release(&id).unwrap();
            assert!(!path.exists());
            assert_eq!(
                std::fs::read_to_string(&history).unwrap(),
                "retained history"
            );
            assert!(session_routes::resolve(agent, &token).is_err());
            // A launch race that loses its route also drops the unadopted files.
            let files = prepare(
                agent,
                workspace.path().to_str().unwrap(),
                None,
                mcp::server_config(agent, &token),
                &mut profile,
            )
            .unwrap();
            let abandoned = match &files {
                Files::Claude { _file } => _file.path().to_path_buf(),
                Files::Codex { _file } => _file.path().to_path_buf(),
            };
            assert!(session_routes::attach_mcp(&token, files).is_err());
            assert!(!abandoned.exists());
        }
    }
}
