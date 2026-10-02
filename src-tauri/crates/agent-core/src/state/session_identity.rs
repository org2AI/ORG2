//! Serialize identity admission and picker writes for one session.
//!
//! Rust turns hold this only through resolve/init/persistence, then release it
//! before execution. CLI runners retain it through provider-native publication,
//! whose files are account-bound. Idle sessions retain no mutex; dead weak
//! entries are pruned on every access.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Weak};
use tokio::sync::Mutex;

static LOCKS: LazyLock<Mutex<HashMap<String, Weak<Mutex<()>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub async fn session_identity_lock(session_id: &str) -> Arc<Mutex<()>> {
    let mut locks = LOCKS.lock().await;
    locks.retain(|_, lock| lock.strong_count() > 0);
    if let Some(lock) = locks.get(session_id).and_then(Weak::upgrade) {
        return lock;
    }
    let lock = Arc::new(Mutex::new(()));
    locks.insert(session_id.to_string(), Arc::downgrade(&lock));
    lock
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn same_session_serializes_and_unrelated_sessions_remain_independent() {
        let first = session_identity_lock("identity-one").await;
        let second = session_identity_lock("identity-one").await;
        let other = session_identity_lock("identity-two").await;
        assert!(Arc::ptr_eq(&first, &second));
        let guard = first.lock().await;
        assert!(second.try_lock().is_err());
        assert!(other.try_lock().is_ok());
        drop(guard);
        assert!(second.try_lock().is_ok());
    }

    #[tokio::test]
    async fn idle_identity_locks_are_released_and_pruned_on_next_access() {
        let lock = session_identity_lock("identity-released").await;
        let weak = Arc::downgrade(&lock);
        drop(lock);
        assert!(weak.upgrade().is_none());
        let _next = session_identity_lock("identity-next").await;
        assert!(!LOCKS.lock().await.contains_key("identity-released"));
    }
}
