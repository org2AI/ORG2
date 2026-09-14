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
