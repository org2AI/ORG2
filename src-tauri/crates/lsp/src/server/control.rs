//! Shared stop signal and cancellation-safe registration ownership.
use std::sync::Arc;
use tokio::sync::watch;

pub(super) struct Stop(watch::Sender<bool>);
impl Stop {
    pub fn new() -> Arc<Self> {
        Arc::new(Self(watch::channel(false).0))
    }
    pub fn close(&self) {
        self.0.send_replace(true);
    }
    pub fn is_closed(&self) -> bool {
        *self.0.borrow()
    }
    pub async fn cancelled(&self) {
        let mut receiver = self.0.subscribe();
        while !*receiver.borrow_and_update() {
            if receiver.changed().await.is_err() {
                break;
            }
        }
    }
}
/// Dropping a partially written frame makes the transport unusable.
pub(super) struct WriteGuard(pub Arc<Stop>, pub bool);
impl Drop for WriteGuard {
    fn drop(&mut self) {
        if !self.1 {
            self.0.close();
        }
    }
}
