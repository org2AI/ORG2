//! Bounded work owned by one authenticated mobile connection.
//!
//! Safe reads may overlap ordered mutations. Initialization is a barrier, and
//! every handler still passes through the dispatcher's permission checks. A
//! scheduler retains at most 32 pending requests (in addition to the bounded
//! transport input channel) and four reads plus one mutation in flight.
//! Search uses one of those read slots and retains only
//! its latest pending query. Transport notification forwarding is independent.
use std::{collections::VecDeque, future::Future};

use serde_json::{json, Value};
use tokio::{sync::mpsc, task::JoinSet};

use super::rpc::{self, RpcContext};

pub const REQUEST_QUEUE_CAPACITY: usize = 32;
const MAX_CONCURRENT_READS: usize = 4;
const SERVER_BUSY: i32 = -32007;
const SEARCH_SUPERSEDED: i32 = -32008;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Lane {
    Read,
    Search,
    Mutation,
    Barrier,
}

fn lane(request: &Value) -> Lane {
    match request.get("method").and_then(Value::as_str) {
        Some("initialize") => Lane::Barrier,
        Some("session/list")
            if request
                .pointer("/params/query")
                .and_then(Value::as_str)
                .is_some_and(|query| !query.trim().is_empty()) =>
        {
            Lane::Search
        }
        Some(
            "session/list" | "session/resolve" | "session/round" | "session/image"
            | "session/config" | "models/list" | "session/read_state",
        ) => Lane::Read,
        // Includes subscribe/unsubscribe, read-receipt writes, interactions,
        // and unknown methods: additions must explicitly opt in to concurrency.
        _ => Lane::Mutation,
    }
}

fn error(request: &Value, code: i32, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": request.get("id").cloned().unwrap_or(Value::Null),
        "error": { "code": code, "message": message }
    })
}

pub async fn run(ctx: RpcContext, requests: mpsc::Receiver<Value>, responses: mpsc::Sender<Value>) {
    run_with_executor(ctx, requests, responses, |mut ctx, request| async move {
        let response = rpc::dispatch(&mut ctx, &request).await;
        (ctx, response)
    })
    .await;
}

/// The injectable seam exercises production scheduling without real adapters.
pub(super) async fn run_with_executor<F, Fut>(
    mut ctx: RpcContext,
    mut requests: mpsc::Receiver<Value>,
    responses: mpsc::Sender<Value>,
    execute: F,
) where
    F: Fn(RpcContext, Value) -> Fut,
    Fut: Future<Output = (RpcContext, Option<Value>)> + Send + 'static,
{
    let mut pending = VecDeque::<Value>::new();
    let mut running = JoinSet::new();
    let mut active_reads = 0;
    let mut active_search = false;
    let mut active_mutation = false;
    let mut active_barrier = false;

    loop {
        // Closed input means disconnected, including buffered input. Never
        // drain buffered mutations after their connection has disappeared.
        if requests.is_closed()
            || responses.is_closed()
            || ctx
                .lan_lease
                .as_ref()
                .is_some_and(|lease| !lease.is_current())
        {
            break;
        }
        while !active_barrier {
            let next = pending.iter().enumerate().find_map(|(index, request)| {
                let kind = if ctx.initialized {
                    lane(request)
                } else {
                    Lane::Barrier
                };
                // No request may overtake an initialization barrier.
                if kind == Lane::Barrier {
                    return Some((index, kind));
                }
                let available = match kind {
                    Lane::Read => active_reads < MAX_CONCURRENT_READS,
                    Lane::Search => !active_search && active_reads < MAX_CONCURRENT_READS,
                    Lane::Mutation => !active_mutation,
                    Lane::Barrier => unreachable!(),
                };
                available.then_some((index, kind))
            });
            let Some((index, kind)) = next else { break };
            if kind == Lane::Barrier && (index != 0 || !running.is_empty()) {
                break;
            }
            // Recheck before admitting work after the receiver's last await.
            if requests.is_closed()
                || responses.is_closed()
                || ctx
                    .lan_lease
                    .as_ref()
                    .is_some_and(|lease| !lease.is_current())
            {
                break;
            }
            let request = pending.remove(index).expect("selected pending request");
            match kind {
                Lane::Read => active_reads += 1,
                Lane::Search => {
                    active_reads += 1;
                    active_search = true;
                }
                Lane::Mutation => active_mutation = true,
                Lane::Barrier => active_barrier = true,
            }
            let future = execute(ctx.clone(), request);
            running.spawn(async move {
                let (context, response) = future.await;
                (kind, context, response)
            });
        }

        tokio::select! {
            biased;
            _ = responses.closed() => break,
            result = running.join_next(), if !running.is_empty() => {
                let Some(Ok((kind, context, response))) = result else {
                    // A panicked handler cannot leave a lane permanently busy
                    // or allow queued writes to execute with uncertain state.
                    break;
                };
                match kind {
                    Lane::Read => active_reads -= 1,
                    Lane::Search => {
                        active_reads -= 1;
                        active_search = false;
                    }
                    Lane::Mutation => active_mutation = false,
                    Lane::Barrier => {
                        ctx = context;
                        active_barrier = false;
                    }
                }
                if let Some(response) = response {
                    // A stalled socket is terminal, not an unbounded secondary
                    // queue or a task that prevents disconnect detection.
                    if responses.try_send(response).is_err() {
                        break;
                    }
                }
            }
            request = requests.recv() => {
                let Some(request) = request else { break };
                if requests.is_closed() {
                    break;
                }
                if lane(&request) == Lane::Search {
                    if let Some(index) = pending.iter().position(|old| lane(old) == Lane::Search) {
                        let old = pending.remove(index).expect("pending search");
                        if responses.try_send(error(&old, SEARCH_SUPERSEDED, "search superseded by a newer query")).is_err() {
                            break;
                        }
                    }
                }
                if pending.len() >= REQUEST_QUEUE_CAPACITY {
                    if responses.try_send(error(&request, SERVER_BUSY, "server busy; request queue is full")).is_err() {
                        break;
                    }
                } else {
                    pending.push_back(request);
                }
            }
        }
    }
    // JoinSet drop also aborts on cancellation of this owning scheduler. Abort
    // only cancels async handlers: started spawn_blocking work may still finish,
    // and already committed writes are not rolled back.
    running.abort_all();
    while running.join_next().await.is_some() {}
}

#[cfg(test)]
mod tests {
    use std::{
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        },
        time::Duration,
    };

    use tokio::{sync::oneshot, task::JoinHandle};

    use super::*;
    use crate::api::mobile_bridge::{auth::MobileRemoteSettings, rpc::MobileTier};

    fn context(initialized: bool) -> RpcContext {
        RpcContext {
            conn_id: 17,
            lan_lease: None,
            initialized,
            tier: MobileTier::Full,
            settings: MobileRemoteSettings {
                enabled: true,
                lan_token: "test".into(),
                allow_lan_exposure: false,
            },
        }
    }

    fn request(id: u64, method: &str) -> Value {
        json!({"jsonrpc":"2.0", "id":id, "method":method})
    }

    #[derive(Debug)]
    enum Finish {
        Success,
        Error,
        Panic,
    }

    struct Call {
        id: u64,
        initialized: bool,
        finish: oneshot::Sender<Finish>,
    }

    struct DropCount(Arc<AtomicUsize>);
    impl Drop for DropCount {
        fn drop(&mut self) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }

    struct Harness {
        input: mpsc::Sender<Value>,
        output: mpsc::Receiver<Value>,
        calls: mpsc::Receiver<Call>,
        dropped: Arc<AtomicUsize>,
        task: JoinHandle<()>,
    }

    impl Harness {
        fn start(initialized: bool, response_capacity: usize) -> Self {
            let (input, requests) = mpsc::channel(REQUEST_QUEUE_CAPACITY);
            let (responses, output) = mpsc::channel(response_capacity);
            let (started, calls) = mpsc::channel(REQUEST_QUEUE_CAPACITY);
            let dropped = Arc::new(AtomicUsize::new(0));
            let counter = dropped.clone();
            let task = tokio::spawn(run_with_executor(
                context(initialized),
                requests,
                responses,
                move |mut ctx, request| {
                    let started = started.clone();
                    let dropped = counter.clone();
                    async move {
                        let _guard = DropCount(dropped);
                        let id = request["id"].as_u64().unwrap();
                        let (finish, done) = oneshot::channel();
                        started
                            .send(Call {
                                id,
                                initialized: ctx.initialized,
                                finish,
                            })
                            .await
                            .unwrap();
                        let response = match done.await.expect("test releases call") {
                            Finish::Success => {
                                if request["method"] == "initialize" {
                                    ctx.initialized = true;
                                }
                                json!({"jsonrpc":"2.0", "id":id, "result":{}})
                            }
                            Finish::Error => error(&request, -32602, "test failure"),
                            Finish::Panic => panic!("injected handler panic"),
                        };
                        (ctx, Some(response))
                    }
                },
            ));
            Self {
                input,
                output,
                calls,
                dropped,
                task,
            }
        }

        async fn send(&self, id: u64, method: &str) {
            self.input.send(request(id, method)).await.unwrap();
        }

        async fn call(&mut self) -> Call {
            tokio::time::timeout(Duration::from_secs(1), self.calls.recv())
                .await
                .expect("call starts")
                .expect("scheduler alive")
        }

        async fn no_call(&mut self) {
            assert!(
                tokio::time::timeout(Duration::from_millis(10), self.calls.recv())
                    .await
                    .is_err()
            );
        }

        async fn response(&mut self) -> Value {
            tokio::time::timeout(Duration::from_secs(1), self.output.recv())
                .await
                .expect("response available")
                .expect("scheduler alive")
        }

        async fn stop(self) {
            drop(self.input);
            tokio::time::timeout(Duration::from_secs(1), self.task)
                .await
                .unwrap()
                .unwrap();
        }
    }

    #[tokio::test(start_paused = true)]
    async fn reads_are_bounded_and_mutations_run_fifo_independently() {
        let mut h = Harness::start(true, 32);
        let mut reads = Vec::new();
        for id in 1..=MAX_CONCURRENT_READS as u64 {
            h.send(id, "session/round").await;
            reads.push(h.call().await);
        }
        h.send(10, "session/list").await;
        h.send(11, "session/subscribe").await;
        h.send(12, "session/unsubscribe").await;
        let first_write = h.call().await;
        assert_eq!(first_write.id, 11);
        h.no_call().await;
        first_write.finish.send(Finish::Success).unwrap();
        assert_eq!(h.response().await["id"], 11);
        let second_write = h.call().await;
        assert_eq!(second_write.id, 12);
        second_write.finish.send(Finish::Error).unwrap();
        assert!(h.response().await.get("error").is_some());
        h.send(13, "session/send").await;
        let third_write = h.call().await;
        assert_eq!(third_write.id, 13);
        third_write.finish.send(Finish::Success).unwrap();
        h.response().await;
        reads.pop().unwrap().finish.send(Finish::Success).unwrap();
        h.response().await;
        assert_eq!(h.call().await.id, 10);
        h.stop().await;
    }

    #[tokio::test(start_paused = true)]
    async fn latest_pending_search_replaces_old_query_and_preserves_ids() {
        let mut h = Harness::start(true, 32);
        h.input
            .send(json!({"id":1,"method":"session/list","params":{"query":"first"}}))
            .await
            .unwrap();
        let first = h.call().await;
        for id in 2..=3 {
            h.input.send(json!({"id":id,"method":"session/list","params":{"query":format!("query-{id}")}})).await.unwrap();
        }
        let superseded = h.response().await;
        assert_eq!(superseded["id"], 2);
        assert!(superseded["error"]["message"]
            .as_str()
            .unwrap()
            .contains("superseded"));
        h.no_call().await;
        first.finish.send(Finish::Success).unwrap();
        assert_eq!(h.response().await["id"], 1);
        let latest = h.call().await;
        assert_eq!(latest.id, 3);
        latest.finish.send(Finish::Success).unwrap();
        assert_eq!(h.response().await["id"], 3);
        h.stop().await;
    }

    #[tokio::test(start_paused = true)]
    async fn initialize_is_a_barrier_and_failed_initialization_does_not_unlock_reads() {
        let mut h = Harness::start(false, 32);
        h.send(1, "initialize").await;
        let failed = h.call().await;
        h.send(2, "session/list").await;
        h.send(3, "initialize").await;
        h.send(4, "session/round").await;
        h.no_call().await;
        failed.finish.send(Finish::Error).unwrap();
        h.response().await;
        let rejected = h.call().await;
        assert_eq!(rejected.id, 2);
        assert!(!rejected.initialized);
        rejected.finish.send(Finish::Error).unwrap();
        h.response().await;
        let retry = h.call().await;
        assert_eq!(retry.id, 3);
        retry.finish.send(Finish::Success).unwrap();
        h.response().await;
        let read = h.call().await;
        assert_eq!(read.id, 4);
        assert!(read.initialized);
        h.stop().await;
    }

    #[tokio::test(start_paused = true)]
    async fn repeated_initialize_waits_for_active_work_and_blocks_later_reads() {
        let mut h = Harness::start(true, 32);
        h.send(1, "session/round").await;
        let read = h.call().await;
        h.send(2, "session/send").await;
        let write = h.call().await;
        h.send(3, "initialize").await;
        h.send(4, "models/list").await;
        h.no_call().await;
        read.finish.send(Finish::Success).unwrap();
        h.response().await;
        h.no_call().await;
        write.finish.send(Finish::Success).unwrap();
        h.response().await;
        let initialize = h.call().await;
        assert_eq!(initialize.id, 3);
        h.no_call().await;
        initialize.finish.send(Finish::Success).unwrap();
        h.response().await;
        let later_read = h.call().await;
        assert_eq!(later_read.id, 4);
        h.stop().await;
    }

    #[tokio::test(start_paused = true)]
    async fn real_dispatch_preserves_preinitialize_and_readonly_gates() {
        for (initialized, method, expected) in [
            (false, "session/list", -32600),
            (false, "session/send", -32600),
            (true, "session/send", -32002),
            (true, "session/cancel", -32002),
            (true, "session/patch", -32002),
            (true, "interaction/respond_permission", -32002),
        ] {
            let (input, requests) = mpsc::channel(1);
            let (responses, mut output) = mpsc::channel(1);
            let mut ctx = context(initialized);
            ctx.tier = MobileTier::ReadOnly;
            let task = tokio::spawn(run(ctx, requests, responses));
            input.send(request(1, method)).await.unwrap();
            let response = output.recv().await.unwrap();
            assert_eq!(response["error"]["code"], expected, "{method}");
            drop(input);
            task.await.unwrap();
        }
    }

    #[tokio::test(start_paused = true)]
    async fn pending_queue_is_bounded_and_overload_is_explicit() {
        let mut h = Harness::start(true, 32);
        h.send(1, "session/send").await;
        let _active = h.call().await;
        for id in 2..=(REQUEST_QUEUE_CAPACITY as u64 + 2) {
            h.send(id, "session/send").await;
        }
        let rejected = h.response().await;
        assert_eq!(rejected["id"], REQUEST_QUEUE_CAPACITY as u64 + 2);
        assert!(rejected["error"]["message"]
            .as_str()
            .unwrap()
            .contains("queue is full"));
        h.no_call().await;
        h.stop().await;
    }

    #[tokio::test(start_paused = true)]
    async fn disconnect_drops_active_handlers_and_never_starts_queued_writes() {
        let mut h = Harness::start(true, 32);
        h.send(1, "session/send").await;
        let _active = h.call().await;
        h.send(2, "session/cancel").await;
        h.no_call().await;
        // Do not yield between buffering another write and disconnecting:
        // both the internal queue and unread transport buffer must be dropped.
        h.input.try_send(request(3, "session/patch")).unwrap();
        drop(h.input);
        h.task.await.unwrap();
        assert_eq!(h.dropped.load(Ordering::SeqCst), 1);
        assert!(h.calls.recv().await.is_none());
        assert!(h.output.recv().await.is_none());
    }

    #[tokio::test(start_paused = true)]
    async fn handler_panic_cancels_peers_and_queued_work() {
        let mut h = Harness::start(true, 32);
        h.send(1, "session/list").await;
        let panics = h.call().await;
        h.send(2, "session/send").await;
        let _write = h.call().await;
        h.send(3, "session/cancel").await;
        panics.finish.send(Finish::Panic).unwrap();
        h.task.await.unwrap();
        assert_eq!(h.dropped.load(Ordering::SeqCst), 2);
        assert!(h.calls.recv().await.is_none());
    }

    #[tokio::test(start_paused = true)]
    async fn closed_response_consumer_cancels_work_and_pending_mutations() {
        let mut h = Harness::start(true, 32);
        h.send(1, "session/send").await;
        let _active = h.call().await;
        h.send(2, "session/cancel").await;
        h.no_call().await;
        drop(h.output);
        h.task.await.unwrap();
        assert!(h.calls.recv().await.is_none());
        assert_eq!(h.dropped.load(Ordering::SeqCst), 1);
        assert!(h.input.is_closed());
    }

    #[tokio::test(start_paused = true)]
    async fn aborting_scheduler_owner_drops_its_handlers() {
        let mut h = Harness::start(true, 32);
        h.send(1, "session/send").await;
        let _active = h.call().await;
        h.send(2, "session/cancel").await;
        h.no_call().await;
        h.task.abort();
        assert!(h.task.await.unwrap_err().is_cancelled());
        assert!(h.calls.recv().await.is_none());
        assert_eq!(h.dropped.load(Ordering::SeqCst), 1);
        assert!(h.input.is_closed());
    }

    #[tokio::test(start_paused = true)]
    async fn response_saturation_is_terminal_and_cleans_up() {
        let mut h = Harness::start(true, 1);
        h.send(1, "session/list").await;
        let first = h.call().await;
        h.send(2, "session/round").await;
        let second = h.call().await;
        first.finish.send(Finish::Success).unwrap();
        second.finish.send(Finish::Success).unwrap();
        h.task.await.unwrap();
        assert_eq!(h.dropped.load(Ordering::SeqCst), 2);
        assert!(h.input.is_closed());
    }

    #[test]
    fn new_methods_and_mark_visited_are_serialized_by_default() {
        for method in [
            "session/mark_visited",
            "session/subscribe",
            "session/unsubscribe",
            "future/method",
        ] {
            assert_eq!(lane(&request(1, method)), Lane::Mutation);
        }
        assert_eq!(lane(&request(1, "session/read_state")), Lane::Read);
        for query in [Value::Null, json!(42), json!("  ")] {
            assert_eq!(
                lane(&json!({"method":"session/list","params":{"query":query}})),
                Lane::Read
            );
        }
    }
}
