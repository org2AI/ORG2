//! Byte-level JSON prefilters for transcript indexers.
//!
//! Indexers walk very large JSONL transcripts without deserializing every
//! record, so they classify lines by raw bytes. A field is matched at any
//! depth: a hit may come from a nested object, but a miss proves the field is
//! absent everywhere, top level included. Callers rely on exactly that — use a
//! hit to over-approximate, never to prove a top-level shape.

/// Scan every `"field":` occurrence and report whether `value_matches`
/// accepts one of them, given the index of its value's first byte.
pub(crate) fn line_might_contain_json_field(
    line: &[u8],
    field: &[u8],
    value_matches: impl Fn(usize) -> bool,
) -> bool {
    let mut key = Vec::with_capacity(field.len() + 2);
    key.push(b'"');
    key.extend_from_slice(field);
    key.push(b'"');
    let mut cursor = 0usize;
    while let Some(relative) = line[cursor..]
        .windows(key.len())
        .position(|window| window == key)
    {
        let mut index = cursor + relative + key.len();
        while line.get(index).is_some_and(u8::is_ascii_whitespace) {
            index += 1;
        }
        if line.get(index) != Some(&b':') {
            cursor = index;
            continue;
        }
        index += 1;
        while line.get(index).is_some_and(u8::is_ascii_whitespace) {
            index += 1;
        }
        if value_matches(index) {
            return true;
        }
        cursor = index;
    }
    false
}

/// `"field": "value"` appears somewhere in the line.
pub(crate) fn line_might_contain_json_string_field(
    line: &[u8],
    field: &[u8],
    value: &[u8],
) -> bool {
    line_might_contain_json_field(line, field, |index| {
        line.get(index) == Some(&b'"')
            && line.get(index + 1..index + 1 + value.len()) == Some(value)
            && line.get(index + 1 + value.len()) == Some(&b'"')
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_fields_at_any_depth_with_json_whitespace() {
        let line = br#"{"payload": {"type" : "message", "role":"assistant"}}"#;
        assert!(line_might_contain_json_string_field(
            line, b"type", b"message"
        ));
        assert!(line_might_contain_json_string_field(
            line,
            b"role",
            b"assistant"
        ));
        assert!(line_might_contain_json_field(line, b"payload", |_| true));
    }

    #[test]
    fn ignores_escaped_text_and_longer_names() {
        let line = br#"{"type":"user","text":"{\"type\":\"message\"}","messageId":"m","encrypted_content":"x"}"#;
        assert!(!line_might_contain_json_string_field(
            line, b"type", b"message"
        ));
        assert!(!line_might_contain_json_field(line, b"message", |_| true));
        assert!(!line_might_contain_json_field(line, b"content", |_| true));
    }
}
