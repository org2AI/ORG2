use serde_json::{json, Value};
type Flags = std::collections::HashMap<String, String>;
const RULEBOOK: &str = include_str!("../../../../docs/agent/ui/rulebook.md");
const CLI_RULEBOOK: &str = include_str!("../../../../docs/agent/ui/cli-rulebook.md");
const RESULTS: &str = include_str!("../../../../docs/agent/ui/results.md");
const TARGETS: &str = include_str!("../../../../docs/agent/ui/targets.md");
pub fn rulebook() -> Value {
    json!({"markdown":CLI_RULEBOOK})
}
pub fn rulebook_markdown() -> &'static str {
    RULEBOOK
}
pub fn help() -> String {
    let mut result="ORG2 UI commands\n\norg2 rulebook\norg2 ui instances | capabilities | windows\norg2 ui docs --list | --search <task> | <topic>\norg2 ui tools [tool-name]\norg2 ui call <tool-name> --params-file <file>\norg2 ui schema <command-id>\norg2 ui exec <command-id> --params-file <file> --target-file <file>\norg2 ui request status <request-id>\n\nCommon commands:\n".to_string();
    for item in crate::catalog()["commands"].as_array().unwrap() {
        if item["discoveryTier"] != "common" {
            continue;
        }
        result.push_str(&format!(
            "  org2 ui {}{} — {}\n",
            item["cli"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(" "),
            item["positional"]
                .as_str()
                .map(|p| format!(" <{p}>"))
                .unwrap_or_default(),
            item["description"].as_str().unwrap()
        ));
    }
    result.push_str("\nTarget options: --instance <id> --window main (--session <id> | --global)\nOther options: --json --reveal --request-id <id>\nFile: --line <n>; tab focus: --partition <shared|workspace>; list: --limit <n> --cursor <n>\nStandalone console executable: org2-ui (same arguments, optional ui prefix).\n");
    result
}
pub fn read(words: &[String], flags: &Flags) -> Result<Value, String> {
    let catalog = crate::catalog();
    let query = flags.get("search").map(|s| s.to_lowercase());
    if flags.contains_key("list") || query.is_some() {
        let mut entries = vec![
            json!({"topic":"targets","description":"Instance, window, workspace and permissions / 目标 窗口 权限"}),
            json!({"topic":"results","description":"Receipts, retries, failures and unknown outcomes / 结果 超时 重试"}),
            json!({"topic":"more-actions","description":"Navigation, appearance and other actions / 导航 主题 设置"}),
            json!({"topic":"native","description":"Concrete tools, defaults and examples / 内置工具"}),
            json!({"topic":"cli","description":"Agent tool schemas, CLI calls and host workspace binding / 命令行 绑定"}),
            json!({"topic":"protocol","description":"Low-level control_orgii protocol compatibility / 底层协议"}),
        ];
        entries.extend(catalog["commands"].as_array().unwrap().iter().map(|c|json!({"topic":c["topic"],"command":c["id"],"description":c["description"],"keywords":c["keywords"]})));
        if let Some(query) = &query {
            entries.retain(|e| e.to_string().to_lowercase().contains(query));
        }
        if flags.contains_key("list") {
            let mut seen = std::collections::HashSet::new();
            entries.retain(|entry| seen.insert(entry["topic"].as_str().unwrap().to_string()));
        }
        entries.truncate(if query.is_some() { 8 } else { 16 });
        return Ok(json!({"protocolVersion":1,"catalogHash":catalog["hash"],"topics":entries}));
    }
    let topic = words
        .get(1)
        .ok_or("Use docs --list, docs --search <task>, or docs <topic>")?;
    let mut output = format!(
        "# ORG2 UI: {topic}\n\nProtocol 1; catalog {}\n\n",
        catalog["hash"].as_str().unwrap()
    );
    match topic.as_str() {
        "targets"|"access"=>output.push_str(TARGETS),
        "native"=>output.push_str(include_str!("../../../../docs/agent/ui/native.md")),
        "cli"=>output.push_str(include_str!("../../../../docs/agent/ui/cli.md")),
        "protocol"=>output.push_str(include_str!("../../../../docs/agent/ui/protocol.md")),
        "results"=>output.push_str(RESULTS),
        "terminals"=>output.push_str(include_str!("../../../../docs/agent/ui/terminals.md")),
        "more-actions"=>output.push_str("This release exposes file, web, Explorer, Source Control, tab focus and shell terminal commands. Settings, themes, Spotlight, guide actions, session control and DOM execution are not public UI commands. Do not guess internal action IDs. Check capabilities after upgrading.\n"),
        _=> {
            let entries:Vec<_>=catalog["commands"].as_array().unwrap().iter().filter(|c|c["topic"]==*topic).collect();
            if entries.is_empty() { return Err("Unknown topic; use docs --list".into()); }
            for c in entries { output.push_str(&format!("## {}\n\n{}\n\nCapability: {}. Parameters:\n\n```json\n{}\n```\n\n",c["id"].as_str().unwrap(),c["description"].as_str().unwrap(),c["capability"].as_str().unwrap(),serde_json::to_string_pretty(&c["params"]).unwrap())); }
            output.push_str("Use docs targets for destination defaults, and docs results before retrying an uncertain result. --reveal requests presentation; inspect revealed/presentationState instead of assuming it rendered.\n");
        }
    }
    if flags.contains_key("json") {
        Ok(json!({"protocolVersion":1,"catalogHash":catalog["hash"],"content":output}))
    } else {
        Ok(json!({"markdown":output}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rulebook_is_short_and_references_only_published_workflows() {
        assert!(RULEBOOK.len() <= 6144);
        assert!(RULEBOOK.split_whitespace().count() <= 320);
        assert!(CLI_RULEBOOK.split_whitespace().count() <= 320);
        assert!(RULEBOOK.contains("get_org2_ui_docs"));
        assert!(CLI_RULEBOOK.contains("docs --search"));
        assert!(!RULEBOOK.contains("gui.execute"));
    }
    #[test]
    fn chinese_search_and_topic_loading_are_bounded() {
        let mut flags = Flags::new();
        flags.insert("search".into(), "文件".into());
        let result = read(&["docs".into()], &flags).unwrap();
        assert!(result["topics"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["topic"] == "files"));
        assert!(result["topics"].as_array().unwrap().len() <= 8);
        let file = read(&["docs".into(), "files".into()], &Flags::new()).unwrap();
        assert!(file["markdown"].as_str().unwrap().len() <= 16384);
        assert!(file["markdown"].as_str().unwrap().contains("ui.file.open"));
        assert!(!file["markdown"].as_str().unwrap().contains("ui.web.open"));
    }
    #[test]
    fn index_topics_are_unique_and_all_resolve() {
        let mut flags = Flags::new();
        flags.insert("list".into(), "true".into());
        let list = read(&["docs".into()], &flags).unwrap();
        assert!(list["topics"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["topic"] == "cli"));
        let mut seen = std::collections::HashSet::new();
        for item in list["topics"].as_array().unwrap() {
            let topic = item["topic"].as_str().unwrap();
            assert!(seen.insert(topic));
            assert!(read(&["docs".into(), topic.into()], &Flags::new()).is_ok());
        }
    }
    #[test]
    fn terminal_topic_is_discoverable_and_does_not_promise_command_success() {
        let mut flags = Flags::new();
        flags.insert("search".into(), "终端".into());
        let found = read(&["docs".into()], &flags).unwrap();
        assert!(!found["topics"].as_array().unwrap().is_empty());
        assert!(found["topics"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["topic"] == "terminals"));
        let topic = read(&["docs".into(), "terminals".into()], &Flags::new()).unwrap();
        let text = topic["markdown"].as_str().unwrap();
        assert!(text.contains("executionState: unconfirmed"));
        assert!(text.len() < 16384);
    }
}
