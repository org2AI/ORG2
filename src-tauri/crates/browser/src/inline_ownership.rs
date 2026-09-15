//! Per-label command lanes serialize native creation and release. A close can
//! release only its owner, and unknown/duplicate releases are harmless.
//! Empty lanes disappear when their last queued command drops: no historical
//! cancellation tombstones, timers, or app-lifetime label accumulation.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use tokio::sync::Mutex as AsyncMutex;

#[derive(Default)]
pub(super) struct Owners {
    generations: HashMap<u64, u64>,
    // Copilot's isolated capture uses the older generation-less command pair.
    anonymous: HashMap<u64, usize>,
}

impl Owners {
    pub fn may_configure(&self, generation: Option<u64>) -> bool {
        self.generations
            .keys()
            .max()
            .is_none_or(|current| generation.is_some_and(|incoming| incoming >= *current))
    }

    pub fn acquire(&mut self, generation: Option<u64>, epoch: u64) -> bool {
        if let Some(generation) = generation.filter(|value| *value != 0) {
            self.generations.insert(generation, epoch).is_none()
        } else {
            *self.anonymous.entry(epoch).or_default() += 1;
            true
        }
    }

    /// Returns true only when this release removed the final actual owner.
    pub fn release(&mut self, generation: Option<u64>) -> bool {
        let removed = if let Some(generation) = generation.filter(|value| *value != 0) {
            self.generations.remove(&generation).is_some()
        } else if let Some(epoch) = self.anonymous.keys().copied().min() {
            let count = self.anonymous.get_mut(&epoch).unwrap();
            *count -= 1;
            if *count == 0 {
                self.anonymous.remove(&epoch);
            }
            true
        } else {
            false
        };
        removed && self.is_empty()
    }

    pub fn is_empty(&self) -> bool {
        self.generations.is_empty() && self.anonymous.is_empty()
    }

    /// Remove only ownership predating this native renderer boundary.
    pub fn release_before(&mut self, epoch: u64) {
        self.generations.retain(|_, acquired| *acquired >= epoch);
        self.anonymous.retain(|acquired, _| *acquired >= epoch);
    }
}

/// Native process clock, independent of frontend wall-clock generations.
#[derive(Default)]
pub(super) struct ReloadEpoch(AtomicU64);
impl ReloadEpoch {
    pub fn current(&self) -> u64 {
        self.0.load(Ordering::Acquire)
    }
    pub fn advance(&self) -> u64 {
        self.0.fetch_add(1, Ordering::AcqRel) + 1
    }
    pub fn check(&self, captured: u64) -> Result<(), String> {
        if self.current() == captured {
            Ok(())
        } else {
            Err("Inline webview creation was cancelled by renderer reload".to_string())
        }
    }
}
type Lane = Arc<AsyncMutex<Owners>>;
#[derive(Default)]
struct LaneEntry {
    state: Lane,
    epoch: Arc<ReloadEpoch>,
    window: Option<String>,
}
static LANES: OnceLock<Mutex<HashMap<String, LaneEntry>>> = OnceLock::new();
fn lanes() -> &'static Mutex<HashMap<String, LaneEntry>> {
    LANES.get_or_init(|| Mutex::new(HashMap::new()))
}
pub(super) struct OwnerLane {
    pub label: String,
    pub state: Lane,
    pub epoch: Arc<ReloadEpoch>,
}
fn handle(label: &str, entry: &LaneEntry) -> OwnerLane {
    OwnerLane {
        label: label.to_string(),
        state: entry.state.clone(),
        epoch: entry.epoch.clone(),
    }
}
pub(super) fn owner_lane(label: &str) -> OwnerLane {
    let mut registry = lanes().lock().unwrap();
    handle(label, registry.entry(label.to_string()).or_default())
}
pub(super) fn owner_lane_for_window(label: &str, window: &str) -> Result<OwnerLane, String> {
    let mut registry = lanes().lock().unwrap();
    let entry = registry.entry(label.to_string()).or_default();
    if entry
        .window
        .as_deref()
        .is_some_and(|parent| parent != window)
    {
        return Err(format!("Webview '{label}' belongs to another window"));
    }
    entry.window = Some(window.to_string());
    Ok(handle(label, entry))
}
pub(super) fn window_reload_lanes(window: &str) -> Vec<(OwnerLane, u64)> {
    let registry = lanes().lock().unwrap();
    registry
        .iter()
        .filter(|(_, entry)| entry.window.as_deref() == Some(window))
        .map(|(label, entry)| (handle(label, entry), entry.epoch.advance()))
        .collect()
}

impl Drop for OwnerLane {
    fn drop(&mut self) {
        let mut registry = lanes().lock().unwrap();
        // Other active/queued commands hold a strong reference. Their last
        // completion will do the cleanup instead, keeping one lane per label.
        if Arc::strong_count(&self.state) == 2 {
            if let Ok(state) = self.state.try_lock() {
                if state.is_empty() {
                    registry.remove(&self.label);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registered_labels() -> Vec<String> {
        lanes().lock().unwrap().keys().cloned().collect()
    }

    #[tokio::test]
    async fn reload_fences_only_its_window_and_retains_fresh_owners() {
        let window = uuid::Uuid::new_v4().to_string();
        let other_window = uuid::Uuid::new_v4().to_string();
        let label = uuid::Uuid::new_v4().to_string();
        let other_label = uuid::Uuid::new_v4().to_string();
        let lane = owner_lane_for_window(&label, &window).unwrap();
        let other = owner_lane_for_window(&other_label, &other_window).unwrap();
        assert!(owner_lane_for_window(&label, &other_window).is_err());
        let old_epoch = lane.epoch.current();
        let other_epoch = other.epoch.current();
        lane.state.lock().await.acquire(Some(10), old_epoch);
        other.state.lock().await.acquire(Some(20), other_epoch);
        let plan = window_reload_lanes(&window);
        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].0.label, label);
        assert!(lane.epoch.check(old_epoch).is_err());
        assert!(other.epoch.check(other_epoch).is_ok());
        let mut owners = lane.state.lock().await;
        owners.acquire(Some(30), lane.epoch.current());
        owners.release_before(plan[0].1);
        assert!(!owners.release(Some(10)));
        assert!(owners.release(Some(30)));
        assert!(other.state.lock().await.release(Some(20)));
    }

    #[test]
    fn pending_creation_is_fenced_and_plan_keeps_lane_alive() {
        let window = uuid::Uuid::new_v4().to_string();
        let label = uuid::Uuid::new_v4().to_string();
        let pending = owner_lane_for_window(&label, &window).unwrap();
        let captured = pending.epoch.current();
        let plan = window_reload_lanes(&window);
        assert_eq!(plan.len(), 1);
        assert!(pending.epoch.check(captured).is_err());
        drop(pending);
        assert!(registered_labels().contains(&label));
        drop(plan);
        assert!(!registered_labels().contains(&label));
    }

    #[tokio::test]
    async fn reload_rejects_create_queued_before_lane_and_preserves_new_renderer() {
        let clock = ReloadEpoch::default();
        let old_epoch = clock.current();
        let label = format!("reload-queued-{}", uuid::Uuid::new_v4());
        let lane = owner_lane(&label);
        let mut owners = lane.state.lock().await;
        let boundary = clock.advance();
        // A newer renderer reaches the same lane first. Its wall clock token
        // may even be smaller; native epochs define the reload boundary.
        owners.acquire(Some(5), boundary);
        drop(owners);
        let mut owners = lane.state.lock().await;
        assert!(clock.check(old_epoch).is_err());
        owners.release_before(boundary);
        assert!(!owners.is_empty());
        assert!(owners.release(Some(5)));
    }

    #[test]
    fn reload_during_native_creation_releases_late_old_owner_only() {
        let clock = ReloadEpoch::default();
        let captured = clock.current();
        let mut owners = Owners::default();
        // Native creation is running while PageLoad Started fences the epoch.
        let boundary = clock.advance();
        owners.acquire(Some(100), captured);
        assert!(clock.check(captured).is_err());
        owners.acquire(Some(200), boundary);
        owners.release_before(boundary);
        assert!(!owners.release(Some(100)));
        assert!(owners.release(Some(200)));
    }

    #[test]
    fn repeated_reload_cleanup_can_finish_out_of_order() {
        let mut owners = Owners::default();
        owners.acquire(Some(10), 0);
        owners.acquire(None, 0);
        owners.acquire(Some(20), 1);
        owners.acquire(None, 1);
        owners.acquire(Some(30), 2);
        owners.release_before(2);
        owners.release_before(1);
        owners.release_before(2);
        assert!(!owners.release(None));
        assert!(!owners.release(Some(10)));
        assert!(!owners.release(Some(20)));
        assert!(owners.release(Some(30)));
    }

    #[tokio::test]
    async fn reload_snapshot_includes_pending_native_creation_and_reclaims_lane() {
        let label = format!("reload-pending-{}", uuid::Uuid::new_v4());
        {
            let lane = owner_lane(&label);
            let mut owners = lane.state.lock().await;
            assert!(registered_labels().contains(&label));
            owners.acquire(Some(10), 0);
            owners.release_before(1);
            assert!(owners.is_empty());
        }
        assert!(!registered_labels().contains(&label));
    }

    #[test]
    fn stale_and_duplicate_release_cannot_consume_new_owner() {
        let mut owners = Owners::default();
        assert!(owners.acquire(Some(10), 0));
        assert!(owners.release(Some(10)));
        assert!(owners.acquire(Some(20), 0));
        assert!(!owners.release(Some(10)));
        assert!(!owners.is_empty());
        assert!(owners.release(Some(20)));
        assert!(!owners.release(Some(20)));
    }

    #[test]
    fn distinct_owners_share_and_duplicate_acquire_is_idempotent() {
        let mut owners = Owners::default();
        assert!(owners.acquire(Some(10), 0));
        assert!(!owners.acquire(Some(10), 0));
        assert!(owners.acquire(Some(20), 0));
        assert!(!owners.may_configure(Some(10)));
        assert!(owners.may_configure(Some(20)));
        assert!(!owners.release(Some(10)));
        assert!(owners.release(Some(20)));
    }

    #[test]
    fn legacy_capture_cannot_release_modern_owner() {
        let mut owners = Owners::default();
        owners.acquire(None, 0);
        owners.acquire(Some(10), 0);
        assert!(!owners.release(None));
        assert!(!owners.release(None));
        assert!(owners.release(Some(10)));
    }

    #[tokio::test]
    async fn pending_create_close_remount_and_old_completion_are_serialized() {
        let label = format!("ownership-{}", uuid::Uuid::new_v4());
        let first = owner_lane(&label);
        let mut creating = first.state.lock().await;
        creating.acquire(Some(10), 0);
        let old_close = owner_lane(&label);
        let new_create = owner_lane(&label);
        assert!(old_close.state.try_lock().is_err());
        drop(creating); // native create completes, now queued release can run
        assert!(old_close.state.lock().await.release(Some(10)));
        new_create.state.lock().await.acquire(Some(20), 0);
        assert!(!old_close.state.lock().await.release(Some(10)));
        assert!(!new_create.state.lock().await.is_empty());
        assert!(new_create.state.lock().await.release(Some(20)));
        drop(first);
        drop(old_close);
        drop(new_create);
        assert!(!lanes().lock().unwrap().contains_key(&label));
    }

    #[tokio::test]
    async fn completed_labels_and_unknown_closes_retain_no_tombstones() {
        for index in 0..10_000 {
            let label = format!("reclaimed-{index}-{}", uuid::Uuid::new_v4());
            {
                let lane = owner_lane(&label);
                let mut owners = lane.state.lock().await;
                owners.acquire(Some(1), 0);
                assert!(owners.release(Some(1)));
                assert!(!owners.release(Some(1)));
            }
            assert!(!lanes().lock().unwrap().contains_key(&label));
        }
        let label = format!("unknown-{}", uuid::Uuid::new_v4());
        {
            let lane = owner_lane(&label);
            assert!(!lane.state.lock().await.release(Some(1)));
        }
        assert!(!lanes().lock().unwrap().contains_key(&label));
    }

    #[tokio::test]
    async fn close_before_create_does_not_require_ipc_order_or_a_tombstone() {
        let label = format!("close-before-create-{}", uuid::Uuid::new_v4());
        {
            let early_close = owner_lane(&label);
            assert!(!early_close.state.lock().await.release(Some(10)));
        }
        assert!(!lanes().lock().unwrap().contains_key(&label));
        {
            let newer = owner_lane(&label);
            newer.state.lock().await.acquire(Some(20), 0);
        }
        {
            let late_create = owner_lane(&label);
            let mut owners = late_create.state.lock().await;
            // An old create may share the existing native view, but must never
            // navigate/reposition the more recent owner's view.
            assert!(!owners.may_configure(Some(10)));
            owners.acquire(Some(10), 0);
            // The unmounted frontend always releases again after create settles.
            assert!(!owners.release(Some(10)));
            assert!(!owners.release(Some(10)));
            assert!(owners.release(Some(20)));
        }
        assert!(!lanes().lock().unwrap().contains_key(&label));
    }
}
