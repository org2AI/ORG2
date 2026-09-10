//! TUI commands require protocol operations; sending their names as turn text
//! merely asks the model to interpret them. Keep the supported native mapping
//! at the transport boundary so typed, queued and resumed turns agree.
use serde_json::{json, Value};

#[derive(Debug, PartialEq, Eq)]
pub(super) enum NativeCommand {
    Compact,
    Init(String),
    Review(String),
}

pub(super) fn parse(text: &str, has_images: bool) -> Result<Option<NativeCommand>, String> {
    if has_images {
        return Ok(None);
    }
    let text = text.trim();
    let (name, arguments) = text.split_once(char::is_whitespace).unwrap_or((text, ""));
    let arguments = arguments.trim();
    match name {
        "/compact" if arguments.is_empty() => Ok(Some(NativeCommand::Compact)),
        "/compact" => Err("Codex's native compaction does not accept focus instructions. Use /compact without arguments.".into()),
        "/init" => Ok(Some(NativeCommand::Init(arguments.into()))),
        "/review" => Ok(Some(NativeCommand::Review(arguments.into()))),
        _ => Ok(None),
    }
}

pub(super) fn review_params(thread_id: &str, instructions: &str) -> Value {
    let target = if instructions.is_empty() {
        json!({"type": "uncommittedChanges"})
    } else {
        json!({"type": "custom", "instructions": instructions})
    };
    json!({"threadId": thread_id, "delivery": "inline", "target": target})
}

/// Take only enabled skills reported for this request's working directory.
/// Paths are supplied by the provider; never resolve an arbitrary user path.
pub(super) fn skills(response: &Value) -> Vec<(String, String)> {
    response
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|entry| {
            entry
                .get("skills")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .filter(|skill| skill.get("enabled").and_then(Value::as_bool) == Some(true))
        .filter_map(|skill| {
            let name = skill.get("name")?.as_str()?;
            let path = skill.get("path")?.as_str()?;
            if name.is_empty() || name.len() > 256 || path.len() > 8192 {
                return None;
            }
            Some((name.to_string(), path.to_string()))
        })
        .take(512)
        .collect()
}

pub(super) fn skill_input(text: &str, skills: &[(String, String)]) -> Option<Value> {
    let name = text.trim().strip_prefix('/')?.split_whitespace().next()?;
    let (_, path) = skills.iter().find(|(candidate, _)| candidate == name)?;
    Some(json!({"type": "skill", "name": name, "path": path}))
}

pub(super) fn init_prompt(instructions: &str) -> String {
    format!("Inspect this repository and create or update AGENTS.md with concise, repository-specific instructions for coding agents. Include the actual build/test commands and conventions you verify. Preserve useful existing guidance. Additional user instructions: {instructions}")
}

pub(super) fn skill_name(text: &str) -> Option<&str> {
    let token = text.split_whitespace().next()?.strip_prefix('/')?;
    if token.is_empty()
        || !token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':'))
    {
        return None;
    }
    Some(token)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn commands_are_exact_and_attachments_remain_messages() {
        assert_eq!(
            parse(" /compact \n", false).unwrap(),
            Some(NativeCommand::Compact)
        );
        assert!(parse("/compact preserve APIs", false).is_err());
        for text in ["explain /compact", "/compactly", "/reviewer", "/my-skill"] {
            assert_eq!(parse(text, false).unwrap(), None);
        }
        assert_eq!(parse("/compact", true).unwrap(), None);
    }
    #[test]
    fn review_uses_native_operation_and_preserves_literal_instructions() {
        assert_eq!(
            parse("/review security\nfocus", false).unwrap(),
            Some(NativeCommand::Review("security\nfocus".into()))
        );
        assert_eq!(
            review_params("t", "")["target"],
            json!({"type":"uncommittedChanges"})
        );
        assert_eq!(
            review_params("t", "$(echo literal)")["target"],
            json!({"type":"custom", "instructions":"$(echo literal)"})
        );
        assert_eq!(review_params("t", "")["delivery"], "inline");
    }
}
