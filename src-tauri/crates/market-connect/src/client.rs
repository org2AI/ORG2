use crate::{Redemption, Selection, CONSOLE};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
const MARKET: &str = "https://org2-market.fly.dev:8443";
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConnectionMetadata {
    pub identity_user_id: String,
    pub workspace_id: String,
    pub target: crate::Target,
}
// This type is native-only. Serialize is for the OS credential store, never IPC.
#[derive(Serialize, Deserialize)]
pub struct Grant {
    token: String,
    expires_at: i64,
    refresh_token: String,
    refresh_expires_at: String,
    refresh_url: String,
    market_url: String,
    identity_user_id: String,
    workspace_id: String,
    target: crate::Target,
    state: String,
}
impl Grant {
    pub(crate) fn enrollment_state(&self) -> &str {
        &self.state
    }
    pub fn metadata(&self) -> ConnectionMetadata {
        ConnectionMetadata {
            identity_user_id: self.identity_user_id.clone(),
            workspace_id: self.workspace_id.clone(),
            target: self.target,
        }
    }
    pub fn selection(&self) -> Selection {
        Selection {
            workspace_id: self.workspace_id.clone(),
            target: self.target,
        }
    }
    fn validate(&self) -> Result<(), &'static str> {
        self.validate_at(chrono::Utc::now().timestamp_millis(), true)
    }
    fn validate_at(&self, now: i64, require_access: bool) -> Result<(), &'static str> {
        let expires = chrono::DateTime::parse_from_rfc3339(&self.refresh_expires_at)
            .map_err(|_| "invalid_login_expiry")?
            .timestamp_millis();
        if !self.token.starts_with("og2ms.v1.")
            || self.token.len() > 8192
            || (require_access && self.expires_at <= now)
            || self.expires_at <= 0
            || self.expires_at > expires
            || !self
                .refresh_token
                .strip_prefix("og2r_")
                .is_some_and(crate::nonce)
            || expires <= now
            || expires > now + 30 * 86400000 + 60000
            || self.market_url != MARKET
            || self.refresh_url != format!("{CONSOLE}/api/auth/refresh")
            || !crate::valid_workspace(&self.workspace_id)
            || !valid_identity(&self.identity_user_id)
        {
            return Err("invalid_connection_grant");
        }
        Ok(())
    }
    /// Expired access credentials remain recoverable while the renewal grant is valid.
    /// The host must renew before forwarding; this function never returns a token to IPC.
    pub fn load(instance_scope: &str, metadata: &ConnectionMetadata) -> Result<Self, &'static str> {
        let _lock = crate::process_lock::acquire(instance_scope)?;
        Self::load_unlocked(instance_scope, metadata)
    }
    fn load_unlocked(
        instance_scope: &str,
        metadata: &ConnectionMetadata,
    ) -> Result<Self, &'static str> {
        let raw = platform_load(&store_account(instance_scope, metadata))?;
        Self::decode_stored(&raw, metadata, chrono::Utc::now().timestamp_millis())
    }
    fn decode_stored(
        raw: &str,
        metadata: &ConnectionMetadata,
        now: i64,
    ) -> Result<Self, &'static str> {
        if raw.len() > 16384 {
            return Err("credential_record_too_large");
        }
        let grant: Self = serde_json::from_str(raw).map_err(|_| "invalid_stored_credential")?;
        grant.validate_at(now, false)?;
        if grant.metadata() != *metadata {
            return Err("credential_scope_mismatch");
        }
        Ok(grant)
    }
    pub fn remove(instance_scope: &str, metadata: &ConnectionMetadata) -> Result<(), &'static str> {
        let _lock = crate::process_lock::acquire(instance_scope)?;
        platform_remove(&store_account(instance_scope, metadata))
    }
    pub fn needs_refresh(&self) -> bool {
        let now = chrono::Utc::now().timestamp_millis();
        let end = chrono::DateTime::parse_from_rfc3339(&self.refresh_expires_at)
            .map(|v| v.timestamp_millis())
            .unwrap_or(0);
        self.expires_at <= now || (self.expires_at <= now + 60000 && self.expires_at < end)
    }
    pub(crate) fn store(&self, instance_scope: &str) -> Result<String, &'static str> {
        let _lock = crate::process_lock::acquire(instance_scope)?;
        self.store_unlocked(instance_scope)
    }
    fn store_unlocked(&self, instance_scope: &str) -> Result<String, &'static str> {
        self.validate()?;
        let account = store_account(instance_scope, &self.metadata());
        let raw = serde_json::to_string(self).map_err(|_| "credential_encoding_failed")?;
        platform_store(&account, &raw)?;
        Ok(account)
    }
}
/// One owner per instance/user/workspace/target. The host retains this owner for
/// the managed selection and retires it after restoring the client configuration.
/// No timers, background retries or globally growing credential cache.
pub struct Connection {
    grant: tokio::sync::Mutex<Option<Grant>>,
    instance: String,
    metadata: ConnectionMetadata,
    transport: reqwest::Client,
}
/// Native forwarding input. Deliberately not serializable or printable.
pub struct AccessCredential {
    token: String,
    pub metadata: ConnectionMetadata,
    pub market_url: String,
}
impl AccessCredential {
    pub fn bearer(&self) -> &str {
        &self.token
    }
}
#[derive(Deserialize)]
struct Renewal {
    token: String,
    expires_at: i64,
    refresh_token: String,
    refresh_expires_at: String,
}
impl Grant {
    fn apply_renewal(mut self, renewal: Renewal) -> Result<Self, &'static str> {
        // The authority cannot silently extend the original login lifetime.
        let old_end = chrono::DateTime::parse_from_rfc3339(&self.refresh_expires_at)
            .map_err(|_| "invalid_login_expiry")?;
        let new_end = chrono::DateTime::parse_from_rfc3339(&renewal.refresh_expires_at)
            .map_err(|_| "invalid_login_expiry")?;
        if old_end != new_end || renewal.refresh_token == self.refresh_token {
            return Err("invalid_renewal_grant");
        }
        self.token = renewal.token;
        self.expires_at = renewal.expires_at;
        self.refresh_token = renewal.refresh_token;
        self.refresh_expires_at = renewal.refresh_expires_at;
        self.validate()?;
        Ok(self)
    }
}
impl Connection {
    pub async fn restore(
        instance: String,
        metadata: ConnectionMetadata,
    ) -> Result<Arc<Self>, &'static str> {
        let scope = instance.clone();
        let expected = metadata.clone();
        let grant = tokio::task::spawn_blocking(move || Grant::load(&scope, &expected))
            .await
            .map_err(|_| "credential_store_unavailable")??;
        let transport = reqwest::Client::builder()
            .timeout(Duration::from_secs(8))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| "connection_transport_unavailable")?;
        Ok(Arc::new(Self {
            grant: tokio::sync::Mutex::new(Some(grant)),
            instance,
            metadata,
            transport,
        }))
    }
    pub fn metadata(&self) -> &ConnectionMetadata {
        &self.metadata
    }
    pub async fn access(self: &Arc<Self>) -> Result<AccessCredential, &'static str> {
        let owner = Arc::clone(self);
        // Keep the OS lock through the entire renewal task, even if the caller
        // drops its future. Re-read disk after locking: another process may
        // have rotated or removed the grant since this owner was restored.
        tokio::spawn(async move {
            let instance = owner.instance.clone();
            let metadata = owner.metadata.clone();
            let (lock, grant) = tokio::task::spawn_blocking(move || {
                let lock = crate::process_lock::acquire(&instance)?;
                let grant = Grant::load_unlocked(&instance, &metadata)?;
                Ok::<_, &'static str>((lock, grant))
            })
            .await
            .map_err(|_| "credential_store_unavailable")??;
            *owner.grant.lock().await = Some(grant);
            let renewal_owner = Arc::clone(&owner);
            let result = owner
                .access_task(move |grant| async move { renewal_owner.renew(grant).await })
                .await;
            drop(lock);
            result
        })
        .await
        .map_err(|_| "market_reauthorization_required")?
    }
    async fn access_task<F, Fut>(
        self: &Arc<Self>,
        renew: F,
    ) -> Result<AccessCredential, &'static str>
    where
        F: FnOnce(Grant) -> Fut + Send + 'static,
        Fut: std::future::Future<Output = Result<Grant, &'static str>> + Send + 'static,
    {
        // Dropping a request must not release the lock while its blocking OS
        // write still runs. The owned task keeps serialization through commit.
        let owner = Arc::clone(self);
        tokio::spawn(async move { owner.access_with(renew).await })
            .await
            .map_err(|_| "market_reauthorization_required")?
    }
    async fn renew(&self, grant: Grant) -> Result<Grant, &'static str> {
        // Persist the spent state before making a one-shot network call. A
        // crash or ambiguous response must not replay an ancestor token and
        // revoke a successfully rotated family on the next application start.
        let account = store_account(&self.instance, &self.metadata);
        tokio::task::spawn_blocking(move || platform_store(&account, "{\"renewal_pending\":true}"))
            .await
            .map_err(|_| "credential_store_unavailable")??;
        let response = self
            .transport
            .post(format!("{CONSOLE}/api/auth/refresh"))
            .json(&serde_json::json!({"refresh_token":grant.refresh_token}))
            .send()
            .await
            .map_err(|_| "market_reauthorization_required")?;
        let bytes = bounded_response(response).await?;
        let renewal: Renewal =
            serde_json::from_slice(&bytes).map_err(|_| "invalid_renewal_response")?;
        let grant = grant.apply_renewal(renewal)?;
        let instance = self.instance.clone();
        let grant = tokio::task::spawn_blocking(move || {
            grant.store_unlocked(&instance)?;
            Ok::<_, &'static str>(grant)
        })
        .await
        .map_err(|_| "credential_store_unavailable")??;
        Ok(grant)
    }
    async fn access_with<F, Fut>(&self, renew: F) -> Result<AccessCredential, &'static str>
    where
        F: FnOnce(Grant) -> Fut,
        Fut: std::future::Future<Output = Result<Grant, &'static str>>,
    {
        let mut guard = self.grant.lock().await;
        if guard
            .as_ref()
            .ok_or("market_reauthorization_required")?
            .needs_refresh()
        {
            let grant = guard.take().ok_or("market_reauthorization_required")?;
            let grant = renew(grant).await?;
            *guard = Some(grant);
        }
        let grant = guard.as_ref().ok_or("market_reauthorization_required")?;
        grant.validate()?;
        Ok(AccessCredential {
            token: grant.token.clone(),
            metadata: grant.metadata(),
            market_url: grant.market_url.clone(),
        })
    }
    pub(crate) async fn market_request(
        self: &Arc<Self>,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<Vec<u8>, &'static str> {
        let access = self.access().await?;
        let url = format!("{MARKET}{path}");
        let request = match body {
            Some(body) => self.transport.post(url).json(&body),
            None => self.transport.get(url),
        };
        let response = request
            .bearer_auth(access.bearer())
            .send()
            .await
            .map_err(|_| "market_request_failed")?;
        bounded_response(response).await
    }
    /// Called only after the host's conflict-aware configuration restoration.
    pub async fn disconnect(&self) -> Result<(), &'static str> {
        // Never hold the in-process mutex while waiting for the file lock:
        // access acquires the file lock first, then this mutex.
        let instance = self.instance.clone();
        let metadata = self.metadata.clone();
        tokio::task::spawn_blocking(move || Grant::remove(&instance, &metadata))
            .await
            .map_err(|_| "credential_store_unavailable")??;
        *self.grant.lock().await = None;
        Ok(())
    }
}
pub(crate) async fn bounded_response(
    mut response: reqwest::Response,
) -> Result<Vec<u8>, &'static str> {
    if !response.status().is_success() {
        return Err("market_reauthorization_required");
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "connection_exchange_failed")?
    {
        if bytes.len() + chunk.len() > 16384 {
            return Err("connection_response_too_large");
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
pub(crate) fn valid_identity(value: &str) -> bool {
    let b = value.as_bytes();
    b.len() == 36
        && b.iter().enumerate().all(|(i, c)| {
            if matches!(i, 8 | 13 | 18 | 23) {
                *c == b'-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
        && matches!(b[14], b'1'..=b'8')
        && matches!(b[19], b'8' | b'9' | b'a' | b'A' | b'b' | b'B')
}
#[cfg(any(target_os = "macos", windows))]
fn platform_load(account: &str) -> Result<String, &'static str> {
    keyring::Entry::new("dev.org2.market.workspace", account)
        .map_err(|_| "credential_store_unavailable")?
        .get_password()
        .map_err(|_| "credential_store_read_failed")
}
#[cfg(any(target_os = "macos", windows))]
fn platform_remove(account: &str) -> Result<(), &'static str> {
    match keyring::Entry::new("dev.org2.market.workspace", account)
        .map_err(|_| "credential_store_unavailable")?
        .delete_credential()
    {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("credential_store_delete_failed"),
    }
}
#[cfg(not(any(target_os = "macos", windows)))]
fn platform_load(_account: &str) -> Result<String, &'static str> {
    Err("native_credential_store_not_supported")
}
#[cfg(not(any(target_os = "macos", windows)))]
fn platform_remove(_account: &str) -> Result<(), &'static str> {
    Err("native_credential_store_not_supported")
}
fn store_account(instance: &str, metadata: &ConnectionMetadata) -> String {
    use sha2::{Digest, Sha256};
    // Length framing prevents ambiguous concatenations; every namespace dimension matters.
    let mut h = Sha256::new();
    for part in [
        instance,
        CONSOLE,
        &metadata.identity_user_id,
        &metadata.workspace_id,
        metadata.target.wire_name(),
    ] {
        h.update((part.len() as u64).to_be_bytes());
        h.update(part.as_bytes());
    }
    format!("{:x}", h.finalize())
}
#[cfg(any(target_os = "macos", windows))]
fn platform_store(account: &str, raw: &str) -> Result<(), &'static str> {
    let entry = keyring::Entry::new("dev.org2.market.workspace", account)
        .map_err(|_| "credential_store_unavailable")?;
    entry
        .set_password(raw)
        .map_err(|_| "credential_store_write_failed")?;
    if entry
        .get_password()
        .map_err(|_| "credential_store_read_failed")?
        != raw
    {
        return Err("credential_store_verification_failed");
    }
    Ok(())
}
#[cfg(not(any(target_os = "macos", windows)))]
fn platform_store(_account: &str, _raw: &str) -> Result<(), &'static str> {
    Err("native_credential_store_not_supported")
}
impl Redemption {
    pub async fn exchange(self) -> Result<Grant, &'static str> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(8))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| "connection_transport_unavailable")?;
        let response = client
            .post(format!("{CONSOLE}/api/auth/native/exchange"))
            .json(&self.proof)
            .send()
            .await
            .map_err(|_| "connection_exchange_failed")?;
        if !response.status().is_success() {
            return Err("connection_authorization_failed");
        }
        let bytes = bounded_response(response).await?;
        let grant: Grant =
            serde_json::from_slice(&bytes).map_err(|_| "invalid_connection_response")?;
        grant.validate()?;
        if grant.state != self.proof.state
            || grant.workspace_id != self.selection.workspace_id
            || grant.target != self.selection.target
        {
            return Err("connection_selection_mismatch");
        }
        Ok(grant)
    }
}
#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    #[test]
    fn credential_namespaces_isolate_users_workspaces_targets_and_instances() {
        let a = ConnectionMetadata {
            identity_user_id: "a".into(),
            workspace_id: "ws_a".into(),
            target: crate::Target::Codex,
        };
        let key = store_account("primary", &a);
        assert_ne!(key, store_account("secondary", &a));
        assert_ne!(
            key,
            store_account(
                "primary",
                &ConnectionMetadata {
                    identity_user_id: "b".into(),
                    ..a.clone()
                }
            )
        );
        assert_ne!(
            key,
            store_account(
                "primary",
                &ConnectionMetadata {
                    workspace_id: "ws_b".into(),
                    ..a.clone()
                }
            )
        );
        assert_ne!(
            key,
            store_account(
                "primary",
                &ConnectionMetadata {
                    target: crate::Target::Org2,
                    ..a
                }
            )
        );
    }
    fn fixture() -> Grant {
        Grant {
            token: concat!("og2ms.v1.", "fixture").into(),
            expires_at: 100000,
            refresh_token: format!("og2r_{}", "r".repeat(43)),
            refresh_expires_at: "1970-01-02T00:00:00Z".into(),
            refresh_url: format!("{CONSOLE}/api/auth/refresh"),
            market_url: MARKET.into(),
            identity_user_id: "11111111-1111-4111-8111-111111111111".into(),
            workspace_id: "ws_example".into(),
            target: crate::Target::Codex,
            state: "s".repeat(43),
        }
    }
    #[test]
    fn restore_expired_access_only_when_renewal_is_still_valid() {
        let g = fixture();
        let raw = serde_json::to_string(&g).unwrap();
        assert!(g.validate_at(200000, true).is_err());
        assert!(Grant::decode_stored(&raw, &g.metadata(), 200000).is_ok());
        assert!(Grant::decode_stored(&raw, &g.metadata(), 86400000).is_err());
    }
    #[test]
    fn stored_grant_cannot_change_owner_workspace_or_target() {
        let g = fixture();
        let raw = serde_json::to_string(&g).unwrap();
        for metadata in [
            ConnectionMetadata {
                workspace_id: "ws_other".into(),
                ..g.metadata()
            },
            ConnectionMetadata {
                target: crate::Target::Org2,
                ..g.metadata()
            },
            ConnectionMetadata {
                identity_user_id: "22222222-2222-4222-8222-222222222222".into(),
                ..g.metadata()
            },
        ] {
            assert!(Grant::decode_stored(&raw, &metadata, 1000).is_err());
        }
    }
    #[test]
    fn malformed_identity_and_untrusted_endpoints_are_rejected() {
        for identity in [
            "x".repeat(36),
            "11111111-1111-0111-8111-111111111111".into(),
            "11111111-1111-4111-1111-111111111111".into(),
        ] {
            let mut g = fixture();
            g.identity_user_id = identity;
            assert!(g.validate_at(1000, true).is_err());
        }
        let mut g = fixture();
        g.refresh_url = "https://evil.test".into();
        assert!(g.validate_at(1000, true).is_err());
        assert!(Grant::decode_stored(&"x".repeat(16385), &fixture().metadata(), 1000).is_err());
    }
    #[test]
    fn late_authorization_cannot_write_after_cancellation_or_new_attempt() {
        let mut enrollment = crate::Enrollment::default();
        let url = url::Url::parse(&enrollment.begin(fixture().selection()).unwrap()).unwrap();
        let state = url
            .query_pairs()
            .find(|(k, _)| k == "state")
            .unwrap()
            .1
            .into_owned();
        let callback = format!(
            "orgii://market/authorized?code={}&state={state}",
            "c".repeat(43)
        );
        enrollment.take_redemption(&callback).unwrap();
        enrollment.cancel();
        let mut old = fixture();
        old.state = state.clone();
        assert_eq!(
            enrollment.store_authorized(old, "test", || panic!(
                "retired attempt must not write index"
            )),
            Err("connection_attempt_retired")
        );
        enrollment.begin(fixture().selection()).unwrap();
        let mut old = fixture();
        old.state = state;
        assert_eq!(
            enrollment.store_authorized(old, "test", || panic!(
                "retired attempt must not write index"
            )),
            Err("connection_attempt_retired")
        );
    }
    #[test]
    fn authorization_commit_never_persists_an_undiscoverable_grant() {
        use std::cell::Cell;
        for failed_stage in 0..2 {
            for after_write in [false, true] {
                let indexed = Cell::new(false);
                let stored = Cell::new(false);
                let grant = fixture();
                let mut enrollment = crate::Enrollment {
                    exchanging: Some(grant.state.clone()),
                    ..Default::default()
                };
                let result = enrollment.commit_authorized(
                    grant,
                    || {
                        if failed_stage == 0 && !after_write {
                            return Err("index failed");
                        }
                        indexed.set(true);
                        if failed_stage == 0 {
                            return Err("index failed");
                        }
                        Ok(())
                    },
                    |_| {
                        assert!(
                            indexed.get(),
                            "credential write requires durable index first"
                        );
                        if failed_stage == 1 && !after_write {
                            return Err("store failed");
                        }
                        stored.set(true);
                        Err("store failed")
                    },
                );
                assert!(result.is_err());
                assert!(enrollment.exchanging.is_none());
                assert!(!stored.get() || indexed.get());
                assert_eq!(indexed.get(), failed_stage == 1 || after_write);
            }
        }
        let mut enrollment = crate::Enrollment::default();
        let grant = fixture();
        enrollment.exchanging = Some(grant.state.clone());
        let expected = grant.metadata();
        assert_eq!(
            enrollment.commit_authorized(grant, || Ok(()), |_| Ok(())),
            Ok(expected)
        );
    }
    fn current_fixture() -> Grant {
        let now = chrono::Utc::now();
        let mut g = fixture();
        g.expires_at = now.timestamp_millis() + 10000;
        g.refresh_expires_at = (now + chrono::Duration::hours(1)).to_rfc3339();
        g
    }
    pub(crate) fn connection_fixture() -> Connection {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let g = current_fixture();
        Connection {
            metadata: g.metadata(),
            instance: "test".into(),
            grant: tokio::sync::Mutex::new(Some(g)),
            transport: reqwest::Client::new(),
        }
    }
    #[tokio::test]
    async fn concurrent_consumers_share_rotation_and_cached_access() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let c = connection_fixture();
        let calls = AtomicUsize::new(0);
        let renew = |mut g: Grant| async {
            calls.fetch_add(1, Ordering::SeqCst);
            tokio::task::yield_now().await;
            g.expires_at = chrono::Utc::now().timestamp_millis() + 600000;
            g.token = concat!("og2ms.v1.", "rotated").into();
            Ok(g)
        };
        let (a, b) = tokio::join!(c.access_with(renew), c.access_with(renew));
        assert_eq!(a.unwrap().bearer(), concat!("og2ms.v1.", "rotated"));
        assert_eq!(b.unwrap().bearer(), concat!("og2ms.v1.", "rotated"));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }
    #[tokio::test]
    async fn uncertain_rotation_is_not_retried_by_waiting_consumer() {
        let c = connection_fixture();
        assert!(c
            .access_with(|_| async { Err("response_lost") })
            .await
            .is_err());
        assert!(c
            .access_with(|_| async { panic!("must not retry spent token") })
            .await
            .is_err());
    }
    #[test]
    fn renewal_cannot_extend_login_or_reuse_refresh_secret() {
        let g = current_fixture();
        let same = Renewal {
            token: concat!("og2ms.v1.", "next").into(),
            expires_at: g.expires_at,
            refresh_token: g.refresh_token.clone(),
            refresh_expires_at: g.refresh_expires_at.clone(),
        };
        assert!(g.apply_renewal(same).is_err());
        let g = current_fixture();
        let extended = Renewal {
            token: concat!("og2ms.v1.", "next").into(),
            expires_at: g.expires_at,
            refresh_token: format!("og2r_{}", "n".repeat(43)),
            refresh_expires_at: (chrono::Utc::now() + chrono::Duration::days(2)).to_rfc3339(),
        };
        assert!(g.apply_renewal(extended).is_err());
    }
    #[test]
    fn final_login_window_does_not_refresh_on_every_request() {
        let mut g = current_fixture();
        g.expires_at = chrono::DateTime::parse_from_rfc3339(&g.refresh_expires_at)
            .unwrap()
            .timestamp_millis();
        g.refresh_expires_at = (chrono::Utc::now() + chrono::Duration::seconds(20)).to_rfc3339();
        g.expires_at = chrono::DateTime::parse_from_rfc3339(&g.refresh_expires_at)
            .unwrap()
            .timestamp_millis();
        assert!(!g.needs_refresh());
    }
    #[tokio::test]
    async fn dropping_request_does_not_release_owner_during_credential_commit() {
        let c = Arc::new(connection_fixture());
        let entered = Arc::new(tokio::sync::Notify::new());
        let release = Arc::new(tokio::sync::Notify::new());
        let owner = Arc::clone(&c);
        let arrived = Arc::clone(&entered);
        let proceed = Arc::clone(&release);
        let request = tokio::spawn(async move {
            owner
                .access_task(move |mut g| async move {
                    arrived.notify_one();
                    proceed.notified().await;
                    g.expires_at = chrono::Utc::now().timestamp_millis() + 600000;
                    Ok(g)
                })
                .await
        });
        entered.notified().await;
        request.abort();
        let _ = request.await;
        assert!(c.grant.try_lock().is_err());
        release.notify_one();
        let result = c.grant.lock().await;
        assert!(result.as_ref().is_some_and(|g| !g.needs_refresh()));
    }
}
