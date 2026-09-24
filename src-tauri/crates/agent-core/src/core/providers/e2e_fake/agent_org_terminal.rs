//! Deterministic provider windows; all Task and Stop writes use production paths.
use super::*;

const MARKER: &str = "E2E_AGENT_ORG_TERMINAL:";

fn scenario(messages: &[Value]) -> Option<(String, String, usize)> {
    let (index, text) = messages
        .iter()
        .enumerate()
        .rev()
        .filter(|(_, message)| message["role"] == "user")
        .filter_map(|(index, message)| content_text(&message["content"]).map(|text| (index, text)))
        .find(|(_, text)| {
            text.contains(MARKER) && !text.trim_start().starts_with("<system-reminder>")
        })?;
    let id: String = text
        .split(MARKER)
        .nth(1)?
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
        .take(64)
        .collect();
    let stage = messages[index + 1..]
        .iter()
        .filter(|message| message["role"] == "tool")
        .count();
    Some((id, text, stage))
}

pub(super) fn tool_calls(messages: &[Value], tools: Option<&[Value]>) -> Vec<ToolCallRequest> {
    let Some((id, text, stage)) = scenario(messages) else {
        return Vec::new();
    };
    if stage != 0 {
        return Vec::new();
    }
    let (name, arguments) = if is_task_assignment(&text) {
        if !id.starts_with("tool_") {
            return Vec::new();
        }
        (
            RUN_SHELL_TOOL,
            serde_json::json!({
                "command": "printf 'TERMINAL_TOOL_STARTED\\n'; sleep 45; printf 'TERMINAL_TOOL_FINISHED\\n'",
                "description": "Finite synchronous tool Stop window", "mode": "blocking", "wait": 60
            }),
        )
    } else if text.contains(&format!("Run {MARKER}")) {
        (
            TASK_GRAPH_CREATE_TOOL,
            serde_json::json!({
                "tasks": [{"key":"terminal-work", "subject":format!("{MARKER}{id}"),
                "description":"Exercise the accepted execution terminal boundary.",
                "owner_member_id":"sde-reviewer", "execution_mode":"build"}]
            }),
        )
    } else {
        return Vec::new();
    };
    if !E2eFakeProvider::has_tool(tools, name) {
        return Vec::new();
    }
    vec![ToolCallRequest {
        id: format!("terminal-{id}-{stage}"),
        name: name.into(),
        arguments,
        thought_signature: None,
    }]
}

pub(super) fn member_window(messages: &[Value]) -> Option<String> {
    let (id, text, _) = scenario(messages)?;
    is_task_assignment(&text).then_some(id)
}

/// Repeated deltas keep the streaming window observable after Member navigation.
pub(super) async fn stream_window(
    on_delta: &(dyn Fn(StreamDelta) + Send + Sync),
    cancel_flag: Option<&AtomicBool>,
) -> Result<(), ProviderError> {
    for _ in 0..60 {
        if cancel_flag.is_some_and(|flag| flag.load(std::sync::atomic::Ordering::Relaxed)) {
            return Err(ProviderError::Cancelled);
        }
        on_delta(StreamDelta {
            content: Some("TERMINAL_STREAM_STARTED ".into()),
            reasoning: None,
            tool_call_delta: None,
            finish_reason: None,
            usage: None,
        });
        sleep(Duration::from_millis(500)).await;
    }
    Ok(())
}
