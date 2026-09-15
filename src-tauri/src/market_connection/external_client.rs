//! Launch a purchased workspace in the user's own terminal. The client profile
//! contains a credential command, so its lifetime is independent of the GUI.
use agent_cli::managed_config::{self, command_auth::CredentialCommand};
use sha2::{Digest, Sha256};

pub async fn open(agent: String, key: String, model: String, folder: String) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("Independent client launch is not available on this platform yet".into());
    }
    let selection = super::source::Selection::parse(&key, &agent)?;
    let entries = super::source::options(selection.metadata.clone()).await?;
    super::source::validate_session_purchase(
        &entries,
        &selection.entitlement_id,
        &agent,
        &model,
        chrono::Utc::now().timestamp_millis(),
    )?;
    let status = managed_config::cli_config_get_status(agent.clone()).await?;
    if status.conflict
        || status.selected_key_id.as_deref() != Some(&key)
        || status.selected_model.as_deref() != Some(&model)
    {
        return Err("Selected client configuration changed".into());
    }
    tokio::task::spawn_blocking(move || {
        let folder = std::fs::canonicalize(folder).map_err(|_| "Workspace folder is unavailable")?;
        if !folder.is_dir() { return Err("Workspace folder is unavailable".into()); }
        if agent == "claude_desktop" {
            let mut link = reqwest::Url::parse("claude://code/new").map_err(|_| "Invalid Desktop link")?;
            link.query_pairs_mut().append_pair("folder", &folder.to_string_lossy());
            let status = std::process::Command::new("/usr/bin/open").args(["-b", "com.anthropic.claudefordesktop", link.as_str()]).status().map_err(|_| "Could not open Claude Desktop")?;
            return if status.success() { Ok(()) } else { Err("Could not open Claude Desktop".into()) };
        }
        let executable = std::env::current_exe().map_err(|_| "ORG2 executable is unavailable")?;
        let scope = app_paths::orgii_root().to_string_lossy().into_owned();
        let auth = CredentialCommand {command:executable.to_string_lossy().into_owned(),
            args:vec!["--market-auth".into(),agent.clone(),key.clone(),scope,"token".into()]};
        let id = format!("market-external-{:x}",Sha256::digest(format!("{key}\n{}",folder.display()).as_bytes()));
        let base = format!("https://org2-market.fly.dev/w/{}",selection.metadata.workspace_id);
        let profile = managed_config::launch::restore_with_auth_command(&agent,&model,&id,&base,&auth)?;
        let directory = managed_config::launch::native_home(&id)?;
        let mut headers = auth.clone();
        *headers.args.last_mut().ok_or("Invalid authentication command")? = "headers".into();
        let mcp = serde_json::json!({"mcpServers":{"org2-market":{"type":"http",
            "url":format!("https://org2-market.fly.dev/v1/skill/mcp/{}",selection.metadata.workspace_id),
            "headersHelper":headers.shell_command()?}}});
        let mut command = CredentialCommand {command: if agent == "claude_code" { "claude" } else { "codex" }.into(),args:vec![]};
        if agent == "claude_code" {
            command.args.extend(["--mcp-config".into(),serde_json::to_string(&mcp).map_err(|_| "Invalid MCP configuration")?]);
        }
        command.args.extend(profile.args);
        let mut script = String::from("#!/bin/zsh -l\nset -e\n");
        script.push_str("unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_OAUTH_TOKEN OPENAI_API_KEY\n");
        for (name,value) in profile.env {
            let assignment = CredentialCommand{command:format!("{name}={value}"),args:vec![]}.shell_command()?;
            script.push_str(&format!("export {assignment}\n"));
        }
        let cwd = CredentialCommand{command:folder.to_string_lossy().into_owned(),args:vec![]}.shell_command()?;
        script.push_str(&format!("cd -- {cwd}\nexec {}\n",command.shell_command()?));
        let launcher = directory.join("open-client.command");
        managed_config::write_cli_profile_file_atomic(&launcher,script.as_bytes())?;
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&launcher,std::fs::Permissions::from_mode(0o700)).map_err(|_| "Could not prepare client launch")?;
        }
        let status = std::process::Command::new("/usr/bin/open").args(["-a","Terminal"]).arg(&launcher).status()
            .map_err(|_| "Could not open your terminal")?;
        if !status.success() { return Err("Could not open your terminal".into()); }
        Ok(())
    }).await.map_err(|_| "Could not launch client")?
}
