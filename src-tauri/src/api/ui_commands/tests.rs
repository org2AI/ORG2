use super::*;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

#[tokio::test]
async fn authenticated_http_and_native_share_broker_receipts() {
    crate::test_utils::install_crypto_provider_for_tests();
    let count = Arc::new(AtomicUsize::new(0));
    let counter = count.clone();
    let generation = app_ui::broker().register(Arc::new(move |dispatch| {
        counter.fetch_add(1, Ordering::SeqCst);
        let response = app_ui::Response {
            protocol_version: 1,
            request_id: dispatch.request.request_id.clone(),
            target: dispatch.request.target.clone(),
            status: app_ui::Status::Applied,
            result: Some(json!({"acceptedParams":dispatch.request.params})),
            error: None,
        };
        assert!(app_ui::broker().resolve(&dispatch.generation, response));
        Ok(())
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, routes()).await.unwrap();
    });
    let client = reqwest::Client::new();
    let base = format!("http://{address}/ui/v1");
    assert_eq!(
        client
            .get(format!("{base}/info"))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        client
            .get(format!("{base}/info"))
            .header("x-orgii-ui-token", token())
            .header("origin", "https://untrusted.example")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    let info: serde_json::Value = client
        .get(format!("{base}/info"))
        .header("x-orgii-ui-token", token())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(info["instanceId"], app_ui::broker().instance_id);
    let request = app_ui::Request {
        protocol_version: 1,
        request_id: uuid::Uuid::new_v4().to_string(),
        command: "ui.file.open".into(),
        target: app_ui::Target {
            instance_id: app_ui::broker().instance_id.clone(),
            window_id: "main".into(),
            workspace: app_ui::Workspace::Global {},
        },
        params: json!({"path":"fixture.txt"}),
        reveal: false,
        timeout_ms: 1000,
    };
    for _ in 0..2 {
        let response: app_ui::Response = client
            .post(format!("{base}/execute"))
            .header("x-orgii-ui-token", token())
            .json(&request)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(response.status, app_ui::Status::Applied);
        assert_eq!(response.result.unwrap()["acceptedParams"], request.params);
    }
    assert_eq!(count.load(Ordering::SeqCst), 1);
    let receipt: app_ui::Response = client
        .get(format!("{base}/receipt"))
        .header("x-orgii-ui-token", token())
        .query(&[("requestId", &request.request_id)])
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(receipt.status, app_ui::Status::Applied);
    let mut native = request.clone();
    native.request_id = uuid::Uuid::new_v4().to_string();
    assert_eq!(
        app_ui::broker()
            .execute("native-fixture", native)
            .await
            .status,
        app_ui::Status::Applied
    );
    assert_eq!(count.load(Ordering::SeqCst), 2);
    assert!(app_ui::broker()
        .receipt("native-fixture", &request.request_id)
        .is_none());
    let bad = client
        .post(format!("{base}/execute"))
        .header("x-orgii-ui-token", token())
        .json(&json!({"invalid":true}))
        .send()
        .await
        .unwrap();
    assert_eq!(bad.status(), StatusCode::BAD_REQUEST);
    server.abort();
    app_ui::broker().unregister(&generation);
}

/// Without a sweep every launch leaves a descriptor behind — `Descriptor::drop`
/// never runs, because `start_server` awaits `axum::serve` until process exit —
/// and `org2-ui` discovery hard-fails above 64 candidates, so the CLI would stop
/// working after roughly 65 app starts.
///
/// The port is deterministic per install, so **every** stale descriptor names
/// the port this process just bound. An earlier version of this test gave each
/// descriptor its own port and passed while the sweep did nothing in practice:
/// probing a port we already hold always succeeds.
#[tokio::test]
async fn sweep_removes_descriptors_that_cannot_be_live() {
    let directory = tempfile::tempdir().unwrap();
    let own_port = 13847u16;
    let own = "instance-current";

    let write = |name: &str, body: serde_json::Value| {
        std::fs::write(directory.path().join(name), body.to_string()).unwrap();
    };
    // Prior launches of this install: same port, different instance ids. These
    // are the ones the leak is made of.
    write("prev-1.json", json!({"instanceId":"old-a","port":own_port,"pid":std::process::id()}));
    write("prev-2.json", json!({"instanceId":"old-b","port":own_port,"pid":1}));
    // Ours, written by this very publish.
    write("current.json", json!({"instanceId":own,"port":own_port,"pid":std::process::id()}));
    // A second install on its own port, still running.
    write("other-live.json", json!({"instanceId":"other","port":13999,"pid":std::process::id()}));
    // A second install on its own port whose process is gone.
    write("other-dead.json", json!({"instanceId":"gone","port":13998,"pid":0x7FFF_FFFE}));
    // Pre-pid format, and not ours.
    write("legacy.json", json!({"instanceId":"legacy","port":13997}));
    std::fs::write(directory.path().join("unparsable.json"), "{").unwrap();
    std::fs::write(directory.path().join("keep.txt"), "not a descriptor").unwrap();

    tokio::task::spawn_blocking({
        let path = directory.path().to_path_buf();
        let own = own.to_string();
        move || sweep(&path, own_port, &own)
    })
    .await
    .unwrap();

    let mut remaining: Vec<String> = std::fs::read_dir(directory.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    remaining.sort();
    assert_eq!(
        remaining,
        vec![
            "current.json".to_string(),
            "keep.txt".to_string(),
            "other-live.json".to_string(),
        ]
    );
}

/// The own-port rule is what the sweep rests on, so pin the reason it holds:
/// a loopback connect to a port we have bound succeeds even though nothing
/// ever calls `accept`. Probing therefore cannot distinguish live from stale.
#[tokio::test]
async fn probing_a_bound_port_cannot_prove_liveness() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let connected = tokio::task::spawn_blocking(move || {
        std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
            std::time::Duration::from_millis(100),
        )
        .is_ok()
    })
    .await
    .unwrap();
    assert!(connected, "a bound listener accepts connections from its backlog");
    drop(listener);
}
