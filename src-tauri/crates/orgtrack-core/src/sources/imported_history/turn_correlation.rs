//! Bounded transport metadata carried through provider-owned user records.
// Reuse the existing internal-context envelope so older replay readers also
// hide the metadata; only new readers consume its correlation field.
const OPEN: &str = "<ide_context>\norgii-turn-intent:";
const CLOSE: &str = "\n</ide_context>";

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 256
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.:".contains(&b))
}

pub fn with_turn_intent(input: &str, intent: &str) -> String {
    if !valid_id(intent) {
        return input.to_string();
    }
    format!("{OPEN}{intent}{CLOSE}\n\n{input}")
}

/// Only our leading envelope is metadata; quoted/body markers are not.
pub fn turn_intent_from_input(input: &str) -> Option<String> {
    let rest = input.strip_prefix(OPEN)?;
    let end = rest.find(CLOSE)?;
    let id = &rest[..end];
    valid_id(id).then(|| id.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_leading_correlation_round_trips_without_accepting_body_markers() {
        let text = with_turn_intent("Hello", "mobile-intent-1");
        assert_eq!(
            turn_intent_from_input(&text).as_deref(),
            Some("mobile-intent-1")
        );
        assert_eq!(super::super::extract_user_request_body(&text), "Hello");
        assert_eq!(turn_intent_from_input(&format!("quoted {text}")), None);
        assert_eq!(
            with_turn_intent("Hello", "bad</orgii_turn_context>"),
            "Hello"
        );
        assert_eq!(with_turn_intent("Hello", &"x".repeat(257)), "Hello");
    }
}
