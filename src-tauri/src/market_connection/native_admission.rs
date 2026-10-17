//! Process-local scheduling, shared across packages for one buyer. This is not
//! authorization or a replacement for the gateway's cross-device admission.
use agent_core::providers::traits::ProviderError;
use async_trait::async_trait;
use market_connect::ConnectionMetadata;
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex, OnceLock, Weak},
    time::Duration,
};
use tokio::{sync::oneshot, time::Instant};

const MAX_OWNERS: usize = 32;
const MAX_WAITERS: usize = 128;
const FRESHNESS: Duration = Duration::from_secs(30);
const WAIT_BUDGET: Duration = Duration::from_secs(90);

#[allow(clippy::double_must_use)]
#[async_trait]
pub(super) trait CapacitySource: Send + Sync {
    async fn buyer_capacity(&self, metadata: &ConnectionMetadata) -> Result<usize, String>;
}

#[derive(Default)]
struct State {
    next: u64,
    pending: usize,
    active: Vec<(u64, bool)>,
    waiting: VecDeque<(u64, bool, oneshot::Sender<()>)>,
    capacity: usize,
}
impl State {
    fn dispatch(&mut self) {
        let capacity = self.capacity.max(1);
        while self.active.len() < capacity {
            let next = self
                .waiting
                .iter()
                .position(|(_, auxiliary, _)| !auxiliary)
                .or_else(|| {
                    let auxiliary = self
                        .active
                        .iter()
                        .filter(|(_, auxiliary)| *auxiliary)
                        .count();
                    (auxiliary < capacity.saturating_sub(1).max(1)).then_some(0)
                });
            let Some((id, auxiliary, wake)) = next.and_then(|i| self.waiting.remove(i)) else {
                break;
            };
            if wake.send(()).is_ok() {
                self.active.push((id, auxiliary));
            }
        }
    }
}

pub(super) struct Admission {
    state: Mutex<State>,
    // Demand-driven and single-flight. Errors also cool down for 30s, at one
    // conservative slot; no timer, background worker, or repeated HTTP retry.
    freshness: tokio::sync::Mutex<Option<Instant>>,
}
impl Default for Admission {
    fn default() -> Self {
        Self {
            state: Mutex::new(State::default()),
            freshness: tokio::sync::Mutex::new(None),
        }
    }
}

pub(super) fn for_buyer(endpoint: &str, identity: &str) -> Result<Arc<Admission>, ProviderError> {
    type Entry = (String, String, Weak<Admission>);
    static OWNERS: OnceLock<Mutex<Vec<Entry>>> = OnceLock::new();
    let mut owners = OWNERS.get_or_init(Default::default).lock().unwrap();
    owners.retain(|(_, _, state)| state.strong_count() > 0);
    if let Some(state) = owners
        .iter()
        .find(|(host, user, _)| host == endpoint && user == identity)
        .and_then(|(_, _, state)| state.upgrade())
    {
        return Ok(state);
    }
    if owners.len() >= MAX_OWNERS {
        return Err(ProviderError::Other("market_local_owner_limit".into()));
    }
    let state = Arc::new(Admission::default());
    owners.push((endpoint.into(), identity.into(), Arc::downgrade(&state)));
    Ok(state)
}

pub(super) struct Permit {
    owner: Arc<Admission>,
    id: u64,
}
impl Drop for Permit {
    fn drop(&mut self) {
        let mut state = self.owner.state.lock().unwrap();
        state.waiting.retain(|(id, _, _)| *id != self.id);
        state.active.retain(|(id, _)| *id != self.id);
        state.dispatch();
    }
}
struct WaitingSlot(Arc<Admission>);
impl Drop for WaitingSlot {
    fn drop(&mut self) {
        self.0.state.lock().unwrap().pending -= 1;
    }
}
impl Admission {
    async fn refresh(&self, source: &dyn CapacitySource, metadata: &ConnectionMetadata) {
        let mut freshness = self.freshness.lock().await;
        if freshness.is_some_and(|at| at.elapsed() < FRESHNESS) {
            return;
        }
        // Record conservative state BEFORE the await. Cancellation of a GET
        // must not let repeated callers bypass the failed-attempt cooldown.
        *freshness = Some(Instant::now());
        {
            let mut state = self.state.lock().unwrap();
            state.capacity = 1;
        }
        let capacity = source
            .buyer_capacity(metadata)
            .await
            .ok()
            .filter(|n| (1..=32).contains(n))
            .unwrap_or(1);
        *freshness = Some(Instant::now());
        let mut state = self.state.lock().unwrap();
        state.capacity = capacity;
        state.dispatch();
    }

    fn enqueue(
        self: &Arc<Self>,
        auxiliary: bool,
    ) -> Result<(Permit, oneshot::Receiver<()>), ProviderError> {
        let mut state = self.state.lock().unwrap();
        if state.waiting.len() >= MAX_WAITERS {
            return Err(ProviderError::Other("market_local_queue_full".into()));
        }
        state.next = state.next.wrapping_add(1);
        let id = state.next;
        let (wake, ready) = oneshot::channel();
        state.waiting.push_back((id, auxiliary, wake));
        state.dispatch();
        Ok((
            Permit {
                owner: Arc::clone(self),
                id,
            },
            ready,
        ))
    }

    pub(super) async fn acquire(
        self: &Arc<Self>,
        source: &dyn CapacitySource,
        metadata: &ConnectionMetadata,
        auxiliary: bool,
        cancel: Option<&std::sync::atomic::AtomicBool>,
    ) -> Result<Permit, ProviderError> {
        let cancelled =
            || cancel.is_some_and(|flag| flag.load(std::sync::atomic::Ordering::Relaxed));
        if cancelled() {
            return Err(ProviderError::Cancelled);
        }
        // Bound callers before capacity discovery's first await, including
        // everyone waiting on its single-flight mutex as well as queue tickets.
        let _waiting_slot = {
            let mut state = self.state.lock().unwrap();
            if state.pending >= MAX_WAITERS {
                return Err(ProviderError::Other("market_local_queue_full".into()));
            }
            state.pending += 1;
            WaitingSlot(Arc::clone(self))
        };
        // One overall wait budget includes capacity discovery and admission.
        // Drop of this future/receiver removes precisely its ticket, including
        // a permit granted just before cancellation; active HTTP is never killed.
        let acquire = async {
            self.refresh(source, metadata).await;
            let (permit, ready) = self.enqueue(auxiliary)?;
            ready
                .await
                .map_err(|_| ProviderError::Other("market_local_admission_closed".into()))?;
            Ok(permit)
        };
        tokio::pin!(acquire);
        let deadline = tokio::time::sleep(WAIT_BUDGET);
        tokio::pin!(deadline);
        loop {
            tokio::select! {
                biased;
                _ = &mut deadline => return Err(ProviderError::Other("market_local_queue_timeout".into())),
                result = &mut acquire => {
                    if cancelled() { return Err(ProviderError::Cancelled); }
                    return result;
                },
                // AtomicBool is the provider's existing cancellation protocol;
                // check only while waiting, never an app-lifetime poller.
                _ = tokio::time::sleep(Duration::from_millis(50)), if cancel.is_some() => {
                    if cancelled() { return Err(ProviderError::Cancelled); }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    struct Capacity {
        value: usize,
        reads: AtomicUsize,
    }
    #[async_trait]
    impl CapacitySource for Capacity {
        async fn buyer_capacity(&self, _: &ConnectionMetadata) -> Result<usize, String> {
            self.reads.fetch_add(1, Ordering::Relaxed);
            if self.value == 0 {
                Err("unavailable".into())
            } else {
                Ok(self.value)
            }
        }
    }
    fn metadata() -> ConnectionMetadata {
        ConnectionMetadata {
            identity_user_id: "11111111-1111-4111-8111-111111111111".into(),
            workspace_id: "ws_test".into(),
            target: market_connect::Target::Org2,
        }
    }
    fn capacity(value: usize) -> Capacity {
        Capacity {
            value,
            reads: AtomicUsize::new(0),
        }
    }
    fn gate(capacity: usize) -> Arc<Admission> {
        let gate = Arc::new(Admission::default());
        gate.state.lock().unwrap().capacity = capacity;
        gate
    }
    #[tokio::test]
    async fn capacity_two_reserves_main_slot_and_foreground_passes_queued_helpers() {
        let gate = gate(2);
        let (skill, mut skill_ready) = gate.enqueue(true).unwrap();
        assert!(skill_ready.try_recv().is_ok());
        let (title, mut title_ready) = gate.enqueue(true).unwrap();
        assert!(title_ready.try_recv().is_err());
        let (main, mut main_ready) = gate.enqueue(false).unwrap();
        assert!(main_ready.try_recv().is_ok());
        let (next_main, mut next_ready) = gate.enqueue(false).unwrap();
        drop(skill);
        assert!(next_ready.try_recv().is_ok());
        assert!(title_ready.try_recv().is_err());
        drop(main);
        assert!(title_ready.try_recv().is_ok());
        drop((next_main, title));
        assert!(gate.state.lock().unwrap().active.is_empty());
    }
    #[tokio::test]
    async fn capacity_one_keeps_inflight_helper_and_then_runs_foreground_first() {
        let gate = gate(1);
        let (helper, ready) = gate.enqueue(true).unwrap();
        ready.await.unwrap();
        let (title, mut title_ready) = gate.enqueue(true).unwrap();
        let (main, mut main_ready) = gate.enqueue(false).unwrap();
        assert!(main_ready.try_recv().is_err());
        drop(helper);
        assert!(main_ready.try_recv().is_ok());
        assert!(title_ready.try_recv().is_err());
        drop(main);
        title_ready.await.unwrap();
        drop(title);
    }
    #[tokio::test]
    async fn trusted_capacity_preserves_parallel_foreground_and_does_not_overadmit() {
        let gate = gate(20);
        let mut permits = Vec::new();
        for _ in 0..19 {
            let (p, r) = gate.enqueue(true).unwrap();
            r.await.unwrap();
            permits.push(p);
        }
        let (helper, mut helper_ready) = gate.enqueue(true).unwrap();
        assert!(helper_ready.try_recv().is_err());
        let (main, ready) = gate.enqueue(false).unwrap();
        ready.await.unwrap();
        assert_eq!(gate.state.lock().unwrap().active.len(), 20);
        drop(permits);
        helper_ready.await.unwrap();
        drop((helper, main));
        let mut foreground = Vec::new();
        for _ in 0..20 {
            let (p, r) = gate.enqueue(false).unwrap();
            r.await.unwrap();
            foreground.push(p);
        }
        assert_eq!(gate.state.lock().unwrap().active.len(), 20);
    }
    #[test]
    fn package_and_session_do_not_split_buyer_scope_and_owners_are_weak() {
        let endpoint = format!("https://{}.test", uuid::Uuid::new_v4());
        let package_a = for_buyer(&endpoint, "owner").unwrap();
        let package_b = for_buyer(&endpoint, "owner").unwrap();
        assert!(Arc::ptr_eq(&package_a, &package_b));
        assert!(!Arc::ptr_eq(
            &package_a,
            &for_buyer(&endpoint, "other").unwrap()
        ));
        assert!(!Arc::ptr_eq(
            &package_a,
            &for_buyer("https://other.test", "owner").unwrap()
        ));
        let weak = Arc::downgrade(&package_a);
        drop((package_a, package_b));
        assert!(weak.upgrade().is_none());
    }
    #[tokio::test(start_paused = true)]
    async fn unknown_capacity_is_one_and_failed_reads_are_cooled_down() {
        let gate = gate(20);
        let source = capacity(0);
        let metadata = metadata();
        let (a, b) = tokio::join!(
            gate.refresh(&source, &metadata),
            gate.refresh(&source, &metadata)
        );
        let _ = (a, b);
        assert_eq!(source.reads.load(Ordering::Relaxed), 1);
        assert_eq!(gate.state.lock().unwrap().capacity, 1);
        tokio::time::advance(FRESHNESS).await;
        gate.refresh(&source, &metadata).await;
        assert_eq!(source.reads.load(Ordering::Relaxed), 2);
    }
    #[tokio::test(start_paused = true)]
    async fn cancelled_and_timed_out_waiters_never_start_and_release_no_other_permit() {
        for auxiliary in [false, true] {
            let gate = gate(1);
            let source = capacity(1);
            let metadata = metadata();
            let (active, ready) = gate.enqueue(false).unwrap();
            ready.await.unwrap();
            let cancel = AtomicBool::new(false);
            let wait = gate.acquire(&source, &metadata, auxiliary, Some(&cancel));
            tokio::pin!(wait);
            assert!(futures_util::poll!(&mut wait).is_pending());
            cancel.store(true, Ordering::Relaxed);
            tokio::time::advance(Duration::from_millis(50)).await;
            assert!(matches!(wait.await, Err(ProviderError::Cancelled)));
            assert_eq!(gate.state.lock().unwrap().active.len(), 1);
            assert!(gate.state.lock().unwrap().waiting.is_empty());
            let wait = gate.acquire(&source, &metadata, auxiliary, None);
            tokio::pin!(wait);
            assert!(futures_util::poll!(&mut wait).is_pending());
            tokio::time::advance(WAIT_BUDGET).await;
            assert!(
                matches!(wait.await, Err(ProviderError::Other(code)) if code == "market_local_queue_timeout")
            );
            assert!(gate.state.lock().unwrap().waiting.is_empty());
            drop(active);
            assert!(gate.state.lock().unwrap().active.is_empty());
        }
    }
    #[tokio::test]
    async fn dropped_granted_receiver_and_queue_overflow_are_bounded() {
        let gate = gate(1);
        let (active, ready) = gate.enqueue(false).unwrap();
        ready.await.unwrap();
        let mut waiters = Vec::new();
        for _ in 0..MAX_WAITERS {
            waiters.push(gate.enqueue(false).unwrap());
        }
        assert!(gate.enqueue(true).is_err());
        drop(active);
        // The first waiter has been granted but not polled. Cancelling its
        // future still owns/releases that slot and dispatches the next one.
        drop(waiters.remove(0));
        assert!(waiters[0].1.try_recv().is_ok());
        drop(waiters);
        assert!(gate.state.lock().unwrap().active.is_empty());
        assert!(gate.state.lock().unwrap().waiting.is_empty());
    }
    #[tokio::test(start_paused = true)]
    async fn capacity_discovery_waiters_are_bounded_and_cancelled_fetch_keeps_cooldown() {
        struct Slow(AtomicUsize);
        #[async_trait]
        impl CapacitySource for Slow {
            async fn buyer_capacity(&self, _: &ConnectionMetadata) -> Result<usize, String> {
                self.0.fetch_add(1, Ordering::Relaxed);
                std::future::pending().await
            }
        }
        let gate = gate(20);
        let source = Slow(AtomicUsize::new(0));
        let metadata = metadata();
        let mut waiters = Vec::new();
        for _ in 0..MAX_WAITERS {
            let mut wait = Box::pin(gate.acquire(&source, &metadata, true, None));
            assert!(futures_util::poll!(&mut wait).is_pending());
            waiters.push(wait);
        }
        assert_eq!(source.0.load(Ordering::Relaxed), 1);
        assert_eq!(gate.state.lock().unwrap().pending, MAX_WAITERS);
        assert!(
            matches!(gate.acquire(&source, &metadata, false, None).await,
            Err(ProviderError::Other(code)) if code == "market_local_queue_full")
        );
        drop(waiters);
        assert_eq!(gate.state.lock().unwrap().pending, 0);
        assert_eq!(gate.state.lock().unwrap().capacity, 1);
        // The aborted leader did not forget its attempt. A subsequent request
        // uses conservative admission instead of launching another slow read.
        let permit = gate.acquire(&source, &metadata, false, None).await.unwrap();
        assert_eq!(source.0.load(Ordering::Relaxed), 1);
        drop(permit);
        tokio::time::advance(FRESHNESS).await;
        let mut next = Box::pin(gate.acquire(&source, &metadata, false, None));
        assert!(futures_util::poll!(&mut next).is_pending());
        assert_eq!(source.0.load(Ordering::Relaxed), 2);
        drop(next);
        assert_eq!(gate.state.lock().unwrap().pending, 0);
    }

    #[tokio::test]
    async fn lower_capacity_does_not_cancel_or_reuse_existing_permits() {
        let gate = gate(2);
        let (a, ra) = gate.enqueue(false).unwrap();
        ra.await.unwrap();
        let (b, rb) = gate.enqueue(false).unwrap();
        rb.await.unwrap();
        gate.refresh(&capacity(1), &metadata()).await;
        let (next, mut ready) = gate.enqueue(false).unwrap();
        drop(a);
        assert!(ready.try_recv().is_err());
        drop(b);
        ready.await.unwrap();
        drop(next);
    }
}
