use serde_json::{json, Value};

use crate::sources::imported_history::{self, ImportedToolCall};

use super::super::super::desktop_exec::normalize_codex_exec_tool_calls;
use super::super::super::normalize::{
    normalize_codex_tool_calls, normalize_tool_name_key, normalize_web_search_args,
};

const ORGII_MATERIALIZED_RAW_NAME_PREFIX: &str = "orgii_materialized_native::";
const ORGII_MATERIALIZED_ARGUMENT_KEY: &str = "__orgiiMaterializedNative";
const ORGII_CANONICAL_ARGUMENT_KEY: &str = "__orgiiCanonicalArguments";

pub(in crate::sources::codex::app::transcript) fn is_orgii_materialized_tool_call(
    call: &ImportedToolCall,
) -> bool {
    call.raw_name
        .starts_with(ORGII_MATERIALIZED_RAW_NAME_PREFIX)
}

pub(super) fn original_raw_tool_name(raw_name: &str) -> &str {
    raw_name
        .strip_prefix(ORGII_MATERIALIZED_RAW_NAME_PREFIX)
        .unwrap_or(raw_name)
}

pub(in crate::sources::codex::app::transcript) fn pending_tool_calls_from_payload(
    payload: &Value,
    created_at: &str,
) -> Option<(String, Vec<ImportedToolCall>)> {
    let call_id = payload.get("call_id")?.as_str()?.to_string();
    let raw_name = payload.get("name")?.as_str()?.to_string();
    let mut arguments = payload
        .get("arguments")
        .and_then(Value::as_str)
        .map(imported_history::parse_inner_json)
        .unwrap_or_else(|| json!({}));
    let materialized_arguments = arguments
        .as_object_mut()
        .and_then(|object| object.remove(ORGII_MATERIALIZED_ARGUMENT_KEY))
        .and_then(|value| value.as_bool())
        == Some(true);
    if materialized_arguments {
        if let Some(canonical) = arguments
            .as_object_mut()
            .and_then(|object| object.remove(ORGII_CANONICAL_ARGUMENT_KEY))
        {
            arguments = canonical;
        }
    }
    if materialized_arguments
        || payload
            .get("orgii_materialization")
            .and_then(Value::as_bool)
            == Some(true)
    {
        return Some((
            call_id.clone(),
            vec![ImportedToolCall {
                call_id,
                raw_name: format!("{ORGII_MATERIALIZED_RAW_NAME_PREFIX}{raw_name}"),
                canonical_name: raw_name,
                args: arguments,
                created_at: created_at.to_string(),
            }],
        ));
    }
    let normalized_calls = normalize_codex_tool_calls(&raw_name, arguments);
    let call_count = normalized_calls.len();
    if call_count == 0 {
        return None;
    }
    let calls = normalized_calls
        .into_iter()
        .enumerate()
        .map(|(index, (canonical_name, args))| ImportedToolCall {
            call_id: split_call_id(&call_id, index, call_count),
            raw_name: raw_name.clone(),
            canonical_name,
            args,
            created_at: created_at.to_string(),
        })
        .collect();
    Some((call_id, calls))
}

pub(crate) fn pending_custom_tool_calls_from_payload(
    payload: &Value,
    created_at: &str,
) -> Option<(String, Vec<ImportedToolCall>)> {
    let call_id = payload.get("call_id")?.as_str()?.to_string();
    let raw_name = payload.get("name")?.as_str()?.to_string();
    let input = payload
        .get("input")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let normalized_calls = if normalize_tool_name_key(&raw_name) == "exec" {
        normalize_codex_exec_tool_calls(input)
    } else {
        let args = if raw_name == "apply_patch" {
            json!({ "patch": input })
        } else {
            json!({ "input": input })
        };
        normalize_codex_tool_calls(&raw_name, args)
    };
    let call_count = normalized_calls.len();
    if call_count == 0 {
        return None;
    }
    let calls = normalized_calls
        .into_iter()
        .enumerate()
        .map(|(index, (canonical_name, args))| ImportedToolCall {
            call_id: split_call_id(&call_id, index, call_count),
            raw_name: raw_name.clone(),
            canonical_name,
            args,
            created_at: created_at.to_string(),
        })
        .collect();
    Some((call_id, calls))
}

pub(in crate::sources::codex::app::transcript) fn web_search_call_from_payload(
    payload: &Value,
    created_at: &str,
) -> Option<ImportedToolCall> {
    let call_id = payload.get("id")?.as_str()?.to_string();
    let action = payload.get("action").cloned().unwrap_or_else(|| json!({}));
    Some(ImportedToolCall {
        call_id,
        raw_name: "web_search_call".to_string(),
        canonical_name: "web_search".to_string(),
        args: normalize_web_search_args(action),
        created_at: created_at.to_string(),
    })
}

fn split_call_id(call_id: &str, index: usize, total: usize) -> String {
    if total <= 1 {
        call_id.to_string()
    } else {
        format!("{call_id}:part-{index}")
    }
}
