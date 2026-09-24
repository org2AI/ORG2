//! Deterministic model choices only; every graph/result write uses real task tools.
use super::*;
use serde_json::json;
use sha2::{Digest, Sha256};

const MARKER: &str = "E2E_AGENT_ORG_REWORK:";

fn call(name: &str, arguments: Value, stage: usize, scope: &str) -> Vec<ToolCallRequest> {
    let scope_digest = format!("{:x}", Sha256::digest(scope.as_bytes()));
    vec![ToolCallRequest {
        id: format!("e2e-rework-{}-{name}-{stage}", &scope_digest[..16]),
        name: name.into(),
        arguments,
        thought_signature: None,
    }]
}

fn node(key: &str, owner: Option<&str>, dependencies: &[&str]) -> Value {
    let mut node = json!({
        "key":key, "subject":format!("{MARKER}{key}"),
        "description":format!("{MARKER}{key}: preserve evidence and verify the current version"),
        "execution_mode":"build", "depends_on":dependencies
    });
    if let Some(owner) = owner {
        node["owner_member_id"] = owner.into();
    } else {
        node["eligible_member_ids"] = json!(["sde-planner"]);
    }
    node
}

fn completed_id(messages: &[Value], suffix: &str) -> Option<String> {
    messages
        .iter()
        .rev()
        .filter(|m| m["role"] == "user")
        .find_map(|message| {
            let text = content_text(&message["content"])?;
            for part in text.split("<task_completed ").skip(1) {
                let tag = part.split_once("</task_completed>")?.0;
                if tag.contains(&format!("subject=\"{MARKER}{suffix}\"")) {
                    return xml_attribute_value(
                        &format!("<task_completed {tag}"),
                        "task_completed",
                        "task_id",
                    );
                }
            }
            // A delivered inbox batch becomes readable transcript history on the
            // next Turn. A new trigger can yield before its output was inspected.
            let normalized = text.replace("\\n", "\n");
            let mut lines = normalized.lines();
            while let Some(line) = lines.next() {
                if line.starts_with("Task completed by ")
                    && line.ends_with(&format!(": {MARKER}{suffix}"))
                {
                    return lines.next()?.strip_prefix("Task ID: ").map(str::to_owned);
                }
            }
            None
        })
}

pub(super) fn tool_calls(messages: &[Value], tools: Option<&[Value]>) -> Vec<ToolCallRequest> {
    if !messages
        .iter()
        .filter_map(|m| content_text(&m["content"]))
        .any(|text| text.contains(MARKER))
    {
        return vec![];
    }
    let Some((start, text)) = messages
        .iter()
        .enumerate()
        .rev()
        .find_map(|(index, message)| {
            (message["role"] == "user")
                .then(|| content_text(&message["content"]))
                .flatten()
                .filter(|text| !text.trim_start().starts_with("<system-reminder>"))
                .map(|text| (index, text))
        })
    else {
        return vec![];
    };
    // A persistent member can execute several Tasks. Distinct input turns
    // must not reuse IDs and attach their results to an older tool message.
    let call = |name, arguments, stage| call(name, arguments, stage, &text);
    let results = messages[start + 1..]
        .iter()
        .filter(|message| message["role"] == "tool")
        .filter_map(|message| tool_result_json(&message["content"]))
        .collect::<Vec<_>>();
    let history_results = messages
        .iter()
        .filter(|message| message["role"] == "tool")
        .filter_map(|message| tool_result_json(&message["content"]))
        .collect::<Vec<_>>();
    let stage = results.len();
    if is_task_assignment(&text) {
        if !E2eFakeProvider::has_tool(tools, TASK_UPDATE_TOOL) {
            return vec![];
        }
        let Some(id) = task_assignment_value(&text, "Task ID:", "task_id") else {
            return vec![];
        };
        if stage == 0 {
            return call(
                TASK_UPDATE_TOOL,
                json!({"operation":"start","id":id}),
                stage,
            );
        }
        if stage == 1 {
            let subject = xml_attribute_value(&text, "task_assigned", "subject").or_else(|| {
                text.lines().find_map(|line| {
                    line.strip_prefix("Task assigned by ")?
                        .split_once(": ")
                        .map(|(_, subject)| subject.to_owned())
                })
            });
            let evidence = if subject.as_deref() == Some(&format!("{MARKER}review")) {
                "Defect observed in first version; repair and new verification required."
            } else if subject.as_deref() == Some(&format!("{MARKER}retest")) {
                "Repaired version verified by the new dependent verification task."
            } else {
                "Assigned deliverable finished through the real task execution path."
            };
            return call(
                TASK_UPDATE_TOOL,
                json!({
                    "operation":"complete","id":id,
                    "output":{"summary":format!("{MARKER}{evidence}"),"content":evidence}
                }),
                stage,
            );
        }
        return vec![];
    }
    if !E2eFakeProvider::has_tool(tools, TASK_GRAPH_CREATE_TOOL) {
        return vec![];
    }
    if text.starts_with(&format!("Run {MARKER}")) {
        return if stage == 0 {
            call(
                TASK_GRAPH_CREATE_TOOL,
                json!({"tasks":[
                    node("implementation", Some("sde-implementer"), &[]),
                    node("review", Some("sde-reviewer"), &["implementation"]),
                    node("delivery", None, &["review"])
                ]}),
                stage,
            )
        } else {
            vec![]
        };
    }
    if let Some(delivery_id) = completed_id(messages, "delivery") {
        let observed = results
            .iter()
            .filter_map(|result| result.get("task"))
            .filter(|task| task["output"].is_object())
            .collect::<Vec<_>>();
        let mut needed = vec![delivery_id];
        for task in &observed {
            if let Some(ids) = task["blocked_by"].as_array() {
                needed.extend(ids.iter().filter_map(Value::as_str).map(str::to_owned));
            }
            if let Some(id) = task["replaces_task_id"].as_str() {
                needed.push(id.into());
            }
        }
        if let Some(id) = needed
            .iter()
            .find(|id| !observed.iter().any(|task| task["id"] == **id))
        {
            return call("task_get", json!({"id":id}), stage);
        }
        if !results.iter().any(|result| result.get("outcome").is_some()) {
            return call(
                ORG_RUN_COMPLETE_TOOL,
                json!({
                    "candidate_outcome":"delivered",
                    "summary":"Original defect preserved; replacement and new verification completed, pending consumer explicitly redirected."
                }),
                stage,
            );
        }
        return vec![];
    }
    let Some(review_id) = completed_id(messages, "review") else {
        return vec![];
    };
    let Some(review) = history_results
        .iter()
        .rev()
        .map(|result| &result["task"])
        .find(|task| task["id"] == review_id && task["output"].is_object())
    else {
        return call("task_get", json!({"id":review_id}), stage);
    };
    let graph = history_results
        .iter()
        .rev()
        .filter_map(|result| result["task_id_by_key"].as_object())
        .find(|graph| graph.contains_key("repair") && graph.contains_key("retest"));
    let Some(graph) = graph else {
        let Some(original_id) = review["blocked_by"].get(0).and_then(Value::as_str) else {
            return vec![];
        };
        let mut repair = node("repair", Some("sde-implementer"), &[]);
        repair["replaces_task_id"] = original_id.into();
        let mut retest = node("retest", Some("sde-tester"), &["repair"]);
        retest["replaces_task_id"] = review_id.into();
        return call(
            TASK_GRAPH_CREATE_TOOL,
            json!({
                "allow_parallel_with_existing_open_tasks":true, "tasks":[repair,retest]
            }),
            stage,
        );
    };
    // Use the actual graph receipt, including after a fresh inbox Turn; do not
    // poll task_list or recreate a graph already committed in an earlier Turn.
    let delivery_id = history_results
        .iter()
        .find_map(|result| result["task_id_by_key"]["delivery"].as_str());
    if let Some(delivery_id) = delivery_id {
        if !history_results.iter().any(|result| {
            result["task"]["id"] == delivery_id
                && result["task"]["blocked_by"] == json!([graph["retest"]])
                && result["task"]["owner_member_id"] == "sde-planner"
        }) {
            return call(
                TASK_UPDATE_TOOL,
                json!({
                    "operation":"patch_pending", "id":delivery_id,
                    "owner_member_id":"sde-planner", "blocked_by":[graph["retest"]]
                }),
                stage,
            );
        }
    }
    vec![]
}

#[cfg(test)]
#[path = "agent_org_rework_tests.rs"]
mod tests;
