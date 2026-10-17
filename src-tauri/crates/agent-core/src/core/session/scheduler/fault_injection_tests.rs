//! Offline fault-injection at the actual DialogScheduler future boundary.
 //! No provider credentials, external HTTP calls or real tools are invoked.
 //! Each test has an explicit, bounded deadline and no automatic replay.
 
use super::{DialogScheduler, ExecutionCompletion, ScheduledKind, ScheduledMessage};
use std::future::pending;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::oneshot;

const DEADLINE: Duration = Duration::from_secs(10);

fn job(
    label: &str,
    execute: super::ExecuteFn,
) -> ScheduledMessage {
    ScheduledMessage {
        kind: ScheduledKind::Maintenance,
        message_id: label.to_string(),
        generation: 0,
        client_message_id: None,
        turn_intent_id: String::new(),
        org_run_id: None,
        content: String::new(),
        execute,
    }
}

/// A provider callback that is waiting on a remote reply must not cause
/// unrelated schedulers to block. A follow-up in the *same* FIFO must wait.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn slow_provider_future_isolated_from_five_neighbor_sessions() {
    let blocked = DialogScheduler::new("slow-provider", 4);
    let (started_tx, started_rx) = oneshot::channel::<()>();
    let (release_tx, release_rx) = oneshot::channel::<()>();
    let provider_executed = Arc::new(AtomicUsize::new(0));
    let provider_count = Arc::clone(&provider_executed);
    blocked.enqueue(job("waiting-provider", Box::new(move || {
        Box::pin(async move {
            let _ = started_tx.send(());
            release_rx.await.map_err(|_| "fixture release dropped".to_string())?;
            provider_count.fetch_add(1, Ordering::SeqCst);
            Ok(ExecutionCompletion::Finished)
        })
    }))).await.expect("provider fixture enqueued");
    tokio::time::timeout(DEADLINE, started_rx)
        .await.expect("provider callback must enter").expect("start signal");

    let followup_finished = Arc::new(AtomicUsize::new(0));
    let followup_count = Arc::clone(&followup_finished);
    blocked.enqueue(job("queued-behind-provider", Box::new(move || {
        Box::pin(async move {
            followup_count.fetch_add(1, Ordering::SeqCst);
            Ok(ExecutionCompletion::Finished)
        })
    }))).await.expect("follow-up must enqueue");

    let other_finished = Arc::new(AtomicUsize::new(0));
    let mut neighbors = Vec::new();
    for n in 0..5 {
        let scheduler = DialogScheduler::new(format!("provider-neighbor-{n}"), 2);
        let finished = Arc::clone(&other_finished);
        scheduler.enqueue(job("unrelated-session", Box::new(move || {
            Box::pin(async move {
                finished.fetch_add(1, Ordering::SeqCst);
                Ok(ExecutionCompletion::Finished)
            })
        }))).await.expect("independent worker enqueues");
        neighbors.push(scheduler);
    }
    tokio::time::timeout(DEADLINE, async {
        while other_finished.load(Ordering::SeqCst) != 5 {
            tokio::task::yield_now().await;
        }
    }).await.expect("other workers must complete while provider waits");
    assert!(blocked.is_processing(), "slow future is still owned by its worker");
    assert_eq!(blocked.pending_count(), 1);
    assert_eq!(provider_executed.load(Ordering::SeqCst), 0);
    assert_eq!(followup_finished.load(Ordering::SeqCst), 0);
    release_tx.send(()).expect("blocked callback remains pending");
    tokio::time::timeout(DEADLINE, async {
        while followup_finished.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
    }).await.expect("follow-up must drain once original provider completes");
    assert_eq!(provider_executed.load(Ordering::SeqCst), 1);
    assert_eq!(followup_finished.load(Ordering::SeqCst), 1);
    assert_eq!(blocked.pending_count(), 0);
    assert_eq!(neighbors.len(), 5);
}

/// An explicit mock/provider timeout must return a bounded error. The
/// scheduler must not poison the FIFO after receiving that error.
/// Maintenance kind isolates the scheduling contract from durable session
/// state and does not claim to test production retry decisions.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn explicit_mock_provider_timeout_does_not_poison_followup_queue() {
    let scheduler = DialogScheduler::new("timeout-provider", 4);
    let timed_out = Arc::new(AtomicUsize::new(0));
    let errors = Arc::clone(&timed_out);
    scheduler.enqueue(job("mock-provider-timeout", Box::new(move || {
        Box::pin(async move {
            let outcome = tokio::time::timeout(
                Duration::from_millis(60),
                pending::<()>(),
            ).await;
            if outcome.is_err() {
                errors.fetch_add(1, Ordering::SeqCst);
                return Err("synthetic-provider-timeout".to_string());
            }
            Ok(ExecutionCompletion::Finished)
        })
    }))).await.expect("provider test enqueued");

    let continued = Arc::new(AtomicUsize::new(0));
    let finished = Arc::clone(&continued);
    scheduler.enqueue(job("after-timeout", Box::new(move || {
        Box::pin(async move {
            finished.fetch_add(1, Ordering::SeqCst);
            Ok(ExecutionCompletion::Finished)
        })
    }))).await.expect("next job accepted");

    tokio::time::timeout(DEADLINE, async {
        while continued.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
    }).await.expect("worker must keep draining after explicit simulated error");
    assert_eq!(timed_out.load(Ordering::SeqCst), 1);
    assert_eq!(continued.load(Ordering::SeqCst), 1);
    assert_eq!(scheduler.pending_count(), 0);
}

/// An indefinite tool future cannot be replayed by an observer. Aborting
/// its scheduler task drops the in-flight future, and the replacement must
/// accept only a *fresh* job. A neighboring scheduler remains independent.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn never_resolving_tool_is_dropped_on_worker_abort_without_replay() {
    struct DropCount(Arc<AtomicUsize>);
    impl Drop for DropCount {
        fn drop(&mut self) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }

    let blocked = DialogScheduler::new("hanging-tool", 4);
    let healthy = DialogScheduler::new("healthy-neighbor", 4);
    let drop_count = Arc::new(AtomicUsize::new(0));
    let (started_tx, started_rx) = oneshot::channel::<()>();
    let tool_drop = Arc::clone(&drop_count);

    blocked.enqueue(job("never-return-tool", Box::new(move || {
        Box::pin(async move {
            let _watch = DropCount(tool_drop);
            let _ = started_tx.send(());
            pending::<()>().await;
            Ok(ExecutionCompletion::Finished)
        })
    }))).await.expect("pending tool job accepted");
    tokio::time::timeout(DEADLINE, started_rx)
        .await.expect("pending tool must start")
        .expect("start notification");

    let lost_queued_executed = Arc::new(AtomicUsize::new(0));
    let lost = Arc::clone(&lost_queued_executed);
    blocked.enqueue(job("lost-queued-followup", Box::new(move || {
        Box::pin(async move {
            lost.fetch_add(1, Ordering::SeqCst);
            Ok(ExecutionCompletion::Finished)
        })
    }))).await.expect("pending followup accepted");

    let neighbor_executed = Arc::new(AtomicUsize::new(0));
    let observed = Arc::clone(&neighbor_executed);
    healthy.enqueue(job("healthy-followup", Box::new(move || {
        Box::pin(async move {
            observed.fetch_add(1, Ordering::SeqCst);
            Ok(ExecutionCompletion::Finished)
        })
    }))).await.expect("neighbor work accepted");
    tokio::time::timeout(DEADLINE, async {
        while neighbor_executed.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
    }).await.expect("neighbor must be able to finish");

    {
        let owner = blocked.inner.lock().await;
        owner.as_ref().expect("worker exists").worker.abort();
    }
    tokio::time::timeout(DEADLINE, async {
        loop {
            let finished = {
                let owner = blocked.inner.lock().await;
                owner.as_ref().expect("worker exists").worker.is_finished()
            };
            if finished && drop_count.load(Ordering::SeqCst) == 1 { break; }
            tokio::task::yield_now().await;
        }
    }).await.expect("aborted worker must drop its nonterminating tool");

    let fresh_executed = Arc::new(AtomicUsize::new(0));
    let fresh = Arc::clone(&fresh_executed);
    blocked.enqueue(job("fresh-after-abort", Box::new(move || {
        Box::pin(async move {
            fresh.fetch_add(1, Ordering::SeqCst);
            Ok(ExecutionCompletion::Finished)
        })
    }))).await.expect("fresh enqueue triggers recovery");
    tokio::time::timeout(DEADLINE, async {
        while fresh_executed.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
    }).await.expect("fresh job must complete");
    assert_eq!(drop_count.load(Ordering::SeqCst), 1);
    assert_eq!(lost_queued_executed.load(Ordering::SeqCst), 0,
        "previously queued side effects must not be replayed");
    assert_eq!(fresh_executed.load(Ordering::SeqCst), 1);
    assert_eq!(neighbor_executed.load(Ordering::SeqCst), 1);
    assert_eq!(blocked.pending_count(), 0);
}

/// Tool errors should be scoped to one callback. The worker must keep
/// draining subsequent work; error text is synthetic and content-free.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn mock_tool_error_does_not_starve_following_job() {
    let scheduler = DialogScheduler::new("tool-error", 2);
    let errors = Arc::new(AtomicUsize::new(0));
    let errors_in_job = Arc::clone(&errors);
    scheduler.enqueue(job("failing-tool", Box::new(move || {
        Box::pin(async move {
            errors_in_job.fetch_add(1, Ordering::SeqCst);
            Err("synthetic-tool-error".to_string())
        })
    }))).await.expect("failed tool fixture enqueued");

    let completed = Arc::new(AtomicUsize::new(0));
    let after = Arc::clone(&completed);
    scheduler.enqueue(job("after-failure", Box::new(move || {
        Box::pin(async move {
            after.fetch_add(1, Ordering::SeqCst);
            Ok(ExecutionCompletion::Finished)
        })
    }))).await.expect("second job accepted");
    tokio::time::timeout(DEADLINE, async {
        while completed.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
    }).await.expect("failed job must not stop queue");
    assert_eq!(errors.load(Ordering::SeqCst), 1);
    assert_eq!(completed.load(Ordering::SeqCst), 1);
}
