//! Bounded correlation metadata carried by provider-owned user records.
//! New writers use native client IDs; the old text envelope is read-only compatibility.
const CLIENT_ID_PREFIX: &str = "orgii-turn-intent:";
const OPEN: &str = "<ide_context>\norgii-turn-intent:";
const CLOSE: &str = "\n</ide_context>";

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 256
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.:".contains(&b))
}

/// Native metadata, never part of the user-authored text sent to the provider.
pub fn client_message_id_for_turn_intent(intent: &str) -> Option<String> {
    valid_id(intent).then(|| format!("{CLIENT_ID_PREFIX}{intent}"))
}

/// Decode only our namespace. Invalid owned metadata must not acquire another
/// identity from an older body marker; unrelated client IDs retain legacy replay.
pub fn turn_intent_from_native_message(client_id: Option<&str>, input: &str) -> Option<String> {
    if let Some(intent) = client_id.and_then(|id| id.strip_prefix(CLIENT_ID_PREFIX)) {
        return valid_id(intent).then(|| intent.to_string());
    }
    turn_intent_from_input(input)
}

/// Only our leading historical envelope is metadata; quoted/body markers are not.
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
    fn native_correlation_is_bounded_and_namespaced() {
        for intent in ["mobile-intent-1", "intent_2.with:scope", &"x".repeat(256)] {
            let encoded = client_message_id_for_turn_intent(intent).unwrap();
            assert_eq!(
                turn_intent_from_native_message(Some(&encoded), "Hello").as_deref(),
                Some(intent)
            );
        }
        for invalid in ["", "has space", "é", "bad</ide_context>", &"x".repeat(257)] {
            assert_eq!(client_message_id_for_turn_intent(invalid), None);
            let encoded = format!("{CLIENT_ID_PREFIX}{invalid}");
            assert_eq!(
                turn_intent_from_native_message(Some(&encoded), "Hello"),
                None
            );
        }
        assert_eq!(
            turn_intent_from_native_message(Some("foreign-message-1"), "Hello"),
            None
        );
    }

    #[test]
    fn native_metadata_wins_and_malformed_owned_metadata_cannot_fall_back() {
        let historical = "<ide_context>\norgii-turn-intent:old-intent\n</ide_context>\n\nHello";
        assert_eq!(
            turn_intent_from_native_message(Some("orgii-turn-intent:new-intent"), historical)
                .as_deref(),
            Some("new-intent")
        );
        for invalid in ["orgii-turn-intent:", "orgii-turn-intent:has space"] {
            assert_eq!(
                turn_intent_from_native_message(Some(invalid), historical),
                None
            );
        }
        for unrelated in [None, Some("foreign-message-1")] {
            assert_eq!(
                turn_intent_from_native_message(unrelated, historical).as_deref(),
                Some("old-intent")
            );
        }
    }

    #[test]
    fn historical_leading_correlation_rejects_body_markers_and_invalid_ids() {
        let text = "<ide_context>\norgii-turn-intent:mobile-intent-1\n</ide_context>\n\nHello";
        assert_eq!(
            turn_intent_from_input(text).as_deref(),
            Some("mobile-intent-1")
        );
        assert_eq!(super::super::extract_user_request_body(text), "Hello");
        assert_eq!(turn_intent_from_input(&format!("quoted {text}")), None);
        assert_eq!(
            turn_intent_from_input("<ide_context>\norgii-turn-intent:bad id\n</ide_context>"),
            None
        );
    }
}
