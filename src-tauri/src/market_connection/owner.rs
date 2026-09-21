//! The current instance's canonical Cloud session owns all Market operations.
//! IPC may invalidate an owner, but can never nominate a user or supply a token.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::Manager;

const OFFICIAL: &str = "https://fpdyejwbiriliuqqcjoy.supabase.co";
const PUBLIC_KEY: &str = "sb_publishable_FpHAgMYJFGb20HunqnhciA_-2nt9eYU";
const REQUIRED: &str = "market_cloud_sign_in_required";
const CHANGED: &str = "market_identity_changed";

#[derive(Clone, PartialEq, Eq)]
struct Identity {
    user: String,
}
// Deliberately neither Debug nor Serialize: this is private auth-store input.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    kind: String,
    supabase_url: String,
    user_id: String,
    access_token: String,
    expires_at: f64,
}
impl Snapshot {
    // Structural identity is only a refresh binding, never authorization.
    fn subject(&self) -> Option<Identity> {
        if self.kind != "org2_cloud"
            || self.supabase_url.trim().trim_end_matches('/') != OFFICIAL
            || uuid::Uuid::parse_str(&self.user_id).is_err()
            || self.access_token.len() > 16384
            || !self.expires_at.is_finite()
            || self.expires_at <= 0.0
        {
            return None;
        }
        // Claims alone never authorize: /user verifies this exact bearer below.
        let mut parts = self.access_token.split('.');
        let _header = parts.next()?;
        let payload = URL_SAFE_NO_PAD.decode(parts.next()?).ok()?;
        if parts.next()?.is_empty() || parts.next().is_some() {
            return None;
        }
        let claims: serde_json::Value = serde_json::from_slice(&payload).ok()?;
        let exp = claims.get("exp")?.as_f64()?;
        (claims.get("sub")?.as_str()? == self.user_id
            && claims.get("iss")?.as_str()? == format!("{OFFICIAL}/auth/v1")
            && exp.is_finite()
            && exp > 0.0)
            .then(|| Identity {
                user: self.user_id.clone(),
            })
    }

    fn identity(&self, now: f64) -> Option<Identity> {
        let subject = self.subject()?;
        (self.effective_expiry()? > now).then_some(subject)
    }

    fn effective_expiry(&self) -> Option<f64> {
        let payload = URL_SAFE_NO_PAD
            .decode(self.access_token.split('.').nth(1)?)
            .ok()?;
        let claims: serde_json::Value = serde_json::from_slice(&payload).ok()?;
        Some(self.expires_at.min(claims.get("exp")?.as_f64()?))
    }

    fn fingerprint(&self) -> [u8; 32] {
        Sha256::digest(self.access_token.as_bytes()).into()
    }
}
#[derive(Default)]
struct State {
    epoch: u64,
    suspended: bool,
    identity: Option<Identity>,
    validated: Option<[u8; 32]>,
    expires_at: f64,
    // Retain the structural subject across expiry, separately from verified auth.
    observed_owner: Option<Identity>,
    owner_generation: u64,
}
impl State {
    fn observe(&mut self, subject: Option<Identity>) -> bool {
        if self.observed_owner == subject {
            return false;
        }
        self.observed_owner = subject;
        self.owner_generation += 1;
        true
    }
    fn suspend(&mut self) -> u64 {
        self.owner_generation += 1;
        self.retire()
    }
    fn retire(&mut self) -> u64 {
        self.epoch += 1;
        self.suspended = true;
        self.identity = None;
        self.validated = None;
        self.epoch
    }
    fn invalidate_if_current(&mut self, epoch: u64) {
        if self.epoch == epoch {
            self.identity = None;
            self.validated = None;
            self.expires_at = 0.0;
        }
    }
    fn begin_replacement(
        &mut self,
        start_epoch: u64,
        requested: Option<u64>,
    ) -> Result<u64, String> {
        if self.epoch != start_epoch || !self.permits_sync(requested) {
            return Err(CHANGED.into());
        }
        if self.suspended {
            return Ok(self.epoch);
        }
        let epoch = self.retire();
        self.suspended = false;
        Ok(epoch)
    }
    fn commit_verified(&mut self, epoch: u64, snapshot: &Snapshot, now: f64) -> Result<(), String> {
        if self.epoch != epoch {
            return Err(CHANGED.into());
        }
        self.identity = Some(snapshot.identity(now).ok_or(REQUIRED)?);
        self.validated = Some(snapshot.fingerprint());
        self.expires_at = snapshot.effective_expiry().ok_or(REQUIRED)?;
        self.suspended = false;
        Ok(())
    }
    fn permits_sync(&self, epoch: Option<u64>) -> bool {
        epoch.is_none_or(|e| e == self.epoch) && (!self.suspended || epoch == Some(self.epoch))
    }
}
fn state() -> &'static Arc<Mutex<State>> {
    static STATE: OnceLock<Arc<Mutex<State>>> = OnceLock::new();
    STATE.get_or_init(Default::default)
}
fn serial() -> &'static tokio::sync::Mutex<()> {
    static SERIAL: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    SERIAL.get_or_init(Default::default)
}
fn changes() -> &'static tokio::sync::watch::Sender<u64> {
    static CHANGES: OnceLock<tokio::sync::watch::Sender<u64>> = OnceLock::new();
    CHANGES.get_or_init(|| tokio::sync::watch::channel(0).0)
}
fn refresh_changes() -> &'static tokio::sync::watch::Sender<u64> {
    static CHANGES: OnceLock<tokio::sync::watch::Sender<u64>> = OnceLock::new();
    CHANGES.get_or_init(|| tokio::sync::watch::channel(0).0)
}
fn now() -> f64 {
    chrono::Utc::now().timestamp_millis() as f64 / 1000.0
}

fn auth_store_path(directory: &std::path::Path, identifier: &str) -> std::path::PathBuf {
    // Match sharedAuthStorage.ts: only the dedicated dev identity opts into
    // primary auth. Every numbered secondary keeps its own canonical store.
    let directory = if identifier == "org2ai.org2.dev" {
        directory.parent().unwrap_or(directory).join("org2ai.org2")
    } else {
        directory.to_path_buf()
    };
    directory.join("shared-service-auth.json")
}

fn read_snapshot() -> Result<Option<Snapshot>, String> {
    let app = crate::api::get_app_handle().ok_or(REQUIRED)?;
    let directory = app.path().app_data_dir().map_err(|_| REQUIRED)?;
    let path = auth_store_path(&directory, &app.config().identifier);
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(REQUIRED.into()),
    };
    use std::io::Read;
    let mut bytes = Vec::new();
    file.take(131073)
        .read_to_end(&mut bytes)
        .map_err(|_| REQUIRED)?;
    if bytes.len() > 131072 {
        return Err(REQUIRED.into());
    }
    let store: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| REQUIRED)?;
    let Some(raw) = store
        .get("orgii:org2-cloud-v1:auth")
        .and_then(|v| v.as_str())
    else {
        return Ok(None);
    };
    serde_json::from_str::<Option<Snapshot>>(raw).map_err(|_| REQUIRED.into())
}
async fn snapshot() -> Result<Option<Snapshot>, String> {
    tokio::task::spawn_blocking(read_snapshot)
        .await
        .map_err(|_| REQUIRED.to_string())?
}

async fn verify(snapshot: &Snapshot) -> Result<(), String> {
    // Once per changed token, shared by all callers. The fixed official endpoint
    // verifies the bearer; caller-controlled URLs and user ids grant nothing.
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| REQUIRED)?;
    let mut response = client
        .get(format!("{OFFICIAL}/auth/v1/user"))
        .header("apikey", PUBLIC_KEY)
        .bearer_auth(&snapshot.access_token)
        .send()
        .await
        .map_err(|_| "market_cloud_verification_unavailable")?;
    if !response.status().is_success() {
        return Err(REQUIRED.into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| REQUIRED)? {
        if bytes.len() + chunk.len() > 65536 {
            return Err(REQUIRED.into());
        }
        bytes.extend_from_slice(&chunk);
    }
    verify_response(snapshot, &bytes)
}
fn verify_response(snapshot: &Snapshot, bytes: &[u8]) -> Result<(), String> {
    let user: serde_json::Value = serde_json::from_slice(bytes).map_err(|_| REQUIRED)?;
    if user.get("id").and_then(|v| v.as_str()) != Some(snapshot.user_id.as_str()) {
        return Err(CHANGED.into());
    }
    Ok(())
}

/// An epoch is authorization context, not a credential. Recheck after awaits
/// and before returning cached tokens or committing a late authorization.
#[derive(Clone)]
pub(super) struct Lease {
    state: Arc<Mutex<State>>,
    epoch: u64,
    identity: Identity,
}
pub(super) struct Operation {
    lease: Lease,
    _barrier: tokio::sync::OwnedRwLockReadGuard<()>,
}
impl crate::dynamic_credentials::OperationAuthorization for Operation {
    fn check(&self) -> Result<(), String> {
        self.lease.check()
    }
}
impl Lease {
    pub(super) fn native_app(
        &self,
        agent: &str,
    ) -> Result<Option<agent_cli::managed_config::native_app::NativeAppProfile>, String> {
        self.check()?;
        if !matches!(agent, "codex" | "claude_desktop") {
            return Ok(None);
        }
        agent_cli::managed_config::native_app::NativeAppProfile::new(agent, OFFICIAL, self.user())
            .map(Some)
    }

    pub(super) async fn operation(self) -> Result<Operation, String> {
        let barrier = super::source::operation_barrier(&self).await?;
        Ok(Operation {
            lease: self,
            _barrier: barrier,
        })
    }

    pub(super) fn user(&self) -> &str {
        &self.identity.user
    }
    pub(super) fn check(&self) -> Result<(), String> {
        let s = self.state.lock().map_err(|_| REQUIRED)?;
        if s.suspended
            || s.epoch != self.epoch
            || s.identity.as_ref() != Some(&self.identity)
            || s.expires_at <= now()
        {
            return Err(CHANGED.into());
        }
        Ok(())
    }
    pub(super) fn matches(&self, user: &str) -> Result<(), String> {
        self.check()?;
        if self.user() != user {
            return Err(CHANGED.into());
        }
        Ok(())
    }
}

pub(super) async fn suspend() -> Result<u64, String> {
    // A Keychain prompt can hold an old read operation. Acknowledge revocation
    // immediately so durable logout never waits for that OS interaction.
    // sync retires old work before it can restore an owner.
    let epoch = {
        let mut s = state().lock().map_err(|_| REQUIRED)?;
        let epoch = s.suspend();
        refresh_changes().send_replace(s.owner_generation);
        epoch
    };
    changes().send_replace(epoch);
    Ok(epoch)
}

pub(super) async fn sync(epoch: Option<u64>) -> Result<(), String> {
    let _serial = serial().lock().await;
    cancel_on_invalidation(changes().subscribe(), sync_current(epoch)).await
}
async fn cancel_on_invalidation<T>(
    mut changes: tokio::sync::watch::Receiver<u64>,
    work: impl std::future::Future<Output = Result<T, String>>,
) -> Result<T, String> {
    // New invalidation cancels an old Keychain-barrier/network wait. Dropping
    // the old future also removes its lock waiter; no polling or worker remains.
    tokio::select! {
        result = work => result,
        _ = changes.changed() => Err(CHANGED.into()),
    }
}
async fn sync_current(epoch: Option<u64>) -> Result<(), String> {
    let start_epoch = {
        let s = state().lock().map_err(|_| REQUIRED)?;
        if !s.permits_sync(epoch) {
            return Err(CHANGED.into());
        }
        s.epoch
    };
    let read = snapshot().await;
    let current = read.as_ref().ok().and_then(|v| v.as_ref());
    let subject = current.and_then(Snapshot::subject);
    let identity = current.and_then(|v| v.identity(now()));
    let fingerprint = current
        .filter(|_| identity.is_some())
        .map(Snapshot::fingerprint);
    let changed = {
        let mut s = state().lock().map_err(|_| REQUIRED)?;
        if s.epoch != start_epoch || !s.permits_sync(epoch) {
            return Err(CHANGED.into());
        }
        if s.observe(subject) {
            refresh_changes().send_replace(s.owner_generation);
        }
        s.suspended || s.identity != identity
    };
    let commit_epoch = if changed {
        // Every explicit suspension retires old work, including signed-out sync.
        // Also detect a storage owner change if frontend notification was lost.
        let e = {
            let mut s = state().lock().map_err(|_| REQUIRED)?;
            s.begin_replacement(start_epoch, epoch)?
        };
        let _barrier = super::source::retire_for_reauthorization().await;
        super::enabled::cancel()?;
        e
    } else {
        start_epoch
    };
    if identity.is_none() {
        let mut s = state().lock().map_err(|_| REQUIRED)?;
        if s.epoch != commit_epoch {
            return Err(CHANGED.into());
        }
        s.identity = None;
        s.validated = None;
        s.suspended = false;
        return read.map(|_| ());
    }
    let already_verified = state().lock().map_err(|_| REQUIRED)?.validated == fingerprint;
    if !already_verified {
        if let Err(error) = verify(current.ok_or(REQUIRED)?).await {
            let mut s = state().lock().map_err(|_| REQUIRED)?;
            s.invalidate_if_current(commit_epoch);
            return Err(error);
        }
    }
    // A disk write or another suspend while verification ran must not resurrect
    // the old account, including a rapid A -> signed out -> A transition.
    let fresh = match snapshot().await {
        Ok(fresh) => fresh,
        Err(error) => {
            state()
                .lock()
                .map_err(|_| REQUIRED)?
                .invalidate_if_current(commit_epoch);
            return Err(error);
        }
    };
    if fresh.as_ref().and_then(|v| v.identity(now())) != identity
        || fresh.as_ref().map(Snapshot::fingerprint) != fingerprint
    {
        let mut s = state().lock().map_err(|_| REQUIRED)?;
        s.invalidate_if_current(commit_epoch);
        return Err(CHANGED.into());
    }
    let mut s = state().lock().map_err(|_| REQUIRED)?;
    s.commit_verified(commit_epoch, current.ok_or(REQUIRED)?, now())
}

pub(super) fn require() -> Result<Lease, String> {
    let s = state().lock().map_err(|_| REQUIRED)?;
    if s.suspended || s.expires_at <= now() {
        return Err(REQUIRED.into());
    }
    Ok(Lease {
        state: Arc::clone(state()),
        epoch: s.epoch,
        identity: s.identity.clone().ok_or(REQUIRED)?,
    })
}

/// Independent of the verified lease epoch: cold-start expiry may replace an
/// unverified owner with the same verified subject, but never cross a logout.
#[derive(Clone)]
pub(super) struct RefreshBinding {
    state: Arc<Mutex<State>>,
    generation: u64,
    user: String,
}
impl RefreshBinding {
    pub(super) fn user(&self) -> &str {
        &self.user
    }
    pub(super) fn check(&self) -> Result<(), String> {
        let s = self.state.lock().map_err(|_| REQUIRED)?;
        if s.suspended
            || s.owner_generation != self.generation
            || s.observed_owner.as_ref().map(|i| i.user.as_str()) != Some(&self.user)
        {
            return Err(CHANGED.into());
        }
        Ok(())
    }
    pub(super) async fn while_current<T>(
        &self,
        work: impl std::future::Future<Output = Result<T, String>>,
    ) -> Result<T, String> {
        let changes = refresh_changes().subscribe();
        self.check()?;
        let result = cancel_on_invalidation(changes, work).await?;
        self.check()?;
        Ok(result)
    }
}
#[derive(Clone)]
pub(super) struct RefreshStart {
    state: Arc<Mutex<State>>,
    generation: u64,
    unobserved: bool,
}
pub(super) fn refresh_start() -> Result<RefreshStart, String> {
    let s = state().lock().map_err(|_| REQUIRED)?;
    if s.suspended {
        return Err(CHANGED.into());
    }
    Ok(RefreshStart {
        state: Arc::clone(state()),
        generation: s.owner_generation,
        unobserved: s.observed_owner.is_none(),
    })
}
impl RefreshStart {
    pub(super) fn binding(&self, user: &str) -> Result<RefreshBinding, String> {
        let s = self.state.lock().map_err(|_| REQUIRED)?;
        // The sole permitted generation change is first observing this exact
        // cold-start owner. Any suspension or A→B→A adds another generation.
        let expected = self.generation + u64::from(self.unobserved);
        if s.suspended
            || (s.owner_generation != self.generation && s.owner_generation != expected)
            || s.observed_owner.as_ref().map(|i| i.user.as_str()) != Some(user)
        {
            return Err(CHANGED.into());
        }
        Ok(RefreshBinding {
            state: Arc::clone(&self.state),
            generation: s.owner_generation,
            user: user.into(),
        })
    }
}

/// All dynamic credential consumers enter here before holding source barriers.
/// The common case is an in-memory verified lease, with no disk/network work.
pub(super) async fn require_fresh(user: &str) -> Result<Lease, String> {
    if let Ok(lease) = require() {
        lease.matches(user)?;
        return Ok(lease);
    }
    let lease = super::owner_refresh::request(user).await?;
    lease.matches(user)?;
    Ok(lease)
}

#[cfg(test)]
pub(super) fn test_lease(user: &str) -> (Lease, impl Fn() + Clone) {
    let identity = Identity { user: user.into() };
    let state = Arc::new(Mutex::new(State {
        identity: Some(identity.clone()),
        expires_at: f64::MAX,
        ..State::default()
    }));
    let lease = Lease {
        state: Arc::clone(&state),
        epoch: 0,
        identity,
    };
    (lease, move || {
        state.lock().unwrap().suspend();
    })
}

#[cfg(test)]
pub(super) fn test_refresh_context(user: &str) -> (RefreshStart, RefreshBinding, impl Fn()) {
    let state = Arc::new(Mutex::new(State {
        observed_owner: Some(Identity { user: user.into() }),
        ..State::default()
    }));
    let start = RefreshStart {
        state: Arc::clone(&state),
        generation: 0,
        unobserved: false,
    };
    let binding = start.binding(user).unwrap();
    (start, binding, move || {
        state.lock().unwrap().suspend();
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn token(user: &str, origin: &str, exp: u64) -> String {
        format!("e30.{}.signature", URL_SAFE_NO_PAD.encode(serde_json::to_vec(&serde_json::json!({"sub": user, "iss": format!("{origin}/auth/v1"), "exp": exp})).unwrap()))
    }
    fn snapshot_fixture() -> Snapshot {
        Snapshot {
            kind: "org2_cloud".into(),
            supabase_url: OFFICIAL.into(),
            user_id: "11111111-1111-4111-8111-111111111111".into(),
            access_token: token("11111111-1111-4111-8111-111111111111", OFFICIAL, 2000),
            expires_at: 2000.0,
        }
    }
    #[test]
    fn canonical_owner_rejects_custom_endpoint_expiry_and_malformed_identity() {
        let mut a = snapshot_fixture();
        assert!(a.identity(1000.0).is_some());
        a.supabase_url.push('/');
        assert!(a.identity(1000.0).is_some());
        a.supabase_url = "https://other.supabase.co".into();
        assert!(a.identity(1000.0).is_none());
        a = snapshot_fixture();
        a.expires_at = 1000.0;
        assert!(a.identity(1000.0).is_none());
        a = snapshot_fixture();
        a.user_id = "caller-provided-owner".into();
        assert!(a.identity(1000.0).is_none());
    }
    #[test]
    fn suspend_blocks_implicit_restore_and_rejects_late_sync_even_same_user() {
        let mut s = State::default();
        let first = s.suspend();
        assert!(!s.permits_sync(None));
        assert!(s.permits_sync(Some(first)));
        let second = s.suspend();
        assert!(!s.permits_sync(Some(first)));
        assert!(s.permits_sync(Some(second)));
    }
    #[test]
    fn token_refresh_keeps_identity_but_requires_new_bearer_verification() {
        let a = snapshot_fixture();
        let mut b = snapshot_fixture();
        b.access_token = token(&b.user_id, OFFICIAL, 3000);
        assert!(a.identity(1000.0) == b.identity(1000.0));
        assert!(a.fingerprint() != b.fingerprint());
    }
    #[test]
    fn persisted_metadata_cannot_override_bearer_subject_or_official_issuer() {
        let mut snapshot = snapshot_fixture();
        snapshot.access_token = token("22222222-2222-4222-8222-222222222222", OFFICIAL, 2000);
        assert!(snapshot.identity(1000.0).is_none());
        snapshot.access_token = token(&snapshot.user_id, "https://attacker.example", 2000);
        assert!(snapshot.identity(1000.0).is_none());
        snapshot.access_token = token(&snapshot.user_id, OFFICIAL, 999);
        assert!(snapshot.identity(1000.0).is_none());
    }
    #[tokio::test]
    async fn verification_completing_after_logout_cannot_restore_old_owner() {
        let state = Arc::new(Mutex::new(State::default()));
        let initial_epoch = state.lock().unwrap().suspend();
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        let (finish_tx, finish_rx) = tokio::sync::oneshot::channel();
        let verifying = Arc::clone(&state);
        let pending = tokio::spawn(async move {
            assert!(verifying.lock().unwrap().permits_sync(Some(initial_epoch)));
            ready_tx.send(()).unwrap();
            finish_rx.await.unwrap();
            verifying
                .lock()
                .unwrap()
                .commit_verified(initial_epoch, &snapshot_fixture(), 1000.0)
        });
        ready_rx.await.unwrap();
        state.lock().unwrap().suspend();
        finish_tx.send(()).unwrap();
        assert!(pending.await.unwrap().is_err());
        assert!(state.lock().unwrap().identity.is_none());
        assert!(!state.lock().unwrap().permits_sync(None));
    }
    #[test]
    fn verified_refresh_preserves_epoch_and_transition_sync_is_idempotent() {
        let mut state = State::default();
        let epoch = state.suspend();
        state
            .commit_verified(epoch, &snapshot_fixture(), 1000.0)
            .unwrap();
        assert!(state.permits_sync(Some(epoch)));
        let mut refreshed = snapshot_fixture();
        refreshed.access_token = token(&refreshed.user_id, OFFICIAL, 3000);
        refreshed.expires_at = 3000.0;
        state.commit_verified(epoch, &refreshed, 1000.0).unwrap();
        assert_eq!(state.epoch, epoch);
        assert_eq!(state.validated, Some(refreshed.fingerprint()));
    }
    #[test]
    fn replacement_cannot_claim_a_newer_suspension_epoch() {
        let mut state = State::default();
        let before_read = state.epoch;
        let new_epoch = state.suspend();
        assert!(state.begin_replacement(before_read, None).is_err());
        assert!(state.identity.is_none());
        assert!(state.suspended);
        assert_eq!(state.epoch, new_epoch);
    }
    #[test]
    fn official_user_response_is_bound_to_the_persisted_bearer_identity() {
        let snapshot = snapshot_fixture();
        let response = serde_json::to_vec(&serde_json::json!({"id":snapshot.user_id})).unwrap();
        assert!(verify_response(&snapshot, &response).is_ok());
        assert!(verify_response(
            &snapshot,
            br#"{"id":"22222222-2222-4222-8222-222222222222"}"#
        )
        .is_err());
        assert!(verify_response(&snapshot, b"{}").is_err());
    }
    #[test]
    fn only_dedicated_dev_identity_shares_primary_auth_store() {
        use std::path::Path;
        let numbered = Path::new("/data/org2ai.org2.instance89");
        assert_eq!(
            auth_store_path(numbered, "org2ai.org2.instance89"),
            numbered.join("shared-service-auth.json")
        );
        assert_eq!(
            auth_store_path(Path::new("/data/org2ai.org2.dev"), "org2ai.org2.dev"),
            Path::new("/data/org2ai.org2/shared-service-auth.json")
        );
    }
    #[test]
    fn metadata_expiry_cannot_extend_the_verified_bearer_lifetime() {
        let mut snapshot = snapshot_fixture();
        snapshot.expires_at = 2010.0;
        assert!(snapshot.identity(1000.0).is_some());
        let mut state = State::default();
        state.commit_verified(0, &snapshot, 1000.0).unwrap();
        assert_eq!(state.expires_at, 2000.0);
    }
    #[tokio::test]
    async fn new_invalidation_cancels_sync_waiting_for_an_old_request() {
        let barrier = Arc::new(tokio::sync::RwLock::new(()));
        let old_request = Arc::clone(&barrier).read_owned().await;
        let (changes, receiver) = tokio::sync::watch::channel(0);
        let (started, ready) = tokio::sync::oneshot::channel();
        let waiting = Arc::clone(&barrier);
        // Production sync executes its retirement/verification future through
        // this exact helper. A blocked retirement must release its queue slot.
        let sync = tokio::spawn(cancel_on_invalidation(receiver, async move {
            started.send(()).unwrap();
            let _retirement = waiting.write().await;
            Ok(())
        }));
        ready.await.unwrap();
        changes.send_replace(1);
        let result = tokio::time::timeout(std::time::Duration::from_secs(1), sync)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(result.unwrap_err(), CHANGED);
        assert!(barrier.try_write().is_err()); // Old operation is still blocked.
        drop(old_request);
        assert!(barrier.try_write().is_ok()); // Canceled sync retained no waiter.
    }
    #[test]
    fn failed_verification_or_disk_reread_invalidates_only_its_own_epoch() {
        let mut state = State::default();
        state
            .commit_verified(0, &snapshot_fixture(), 1000.0)
            .unwrap();
        state.invalidate_if_current(0);
        assert!(state.identity.is_none());
        assert!(state.validated.is_none());
        let newer = state.suspend();
        state
            .commit_verified(newer, &snapshot_fixture(), 1000.0)
            .unwrap();
        state.invalidate_if_current(0);
        assert!(state.identity.is_some());
        assert!(state.validated.is_some());
    }

    #[test]
    fn expired_snapshot_is_only_a_refresh_hint_and_cannot_authorize() {
        let a = snapshot_fixture();
        assert!(a.subject().is_some());
        assert!(a.identity(2001.0).is_none());
        let mut state = State::default();
        assert!(state.observe(a.subject()));
        assert!(state.commit_verified(0, &a, 2001.0).is_err());
        assert!(state.identity.is_none());
        let mut forged = snapshot_fixture();
        forged.supabase_url = "https://attacker.example".into();
        assert!(forged.subject().is_none());
        forged = snapshot_fixture();
        forged.access_token = token("22222222-2222-4222-8222-222222222222", OFFICIAL, 2000);
        assert!(forged.subject().is_none());
    }
    #[test]
    fn cold_expired_subject_can_become_verified_without_reviving_an_old_generation() {
        let state = Arc::new(Mutex::new(State::default()));
        let start = RefreshStart {
            state: Arc::clone(&state),
            generation: 0,
            unobserved: true,
        };
        let snapshot = snapshot_fixture();
        state.lock().unwrap().observe(snapshot.subject());
        let binding = start.binding(&snapshot.user_id).unwrap();
        let epoch = state.lock().unwrap().begin_replacement(0, None).unwrap();
        state
            .lock()
            .unwrap()
            .commit_verified(epoch, &snapshot, 1000.0)
            .unwrap();
        assert!(binding.check().is_ok());
        assert_eq!(state.lock().unwrap().owner_generation, 1);
        state.lock().unwrap().suspend();
        assert!(binding.check().is_err());
        assert!(start.binding(&snapshot.user_id).is_err());
    }
    #[test]
    fn implicit_a_b_a_or_endpoint_round_trip_invalidates_refresh() {
        let snapshot = snapshot_fixture();
        let (start, binding, _) = test_refresh_context(&snapshot.user_id);
        let mut state = start.state.lock().unwrap();
        state.observe(Some(Identity {
            user: "22222222-2222-4222-8222-222222222222".into(),
        }));
        state.observe(snapshot.subject());
        drop(state);
        assert!(binding.check().is_err());
        assert!(start.binding(&snapshot.user_id).is_err());
        let (start, binding, _) = test_refresh_context(&snapshot.user_id);
        let mut state = start.state.lock().unwrap();
        state.observe(None); // Custom endpoint or signed-out canonical snapshot.
        state.observe(snapshot.subject());
        drop(state);
        assert!(binding.check().is_err());
        assert!(start.binding(&snapshot.user_id).is_err());
    }
    #[test]
    fn logout_before_cold_start_sync_cannot_use_first_observation_exception() {
        let state = Arc::new(Mutex::new(State::default()));
        let start = RefreshStart {
            state: Arc::clone(&state),
            generation: 0,
            unobserved: true,
        };
        let snapshot = snapshot_fixture();
        let epoch = state.lock().unwrap().suspend();
        state.lock().unwrap().observe(snapshot.subject());
        state
            .lock()
            .unwrap()
            .commit_verified(epoch, &snapshot, 1000.0)
            .unwrap();
        assert!(start.binding(&snapshot.user_id).is_err());
    }
}
