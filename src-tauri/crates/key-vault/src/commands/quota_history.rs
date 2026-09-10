use crate::key_store::{AuthMethod, ModelKey, ModelType, KEY_SERVICE};
use crate::quota_history::{self as history, QuotaHistoryPoint};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountQuotaHistory {
    key_id: String,
    provider: String,
    name: String,
    status: String,
    sampling_enabled: bool,
    points: Vec<QuotaHistoryPoint>,
}

use super::quota_history_identity::{can_promote_scope, history_id};

fn eligible(key: &ModelKey) -> bool {
    key.has_local_key
        && match key.model_type {
            ModelType::ClaudeCode | ModelType::Codex => {
                key.auth_method == AuthMethod::Oauth
                    && key.session_token.as_ref().is_some_and(|s| !s.is_empty())
            }
            ModelType::OpenCode => super::validate::key_can_refresh_quota(key),
            _ => false,
        }
}

fn can_sample(key: &ModelKey) -> bool {
    eligible(key) && key.enabled
}

fn due_accounts(
    db: &rusqlite::Connection,
    keys: &[ModelKey],
    now: i64,
) -> Result<Vec<String>, String> {
    let mut due = Vec::new();
    for key in keys.iter().filter(|key| can_sample(key)) {
        let last = history::last_attempt(db, &history_id(key)).map_err(|e| e.to_string())?;
        if last.is_none_or(|last| now - last >= history::HOUR) {
            due.push((last.unwrap_or(0), key.id.clone()));
        }
    }
    due.sort();
    Ok(due.into_iter().take(128).map(|(_, id)| id).collect())
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

/// One account per call lets the visibility-aware caller stop between accounts.
#[tauri::command]
pub async fn sample_weekly_quota(key_id: String) -> Result<(), String> {
    let id = key_id.clone();
    let claimed = blocking(move || {
        let Some(key) = KEY_SERVICE.get_key_by_id_checked(&id)?.filter(can_sample) else {
            return Ok(None);
        };
        let scoped_id = history_id(&key);
        history::claim(
            &history::open()?,
            &scoped_id,
            chrono::Utc::now().timestamp(),
        )
        .map(|claimed| claimed.then_some((scoped_id, key)))
        .map_err(|e| e.to_string())
    })
    .await?;
    let Some((scoped_id, original_key)) = claimed else {
        return Ok(());
    };
    let success = super::refresh_key_quota(key_id.clone(), Some(false))
        .await
        .is_ok();
    blocking(move || {
        let db = history::open()?;
        // Re-read identity after the existing refresh coordinator's credential guard.
        let Some(current) = KEY_SERVICE.get_key_by_id_checked(&key_id)?.filter(eligible) else {
            db.execute("DELETE FROM accounts WHERE id=?1", [&scoped_id])
                .map_err(|e| e.to_string())?;
            return Ok(());
        };
        let current_scope = history_id(&current);
        if current_scope != scoped_id {
            if !success || !can_promote_scope(&original_key, &current) {
                return Ok(());
            }
            history::promote_scope(&db, &scoped_id, &current_scope).map_err(|e| e.to_string())?;
        }
        let last_good = if success {
            super::validate::key_quota_refresh_status(&key_id).and_then(|s| s.last_good)
        } else {
            None
        };
        let captured = last_good
            .as_ref()
            .map(|s| chrono::DateTime::<chrono::Utc>::from(s.captured_at).timestamp())
            .unwrap_or_else(|| chrono::Utc::now().timestamp());
        history::record(
            &db,
            &current_scope,
            last_good.as_ref().map(|s| &s.value),
            captured,
        )
        .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn get_weekly_quota_history() -> Result<Vec<AccountQuotaHistory>, String> {
    blocking(|| {
        let mut keys: Vec<_> = KEY_SERVICE
            .list_keys_checked()?
            .into_iter()
            .filter(eligible)
            .collect();
        keys.sort_by(|a, b| a.id.cmp(&b.id));
        // A hard bound on scheduler work and IPC payload, independent of account count.
        keys.truncate(128);
        let db = history::open()?;
        keys.into_iter()
            .map(|key| {
                let (status, points) =
                    history::read(&db, &history_id(&key)).map_err(|e| e.to_string())?;
                Ok(AccountQuotaHistory {
                    sampling_enabled: key.enabled,
                    key_id: key.id,
                    provider: key.model_type.as_str().into(),
                    name: key.name.unwrap_or_else(|| key.model_type.as_str().into()),
                    status,
                    points,
                })
            })
            .collect()
    })
    .await
}

/// Lightweight scheduler discovery: never serialize chart observations on a wake.
#[tauri::command]
pub async fn list_due_weekly_quota_accounts() -> Result<Vec<String>, String> {
    blocking(|| {
        let keys = KEY_SERVICE.list_keys_checked()?;
        let db = history::open()?;
        let now = chrono::Utc::now().timestamp();
        history::prune(
            &db,
            &keys.iter().map(|key| key.id.clone()).collect::<Vec<_>>(),
            now,
        )
        .map_err(|e| e.to_string())?;
        due_accounts(&db, &keys, now)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn due_discovery_skips_disabled_and_recent_accounts_and_prioritizes_unseen() {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        history::initialize(&db).unwrap();
        let now = chrono::Utc::now().timestamp();
        let mut keys = Vec::new();
        for index in 0..130 {
            let mut key = ModelKey::new(ModelType::Codex);
            key.id = format!("{index:03}");
            key.auth_method = AuthMethod::Oauth;
            key.session_token = Some("token".into());
            keys.push(key);
        }
        keys[0].enabled = false;
        assert!(!can_sample(&keys[0]));
        history::claim(&db, &history_id(&keys[1]), now).unwrap();
        let due = due_accounts(&db, &keys, now).unwrap();
        assert_eq!(due.len(), 128);
        assert!(!due.contains(&keys[0].id));
        assert!(!due.contains(&keys[1].id));
        let later = due_accounts(&db, &keys, now + history::HOUR).unwrap();
        assert!(!later.contains(&keys[1].id)); // never-sampled keys are served first
    }

    #[test]
    fn account_scope_isolates_identity_endpoint_and_anonymous_credentials() {
        let mut key = ModelKey::new(ModelType::Codex);
        key.auth_method = AuthMethod::Oauth;
        key.session_token = Some("first-token".into());
        assert!(eligible(&key));
        let anonymous = history_id(&key);
        key.session_token = Some("second-token".into());
        assert_ne!(anonymous, history_id(&key));
        key.account_metadata
            .insert("email".into(), "one@example.test".into());
        let identified = history_id(&key);
        key.session_token = Some("renewed-token".into());
        assert_eq!(identified, history_id(&key));
        key.account_metadata
            .insert("email".into(), "two@example.test".into());
        assert_ne!(identified, history_id(&key));
        let other_account = history_id(&key);
        key.base_url = Some("https://example.test".into());
        assert_ne!(other_account, history_id(&key));
        key.session_token = None;
        assert!(!eligible(&key));
    }
}
