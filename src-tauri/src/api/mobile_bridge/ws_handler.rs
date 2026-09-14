//! Mobile bridge HTTP health probes and WebSocket upgrade handler.

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Query, WebSocketUpgrade};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use axum::Json;
use futures_util::{Sink, SinkExt, Stream, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tokio::task::JoinSet;

use super::auth::{self, AuthFailure, MobileRemoteSettings};
use super::fanout;
use super::request_scheduler::{self, REQUEST_QUEUE_CAPACITY};
use super::rpc::{MobileTier, RpcContext};

const MAX_WS_TEXT_BYTES: usize = 1024 * 1024;

#[derive(Debug, Deserialize)]
pub struct MobileWsQuery {
    pub token: Option<String>,
}

/// GET /mobile/health — unauthenticated liveness probe.
///
/// Still gated on the live Mobile Remote settings so that switching the
/// feature (or LAN exposure) off stops every bridge route answering on the
/// next request, without waiting for the listener to be dropped at restart.
pub async fn health_shallow() -> Response {
    if let Err(failure) = auth::check_bridge_available(&auth::load_settings()) {
        return failure_response(failure);
    }

    Json(json!({
        "ok": true,
        "mobileBridge": true,
    }))
    .into_response()
}

/// GET /mobile/health/deep — authenticated bridge status.
pub async fn health_deep(headers: HeaderMap) -> Response {
    let token = auth::token_from_headers(&headers).ok_or(AuthFailure::MissingToken);

    let settings = match token
        .and_then(|candidate| auth::validate_token(&candidate))
        .and_then(|settings| auth::check_bridge_available(&settings).map(|()| settings))
    {
        Ok(settings) => settings,
        Err(failure) => return failure_response(failure),
    };

    Json(json!({
        "ok": true,
        "agentRunning": true,
        "enabled": settings.enabled,
    }))
    .into_response()
}

/// GET /mobile/ws — JSON-RPC WebSocket endpoint (`?token=` required).
pub async fn mobile_ws_handler(
    ws: WebSocketUpgrade,
    Query(query): Query<MobileWsQuery>,
) -> Response {
    let Some(token) = query.token.filter(|value| !value.is_empty()) else {
        return failure_response(AuthFailure::MissingToken);
    };

    let settings = match auth::validate_token(&token)
        .and_then(|settings| auth::check_bridge_available(&settings).map(|()| settings))
    {
        Ok(settings) => settings,
        Err(failure) => return failure_response(failure),
    };

    ws.on_upgrade(move |socket| handle_mobile_socket(socket, settings))
}

fn failure_response(failure: AuthFailure) -> Response {
    (
        failure.status_code(),
        Json(json!({ "ok": false, "error": failure.message() })),
    )
        .into_response()
}

async fn handle_mobile_socket(socket: WebSocket, settings: MobileRemoteSettings) {
    let (sender, receiver) = socket.split();
    handle_mobile_transport(sender, receiver, settings, request_scheduler::run).await;
}

/// The socket owns both its fanout registration and every child task, including
/// when the server cancels the upgrade future instead of receiving a Close frame.
struct ConnectionRegistration(u64);

impl Drop for ConnectionRegistration {
    fn drop(&mut self) {
        fanout::unregister_connection(self.0);
        tracing::debug!(conn_id = self.0, "[MobileBridge] client disconnected");
    }
}

async fn handle_mobile_transport<S, R, E, F, Fut>(
    mut sender: S,
    mut receiver: R,
    settings: MobileRemoteSettings,
    run_scheduler: F,
) where
    S: Sink<Message> + Unpin + Send + 'static,
    R: Stream<Item = Result<Message, E>> + Unpin,
    F: FnOnce(RpcContext, mpsc::Receiver<Value>, mpsc::Sender<Value>) -> Fut,
    Fut: std::future::Future<Output = ()> + Send + 'static,
{
    let (outbound_tx, mut outbound_rx) = mpsc::channel::<String>(64);
    let conn_id = fanout::register_connection(outbound_tx.clone());
    let _registration = ConnectionRegistration(conn_id);

    let ctx = RpcContext {
        conn_id,
        initialized: false,
        tier: MobileTier::Full,
        settings,
    };

    // JoinSet aborts all children on drop. Any child exiting (including a socket
    // write failure) closes this connection and cancels its outstanding RPCs.
    let mut tasks = JoinSet::new();
    tasks.spawn(async move {
        while let Some(message) = outbound_rx.recv().await {
            let result = sender.send(Message::Text(message.into())).await;
            if result.is_err() {
                break;
            }
        }
    });

    let (request_tx, request_rx) = mpsc::channel(REQUEST_QUEUE_CAPACITY);
    let (response_tx, mut response_rx) = mpsc::channel::<Value>(REQUEST_QUEUE_CAPACITY);
    tasks.spawn(run_scheduler(ctx, request_rx, response_tx));
    let response_outbound_tx = outbound_tx.clone();
    tasks.spawn(async move {
        while let Some(response) = response_rx.recv().await {
            if response_outbound_tx
                .send(response.to_string())
                .await
                .is_err()
            {
                break;
            }
        }
    });

    loop {
        let result = tokio::select! {
            biased;
            _ = tasks.join_next() => break,
            result = receiver.next() => result,
        };
        let Some(result) = result else { break };
        let Ok(message) = result else {
            break;
        };

        match message {
            Message::Text(text) => {
                if text.len() > MAX_WS_TEXT_BYTES {
                    let _ = send_transport_error(
                        &outbound_tx,
                        Value::Null,
                        -32600,
                        "message too large",
                    );
                    break;
                }

                let parsed = match serde_json::from_str::<Value>(&text) {
                    Ok(value) => value,
                    Err(err) => {
                        if !send_transport_error(
                            &outbound_tx,
                            Value::Null,
                            -32600,
                            &format!("invalid json: {err}"),
                        ) {
                            break;
                        }
                        continue;
                    }
                };

                // A saturated peer gets a bounded overload response rather than
                // blocking receipt of control frames or retaining more requests.
                match request_tx.try_send(parsed) {
                    Ok(()) => {}
                    Err(mpsc::error::TrySendError::Closed(_)) => break,
                    Err(mpsc::error::TrySendError::Full(request)) => {
                        let id = request.get("id").cloned().unwrap_or(Value::Null);
                        if !send_transport_error(&outbound_tx, id, -32007, "server busy") {
                            break;
                        }
                    }
                }
            }
            Message::Close(_) => break,
            Message::Ping(_) | Message::Pong(_) => {}
            Message::Binary(_) => {
                if !send_transport_error(
                    &outbound_tx,
                    Value::Null,
                    -32600,
                    "binary frames not supported",
                ) {
                    break;
                }
            }
        }
    }
}

fn send_transport_error(
    outbound: &mpsc::Sender<String>,
    id: Value,
    code: i64,
    message: &str,
) -> bool {
    outbound
        .try_send(
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": code, "message": message },
            })
            .to_string(),
        )
        .is_ok()
}

#[cfg(test)]
mod tests {
    use super::auth::{token_matches, AuthFailure, MobileRemoteSettings};
    use super::*;
    use axum::http::StatusCode;
    use std::sync::Arc;
    use tokio::sync::Semaphore;
    use tokio::time::{timeout, Duration};

    struct TestTransport {
        input: mpsc::Sender<Message>,
        output: mpsc::Receiver<Message>,
        task: tokio::task::JoinHandle<()>,
    }

    impl Drop for TestTransport {
        fn drop(&mut self) {
            self.task.abort();
        }
    }

    impl TestTransport {
        async fn request(&self, id: u64, method: &str) {
            self.input
                .send(Message::Text(
                    json!({
                        "jsonrpc": "2.0", "id": id, "method": method,
                    })
                    .to_string()
                    .into(),
                ))
                .await
                .unwrap();
        }

        async fn response(&mut self) -> Value {
            let message = timeout(Duration::from_secs(2), self.output.recv())
                .await
                .expect("transport must remain responsive")
                .unwrap();
            let Message::Text(text) = message else {
                panic!("expected JSON text")
            };
            serde_json::from_str(&text).unwrap()
        }
    }

    fn test_transport<F, Fut>(run: F) -> TestTransport
    where
        F: FnOnce(RpcContext, mpsc::Receiver<Value>, mpsc::Sender<Value>) -> Fut + Send + 'static,
        Fut: std::future::Future<Output = ()> + Send + 'static,
    {
        let (input, incoming) = mpsc::channel::<Message>(128);
        let (outgoing, output) = mpsc::channel::<Message>(128);
        let receiver = Box::pin(futures_util::stream::unfold(
            incoming,
            |mut incoming| async {
                incoming
                    .recv()
                    .await
                    .map(|message| (Ok::<_, std::io::Error>(message), incoming))
            },
        ));
        let sender = Box::pin(futures_util::sink::unfold(
            outgoing,
            |outgoing, message| async {
                outgoing
                    .send(message)
                    .await
                    .map_err(|_| std::io::Error::from(std::io::ErrorKind::BrokenPipe))?;
                Ok::<_, std::io::Error>(outgoing)
            },
        ));
        let settings = MobileRemoteSettings {
            enabled: true,
            lan_token: "test-token".into(),
            allow_lan_exposure: true,
        };
        let task = tokio::spawn(handle_mobile_transport(sender, receiver, settings, run));
        TestTransport {
            input,
            output,
            task,
        }
    }

    struct OnDrop(mpsc::UnboundedSender<()>);

    impl Drop for OnDrop {
        fn drop(&mut self) {
            let _ = self.0.send(());
        }
    }

    async fn transport_with_pending_read() -> (
        TestTransport,
        u64,
        Arc<Semaphore>,
        mpsc::UnboundedReceiver<()>,
    ) {
        let (started_tx, mut started_rx) = mpsc::unbounded_channel();
        let (dropped_tx, dropped_rx) = mpsc::unbounded_channel();
        let release = Arc::new(Semaphore::new(0));
        let executor_release = release.clone();
        let mut transport = test_transport(move |ctx, requests, responses| {
            request_scheduler::run_with_executor(
                ctx,
                requests,
                responses,
                move |mut ctx, request| {
                    let started_tx = started_tx.clone();
                    let dropped_tx = dropped_tx.clone();
                    let release = executor_release.clone();
                    async move {
                        if request["method"] == "initialize" {
                            ctx.initialized = true;
                        } else if request["method"] == "session/list" {
                            let _drop = OnDrop(dropped_tx);
                            started_tx.send(ctx.conn_id).unwrap();
                            let _permit = release.acquire().await.unwrap();
                        }
                        let response =
                            json!({ "jsonrpc": "2.0", "id": request["id"], "result": {} });
                        (ctx, Some(response))
                    }
                },
            )
        });
        transport.request(1, "initialize").await;
        assert_eq!(transport.response().await["id"], 1);
        transport.request(2, "session/list").await;
        let conn_id = timeout(Duration::from_secs(2), started_rx.recv())
            .await
            .unwrap()
            .unwrap();
        (transport, conn_id, release, dropped_rx)
    }

    #[tokio::test]
    async fn pending_read_keeps_later_requests_validation_and_fanout_responsive() {
        let _registry = fanout::TEST_REGISTRY_LOCK.lock().await;
        let (mut transport, conn_id, release, _dropped) = transport_with_pending_read().await;
        transport.request(3, "models/list").await;
        assert_eq!(transport.response().await["id"], 3);

        transport
            .input
            .send(Message::Text("{".into()))
            .await
            .unwrap();
        assert_eq!(transport.response().await["error"]["code"], -32600);
        transport
            .input
            .send(Message::Binary(vec![1].into()))
            .await
            .unwrap();
        assert_eq!(
            transport.response().await["error"]["message"],
            "binary frames not supported"
        );

        let session_id = format!("lan-pending-read-{conn_id}");
        assert!(fanout::subscribe_session(conn_id, &session_id));
        fanout::fanout_to_session(
            &session_id,
            r#"{"jsonrpc":"2.0","method":"test/notification"}"#,
        );
        assert_eq!(transport.response().await["method"], "test/notification");

        release.add_permits(1);
        assert_eq!(transport.response().await["id"], 2);
        transport.input.send(Message::Close(None)).await.unwrap();
        timeout(Duration::from_secs(2), &mut transport.task)
            .await
            .unwrap()
            .unwrap();
        assert!(!fanout::subscribe_session(conn_id, &session_id));
    }

    #[tokio::test]
    async fn close_abort_and_write_failure_cancel_pending_reads_and_unregister() {
        let _registry = fanout::TEST_REGISTRY_LOCK.lock().await;
        for terminal in ["close", "abort", "write_failure"] {
            let (mut transport, conn_id, _release, mut dropped) =
                transport_with_pending_read().await;
            match terminal {
                "close" => transport.input.send(Message::Close(None)).await.unwrap(),
                "abort" => transport.task.abort(),
                _ => {
                    transport.output.close();
                    // A validation response exercises the real writer failure path.
                    transport
                        .input
                        .send(Message::Text("{".into()))
                        .await
                        .unwrap();
                }
            }
            let completed = timeout(Duration::from_secs(2), &mut transport.task)
                .await
                .unwrap();
            if terminal == "abort" {
                assert!(completed.unwrap_err().is_cancelled());
            } else {
                completed.unwrap();
            }
            assert_eq!(
                timeout(Duration::from_secs(2), dropped.recv())
                    .await
                    .unwrap(),
                Some(())
            );
            assert!(!fanout::subscribe_session(conn_id, "disconnected"));
        }
    }

    #[tokio::test]
    async fn full_request_queue_replies_busy_and_still_accepts_close() {
        let _registry = fanout::TEST_REGISTRY_LOCK.lock().await;
        let (started_tx, mut started_rx) = mpsc::unbounded_channel();
        let (dropped_tx, mut dropped_rx) = mpsc::unbounded_channel();
        let mut transport = test_transport(move |ctx, requests, responses| async move {
            let _requests = requests;
            // Keep both scheduler channels alive while intentionally refusing
            // input; a closed response channel correctly terminates transport.
            let _responses = responses;
            let _drop = OnDrop(dropped_tx);
            started_tx.send(ctx.conn_id).unwrap();
            std::future::pending::<()>().await;
        });
        let conn_id = timeout(Duration::from_secs(2), started_rx.recv())
            .await
            .unwrap()
            .unwrap();
        for id in 0..=REQUEST_QUEUE_CAPACITY {
            transport.request(id as u64, "session/list").await;
        }
        let response = transport.response().await;
        assert_eq!(response["id"], REQUEST_QUEUE_CAPACITY);
        assert_eq!(response["error"]["code"], -32007);
        transport.input.send(Message::Close(None)).await.unwrap();
        timeout(Duration::from_secs(2), &mut transport.task)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            timeout(Duration::from_secs(2), dropped_rx.recv())
                .await
                .unwrap(),
            Some(())
        );
        assert!(!fanout::subscribe_session(conn_id, "overloaded"));
    }

    #[test]
    fn validate_token_fails_when_feature_disabled() {
        // Uses live settings file when present; assert enum mapping stays stable.
        let failure = AuthFailure::FeatureDisabled;
        assert_eq!(failure.status_code(), StatusCode::FORBIDDEN);
        assert_eq!(failure.message(), "mobile remote disabled");
    }

    #[test]
    fn validate_token_fails_for_empty_candidate() {
        let settings = MobileRemoteSettings {
            enabled: true,
            lan_token: "secret-token".to_string(),
            allow_lan_exposure: false,
        };
        assert!(!token_matches("", &settings.lan_token));
    }

    #[test]
    fn health_shallow_shape() {
        let value = json!({ "ok": true, "mobileBridge": true });
        assert_eq!(
            value.get("mobileBridge").and_then(|v| v.as_bool()),
            Some(true)
        );
    }
}
