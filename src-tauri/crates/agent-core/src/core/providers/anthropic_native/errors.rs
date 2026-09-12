//! HTTP error parsing for the Anthropic Messages API.
//!
//! Maps `(status, body)` pairs into a typed `ProviderError` so callers
//! (streaming + non-streaming) can branch on overload / rate-limit / auth
//! / context-too-long etc. rather than parsing strings.

use crate::providers::traits::ProviderError;

use reqwest::header::HeaderMap;

use super::types::ApiErrorResponse;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct AnthropicErrorClassification {
    pub error_type: String,
    pub message: String,
    pub retry_after_secs: Option<u64>,
    pub mark_temporary_unavailable: bool,
    /// Server's explicit `x-should-retry` response header (non-standard):
    /// `Some(false)` suppresses retry, `Some(true)` allows retry of an
    /// otherwise non-retryable status. `None` = header absent.
    pub should_retry: Option<bool>,
}

/// True when a 400 body indicates the model rejected the `temperature`
/// request param (Anthropic's newer models deprecate it). The fix is to
/// resend without `temperature` — see
/// `model_capabilities::mark_temperature_unsupported` and the in-request
/// retry in `streaming.rs`.
pub(super) fn is_temperature_rejected(status: u16, body: &str) -> bool {
    if status != 400 {
        return false;
    }
    let lower = extract_error_message(body)
        .unwrap_or_default()
        .to_lowercase();
    lower.contains("temperature")
        && (lower.contains("deprecated") || lower.contains("not supported"))
}

/// True when a 403 body indicates the OAuth access token was revoked
/// server-side (another process rotated it). Recoverable by one forced
/// token refresh — see the retry guard in `streaming.rs`. Mirrors the
/// reference harness's `isOAuthTokenRevokedError` (403 + "OAuth token has
/// been revoked").
pub(super) fn is_oauth_token_revoked(status: u16, body: &str) -> bool {
    if status != 403 {
        return false;
    }
    extract_error_message(body)
        .unwrap_or_else(|| body.to_string())
        .to_lowercase()
        .contains("revoked")
}

pub(super) fn classify_error(
    status: u16,
    body: &str,
    headers: Option<&HeaderMap>,
    retry_after_secs: Option<u64>,
) -> AnthropicErrorClassification {
    let message = extract_error_message(body)
        .unwrap_or_else(|| crate::providers::http_error_body::clean_error_message(status, body));
    let lower = message.to_lowercase();
    let parsed_retry_after =
        retry_after_secs.or_else(|| headers.and_then(parse_anthropic_retry_after));

    let error_type = if status == 401 {
        "auth_error"
    } else if status == 403 {
        "forbidden"
    } else if status == 429 && lower.contains("extra usage") {
        "extra_usage_required"
    } else if status == 429 {
        "rate_limit"
    } else if status == 529 {
        "overloaded"
    } else if status >= 500 {
        "server_error"
    } else {
        "request_error"
    };

    AnthropicErrorClassification {
        error_type: error_type.to_string(),
        message,
        retry_after_secs: parsed_retry_after,
        mark_temporary_unavailable: matches!(status, 401 | 403 | 429 | 500..=599)
            && error_type != "extra_usage_required",
        should_retry: headers.and_then(parse_should_retry_header),
    }
}

fn parse_should_retry_header(headers: &HeaderMap) -> Option<bool> {
    match headers.get("x-should-retry")?.to_str().ok()?.trim() {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

/// Stamp the server's `x-should-retry` directive into the error message so
/// `ReliableProvider::server_retry_directive` can obey it (the message is
/// the only channel `ProviderError` carries).
fn with_retry_directive(message: String, should_retry: Option<bool>) -> String {
    match should_retry {
        Some(true) => format!(
            "{message} {}",
            crate::providers::reliable::X_SHOULD_RETRY_TRUE_MARKER
        ),
        Some(false) => format!(
            "{message} {}",
            crate::providers::reliable::X_SHOULD_RETRY_FALSE_MARKER
        ),
        None => message,
    }
}

fn extract_error_message(body: &str) -> Option<String> {
    serde_json::from_str::<ApiErrorResponse>(body)
        .ok()
        .and_then(|err_resp| err_resp.error)
        .and_then(|err| err.message)
        .filter(|message| !message.trim().is_empty())
}

fn parse_anthropic_retry_after(headers: &HeaderMap) -> Option<u64> {
    headers
        .get("anthropic-ratelimit-unified-reset")
        .and_then(|value| value.to_str().ok())
        .and_then(parse_reset_header_secs)
}

fn parse_reset_header_secs(value: &str) -> Option<u64> {
    if let Ok(epoch_secs) = value.parse::<i64>() {
        let now = chrono::Utc::now().timestamp();
        return (epoch_secs > now).then_some((epoch_secs - now) as u64);
    }

    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|date| date.with_timezone(&chrono::Utc))
        .and_then(|date| {
            let seconds = (date - chrono::Utc::now()).num_seconds();
            (seconds > 0).then_some(seconds as u64)
        })
}

/// Parse an Anthropic error response body and map it to `ProviderError`.
///
/// Falls back to `RequestFailed("HTTP {status}: {prefix}")` when the body
/// is not a recognizable Anthropic error envelope.
///
/// Special cases:
/// - "prompt is too long" / "`max_tokens` exceed context limit" → `ContextTooLong`
/// - 401 → `AuthError`
/// - 403 with a revoked-token body → `AuthError` (fail fast when the
///   one-shot refresh in `streaming.rs` didn't rescue it)
/// - 404 → `ModelNotFound`
/// - 429 → `RateLimited` (with optional `retry_after_secs` from the header)
/// - 529 → `Overloaded` (with optional `retry_after_secs`)
///
/// `should_retry` is the server's `x-should-retry` header directive; it is
/// stamped into the message of status-derived errors (not the dedicated
/// context/media rescue variants, which have their own recovery arms) so
/// the retry layer can obey it.
pub(super) fn parse_error(
    status: u16,
    body: &str,
    retry_after_secs: Option<u64>,
    should_retry: Option<bool>,
) -> ProviderError {
    let classification = classify_error(status, body, None, retry_after_secs);
    let lower = classification.message.to_lowercase();

    // "max_tokens exceed context limit" is recoverable by LOWERING
    // max_tokens — distinct from "prompt is too long" which needs
    // compaction. Classified separately so the turn loop can pick the
    // right rescue.
    if lower.contains("max_tokens") && lower.contains("exceed") {
        return ProviderError::MaxTokensExceedContext(classification.message);
    }
    if lower.contains("prompt is too long") {
        return ProviderError::ContextTooLong(classification.message);
    }
    // Oversized media payloads (base64 images/PDFs) surface as 413 or as
    // 400s complaining about image/document size — recoverable by
    // stripping historical media blocks, NOT by text compaction.
    if status == 413
        || ((lower.contains("image") || lower.contains("document") || lower.contains("pdf"))
            && (lower.contains("too large")
                || lower.contains("exceeds")
                || lower.contains("maximum")))
    {
        return ProviderError::MediaTooLarge(classification.message);
    }

    let message = with_retry_directive(classification.message, should_retry);
    match status {
        401 => ProviderError::AuthError(message),
        // Revoked OAuth token: non-retryable with the same credentials.
        // The one-shot refresh guard in `streaming.rs` runs before this;
        // reaching here means the refresh was already spent or unavailable.
        403 if is_oauth_token_revoked(status, body) => ProviderError::AuthError(message),
        429 => ProviderError::RateLimited {
            message,
            retry_after_secs: classification.retry_after_secs,
        },
        529 => ProviderError::Overloaded {
            message,
            retry_after_secs: classification.retry_after_secs,
        },
        400 if crate::providers::http_error_body::is_model_unavailable(status, body) => {
            ProviderError::ModelNotFound(message)
        }
        404 => ProviderError::ModelNotFound(message),
        _ => ProviderError::RequestFailed(format!("HTTP {}: {}", status, message)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::{HeaderMap, HeaderValue};

    #[test]
    fn classifies_401_as_temporary_auth_health_event() {
        let body = r#"{"error":{"type":"authentication_error","message":"Invalid authentication credentials"}}"#;
        let classification = classify_error(401, body, None, None);

        assert_eq!(classification.error_type, "auth_error");
        assert!(classification.mark_temporary_unavailable);
        assert_eq!(classification.message, "Invalid authentication credentials");
    }

    #[test]
    fn parses_anthropic_unified_reset_header_for_429() {
        let mut headers = HeaderMap::new();
        let reset = (chrono::Utc::now() + chrono::Duration::seconds(120))
            .timestamp()
            .to_string();
        headers.insert(
            "anthropic-ratelimit-unified-reset",
            HeaderValue::from_str(&reset).unwrap(),
        );
        let body = r#"{"error":{"type":"rate_limit_error","message":"rate limited"}}"#;

        let classification = classify_error(429, body, Some(&headers), None);

        assert_eq!(classification.error_type, "rate_limit");
        assert!(classification.mark_temporary_unavailable);
        assert!(classification
            .retry_after_secs
            .is_some_and(|secs| secs <= 120 && secs > 0));
    }

    #[test]
    fn extra_usage_429_is_not_account_cooldown() {
        let body = r#"{"error":{"type":"rate_limit_error","message":"Extra usage required"}}"#;
        let classification = classify_error(429, body, None, None);

        assert_eq!(classification.error_type, "extra_usage_required");
        assert!(!classification.mark_temporary_unavailable);
    }

    #[test]
    fn revoked_oauth_403_maps_to_auth_error() {
        let body =
            r#"{"error":{"type":"permission_error","message":"OAuth token has been revoked"}}"#;
        assert!(is_oauth_token_revoked(403, body));
        // Same body on another status is not the revocation case.
        assert!(!is_oauth_token_revoked(401, body));
        // A plain 403 stays a retryable RequestFailed.
        let other = r#"{"error":{"type":"permission_error","message":"Access denied"}}"#;
        assert!(!is_oauth_token_revoked(403, other));

        // Revoked → AuthError so ReliableProvider fails fast instead of
        // burning the retry budget on a dead token.
        match parse_error(403, body, None, None) {
            ProviderError::AuthError(msg) => assert!(msg.contains("revoked")),
            other => panic!("expected AuthError, got {other:?}"),
        }
        match parse_error(403, other, None, None) {
            ProviderError::RequestFailed(_) => {}
            unexpected => panic!("expected RequestFailed, got {unexpected:?}"),
        }
    }

    #[test]
    fn should_retry_header_is_classified_and_stamped() {
        let mut headers = HeaderMap::new();
        headers.insert("x-should-retry", HeaderValue::from_static("false"));
        let body = r#"{"error":{"type":"api_error","message":"internal error"}}"#;

        let classification = classify_error(500, body, Some(&headers), None);
        assert_eq!(classification.should_retry, Some(false));

        let err = parse_error(500, body, None, classification.should_retry);
        assert!(err
            .to_string()
            .contains(crate::providers::reliable::X_SHOULD_RETRY_FALSE_MARKER));

        // "true" direction: stamped onto otherwise non-retryable statuses.
        let err = parse_error(401, body, None, Some(true));
        assert!(err
            .to_string()
            .contains(crate::providers::reliable::X_SHOULD_RETRY_TRUE_MARKER));

        // Absent header: no marker, message untouched.
        let classification = classify_error(500, body, None, None);
        assert_eq!(classification.should_retry, None);
        let err = parse_error(500, body, None, None);
        assert!(!err.to_string().contains("x-should-retry"));
    }

    #[test]
    fn detects_temperature_deprecated_400() {
        let body = r#"{"type":"error","error":{"type":"invalid_request_error","message":"`temperature` is deprecated for this model."}}"#;
        assert!(is_temperature_rejected(400, body));
        // Wrong status: not our case.
        assert!(!is_temperature_rejected(200, body));
        // Unrelated 400: must not match.
        let other = r#"{"error":{"type":"invalid_request_error","message":"messages: at least one message is required"}}"#;
        assert!(!is_temperature_rejected(400, other));
    }
}
