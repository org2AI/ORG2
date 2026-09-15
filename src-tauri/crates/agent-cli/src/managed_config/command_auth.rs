//! Provider-supported, short-lived credential commands. No bearer or renewal
//! secret is persisted in this configuration.
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub struct CredentialCommand {
    pub command: String,
    pub args: Vec<String>,
}
impl CredentialCommand {
    pub fn shell_command(&self) -> Result<String, String> {
        fn quote(value: &str) -> Result<String, String> {
            if value.contains(['\0', '\r', '\n']) {
                return Err("Invalid authentication command".into());
            }
            Ok(format!("'{}'", value.replace('\'', "'\\''")))
        }
        std::iter::once(&self.command)
            .chain(&self.args)
            .map(|s| quote(s))
            .collect::<Result<Vec<_>, _>>()
            .map(|v| v.join(" "))
    }
}

pub(super) fn generate(
    agent: &str,
    model: &str,
    base_url: &str,
    command: &CredentialCommand,
) -> Result<String, String> {
    match agent {
        "claude_code" => serde_json::to_string_pretty(&serde_json::json!({
            "model": model,
            "apiKeyHelper": command.shell_command()?,
            "env": {
                "ANTHROPIC_BASE_URL": base_url,
                "ANTHROPIC_MODEL": model,
                "ANTHROPIC_AUTH_TOKEN": "",
                "ANTHROPIC_API_KEY": "",
                "CLAUDE_CODE_OAUTH_TOKEN": "",
                "CLAUDE_CODE_API_KEY_HELPER_TTL_MS": "60000"
            }
        }))
        .map_err(|e| e.to_string()),
        "codex" => {
            let config = serde_json::json!({
                "model":model,"model_provider":"orgii",
                "model_providers":{"orgii":{
                    "name":"ORG2", "base_url":format!("{}/v1",base_url.trim_end_matches('/')),
                    "wire_api":"responses", "supports_websockets":false,
                    "auth":{"command":command.command,"args":command.args,
                        "timeout_ms":30000,"refresh_interval_ms":60000}
                }}
            });
            let value: toml::Value = serde_json::from_value(config).map_err(|e| e.to_string())?;
            toml::to_string_pretty(&value).map_err(|e| e.to_string())
        }
        _ => Err("Client does not support credential commands".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn command_arguments_cannot_execute_shell_expansions() {
        let c = CredentialCommand {
            command: "/Applications/ORG2's App/org2".into(),
            args: vec!["$(touch /tmp/unwanted)".into()],
        };
        assert_eq!(
            c.shell_command().unwrap(),
            "'/Applications/ORG2'\\''s App/org2' '$(touch /tmp/unwanted)'"
        );
    }
    #[test]
    fn both_clients_use_helpers_without_stored_bearers() {
        let c = CredentialCommand {
            command: "/app/org2".into(),
            args: vec!["--market-auth".into()],
        };
        let cc: serde_json::Value = serde_json::from_str(
            &generate("claude_code", "model-a", "https://gateway.test/w/ws_a", &c).unwrap(),
        )
        .unwrap();
        assert!(cc["apiKeyHelper"]
            .as_str()
            .unwrap()
            .contains("--market-auth"));
        assert_eq!(cc["env"]["ANTHROPIC_AUTH_TOKEN"], "");
        let cdx: toml::Value = toml::from_str(
            &generate("codex", "model-b", "https://gateway.test/w/ws_a", &c).unwrap(),
        )
        .unwrap();
        let provider = &cdx["model_providers"]["orgii"];
        assert_eq!(
            provider["base_url"].as_str(),
            Some("https://gateway.test/w/ws_a/v1")
        );
        assert!(provider.get("env_key").is_none());
        assert!(provider.get("experimental_bearer_token").is_none());
    }
}
