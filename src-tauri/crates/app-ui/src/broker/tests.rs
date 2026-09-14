use super::*;
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};
fn request(broker: &Broker, id: &str) -> Request {
    Request {
        protocol_version: VERSION,
        request_id: id.into(),
        command: "ui.file.open".into(),
        target: Target {
            instance_id: broker.instance_id.clone(),
            window_id: "main".into(),
            workspace: Workspace::Global {},
        },
        params: json!({"path":"/tmp/example"}),
        reveal: false,
        timeout_ms: 100,
    }
}
fn applied(request: &Request) -> Response {
    Response {
        protocol_version: VERSION,
        request_id: request.request_id.clone(),
        target: request.target.clone(),
        status: Status::Applied,
        result: Some(json!({"tabId":"file:test"})),
        error: None,
    }
}
#[tokio::test]
async fn duplicate_requests_replay_one_execution_and_reject_changed_payload() {
    let broker = Arc::new(Broker::new());
    let weak = Arc::downgrade(&broker);
    let count = Arc::new(AtomicUsize::new(0));
    let counter = count.clone();
    broker.register(Arc::new(move |event| {
        counter.fetch_add(1, Ordering::SeqCst);
        weak.upgrade()
            .unwrap()
            .resolve(&event.generation, applied(&event.request));
        Ok(())
    }));
    let req = request(&broker, "one");
    assert_eq!(
        broker.execute("cli", req.clone()).await.status,
        Status::Applied
    );
    assert_eq!(
        broker.execute("cli", req.clone()).await.status,
        Status::Applied
    );
    assert_eq!(count.load(Ordering::SeqCst), 1);
    let mut changed = req.clone();
    changed.reveal = true;
    assert_eq!(
        broker.execute("cli", changed).await.error.unwrap().code,
        "INVALID_PARAMS"
    );
    assert!(broker.receipt("other", "one").is_none());
    assert_eq!(broker.execute("other", req).await.status, Status::Failed);
}
#[tokio::test]
async fn aborted_caller_cleans_pending_and_rejects_late_results() {
    let broker = Arc::new(Broker::new());
    let generation = broker.register(Arc::new(|_| Ok(())));
    let req = request(&broker, "cancelled");
    let task_broker = broker.clone();
    let task_request = req.clone();
    let task = tokio::spawn(async move { task_broker.execute("cli", task_request).await });
    tokio::task::yield_now().await;
    assert!(broker.active(&generation, &req));
    task.abort();
    let _ = task.await;
    assert!(!broker.active(&generation, &req));
    assert_eq!(
        broker.receipt("cli", "cancelled").unwrap().status,
        Status::Unknown
    );
    assert!(!broker.resolve(&generation, applied(&req)));
}
#[tokio::test]
async fn reload_invalidates_pending_and_wrong_target_never_dispatches() {
    let broker = Arc::new(Broker::new());
    let old = broker.register(Arc::new(|_| Ok(())));
    let req = request(&broker, "reload");
    let b = broker.clone();
    let r = req.clone();
    let task = tokio::spawn(async move { b.execute("cli", r).await });
    tokio::task::yield_now().await;
    let new = broker.register(Arc::new(|_| Ok(())));
    assert_eq!(task.await.unwrap().status, Status::Unknown);
    assert_ne!(old, new);
    assert!(!broker.resolve(&old, applied(&req)));
    broker.unregister(&old);
    assert!(broker.ready());
    let mut wrong = request(&broker, "wrong");
    wrong.target.instance_id = "another".into();
    assert_eq!(
        broker.execute("cli", wrong).await.error.unwrap().code,
        "TARGET_NOT_FOUND"
    );
    broker.unregister(&new);
    assert!(!broker.ready());
}
#[tokio::test]
async fn deadlines_leave_a_queryable_unknown_receipt() {
    let broker = Broker::new();
    let generation = broker.register(Arc::new(|_| Ok(())));
    let mut req = request(&broker, "timeout");
    req.timeout_ms = 1;
    assert_eq!(
        broker.execute("cli", req.clone()).await.status,
        Status::Unknown
    );
    assert!(!broker.active(&generation, &req));
    assert_eq!(
        broker.receipt("cli", "timeout").unwrap().status,
        Status::Unknown
    );
}
#[test]
fn receipt_cache_and_ttl_are_bounded() {
    let broker = Broker::new();
    let mut state = broker.state.lock().unwrap();
    for n in 0..300 {
        let req = request(&broker, &n.to_string());
        let (tx, _) = watch::channel(Some(applied(&req)));
        state.entries.insert(
            ("cli".into(), req.request_id.clone()),
            Entry {
                request: req,
                generation: "g".into(),
                result: tx,
                finished: Some(Instant::now()),
            },
        );
    }
    Broker::prune(&mut state);
    assert_eq!(state.entries.len(), MAX_RECEIPTS);
    for entry in state.entries.values_mut() {
        entry.finished = Some(Instant::now() - Duration::from_secs(61));
    }
    Broker::prune(&mut state);
    assert!(state.entries.is_empty());
}
#[test]
fn protocol_rejects_unknown_fields_and_retains_workspace_discriminant() {
    let broker = Broker::new();
    let req = request(&broker, "wire");
    let mut value = serde_json::to_value(req).unwrap();
    assert_eq!(value["target"]["workspace"], json!({"kind":"global"}));
    value["invokingSessionId"] = json!("forged");
    assert!(serde_json::from_value::<Request>(value).is_err());
}

#[test]
fn shared_typescript_rust_fixture_roundtrips_without_wire_drift() {
    let value: serde_json::Value =
        serde_json::from_str(include_str!("../../protocol.fixture.json")).unwrap();
    let request: Request = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(request).unwrap(), value);
}

#[tokio::test]
async fn rejects_oversized_native_requests_and_invalid_session_before_dispatch() {
    let broker = Broker::new();
    broker.register(Arc::new(|_| panic!("invalid requests must not dispatch")));
    let mut req = request(&broker, "oversized");
    req.params = json!({"path": "x".repeat(MAX_BODY)});
    assert_eq!(
        broker.execute("native", req).await.error.unwrap().code,
        "INVALID_PARAMS"
    );
    let mut req = request(&broker, "empty-session");
    req.target.workspace = Workspace::Session {
        session_id: String::new(),
    };
    assert_eq!(
        broker.execute("native", req).await.error.unwrap().code,
        "INVALID_PARAMS"
    );
}

#[tokio::test]
async fn concurrent_duplicates_share_dispatch_and_pending_capacity_is_bounded() {
    let broker = Arc::new(Broker::new());
    let count = Arc::new(AtomicUsize::new(0));
    let counter = count.clone();
    let generation = broker.register(Arc::new(move |_| {
        counter.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }));
    let mut tasks = Vec::new();
    for n in 0..MAX_PENDING {
        let b = broker.clone();
        let mut req = request(&b, &n.to_string());
        req.timeout_ms = 30_000;
        tasks.push(tokio::spawn(async move { b.execute("cli", req).await }));
    }
    tokio::task::yield_now().await;
    assert_eq!(count.load(Ordering::SeqCst), MAX_PENDING);
    assert_eq!(
        broker
            .execute("cli", request(&broker, "overflow"))
            .await
            .error
            .unwrap()
            .code,
        "BUSY"
    );
    let mut req = request(&broker, "0");
    req.timeout_ms = 30_000;
    let b = broker.clone();
    let duplicate = req.clone();
    let repeat = tokio::spawn(async move { b.execute("cli", duplicate).await });
    tokio::task::yield_now().await;
    assert_eq!(count.load(Ordering::SeqCst), MAX_PENDING);
    let mut forged = req.clone();
    forged.params = json!({"path":"other"});
    assert!(!broker.active(&generation, &forged));
    assert!(broker.resolve(&generation, applied(&req)));
    assert_eq!(repeat.await.unwrap().status, Status::Applied);
    broker.disconnect();
    for task in tasks {
        let _ = task.await.unwrap();
    }
    assert!(!broker.ready());
}
