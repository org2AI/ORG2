//! Test provider behavior only: real task tools create the work and evidence.
use super::*;
use serde_json::json;
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

const SCENARIO: &str = "member_end_wait_";
const PAUSE_RESUME_BEFORE_COMPLETE_SCENARIO: &str = "pause_resume_before_complete_";

static HELD_BEFORE_COMPLETION: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

pub(super) fn tool_calls(messages: &[Value], tools: Option<&[Value]>) -> Vec<ToolCallRequest> {
    if !E2eFakeProvider::has_tool(tools, ORG_RUN_COMPLETE_TOOL) {
        return vec![];
    }
    let Some((start, task_id)) = messages
        .iter()
        .enumerate()
        .rev()
        .find_map(|(index, message)| {
            if message["role"] != "user" {
                return None;
            }
            let text = content_text(&message["content"])?;
            if !text.contains(SCENARIO) {
                return None;
            }
            Some((
                index,
                xml_attribute_value(&text, "task_completed", "task_id")?,
            ))
        })
    else {
        return vec![];
    };
    let results = messages[start + 1..]
        .iter()
        .filter(|m| m["role"] == "tool")
        .filter_map(|m| tool_result_json(&m["content"]))
        .collect::<Vec<_>>();
    if results
        .iter()
        .any(|r| r["outcome"] == "waiting" || r["outcome"] == "requires_input")
    {
        return vec![];
    }
    let presented = results
        .iter()
        .any(|r| r["task"]["id"] == task_id && r["task"]["output"].is_object());
    let (name, arguments) = if presented {
        (
            ORG_RUN_COMPLETE_TOOL,
            json!({"candidate_outcome":"delivered","summary":"Complete evidence reviewed; wait for the member to end."}),
        )
    } else {
        ("task_get", json!({"id":task_id}))
    };
    vec![ToolCallRequest {
        id: format!("e2e-{SCENARIO}-{name}"),
        name: name.into(),
        arguments,
        thought_signature: None,
    }]
}

pub(super) fn member_wait(messages: &[Value]) -> bool {
    let Some((start, text)) = messages
        .iter()
        .enumerate()
        .rev()
        .find_map(|(index, message)| {
            (message["role"] == "user")
                .then(|| content_text(&message["content"]))
                .flatten()
                .filter(|text| text.contains(SCENARIO) && is_task_assignment(text))
                .map(|text| (index, text))
        })
    else {
        return false;
    };
    text.contains(SCENARIO)
        && is_task_assignment(&text)
        && messages[start + 1..]
            .iter()
            .filter(|m| m["role"] == "tool")
            .count()
            >= 2
}

/// Give the rendered Pause/Resume test a deterministic window after the
/// owning member has started its Task but before it records completion. The
/// first provider call for the scenario waits until Pause cancels it; the
/// durable Resume continuation sees the same transcript and proceeds.
pub(super) fn pause_before_completion_wait(messages: &[Value]) -> bool {
    let Some((start, text)) = messages
        .iter()
        .enumerate()
        .rev()
        .find_map(|(index, message)| {
            (message["role"] == "user")
                .then(|| content_text(&message["content"]))
                .flatten()
                .filter(|text| {
                    text.contains(PAUSE_RESUME_BEFORE_COMPLETE_SCENARIO) && is_task_assignment(text)
                })
                .map(|text| (index, text))
        })
    else {
        return false;
    };
    let Some(scenario_id) = completion_scenario_id(&text) else {
        return false;
    };
    if !scenario_id.contains(PAUSE_RESUME_BEFORE_COMPLETE_SCENARIO)
        || messages[start + 1..]
            .iter()
            .filter(|message| message["role"] == "tool")
            .count()
            != 1
    {
        return false;
    }
    HELD_BEFORE_COMPLETION
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
        .expect("E2E completion hold lock")
        .insert(scenario_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn complete_only_after_full_task_get_and_yield_after_request() {
        let tools = [json!({"type":"function","function":{"name":ORG_RUN_COMPLETE_TOOL}})];
        let mut messages = vec![
            json!({"role":"user","content":"<task_completed task_id=\"task-1\">E2E member_end_wait_test</task_completed>"}),
        ];
        assert_eq!(tool_calls(&messages, Some(&tools))[0].name, "task_get");
        messages.push(json!({"role":"tool","content":json!({"task":{"id":"task-1","output":{"content":"Full evidence"}}}).to_string()}));
        assert_eq!(
            tool_calls(&messages, Some(&tools))[0].name,
            ORG_RUN_COMPLETE_TOOL
        );
        messages.push(json!({"role":"tool","content":"{\"outcome\":\"waiting\"}"}));
        assert!(tool_calls(&messages, Some(&tools)).is_empty());
    }

    #[test]
    fn pause_window_only_holds_the_first_pre_completion_call() {
        let messages = vec![
            json!({
                "role":"user",
                "content":"Task assigned by coordinator: E2E_AGENT_ORG_COMPLETION:member_end_wait_pause_resume_before_complete_unit_1\nTask ID: task-1"
            }),
            json!({"role":"tool","content":"{}"}),
        ];
        assert!(pause_before_completion_wait(&messages));
        assert!(!pause_before_completion_wait(&messages));
    }
}
