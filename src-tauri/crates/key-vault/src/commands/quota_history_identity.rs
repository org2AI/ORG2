use crate::key_store::{ModelKey, ModelType};
use core_types::providers::CODEX_ID_TOKEN_ENV_KEY;
use sha2::{Digest, Sha256};

fn account_identity(key: &ModelKey) -> Option<String> {
    if key.model_type == ModelType::Codex {
        if let Some(identity) = key
            .env_vars
            .get(CODEX_ID_TOKEN_ENV_KEY)
            .and_then(|token| crate::providers::codex::extract_account_id_from_id_token(token))
        {
            return Some(identity);
        }
    }
    ["account_id", "email", "user_id"].iter().find_map(|field| {
        key.account_metadata
            .get(*field)
            .filter(|s| !s.trim().is_empty())
            .cloned()
    })
}

pub(super) fn history_id(key: &ModelKey) -> String {
    let identity = account_identity(key);
    let scope = serde_json::json!([
        key.model_type.as_str(),
        key.base_url,
        key.created_at,
        identity
            .as_ref()
            .or(key.session_token.as_ref())
            .or(key.api_key.as_ref()),
        crate::providers::opencode_go::workspace_id_override_from_key(key),
        key.account_metadata.get("organization_uuid")
    ]);
    format!(
        "{}:{:x}",
        key.id,
        Sha256::digest(scope.to_string().as_bytes())
    )
}

/// A profile lookup may enrich an unchanged credential. Preserve that first
/// sample and its cooldown, but never carry history across an account switch.
pub(super) fn can_promote_scope(before: &ModelKey, after: &ModelKey) -> bool {
    let identity = account_identity(before);
    let organization = before.account_metadata.get("organization_uuid");
    before.id == after.id
        && before.created_at == after.created_at
        && before.model_type == after.model_type
        && before.base_url == after.base_url
        && before.auth_method == after.auth_method
        && before.session_token == after.session_token
        && before.api_key == after.api_key
        && crate::providers::opencode_go::workspace_id_override_from_key(before)
            == crate::providers::opencode_go::workspace_id_override_from_key(after)
        && identity
            .as_ref()
            .is_none_or(|value| Some(value) == account_identity(after).as_ref())
        && organization
            .is_none_or(|value| Some(value) == after.account_metadata.get("organization_uuid"))
}

/// Called at the shared quota persistence boundary, including manual refreshes.
/// Profile metadata must not strand observations in the pre-profile scope.
pub(super) fn preserve_profile_history(before: &ModelKey, after: &ModelKey) -> Result<(), String> {
    if history_id(before) == history_id(after) || !can_promote_scope(before, after) {
        return Ok(());
    }
    preserve_profile_history_in(&crate::quota_history::open()?, before, after)
        .map_err(|e| e.to_string())
}

fn preserve_profile_history_in(
    db: &rusqlite::Connection,
    before: &ModelKey,
    after: &ModelKey,
) -> rusqlite::Result<()> {
    if history_id(before) != history_id(after) && can_promote_scope(before, after) {
        crate::quota_history::promote_scope(db, &history_id(before), &history_id(after))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    #[test]
    fn shared_profile_write_preserves_an_existing_first_sample_and_cooldown() {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        crate::quota_history::initialize(&db).unwrap();
        let now = chrono::Utc::now().timestamp();
        let mut before = ModelKey::new(ModelType::ClaudeCode);
        before.session_token = Some("token".into());
        let old = history_id(&before);
        crate::quota_history::claim(&db, &old, now).unwrap();
        db.execute(
            "INSERT INTO samples VALUES (?1, ?2, 80, NULL)",
            rusqlite::params![old, now],
        )
        .unwrap();
        let mut after = before.clone();
        after
            .account_metadata
            .insert("email".into(), "account@example.test".into());
        preserve_profile_history_in(&db, &before, &after).unwrap();
        preserve_profile_history_in(&db, &before, &after).unwrap(); // idempotent across consumers
        let next = history_id(&after);
        assert_eq!(crate::quota_history::read(&db, &next).unwrap().1.len(), 1);
        assert!(!crate::quota_history::claim(&db, &next, now + 1).unwrap());
    }

    #[test]
    fn codex_renewal_keeps_account_scope_but_account_switch_does_not() {
        let mut key = ModelKey::new(ModelType::Codex);
        let token = |id: &str| {
            format!(
                "header.{}.signature",
                URL_SAFE_NO_PAD.encode(
                    serde_json::json!({"https://api.openai.com/auth": {"chatgpt_account_id": id}})
                        .to_string()
                )
            )
        };
        key.env_vars
            .insert(CODEX_ID_TOKEN_ENV_KEY.into(), token("one"));
        key.session_token = Some("first".into());
        let before = history_id(&key);
        key.session_token = Some("rotated".into());
        assert_eq!(before, history_id(&key));
        key.env_vars
            .insert(CODEX_ID_TOKEN_ENV_KEY.into(), token("two"));
        assert_ne!(before, history_id(&key));
    }
    #[test]
    fn profile_enrichment_preserves_history_only_for_unchanged_credentials() {
        let mut before = ModelKey::new(ModelType::ClaudeCode);
        before.session_token = Some("token".into());
        let mut after = before.clone();
        after
            .account_metadata
            .insert("email".into(), "one@example.test".into());
        after
            .account_metadata
            .insert("organization_uuid".into(), "org-one".into());
        assert!(can_promote_scope(&before, &after));
        assert_ne!(history_id(&before), history_id(&after));
        let mut switched = after.clone();
        switched
            .account_metadata
            .insert("organization_uuid".into(), "org-two".into());
        assert!(!can_promote_scope(&after, &switched));
        assert_ne!(history_id(&after), history_id(&switched));
        after.session_token = Some("other-token".into());
        assert!(!can_promote_scope(&before, &after));
    }
}
