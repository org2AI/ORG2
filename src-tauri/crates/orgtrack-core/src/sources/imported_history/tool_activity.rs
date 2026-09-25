//! Bounded metadata describing explicit tool operations, never raw tool logs.
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolActivity {
    pub call_id: String,
    pub tool_name: String,
    pub group: String,
    pub status: ToolActivityStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub actions: Vec<ToolActivityAction>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolActivityStatus {
    Success,
    Error,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ToolActivityKind {
    Search,
    Open,
    ReadTerminal,
    Generic,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolActivityAction {
    pub kind: ToolActivityKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}
fn bounded(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}
fn error_summary(result: &Value) -> Option<String> {
    let explicit = result
        .pointer("/error/message")
        .or_else(|| result.get("error"))
        .and_then(Value::as_str)
        .or_else(|| result.get("message").and_then(Value::as_str));
    let mcp_error = result
        .get("isError")
        .or_else(|| result.get("is_error"))
        .and_then(Value::as_bool)
        == Some(true);
    let text = explicit.or_else(|| {
        if !mcp_error {
            return None;
        }
        let content = result.get("content")?;
        content.as_str().or_else(|| {
            content.as_array()?.iter().find_map(|part| {
                (part.get("type")?.as_str()? == "text")
                    .then(|| part.get("text")?.as_str())
                    .flatten()
            })
        })
    });
    text.map(|value| bounded(value, 512))
        .filter(|value| !value.is_empty())
}

impl ToolActivity {
    pub(super) fn project(
        call_id: &str,
        tool_name: &str,
        args: &Value,
        result: &Value,
        success: bool,
    ) -> Self {
        let lower = tool_name.to_ascii_lowercase();
        let group = if lower.starts_with("web.")
            || lower.starts_with("web__")
            || lower.contains("__web__")
            || matches!(
                lower.as_str(),
                "web_search" | "websearch" | "web_fetch" | "webfetch"
            ) {
            "web".to_string()
        } else if lower.contains("codex_app") || lower.contains("chatgpt_app_tools") {
            "codex-app".to_string()
        } else if let Some(namespace) = lower
            .strip_prefix("mcp__")
            .and_then(|name| name.split("__").next())
            .and_then(|namespace| namespace.split('.').next())
        {
            format!("mcp:{namespace}")
        } else {
            lower.split('.').next().unwrap_or(&lower).to_string()
        };
        let mut actions = Vec::new();
        if group == "web" {
            for key in ["search_query", "queries"] {
                if let Some(items) = args.get(key).and_then(Value::as_array) {
                    for item in items.iter().take(32) {
                        if actions.len() >= 32 {
                            break;
                        }
                        if let Some(query) = item
                            .get("q")
                            .or_else(|| item.get("query"))
                            .and_then(Value::as_str)
                            .or_else(|| item.as_str())
                        {
                            actions.push(ToolActivityAction {
                                kind: ToolActivityKind::Search,
                                query: Some(bounded(query, 2048)),
                                url: None,
                            });
                        }
                    }
                }
            }
            if actions.is_empty() {
                if let Some(query) = args
                    .get("query")
                    .or_else(|| args.get("q"))
                    .and_then(Value::as_str)
                {
                    actions.push(ToolActivityAction {
                        kind: ToolActivityKind::Search,
                        query: Some(bounded(query, 2048)),
                        url: None,
                    });
                }
            }
            if let Some(items) = args.get("open").and_then(Value::as_array) {
                for item in items.iter().take(32) {
                    if actions.len() >= 32 {
                        break;
                    }
                    if let Some(url) = item
                        .get("ref_id")
                        .or_else(|| item.get("url"))
                        .and_then(Value::as_str)
                    {
                        actions.push(ToolActivityAction {
                            kind: ToolActivityKind::Open,
                            query: None,
                            url: Some(bounded(url, 2048)),
                        });
                    }
                }
            }
            if actions.is_empty() {
                if let Some(url) = args.get("url").and_then(Value::as_str) {
                    actions.push(ToolActivityAction {
                        kind: ToolActivityKind::Open,
                        query: None,
                        url: Some(bounded(url, 2048)),
                    });
                }
            }
        }
        if actions.is_empty() {
            actions.push(ToolActivityAction {
                kind: if lower.ends_with("read_thread_terminal") || lower.ends_with("read_terminal")
                {
                    ToolActivityKind::ReadTerminal
                } else {
                    ToolActivityKind::Generic
                },
                query: None,
                url: None,
            });
        }
        Self {
            call_id: call_id.to_string(),
            tool_name: bounded(tool_name, 256),
            group: bounded(&group, 256),
            status: if success {
                ToolActivityStatus::Success
            } else {
                ToolActivityStatus::Error
            },
            error: if success { None } else { error_summary(result) },
            actions,
        }
    }
}
