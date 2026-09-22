use super::*;
use crate::dynamic_credentials::{Credential, Destination, RequestSelection, Source, SourceModel};
use std::{future::Future, pin::Pin, sync::Arc};

struct CatalogFixture {
    root: String,
    requests: Arc<std::sync::atomic::AtomicUsize>,
    catalog_reads: Arc<std::sync::atomic::AtomicUsize>,
    selections: Arc<std::sync::atomic::AtomicUsize>,
}
impl Source for CatalogFixture {
    fn namespace(&self) -> &'static str {
        "catalog-routing-test"
    }
    fn destination(&self, key: &str, _: &str) -> Result<Destination, String> {
        let owner = key
            .strip_prefix("catalog-routing-test:")
            .ok_or("Unknown owner")?;
        Ok(Destination {
            provider: "market".into(),
            authentication: Authentication::Bearer,
            base_url: format!("{}/{owner}/v1", self.root),
        })
    }
    fn models(&self, _: &str, _: &str) -> Result<Option<Vec<SourceModel>>, String> {
        self.catalog_reads.fetch_add(1, Ordering::SeqCst);
        Ok(Some(vec![
            SourceModel {
                id: "shared-first".into(),
                label: "First package".into(),
            },
            SourceModel {
                id: "shared-second".into(),
                label: "Second package".into(),
            },
        ]))
    }
    fn request_selection(
        &self,
        _: &str,
        _: &str,
        model: &str,
    ) -> Result<Option<RequestSelection>, String> {
        self.selections.fetch_add(1, Ordering::SeqCst);
        let owner = match model {
            "shared-first" => "first",
            "shared-second" => "second",
            _ => return Err("Unconfigured model".into()),
        };
        Ok(Some(RequestSelection {
            selection: format!("catalog-routing-test:{owner}"),
            model: "real-shared".into(),
        }))
    }
    fn credential<'a>(
        &'a self,
        key: &'a str,
        agent: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Credential, String>> + Send + 'a>> {
        Box::pin(async move {
            self.requests.fetch_add(1, Ordering::SeqCst);
            Ok(Credential {
                destination: self.destination(key, agent)?,
                secret: format!("synthetic-{key}"),
            })
        })
    }
}

#[tokio::test]
async fn real_proxy_routes_model_body_destination_and_credential_as_one_choice() {
    crate::test_utils::install_crypto_provider_for_tests();
    let (send, mut receive) = tokio::sync::mpsc::channel(4);
    let upstream = Router::new().fallback(any(move |request: Request<Body>| {
        let send = send.clone();
        async move {
            let uri = request.uri().to_string();
            let auth = request.headers()["authorization"]
                .to_str()
                .unwrap()
                .to_owned();
            let body: Value = serde_json::from_slice(
                &to_bytes(request.into_body(), MAX_PROXY_BODY_BYTES)
                    .await
                    .unwrap(),
            )
            .unwrap();
            send.send((uri, auth, body)).await.unwrap();
            Json(serde_json::json!({"ok":true}))
        }
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let root = format!("http://{}", listener.local_addr().unwrap());
    let upstream_task = tokio::spawn(async move {
        axum::serve(listener, upstream).await.unwrap();
    });
    let requests = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let catalog_reads = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let selections = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    crate::dynamic_credentials::register(Arc::new(CatalogFixture {
        root: root.clone(),
        requests: requests.clone(),
        catalog_reads: catalog_reads.clone(),
        selections: selections.clone(),
    }))
    .unwrap();
    let context = ProxyContext {
        authentication: Authentication::Bearer,
        key_id: "catalog-routing-test:catalog".into(),
        provider: "market".into(),
        model: "shared-first".into(),
        api_key: String::new(),
        upstream_base_url: root,
        proxy_token: "synthetic-local-catalog".into(),
        protocol: ProxyProtocol::OpenAi,
    };
    let proxy = proxy_router(ContextResolver(Arc::new(move |_| Ok(context.clone()))));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let root = format!(
        "http://{}/cli/codex/synthetic-local-catalog/v1",
        listener.local_addr().unwrap()
    );
    let proxy_task = tokio::spawn(async move {
        axum::serve(listener, proxy).await.unwrap();
    });
    let client = reqwest::Client::new();
    // Authentication must precede every source callback, including metadata-only
    // model listing. Otherwise stale native configuration could disclose a
    // different signed-in user's purchases or trigger a credential refresh.
    let unauthorized_root = root.replace("synthetic-local-catalog", "invalid-local-token");
    for response in [
        client
            .get(format!("{unauthorized_root}/models"))
            .send()
            .await
            .unwrap(),
        client
            .post(format!("{unauthorized_root}/responses"))
            .json(&serde_json::json!({"model":"shared-second","input":"hello"}))
            .send()
            .await
            .unwrap(),
    ] {
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        let body = response.text().await.unwrap();
        assert!(!body.contains("shared-first"));
        assert!(!body.contains("shared-second"));
    }
    assert_eq!(catalog_reads.load(Ordering::SeqCst), 0);
    assert_eq!(selections.load(Ordering::SeqCst), 0);
    assert_eq!(requests.load(Ordering::SeqCst), 0);
    assert!(receive.try_recv().is_err());
    let models: Value = client
        .get(format!("{root}/models?limit=10"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(models["data"].as_array().unwrap().len(), 2);
    assert_eq!(catalog_reads.load(Ordering::SeqCst), 1);
    assert_eq!(selections.load(Ordering::SeqCst), 0);
    assert_eq!(requests.load(Ordering::SeqCst), 0);
    for owner in ["first", "second", "first"] {
        let result = client
            .post(format!("{root}/responses"))
            .json(&serde_json::json!({"model":format!("shared-{owner}"),"input":"hello"}))
            .send()
            .await
            .unwrap();
        assert_eq!(result.status(), StatusCode::OK);
        let (uri, auth, body) = tokio::time::timeout(Duration::from_secs(5), receive.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(uri, format!("/{owner}/v1/responses"));
        assert_eq!(
            auth,
            format!("Bearer synthetic-catalog-routing-test:{owner}")
        );
        assert_eq!(body["model"], "real-shared");
    }
    for body in [
        serde_json::json!({"model":"real-shared"}),
        serde_json::json!({"model":null}),
        serde_json::json!(42),
    ] {
        assert_eq!(
            client
                .post(format!("{root}/responses"))
                .json(&body)
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::BAD_REQUEST
        );
    }
    assert_eq!(requests.load(Ordering::SeqCst), 3);
    assert!(receive.try_recv().is_err());
    proxy_task.abort();
    upstream_task.abort();
}
