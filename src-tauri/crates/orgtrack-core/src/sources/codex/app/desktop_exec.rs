use serde_json::{json, Value};

use super::normalize::{
    is_codex_shell_tool_key, normalize_codex_tool_calls, normalize_tool_name_key,
};

/// Codex Desktop records a custom `exec` call whose input is a generated
/// JavaScript wrapper. Extract its real `tools.<name>(...)` operations without
/// evaluating that JavaScript, then route them through the normal Codex tool
/// canonicalizer.
pub(super) fn normalize_codex_exec_tool_calls(input: &str) -> Vec<(String, Value)> {
    let calls = tool_invocations(input);
    if calls.is_empty() {
        return vec![("exec".to_string(), json!({ "input": input }))];
    }
    calls
        .into_iter()
        .flat_map(|(name, expression)| {
            let args = tool_args(input, name, expression);
            if is_codex_shell_tool_key(&normalize_tool_name_key(name)) {
                let statements = args
                    .get("command")
                    .and_then(Value::as_str)
                    .map(split_multiline_shell_script)
                    .unwrap_or_default();
                if statements.len() > 1 {
                    return statements
                        .into_iter()
                        .flat_map(|command| {
                            let mut statement_args = args.clone();
                            if let Some(object) = statement_args.as_object_mut() {
                                object.insert(
                                    "command".to_string(),
                                    Value::String(command.to_string()),
                                );
                            }
                            normalize_codex_tool_calls(name, statement_args)
                        })
                        .collect::<Vec<_>>();
                }
            }
            normalize_codex_tool_calls(name, args)
        })
        .collect()
}

fn split_multiline_shell_script(command: &str) -> Vec<&str> {
    if !command.contains('\n') {
        let statement = command.trim();
        return if statement.is_empty() {
            Vec::new()
        } else {
            vec![statement]
        };
    }
    let mut statements = Vec::new();
    let mut start = 0;
    let mut quote = None;
    let mut escaped = false;
    let mut chars = command.char_indices().peekable();
    while let Some((index, ch)) = chars.next() {
        if escaped {
            escaped = false;
            continue;
        }
        // Backslashes are literal inside single quotes.
        if ch == '\\' && quote != Some('\'') {
            escaped = true;
            continue;
        }
        if let Some(active) = quote {
            if ch == active {
                quote = None;
            }
            continue;
        }
        // A here-document body is input to one shell invocation, not a list
        // of shell commands. Keep the whole script (including any surrounding
        // statements) together so its single process result has one owner.
        // This also safely retains here-strings and tab-stripped heredocs.
        if ch == '<' && chars.peek().is_some_and(|(_, next)| *next == '<') {
            return vec![command];
        }
        // Compound shell syntax cannot be decomposed using line boundaries.
        if matches!(ch, '(' | ')' | '{' | '}') {
            return vec![command];
        }
        if matches!(ch, '\'' | '"' | '`') {
            quote = Some(ch);
        } else if ch == '\n' {
            let statement = command[start..index].trim();
            if statement.ends_with(['|', '&']) {
                return vec![command];
            }
            if !statement.is_empty() {
                statements.push(statement);
            }
            start = index + 1;
        }
    }
    if quote.is_some() || escaped {
        return vec![command];
    }
    let statement = command[start..].trim();
    if !statement.is_empty() {
        statements.push(statement);
    }
    if statements.iter().any(|line| {
        matches!(
            line.split_whitespace().next(),
            Some("if" | "for" | "while" | "until" | "case" | "select" | "function")
        )
    }) {
        return vec![command];
    }
    statements
}

fn tool_args(script: &str, name: &str, expression: &str) -> Value {
    match normalize_tool_name_key(name).as_str() {
        "write_stdin" => json!({
            "session_id": object_i64(expression, "session_id").unwrap_or_default(),
            "chars": object_string(expression, "chars").unwrap_or_default(),
            "yield_time_ms": object_i64(expression, "yield_time_ms").unwrap_or_default(),
            "payload": { "input": expression },
        }),
        key if is_codex_shell_tool_key(key) => json!({
            "command": object_string(expression, "command")
                .or_else(|| object_string(expression, "cmd"))
                .unwrap_or_default(),
            "workdir": object_string(expression, "workdir")
                .or_else(|| object_string(expression, "cwd"))
                .unwrap_or_default(),
            "payload": { "input": expression },
        }),
        "apply_patch" => json!({
            "patch": resolve_string_expression(script, expression).unwrap_or_default(),
        }),
        "web__run" => json!({
            "query": nested_string(expression, "search_query", "q")
                .or_else(|| nested_string(expression, "image_query", "q"))
                .unwrap_or_default(),
            "payload": { "input": expression },
        }),
        _ => json!({ "input": expression }),
    }
}

/// Scan source-order calls while ignoring tool-looking text inside strings.
fn tool_invocations(script: &str) -> Vec<(&str, &str)> {
    let bytes = script.as_bytes();
    let mut calls = Vec::new();
    let mut index = 0usize;
    let mut quote = None;
    while index < bytes.len() {
        if let Some(active) = quote {
            if bytes[index] == b'\\' {
                index = index.saturating_add(2);
                continue;
            }
            if bytes[index] == active {
                quote = None;
            }
            index += 1;
            continue;
        }
        if matches!(bytes[index], b'\'' | b'"' | b'`') {
            quote = Some(bytes[index]);
            index += 1;
            continue;
        }
        if bytes.get(index..index.saturating_add(6)) != Some(b"tools.") {
            index += 1;
            continue;
        }

        let name_start = index + 6;
        let mut name_end = name_start;
        while name_end < bytes.len()
            && (bytes[name_end].is_ascii_alphanumeric() || bytes[name_end] == b'_')
        {
            name_end += 1;
        }
        let mut open = name_end;
        while bytes.get(open).is_some_and(u8::is_ascii_whitespace) {
            open += 1;
        }
        if bytes.get(open) != Some(&b'(') {
            index = name_end.max(index + 1);
            continue;
        }
        let Some(close) = balanced_call_end(script, open) else {
            break;
        };
        let name = &script[name_start..name_end];
        if !matches!(name, "text" | "image" | "generatedImage" | "notify") {
            calls.push((name, script[(open + 1)..close].trim()));
        }
        index = close + 1;
    }
    calls
}

fn balanced_call_end(script: &str, open: usize) -> Option<usize> {
    let bytes = script.as_bytes();
    let mut index = open + 1;
    let mut depth = 1usize;
    let mut quote = None;
    while index < bytes.len() {
        if let Some(active) = quote {
            if bytes[index] == b'\\' {
                index = index.saturating_add(2);
                continue;
            }
            if bytes[index] == active {
                quote = None;
            }
        } else if matches!(bytes[index], b'\'' | b'"' | b'`') {
            quote = Some(bytes[index]);
        } else if bytes[index] == b'(' {
            depth += 1;
        } else if bytes[index] == b')' {
            depth -= 1;
            if depth == 0 {
                return Some(index);
            }
        }
        index += 1;
    }
    None
}

fn object_string(expression: &str, property: &str) -> Option<String> {
    parse_string(object_value(expression, property)?)
}

fn object_i64(expression: &str, property: &str) -> Option<i64> {
    let value = object_value(expression, property)?;
    let end = value
        .char_indices()
        .find_map(|(index, ch)| (!ch.is_ascii_digit() && ch != '-').then_some(index))
        .unwrap_or(value.len());
    value[..end].parse().ok()
}

fn object_value<'a>(expression: &'a str, property: &str) -> Option<&'a str> {
    for key in [
        format!("{property}:"),
        format!("\"{property}\":"),
        format!("'{property}':"),
    ] {
        let mut offset = 0usize;
        while let Some(relative) = expression[offset..].find(&key) {
            let start = offset + relative;
            let previous_is_key_char = start > 0
                && (expression.as_bytes()[start - 1].is_ascii_alphanumeric()
                    || expression.as_bytes()[start - 1] == b'_');
            if previous_is_key_char {
                offset = start + key.len();
                continue;
            }
            return Some(expression[(start + key.len())..].trim_start());
        }
    }
    None
}

fn nested_string(expression: &str, container: &str, property: &str) -> Option<String> {
    let start = expression.find(container)?;
    object_string(&expression[start..], property)
}

fn resolve_string_expression(script: &str, expression: &str) -> Option<String> {
    let expression = expression.trim();
    if let Some(value) = parse_string(expression) {
        return Some(value);
    }
    if !expression
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$'))
    {
        return None;
    }
    for keyword in ["const", "let", "var"] {
        let declaration = format!("{keyword} {expression}");
        let Some(start) = script.find(&declaration) else {
            continue;
        };
        let (_, value) = script[(start + declaration.len())..].split_once('=')?;
        if let Some(value) = parse_string(value.trim_start()) {
            return Some(value);
        }
    }
    None
}

fn parse_string(value: &str) -> Option<String> {
    let quote = *value.as_bytes().first()?;
    if quote == b'"' {
        let mut index = 1usize;
        while index < value.len() {
            match value.as_bytes()[index] {
                b'\\' => index = index.saturating_add(2),
                b'"' => return serde_json::from_str(&value[..=index]).ok(),
                _ => index += 1,
            }
        }
        return None;
    }
    if !matches!(quote, b'\'' | b'`') {
        return None;
    }
    let mut output = String::new();
    let mut escaped = false;
    for ch in value[1..].chars() {
        if escaped {
            output.push(match ch {
                'n' => '\n',
                'r' => '\r',
                't' => '\t',
                other => other,
            });
            escaped = false;
        } else if ch == '\\' {
            escaped = true;
        } else if ch as u32 == quote as u32 {
            return Some(output);
        } else {
            output.push(ch);
        }
    }
    None
}

pub(super) fn codex_tool_output_text(output: Option<&Value>) -> String {
    match output {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| {
                part.get("text")
                    .and_then(Value::as_str)
                    .or_else(|| part.as_str())
            })
            .collect::<Vec<_>>()
            .join(""),
        Some(value) if !value.is_null() => value.to_string(),
        _ => String::new(),
    }
}

pub(super) fn codex_tool_exit_code(output: &str) -> Option<i64> {
    output.lines().find_map(|line| {
        let value = line.trim().strip_prefix("Exit code:")?.trim();
        value.split_whitespace().next()?.parse().ok()
    })
}

pub(super) fn codex_tool_output_failed(output: &str, exit_code: Option<i64>) -> bool {
    exit_code.is_some_and(|code| code != 0)
        || output.lines().any(|line| {
            matches!(
                line.trim(),
                "Script failed" | "Script error:" | "Script error"
            )
        })
}

#[cfg(test)]
mod tests {
    use super::split_multiline_shell_script;

    #[test]
    fn splits_only_unquoted_lines_without_copying_the_command() {
        for (command, expected) in [
            (
                "printf '你好'\r\nprintf done\r\n",
                vec!["printf '你好'", "printf done"],
            ),
            (
                "printf 'a\nb'\nprintf done",
                vec!["printf 'a\nb'", "printf done"],
            ),
            (
                "printf 'a\\'\nprintf done",
                vec!["printf 'a\\'", "printf done"],
            ),
            (
                "printf a\\\nb\nprintf done",
                vec!["printf a\\\nb", "printf done"],
            ),
            ("\n  \nprintf done\n", vec!["printf done"]),
        ] {
            let actual = split_multiline_shell_script(command);
            assert_eq!(actual, expected);
            let source = command.as_bytes().as_ptr_range();
            assert!(actual.iter().all(|part| source.contains(&part.as_ptr())));
        }
    }

    #[test]
    fn preserves_compound_and_incomplete_shell_scripts() {
        for command in [
            "for x in a b; do\nprintf '%s' \"$x\"\ndone",
            "if true; then\nprintf done\nfi",
            "(\nprintf done\n)",
            "value=$(printf a\nprintf b)\nprintf '%s' \"$value\"",
            "printf done |\nwc -c",
            "true &&\nprintf done",
            "echo before\nprintf 'unterminated",
            "echo before\nprintf trailing\\",
            "python3 - <<'PY'\nprint('done')\nPY",
        ] {
            assert_eq!(split_multiline_shell_script(command), vec![command]);
        }
    }
}
