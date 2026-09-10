//! ChatGPT account id extraction from Codex OAuth id tokens.

pub(crate) fn extract_account_id_from_id_token(id_token: &str) -> Option<String> {
    let payload = id_token.split('.').nth(1)?;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    let decoded = URL_SAFE_NO_PAD.decode(payload).ok()?;
    let value: serde_json::Value = serde_json::from_slice(&decoded).ok()?;
    value
        .get("https://api.openai.com/auth.chatgpt_account_id")
        .or_else(|| value.get("chatgpt_account_id"))
        .or_else(|| {
            value
                .get("https://api.openai.com/auth")
                .and_then(|auth| auth.get("chatgpt_account_id"))
        })
        .and_then(|v| v.as_str())
        .filter(|v| !v.is_empty())
        .map(ToString::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    #[test]
    fn reads_flat_and_namespaced_account_claims_without_using_email() {
        for payload in [
            serde_json::json!({"chatgpt_account_id":"account"}),
            serde_json::json!({"https://api.openai.com/auth.chatgpt_account_id":"account"}),
            serde_json::json!({"https://api.openai.com/auth":{"chatgpt_account_id":"account"}}),
        ] {
            let token = format!("h.{}.s", URL_SAFE_NO_PAD.encode(payload.to_string()));
            assert_eq!(
                extract_account_id_from_id_token(&token).as_deref(),
                Some("account")
            );
        }
        assert!(extract_account_id_from_id_token("not-a-token").is_none());
    }
}
