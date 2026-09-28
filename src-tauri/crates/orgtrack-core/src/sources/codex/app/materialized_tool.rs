//! Lossless tool-result transport for ORG2-injected Codex response items.
//!
//! The version is carried by the native function-item ID, outside user text.
//! The output remains a normal Codex string containing an exec-style envelope.
//! Decode it exactly once; its body is never another execution envelope.

use serde::Deserialize;
use serde_json::{json, Value};

pub const MATERIALIZED_TOOL_ID_PREFIX: &str = "fc_orgii_v1_";

pub fn encode_tool_output(output: &str, is_error: bool, interrupted: bool) -> Value {
    let exit_code = if interrupted {
        130
    } else if is_error {
        1
    } else {
        0
    };
    Value::String(json!({"exit_code": exit_code, "output": output}).to_string())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct MaterializedToolOutput {
    pub output: String,
    pub exit_code: i64,
}

pub(super) fn decode_tool_output(value: Option<&Value>) -> Result<MaterializedToolOutput, String> {
    let text = value
        .and_then(Value::as_str)
        .ok_or("Materialized tool output must be a string")?;
    let decoded: MaterializedToolOutput = serde_json::from_str(text)
        .map_err(|_| "Invalid materialized tool output envelope".to_string())?;
    if !matches!(decoded.exit_code, 0 | 1 | 130) {
        return Err("Invalid materialized tool output status".into());
    }
    Ok(decoded)
}
