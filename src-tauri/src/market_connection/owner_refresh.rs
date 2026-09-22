//! A bounded, demand-only bridge to the instance's canonical Cloud auth owner.
//! Tickets wake a waiter; only owner::sync's persisted bearer verification can
//! restore authorization. No Cloud token crosses these commands or events.
use super::owner::{self, RefreshBinding};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{Emitter, Manager};
use tokio::sync::{oneshot, watch};

const EVENT: &str = "market-cloud-owner-refresh-needed";
const UNAVAILABLE: &str = "market_cloud_refresh_unavailable";
const CHANGED: &str = "market_identity_changed";
const DEADLINE: Duration = Duration::from_secs(30);

type Outcome = Result<owner::Lease, String>;
struct Waiting {
    binding: RefreshBinding,
    claimed: bool,
    complete: Option<oneshot::Sender<()>>,
}
struct Flight {
    ticket: String,
    user: String,
    deadline: tokio::time::Instant,
    start: owner::RefreshStart,
    waiting: Mutex<Option<Waiting>>,
    result: watch::Sender<Option<Outcome>>,
}
impl Flight {
    fn current(&self) -> bool {
        tokio::time::Instant::now() < self.deadline && self.result.borrow().is_none()
    }
    fn pending(&self) -> Option<String> {
        let waiting = self.waiting.lock().ok()?;
        let waiting = waiting.as_ref()?;
        (self.current() && !waiting.claimed && waiting.binding.check().is_ok())
            .then(|| self.ticket.clone())
    }
    fn claim(&self, ticket: &str) -> Option<String> {
        if ticket != self.ticket || !self.current() {
            return None;
        }
        let mut waiting = self.waiting.lock().ok()?;
        let waiting = waiting.as_mut()?;
        if waiting.claimed || waiting.binding.check().is_err() {
            return None;
        }
        waiting.claimed = true;
        Some(waiting.binding.user().into())
    }
    fn complete(&self, ticket: &str) {
        if ticket != self.ticket || !self.current() {
            return;
        }
        let Ok(mut waiting) = self.waiting.lock() else {
            return;
        };
        let Some(waiting) = waiting.as_mut() else {
            return;
        };
        if !waiting.claimed || waiting.binding.check().is_err() {
            return;
        }
        if let Some(done) = waiting.complete.take() {
            let _ = done.send(());
        }
    }
}
#[derive(Default)]
struct Registry(Mutex<Option<Arc<Flight>>>);
impl Registry {
    fn acquire(
        &self,
        user: &str,
        start: owner::RefreshStart,
    ) -> Result<(Arc<Flight>, bool), String> {
        let mut slot = self.0.lock().map_err(|_| UNAVAILABLE)?;
        if let Some(flight) = slot.as_ref() {
            // A different account cannot join or supersede another owner's work.
            if flight.user != user {
                return Err(CHANGED.into());
            }
            return Ok((Arc::clone(flight), false));
        }
        let flight = Arc::new(Flight {
            ticket: uuid::Uuid::new_v4().to_string(),
            user: user.into(),
            deadline: tokio::time::Instant::now() + DEADLINE,
            start,
            waiting: Mutex::new(None),
            result: watch::channel(None).0,
        });
        *slot = Some(Arc::clone(&flight));
        Ok((flight, true))
    }
    async fn run(&self, flight: &Arc<Flight>, work: impl std::future::Future<Output = Outcome>) {
        let result = tokio::time::timeout_at(flight.deadline, work)
            .await
            .unwrap_or_else(|_| Err(UNAVAILABLE.into()));
        self.finish(flight, result);
    }
    fn finish(&self, flight: &Arc<Flight>, result: Outcome) {
        // Clear retained tickets/oneshots even if a caller keeps its result.
        if let Ok(mut waiting) = flight.waiting.lock() {
            waiting.take();
        }
        if let Ok(mut slot) = self.0.lock() {
            if slot
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, flight))
            {
                slot.take();
            }
            flight.result.send_replace(Some(result));
        }
    }
}
fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(Default::default)
}

pub(super) fn pending() -> Option<String> {
    registry().0.lock().ok()?.as_ref()?.pending()
}
pub(super) fn claim(ticket: &str) -> Option<String> {
    registry().0.lock().ok()?.as_ref()?.claim(ticket)
}
pub(super) fn complete(ticket: &str) {
    if let Ok(slot) = registry().0.lock() {
        if let Some(flight) = slot.as_ref() {
            flight.complete(ticket);
        }
    }
}

pub(super) async fn request(user: &str) -> Outcome {
    request_started(user, owner::refresh_start()?).await
}
pub(super) async fn request_started(user: &str, start: owner::RefreshStart) -> Outcome {
    let (flight, start) = registry().acquire(user, start)?;
    let mut result = flight.result.subscribe();
    if start {
        // One bounded worker survives a single consumer disconnect, allowing
        // the remaining requests to share the same rotating refresh credential.
        tokio::spawn(async move {
            registry().run(&flight, refresh(&flight)).await;
        });
    }
    loop {
        if let Some(outcome) = result.borrow_and_update().clone() {
            return outcome;
        }
        result.changed().await.map_err(|_| UNAVAILABLE)?;
    }
}
async fn refresh(flight: &Arc<Flight>) -> Outcome {
    // Read canonical auth before requesting refresh. This also records an
    // expired cold-start subject without treating its unsigned claims as auth.
    owner::sync(None).await?;
    let binding = flight.start.binding(&flight.user)?;
    if let Ok(lease) = owner::require() {
        lease.matches(&flight.user)?;
        return Ok(lease);
    }
    binding
        .while_current(async {
            ask_frontend(flight, binding.clone(), |ticket| {
                let app = crate::api::get_app_handle().ok_or(UNAVAILABLE)?;
                // Hidden windows are valid. A destroyed window cannot refresh.
                if app.get_webview_window("main").is_none() {
                    return Err(UNAVAILABLE.into());
                }
                app.emit_to("main", EVENT, ticket)
                    .map_err(|_| UNAVAILABLE.into())
            })
            .await?;
            binding.check()?;
            // An ack can be forged by the same webview: it never grants a lease.
            // Reuse canonical persistence + fixed /user verification, cached only
            // when that exact bearer was already verified by foreground auth sync.
            owner::sync(None).await?;
            binding.check()?;
            let lease = owner::require()?;
            lease.matches(&flight.user)?;
            Ok(lease)
        })
        .await
}

async fn ask_frontend(
    flight: &Flight,
    binding: RefreshBinding,
    emit: impl FnOnce(&str) -> Result<(), String>,
) -> Result<(), String> {
    let (complete, completed) = oneshot::channel();
    *flight.waiting.lock().map_err(|_| UNAVAILABLE)? = Some(Waiting {
        binding,
        claimed: false,
        complete: Some(complete),
    });
    emit(&flight.ticket)?;
    completed.await.map_err(|_| UNAVAILABLE.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    const USER: &str = "11111111-1111-4111-8111-111111111111";

    fn waiting(flight: &Flight, binding: RefreshBinding) -> oneshot::Receiver<()> {
        let (complete, completed) = oneshot::channel();
        *flight.waiting.lock().unwrap() = Some(Waiting {
            binding,
            claimed: false,
            complete: Some(complete),
        });
        completed
    }
    #[tokio::test]
    async fn concurrent_requests_share_one_bounded_ticket_and_release_it_after_failure() {
        let registry = Registry::default();
        let (start, _, _) = owner::test_refresh_context(USER);
        let (first, launched) = registry.acquire(USER, start.clone()).unwrap();
        assert!(launched);
        for _ in 0..100 {
            let (joined, launched) = registry.acquire(USER, start.clone()).unwrap();
            assert!(!launched);
            assert!(Arc::ptr_eq(&joined, &first));
        }
        assert!(registry.acquire("other-user", start.clone()).is_err());
        registry.finish(&first, Err(UNAVAILABLE.into()));
        assert!(registry.0.lock().unwrap().is_none());
        assert!(first.waiting.lock().unwrap().is_none());
        assert!(first.result.borrow().as_ref().unwrap().is_err());
        let (second, launched) = registry.acquire(USER, start).unwrap();
        assert!(launched);
        assert_ne!(second.ticket, first.ticket);
        // A late completion must not erase the next request's registry slot.
        registry.finish(&first, Err(CHANGED.into()));
        assert!(Arc::ptr_eq(
            registry.0.lock().unwrap().as_ref().unwrap(),
            &second
        ));
    }
    #[tokio::test]
    async fn ticket_must_be_current_claimed_once_and_ack_never_sets_a_result() {
        let registry = Registry::default();
        let (start, binding, _) = owner::test_refresh_context(USER);
        let (flight, _) = registry.acquire(USER, start).unwrap();
        let mut done = waiting(&flight, binding);
        assert_eq!(flight.pending(), Some(flight.ticket.clone()));
        assert!(flight.claim("spoofed-ticket").is_none());
        flight.complete(&flight.ticket); // Unclaimed acknowledgements do nothing.
        assert!(done.try_recv().is_err());
        assert_eq!(flight.claim(&flight.ticket).as_deref(), Some(USER));
        assert!(flight.claim(&flight.ticket).is_none());
        assert!(flight.pending().is_none());
        flight.complete("spoofed-ticket");
        assert!(done.try_recv().is_err());
        flight.complete(&flight.ticket);
        assert!(done.await.is_ok());
        assert!(flight.result.borrow().is_none()); // Still no authorization.
        registry.finish(&flight, Err("verification rejected".into()));
        assert!(flight.result.borrow().as_ref().unwrap().is_err());
    }
    #[tokio::test]
    async fn invalidation_and_deadline_reject_late_ticket_claims_or_completion() {
        let registry = Registry::default();
        let (start, binding, invalidate) = owner::test_refresh_context(USER);
        let (flight, _) = registry.acquire(USER, start).unwrap();
        let mut done = waiting(&flight, binding);
        assert!(flight.claim(&flight.ticket).is_some());
        invalidate();
        assert!(flight.pending().is_none());
        flight.complete(&flight.ticket);
        assert!(done.try_recv().is_err());
        registry.finish(&flight, Err(CHANGED.into()));
        assert!(done.await.is_err());
        assert!(flight.claim(&flight.ticket).is_none());

        let (start, binding, _) = owner::test_refresh_context(USER);
        let (mut expired, _) = registry.acquire(USER, start).unwrap();
        registry.0.lock().unwrap().take();
        Arc::get_mut(&mut expired).unwrap().deadline = tokio::time::Instant::now();
        let _done = waiting(&expired, binding);
        assert!(expired.pending().is_none());
        assert!(expired.claim(&expired.ticket).is_none());
    }
    #[tokio::test]
    async fn unavailable_frontend_timeout_releases_registry_ticket_and_waiters() {
        let registry = Registry::default();
        let (start, binding, _) = owner::test_refresh_context(USER);
        let (mut flight, _) = registry.acquire(USER, start).unwrap();
        registry.0.lock().unwrap().take();
        Arc::get_mut(&mut flight).unwrap().deadline =
            tokio::time::Instant::now() + Duration::from_millis(5);
        *registry.0.lock().unwrap() = Some(Arc::clone(&flight));
        let done = waiting(&flight, binding);
        let mut result = flight.result.subscribe();
        // This exact production wrapper owns timeout and registry cleanup.
        registry
            .run(&flight, std::future::pending::<Outcome>())
            .await;
        result.changed().await.unwrap();
        assert_eq!(
            result
                .borrow()
                .as_ref()
                .unwrap()
                .as_ref()
                .err()
                .map(String::as_str),
            Some(UNAVAILABLE)
        );
        assert!(registry.0.lock().unwrap().is_none());
        assert!(flight.waiting.lock().unwrap().is_none());
        assert!(done.await.is_err());
        assert!(flight.claim(&flight.ticket).is_none());
    }
    #[tokio::test]
    async fn delivered_lease_does_not_rebind_to_a_later_login() {
        let registry = Registry::default();
        let (start, _, _) = owner::test_refresh_context(USER);
        let (flight, _) = registry.acquire(USER, start).unwrap();
        let (lease, invalidate) = owner::test_lease(USER);
        registry.finish(&flight, Ok(lease));
        let delivered = flight
            .result
            .borrow()
            .as_ref()
            .unwrap()
            .as_ref()
            .unwrap()
            .clone();
        invalidate();
        assert!(delivered.check().is_err());
        assert!(registry.0.lock().unwrap().is_none());
    }

    #[tokio::test]
    async fn missing_frontend_dispatch_fails_immediately_and_cold_listener_can_claim_pending() {
        let registry = Registry::default();
        let (start, binding, _) = owner::test_refresh_context(USER);
        let (flight, _) = registry.acquire(USER, start).unwrap();
        registry
            .run(&flight, async {
                ask_frontend(&flight, binding, |_| Err(UNAVAILABLE.into())).await?;
                panic!("missing webview cannot reach owner verification");
            })
            .await;
        assert!(registry.0.lock().unwrap().is_none());
        assert!(flight.waiting.lock().unwrap().is_none());
        assert_eq!(
            flight
                .result
                .borrow()
                .as_ref()
                .unwrap()
                .as_ref()
                .err()
                .map(String::as_str),
            Some(UNAVAILABLE)
        );

        let (start, binding, _) = owner::test_refresh_context(USER);
        let (flight, _) = registry.acquire(USER, start).unwrap();
        // Emitting before the listener exists is not delivery. The main-view
        // onReady path reads this same pending state exactly once to recover it.
        ask_frontend(&flight, binding, |ticket| {
            assert_eq!(flight.pending().as_deref(), Some(ticket));
            assert_eq!(flight.claim(ticket).as_deref(), Some(USER));
            flight.complete(ticket);
            Ok(())
        })
        .await
        .unwrap();
        assert!(flight.result.borrow().is_none()); // Ack still grants no lease.
        registry.finish(&flight, Err(UNAVAILABLE.into()));
    }
}
