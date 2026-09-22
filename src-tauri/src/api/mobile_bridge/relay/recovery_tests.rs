use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

fn status() -> Arc<RwLock<RelayStatus>> {
    Arc::new(RwLock::new(RelayStatus::default()))
}

fn plan(port: u16) -> RelayConnectionPlan {
    RelayConnectionPlan {
        ws_url: format!("ws://127.0.0.1:{port}"),
        desktop_id: "recovery-test".into(),
        access_token: "test-only".into(),
    }
}

async fn wait_phase(status: &Arc<RwLock<RelayStatus>>, phase: RelayPhase) {
    tokio::time::timeout(Duration::from_secs(3), async {
        while status.read().unwrap().phase != phase {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("relay phase transition");
}

async fn short_connection(
    plan: RelayConnectionPlan,
    status: Arc<RwLock<RelayStatus>>,
) -> Result<(), RelayError> {
    // A separate watchdog ensures removing production deadlines fails the test.
    tokio::time::timeout(
        Duration::from_secs(2),
        run_connection_with_timeouts(
            plan,
            status,
            Arc::new(AtomicI64::new(0)),
            Duration::from_millis(100),
            Duration::from_millis(100),
            Duration::from_millis(200),
        ),
    )
    .await
    .expect("connection must end using its own deadline")
}

#[tokio::test]
async fn unauthorized_handshake_is_a_refreshable_failure() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let plan = plan(listener.local_addr().unwrap().port());
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut bytes = [0; 4096];
        let received = stream.read(&mut bytes).await.unwrap();
        assert!(
            received > 0,
            "client must send handshake bytes before rejection"
        );
        stream
            .write_all(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n")
            .await
            .unwrap();
    });
    let error = short_connection(plan, status()).await.unwrap_err();
    assert!(matches!(error, RelayError::Unauthorized));
    assert!(error.needs_auth_refresh());
    server.await.unwrap();
}

#[tokio::test]
async fn silent_handshake_times_out() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let plan = plan(listener.local_addr().unwrap().port());
    let server = tokio::spawn(async move {
        let (_stream, _) = listener.accept().await.unwrap();
        std::future::pending::<()>().await;
    });
    assert_eq!(
        short_connection(plan, status())
            .await
            .unwrap_err()
            .to_string(),
        "relay handshake timed out"
    );
    server.abort();
}

#[tokio::test]
async fn unrelated_frames_do_not_extend_registration_deadline() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let plan = plan(listener.local_addr().unwrap().port());
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
        loop {
            if ws.send(Message::Text("{}".into())).await.is_err() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    });
    assert_eq!(
        short_connection(plan, status())
            .await
            .unwrap_err()
            .to_string(),
        "relay registration timed out"
    );
    server.abort();
}

#[tokio::test]
async fn registered_but_unresponsive_socket_times_out() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let plan = plan(listener.local_addr().unwrap().port());
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
        ws.send(Message::Text(
            serde_json::to_string(&RelayWireFrame::DesktopRegistered {
                desktop_id: "recovery-test".into(),
                protocol_version: 1,
            })
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();
        std::future::pending::<()>().await;
    });
    let status = status();
    assert_eq!(
        short_connection(plan, status.clone())
            .await
            .unwrap_err()
            .to_string(),
        "relay heartbeat timed out"
    );
    assert_eq!(status.read().unwrap().phase, RelayPhase::Online);
    server.abort();
}

#[tokio::test]
async fn healthy_registered_socket_is_not_closed_by_registration_deadline() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let plan = plan(listener.local_addr().unwrap().port());
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
        ws.send(Message::Text(
            serde_json::to_string(&RelayWireFrame::DesktopRegistered {
                desktop_id: "recovery-test".into(),
                protocol_version: 1,
            })
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();
        loop {
            if ws.send(Message::Ping(Vec::new().into())).await.is_err() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    });
    let status = status();
    let result = tokio::time::timeout(
        Duration::from_millis(400),
        run_connection_with_timeouts(
            plan,
            status.clone(),
            Arc::new(AtomicI64::new(0)),
            Duration::from_secs(1),
            Duration::from_millis(100),
            Duration::from_millis(200),
        ),
    )
    .await;
    assert!(
        result.is_err(),
        "healthy traffic must keep the connection running"
    );
    assert_eq!(status.read().unwrap().phase, RelayPhase::Online);
    server.abort();
}

// Uses the real disk-read → plan → supervisor → WebSocket registration path.
// The shared lock prevents other native auth tests from replacing this path.
struct AuthStore {
    dir: tempfile::TempDir,
    _guard: std::sync::MutexGuard<'static, ()>,
}
impl AuthStore {
    fn new() -> Self {
        let lock = org2_cloud_auth::TEST_AUTH_STORE_LOCK
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("ORGII_TEST_SHARED_AUTH_STORE", dir.path().join("auth.json"));
        Self { dir, _guard: lock }
    }
    fn write(&self, expires_at: f64) {
        let auth = serde_json::json!({"kind":"org2_cloud", "accessToken":"test-only", "refreshToken":"test-refresh", "expiresAt":expires_at});
        std::fs::write(
            self.dir.path().join("auth.json"),
            serde_json::json!({org2_cloud_auth::ORG2_CLOUD_AUTH_STORAGE_KEY: auth.to_string()})
                .to_string(),
        )
        .unwrap();
    }
}
impl Drop for AuthStore {
    fn drop(&mut self) {
        std::env::remove_var("ORGII_TEST_SHARED_AUTH_STORE");
    }
}

#[tokio::test]
async fn expired_auth_recovers_from_durable_refresh_even_without_notification() {
    let auth = AuthStore::new();
    auth.write(1.0);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let settings = RelaySettings {
        enabled: true,
        relay_enabled: true,
        relay_url: format!("ws://127.0.0.1:{}", listener.local_addr().unwrap().port()),
        desktop_id: "recovery-test".into(),
    };
    let (settings_tx, settings_rx) = watch::channel(settings);
    let (_auth_tx, auth_rx) = watch::channel(0);
    let status = status();
    let shutdown = CancellationToken::new();
    let runtime = tokio::spawn(supervise(
        settings_rx,
        auth_rx,
        status.clone(),
        shutdown.clone(),
    ));
    wait_phase(&status, RelayPhase::Backoff).await;
    assert_eq!(status.read().unwrap().reconnect_attempt, 1);
    auth.write(4_102_444_800.0);
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
        ws.send(Message::Text(
            serde_json::to_string(&RelayWireFrame::DesktopRegistered {
                desktop_id: "recovery-test".into(),
                protocol_version: 1,
            })
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();
        while let Some(message) = ws.next().await {
            if matches!(message, Ok(Message::Ping(_))) && ws.flush().await.is_err() {
                break;
            }
        }
    });
    wait_phase(&status, RelayPhase::Online).await;
    settings_tx.send_modify(|value| value.enabled = false);
    wait_phase(&status, RelayPhase::Disabled).await;
    shutdown.cancel();
    runtime.await.unwrap();
    assert_eq!(status.read().unwrap().phase, RelayPhase::Stopped);
    tokio::time::timeout(Duration::from_secs(1), server)
        .await
        .expect("disabling drops the connection")
        .unwrap();
}

#[tokio::test]
async fn credential_notifications_do_not_bypass_auth_failure_backoff() {
    let auth = AuthStore::new();
    auth.write(1.0);
    let (_settings_tx, settings_rx) = watch::channel(RelaySettings {
        enabled: true,
        relay_enabled: true,
        relay_url: "ws://127.0.0.1:1".into(),
        desktop_id: "test".into(),
    });
    let (auth_tx, auth_rx) = watch::channel(0);
    let status = status();
    let shutdown = CancellationToken::new();
    let runtime = tokio::spawn(supervise(
        settings_rx,
        auth_rx,
        status.clone(),
        shutdown.clone(),
    ));
    wait_phase(&status, RelayPhase::Backoff).await;
    for _ in 0..20 {
        auth_tx.send_modify(|generation| *generation += 1);
    }
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(status.read().unwrap().reconnect_attempt, 1);
    shutdown.cancel();
    runtime.await.unwrap();
}
