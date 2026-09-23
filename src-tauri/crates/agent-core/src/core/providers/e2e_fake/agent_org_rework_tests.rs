use super::*;

#[test]
fn assignment_evidence_belongs_to_its_subject_not_dependency_text() {
    let tools = [json!({"type":"function","function":{"name":TASK_UPDATE_TOOL}})];
    let messages = vec![
        json!({"role":"user","content":format!(
            "<task_assigned task_id=\"delivery\" subject=\"{MARKER}delivery\">Depends on {MARKER}review and {MARKER}retest</task_assigned>"
        )}),
        tool_result(json!({})),
    ];
    let calls = tool_calls(&messages, Some(&tools));
    assert_eq!(
        calls[0].arguments["output"]["content"],
        "Assigned deliverable finished through the real task execution path."
    );
}

#[test]
fn assignment_committed_does_not_count_as_delivery_completion() {
    let messages = [json!({"role":"user","content":format!(
        "<task_assignment_committed task_id=\"delivery\" subject=\"{MARKER}delivery\"/><task_completed task_id=\"retest\" subject=\"{MARKER}retest\">Verified</task_completed>"
    )})];
    assert_eq!(completed_id(&messages, "delivery"), None);
    assert_eq!(completed_id(&messages, "retest").as_deref(), Some("retest"));
}

#[test]
fn graph_committed_before_yield_resumes_with_missing_dependency_patch() {
    let tools = [json!({"type":"function","function":{"name":TASK_GRAPH_CREATE_TOOL}})];
    let messages = vec![
        tool_result(json!({"task_id_by_key":{"delivery":"delivery"}})),
        completed_history("review", "review"),
        tool_result(json!({"task":{"id":"review","output":{},"blocked_by":["original"]}})),
        tool_result(json!({"task_id_by_key":{"repair":"repair","retest":"retest"}})),
        idle(),
    ];
    let calls = tool_calls(&messages, Some(&tools));
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].name, TASK_UPDATE_TOOL);
    assert_eq!(calls[0].arguments["operation"], "patch_pending");
    assert_eq!(calls[0].arguments["id"], "delivery");
    assert_eq!(calls[0].arguments["blocked_by"], json!(["retest"]));
}

fn tool_result(result: Value) -> Value {
    json!({"role":"tool", "content":result.to_string()})
}

fn completed_history(task: &str, subject: &str) -> Value {
    json!({"role":"user", "content":format!(
        "[Agent Org inbox message id=23]\\nTask completed by member: {MARKER}{subject}\\nTask ID: {task}\\nEvidence"
    )})
}

fn idle() -> Value {
    json!({"role":"user", "content":"<inbox-batch><member_idle member_id=\"sde-planner\"/></inbox-batch>"})
}

#[test]
fn delivery_resumes_after_new_trigger_yields_before_reading_evidence() {
    let tools = [json!({"type":"function","function":{"name":TASK_GRAPH_CREATE_TOOL}})];
    let mut messages = vec![
        completed_history("delivery", "delivery"),
        tool_result(json!({"code":"coordinator_new_trigger_pending"})),
        idle(),
    ];
    let calls = tool_calls(&messages, Some(&tools));
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].name, "task_get");
    assert_eq!(calls[0].arguments["id"], "delivery");
    messages.push(tool_result(json!({"task":{
        "id":"delivery", "output":{"content":"verified"}, "blocked_by":[]
    }})));
    let calls = tool_calls(&messages, Some(&tools));
    assert_eq!(calls[0].name, ORG_RUN_COMPLETE_TOOL);
}

#[test]
fn completed_rework_graph_is_not_recreated_on_later_idle() {
    let tools = [json!({"type":"function","function":{"name":TASK_GRAPH_CREATE_TOOL}})];
    let messages = vec![
        completed_history("review", "review"),
        tool_result(json!({"task":{"id":"review","output":{},"blocked_by":["original"]}})),
        tool_result(json!({"task_id_by_key":{"delivery":"delivery"}})),
        tool_result(json!({"task_id_by_key":{"repair":"repair","retest":"retest"}})),
        tool_result(
            json!({"task":{"id":"delivery","blocked_by":["retest"],"owner_member_id":"sde-planner"}}),
        ),
        idle(),
    ];
    assert!(tool_calls(&messages, Some(&tools)).is_empty());
}

#[test]
fn review_resumes_after_new_trigger_before_graph_creation() {
    let tools = [json!({"type":"function","function":{"name":TASK_GRAPH_CREATE_TOOL}})];
    let messages = vec![
        completed_history("review", "review"),
        tool_result(json!({"code":"coordinator_new_trigger_pending"})),
        idle(),
    ];
    let calls = tool_calls(&messages, Some(&tools));
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].name, "task_get");
    assert_eq!(calls[0].arguments["id"], "review");
}

#[test]
fn repeated_member_tasks_have_distinct_provider_call_ids() {
    let tools = [json!({"type":"function","function":{"name":TASK_UPDATE_TOOL}})];
    let assignment = |id| {
        json!({"role":"user","content":format!(
            "<task_assigned task_id=\"{id}\" subject=\"{MARKER}implementation\">{MARKER}work</task_assigned>"
        )})
    };
    let mut messages = vec![assignment("old-task")];
    let old = tool_calls(&messages, Some(&tools));
    messages.push(json!({"role":"tool","tool_call_id":old[0].id,"content":"{}"}));
    let old_complete = tool_calls(&messages, Some(&tools));
    messages.push(assignment("new-task"));
    let new = tool_calls(&messages, Some(&tools));
    assert_eq!(new[0].arguments["id"], "new-task");
    assert_ne!(old[0].id, new[0].id);
    messages.push(json!({"role":"tool","tool_call_id":new[0].id,"content":"{}"}));
    let new_complete = tool_calls(&messages, Some(&tools));
    assert_eq!(new_complete[0].arguments["operation"], "complete");
    assert_ne!(old_complete[0].id, new_complete[0].id);
}
