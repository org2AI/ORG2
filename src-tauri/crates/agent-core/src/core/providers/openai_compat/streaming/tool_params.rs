//! Tool parameters shared by streaming and whole-response requests.

use serde_json::Value;

use super::translate_tool_choice_for_openai;
use crate::providers::traits::ProviderError;
use crate::providers::wire_sanitize::strip_tool_schema_cache_scopes;

pub(super) fn build_tool_params(
    tools: Option<&[Value]>,
    send_auto: bool,
) -> Result<(Option<Vec<Value>>, Option<Value>), ProviderError> {
    let wire_tools = strip_tool_schema_cache_scopes(tools.unwrap_or_default());
    let (override_value, tools) =
        crate::core::side_query::extract_tool_choice_override(&wire_tools);
    let choice = override_value
        .as_ref()
        .map(translate_tool_choice_for_openai);
    if let Some(choice) = &choice {
        if let Some(name) = choice.pointer("/function/name").and_then(Value::as_str) {
            if !tools
                .iter()
                .any(|tool| tool.pointer("/function/name").and_then(Value::as_str) == Some(name))
            {
                return Err(ProviderError::InvalidRequest {
                    status: None,
                    parameter: Some("tool_choice".into()),
                    message: format!("The selected tool '{name}' is absent from the tool list"),
                });
            }
        }
        if tools.is_empty() && choice.as_str() == Some("required") {
            return Err(ProviderError::InvalidRequest {
                status: None,
                parameter: Some("tool_choice".into()),
                message: "Required tool selection needs at least one tool".into(),
            });
        }
    }
    // An empty tool list is a valid text-only turn, but an empty tools field
    // (or an orphan automatic choice) is rejected by strict compatible APIs.
    if tools.is_empty() {
        return Ok((None, None));
    }
    Ok((
        Some(tools),
        choice.or_else(|| send_auto.then(|| Value::String("auto".into()))),
    ))
}
