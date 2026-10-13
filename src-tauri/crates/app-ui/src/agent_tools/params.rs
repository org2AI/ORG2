use super::Kind;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

fn parse<T: serde::de::DeserializeOwned>(value: Value) -> Result<T, String> {
    serde_json::from_value(value).map_err(|e| e.to_string())
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Open {
    target: OpenTarget,
    reveal: Option<bool>,
}
#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum OpenTarget {
    File {
        path: String,
        line: Option<u32>,
    },
    Browser {
        url: String,
    },
    Explorer {},
    SourceControl {},
    Terminal {
        terminal_id: Option<String>,
    },
    NewTerminal {
        name: Option<String>,
    },
    Tab {
        tab_id: String,
        partition: Partition,
    },
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum Partition {
    Shared,
    Workspace,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Page {
    #[serde(skip_serializing_if = "Option::is_none")]
    limit: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cursor: Option<u32>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Read {
    terminal_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_bytes: Option<u32>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Write {
    terminal_id: String,
    input: TerminalAction,
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
enum TerminalAction {
    Execute { command: String },
    Input { data: String },
    Interrupt {},
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Empty {}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Docs {
    topic: Option<String>,
    query: Option<String>,
    command: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Receipt {
    request_id: String,
}

pub(super) fn operation(kind: Kind, value: Value) -> Result<(&'static str, Value, bool), String> {
    let (command, mut params, reveal) = match kind {
        Kind::Open => {
            let Open { target, reveal } = parse(value)?;
            let reveal = reveal.unwrap_or(true);
            let (command, params) = match target {
                OpenTarget::File { path, line } => {
                    ("ui.file.open", json!({"path":path,"line":line}))
                }
                OpenTarget::Browser { url } => ("ui.web.open", json!({"url":url})),
                OpenTarget::Explorer {} => ("ui.tab.open", json!({"kind":"explorer"})),
                OpenTarget::SourceControl {} => ("ui.tab.open", json!({"kind":"source-control"})),
                OpenTarget::Terminal {
                    terminal_id: Some(id),
                } => ("ui.terminal.focus", json!({"terminalId":id})),
                OpenTarget::Terminal { terminal_id: None } => ("ui.terminal.open", json!({})),
                OpenTarget::NewTerminal { name } => ("ui.terminal.new", json!({"name":name})),
                OpenTarget::Tab { tab_id, partition } => (
                    "ui.tab.focus",
                    json!({"tabId":tab_id,"partition":partition}),
                ),
            };
            if !reveal && matches!(command, "ui.tab.focus" | "ui.terminal.focus") {
                return Err(
                    "Focusing an existing tab or terminal requests presentation; omit reveal=false"
                        .into(),
                );
            }
            (command, params, reveal)
        }
        Kind::Context => {
            let _: Empty = parse(value)?;
            ("ui.context", json!({}), false)
        }
        Kind::Tabs | Kind::Terminals => {
            let page: Page = parse(value)?;
            (
                if kind == Kind::Tabs {
                    "ui.tabs.list"
                } else {
                    "ui.terminal.list"
                },
                json!(page),
                false,
            )
        }
        Kind::ReadTerminal => ("ui.terminal.read", json!(parse::<Read>(value)?), false),
        Kind::WriteTerminal => {
            let Write { terminal_id, input } = parse(value)?;
            match input {
                TerminalAction::Execute { command } => (
                    "ui.terminal.execute",
                    json!({"terminalId":terminal_id,"command":command}),
                    false,
                ),
                TerminalAction::Input { data } => (
                    "ui.terminal.input",
                    json!({"terminalId":terminal_id,"data":data}),
                    false,
                ),
                TerminalAction::Interrupt {} => (
                    "ui.terminal.interrupt",
                    json!({"terminalId":terminal_id}),
                    false,
                ),
            }
        }
        Kind::Docs | Kind::Result => return Err("Not an execution tool".into()),
    };
    params
        .as_object_mut()
        .expect("object params")
        .retain(|_, v| !v.is_null());
    Ok((command, params, reveal))
}

pub(super) fn document(value: Value) -> Result<Value, String> {
    let Docs {
        topic,
        query,
        command,
    } = parse(value)?;
    if [&topic, &query, &command]
        .iter()
        .filter(|v| v.is_some())
        .count()
        > 1
    {
        return Err("Provide only one of topic, query or command".into());
    }
    if let Some(command) = command {
        return crate::catalog()["commands"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["id"] == command)
            .cloned()
            .ok_or("Unknown published command".into());
    }
    let mut words = vec!["docs".into()];
    let mut flags = std::collections::HashMap::new();
    if let Some(topic) = topic {
        words.push(topic);
    } else if let Some(query) = query {
        flags.insert("search".into(), query);
    } else {
        flags.insert("list".into(), "true".into());
    }
    crate::docs::read(&words, &flags)
}
pub(super) fn receipt(value: Value) -> Result<String, String> {
    let receipt: Receipt = parse(value)?;
    if receipt.request_id.is_empty() || receipt.request_id.len() > 128 {
        return Err("Invalid requestId".into());
    }
    Ok(receipt.request_id)
}
