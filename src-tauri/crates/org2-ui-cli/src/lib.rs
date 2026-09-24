//! Thin synchronous console client. Never launches a desktop or an agent session.
mod args;
mod client;
use app_ui::docs;
use serde_json::{json, Value};

pub fn run(args: Vec<String>) -> i32 {
    match execute(args) {
        Ok(value) => {
            let status = value["status"].as_str().unwrap_or("applied");
            let code = if status == "unknown" {
                5
            } else if status == "failed" {
                match value["error"]["code"].as_str().unwrap_or("") {
                    "UNAUTHORIZED" | "CAPABILITY_DENIED" => 3,
                    "UI_NOT_READY" | "APP_NOT_RUNNING" | "PROTOCOL_MISMATCH" | "BUSY"
                    | "TERMINAL_NOT_READY" => 4,
                    "FILE_NOT_FOUND" | "FILE_NOT_READABLE" | "TAB_NOT_FOUND"
                    | "TERMINAL_NOT_FOUND" => 6,
                    _ => 2,
                }
            } else {
                0
            };
            if let Some(text) = value.get("markdown").and_then(Value::as_str) {
                println!("{text}");
            } else {
                println!("{}", serde_json::to_string(&value).unwrap());
            }
            code
        }
        Err(message) => {
            println!(
                "{}",
                json!({"protocolVersion":1,"status":"failed","error":{"code":"CLI_ERROR","message":message}})
            );
            2
        }
    }
}
fn execute(mut argv: Vec<String>) -> Result<Value, String> {
    if argv.first().is_some_and(|s| s == "ui") {
        argv.remove(0);
    }
    if argv.first().is_some_and(|s| s == "rulebook") {
        return Ok(docs::rulebook());
    }
    if argv.is_empty() || matches!(argv[0].as_str(), "help" | "--help" | "-h") {
        return Ok(json!({"markdown": docs::help()}));
    }
    let (words, flags) = args::parse(&argv)?;
    if words.first().is_some_and(|s| s == "tools") {
        if words.len() > 2 || flags.keys().any(|key| key != "json") {
            return Err("Use tools [tool-name] [--json]".into());
        }
        if let Some(name) = words.get(1) {
            let kind = app_ui::agent_tools::Kind::from_name(name).ok_or("Unknown UI tool")?;
            return Ok(
                json!({"name":kind.name(),"description":kind.description(),"inputSchema":kind.parameters()}),
            );
        }
        return Ok(app_ui::agent_tools::catalog());
    }
    if words.first().is_some_and(|s| s == "docs") {
        return docs::read(&words, &flags);
    }
    if words.first().is_some_and(|s| s == "schema") {
        let id = words.get(1).ok_or("schema requires a command ID")?;
        return app_ui::catalog()["commands"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["id"] == *id)
            .cloned()
            .ok_or_else(|| "Unknown command".into());
    }
    client::execute(words, flags)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn offline_tools_share_native_schemas_and_reject_ambiguous_usage() {
        assert_eq!(
            execute(vec!["ui".into(), "tools".into()]).unwrap(),
            app_ui::agent_tools::catalog()
        );
        let tool = execute(vec!["tools".into(), "open_in_org2".into()]).unwrap();
        assert_eq!(
            tool["inputSchema"],
            app_ui::agent_tools::Kind::Open.parameters()
        );
        assert!(execute(vec!["tools".into(), "open_in_org2".into(), "extra".into()]).is_err());
        assert!(execute(vec![
            "call".into(),
            "get_org2_ui_docs".into(),
            "--reveal".into()
        ])
        .is_err());
        assert!(
            execute(vec!["call".into(), "get_org2_ui_docs".into()]).unwrap()["topics"].is_array()
        );
    }
}
