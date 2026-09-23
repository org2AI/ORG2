//! Upgrade capabilities live beside the authoritative install catalog.
//! Never replay an arbitrary installer (downloads, sudo, repository checkouts).
//! Unknown methods stay documentation-only until an upgrade path is verified.

use super::super::CliInstallMethod;
use super::cli_install_methods;

pub(crate) fn cli_upgrade_methods(name: &str) -> Vec<CliInstallMethod> {
    let method = |id: &str, label: &str, command: &str| CliInstallMethod {
        id: id.into(),
        label: label.into(),
        command: command.into(),
    };
    // These updaters own install-method resolution. Do not expose the unrelated
    // cursor-cli npm package as an update to Cursor Agent.
    match name {
        "cursor_cli" => return vec![method("self", "", "cursor-agent update")],
        "opencode" => return vec![method("self", "", "opencode upgrade")],
        _ => {}
    }

    // Native updaters are alternatives to package managers, not interchangeable
    // with them. The UI asks for the installation method before dispatch.
    let native = match name {
        "claude_code" => Some("claude update"),
        "kiro" => Some("kiro-cli update"),
        "goose" => Some("goose update"),
        "hermes" => Some("hermes update"),
        "droid" => Some("droid update"),
        "devin" => Some("devin update"),
        _ => None,
    };
    let mut methods = Vec::new();
    if let Some(command) = native {
        methods.push(method("native", "", command));
    }

    for install in cli_install_methods(name) {
        let command = match install.id.as_str() {
            "npm" => install
                .command
                .strip_prefix("npm install -g ")
                .map(|package| format!("npm install -g {package}@latest")),
            "bun" => install
                .command
                .strip_prefix("bun install -g ")
                .map(|package| format!("bun install -g {package}@latest")),
            "homebrew" | "brew" if !cfg!(windows) => install
                .command
                .strip_prefix("brew install ")
                .map(|package| format!("brew upgrade {package}")),
            "uv" => match name {
                "kimi_cli" => Some("uv tool upgrade kimi-cli --no-cache".into()),
                "mistral_vibe" => Some("uv tool upgrade mistral-vibe".into()),
                _ => None,
            },
            // Keep pip explicit: never infer it from a pipx or uv environment.
            "pip" => install
                .command
                .strip_prefix("pip install ")
                .map(|package| format!("pip install --upgrade {package}")),
            "winget" if cfg!(windows) => install
                .command
                .strip_prefix("winget install ")
                .map(|package| format!("winget upgrade --id {package} --exact")),
            _ => None,
        };
        if let Some(command) = command {
            let label = if install.id == "pip" {
                "pip"
            } else {
                &install.label
            };
            methods.push(method(&install.id, label, &command));
            if install.id == "pip" && install.label.contains("pipx") {
                if let Some(package) = install.command.strip_prefix("pip install ") {
                    methods.push(method("pipx", "pipx", &format!("pipx upgrade {package}")));
                }
            }
        }
    }
    methods
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_and_package_manager_updates_are_distinct() {
        assert_eq!(
            cli_upgrade_methods("cursor_cli")[0].command,
            "cursor-agent update"
        );
        assert_eq!(cli_upgrade_methods("cursor_cli").len(), 1);
        assert_eq!(
            cli_upgrade_methods("opencode")[0].command,
            "opencode upgrade"
        );
        let claude = cli_upgrade_methods("claude_code");
        assert!(claude
            .iter()
            .any(|m| m.id == "native" && m.command == "claude update"));
        assert!(claude.iter().any(
            |m| m.id == "npm" && m.command == "npm install -g @anthropic-ai/claude-code@latest"
        ));
    }

    #[test]
    fn package_upgrades_target_the_official_package() {
        for (agent, command) in [
            ("codex", "npm install -g @openai/codex@latest"),
            ("copilot", "npm install -g @github/copilot@latest"),
            ("qwen_code", "npm install -g @qwen-code/qwen-code@latest"),
            ("droid", "npm install -g droid@latest"),
            ("kimi_cli", "uv tool upgrade kimi-cli --no-cache"),
            ("mistral_vibe", "uv tool upgrade mistral-vibe"),
            ("aider", "pip install --upgrade aider-chat"),
            ("aider", "pipx upgrade aider-chat"),
            ("devin", "devin update"),
            ("omp", "bun install -g @oh-my-pi/pi-coding-agent@latest"),
        ] {
            assert!(
                cli_upgrade_methods(agent)
                    .iter()
                    .any(|m| m.command == command),
                "{agent}"
            );
        }
        #[cfg(not(windows))]
        for (agent, command) in [
            ("codex", "brew upgrade --cask codex"),
            ("claude_code", "brew upgrade --cask claude-code"),
            ("copilot", "brew upgrade --cask copilot-cli"),
            ("goose", "brew upgrade block-goose-cli"),
        ] {
            assert!(
                cli_upgrade_methods(agent)
                    .iter()
                    .any(|m| m.command == command),
                "{agent}"
            );
        }
    }

    #[test]
    fn every_registered_cli_has_commands_or_documentation() {
        for agent in super::super::cli_agent_registry() {
            let methods = cli_upgrade_methods(agent.name);
            assert!(
                !methods.is_empty() || agent.docs_url.starts_with("https://"),
                "{}",
                agent.name
            );
            let mut ids = std::collections::HashSet::new();
            for method in methods {
                assert!(ids.insert(method.id));
                assert!(!method.command.contains("sudo"));
                assert!(!method.command.contains("install.sh"));
                assert!(!method.command.contains("uninstall"));
            }
        }
    }

    #[test]
    fn unsupported_installers_do_not_become_upgrade_commands() {
        for name in ["rovo", "antigravity", "qoder_cli", "trae_cli"] {
            assert!(cli_upgrade_methods(name).is_empty(), "{name}");
        }
    }
}
