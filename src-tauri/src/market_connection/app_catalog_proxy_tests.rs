//! Real AppSource selection plus the production HTTP proxy. Only credentials
//! and the remote Market service are synthetic; no user settings are written.
use super::*;
use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
    routing::any,
    Json, Router,
};
use std::sync::Arc;

struct LocalMarket {
    root: String,
}
impl Source for LocalMarket {
    fn namespace(&self) -> &'static str {
        "history-catalog-fixture"
    }
    fn destination(&self, key: &str, _: &str) -> Result<Destination, String> {
        let selection = Selection::parse(
            key.strip_prefix("history-catalog-fixture:")
                .ok_or("fixture key")?,
            "codex",
        )?;
        Ok(Destination {
            provider: "market".into(),
            authentication: crate::dynamic_credentials::Authentication::Bearer,
            base_url: format!("{}/{}/v1", self.root, selection.entitlement_id),
        })
    }
    fn request_selection(
        &self,
        key: &str,
        agent: &str,
        model: &str,
    ) -> Result<Option<RequestSelection>, String> {
        let raw = key
            .strip_prefix("history-catalog-fixture:")
            .ok_or("fixture key")?;
        let mut route = AppSource
            .request_selection(raw, agent, model)?
            .ok_or("missing route")?;
        route.selection = format!("history-catalog-fixture:{}", route.selection);
        Ok(Some(route))
    }
    fn credential<'a>(
        &'a self,
        key: &'a str,
        agent: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Credential, String>> + Send + 'a>> {
        Box::pin(async move {
            let destination = self.destination(key, agent)?;
            let owner = Selection::parse(
                key.strip_prefix("history-catalog-fixture:")
                    .ok_or("fixture key")?,
                agent,
            )?
            .entitlement_id;
            Ok(Credential {
                destination,
                secret: format!("synthetic-{owner}"),
            })
        })
    }
}

#[tokio::test]
async fn history_fallback_and_explicit_alias_keep_wire_model_destination_and_credential_together() {
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
            let body: serde_json::Value =
                serde_json::from_slice(&to_bytes(request.into_body(), 16384).await.unwrap())
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
    crate::dynamic_credentials::register(Arc::new(LocalMarket { root })).unwrap();
    let models = vec![
        tests::entry("pa_first", "gpt-default"),
        tests::entry("pa_second", "gpt-selected"),
    ];
    let default = models[0].id.clone();
    let second = models[1].id.clone();
    let catalog = Catalog {
        version: 1,
        agent: "codex".into(),
        default_model: default.clone(),
        models,
    };
    let router = crate::cli_managed_proxy::catalog_fixture_router(
        format!("history-catalog-fixture:{}", catalog.key().unwrap()),
        default,
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!(
        "http://{}/cli/codex/synthetic-history-catalog/v1/responses",
        listener.local_addr().unwrap()
    );
    let proxy_task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let client = reqwest::Client::new();
    for (requested, owner, wire_model) in [
        ("gpt-5.4", "pa_first", "gpt-default"),
        (second.as_str(), "pa_second", "gpt-selected"),
    ] {
        let response = client.post(&endpoint).json(&serde_json::json!({"model":requested,"input":"synthetic compaction input","stream":false})).send().await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let (path, auth, body) =
            tokio::time::timeout(std::time::Duration::from_secs(5), receive.recv())
                .await
                .unwrap()
                .unwrap();
        assert_eq!(path, format!("/{owner}/v1/responses"));
        assert_eq!(auth, format!("Bearer synthetic-{owner}"));
        assert_eq!(body["model"], wire_model);
        assert_eq!(body["input"], "synthetic compaction input");
    }
    for model in [
        "gpt-default-org2-retired",
        "claude-org2-route-retired",
        "gpt bad",
        "",
    ] {
        assert_eq!(
            client
                .post(&endpoint)
                .json(&serde_json::json!({"model":model}))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::BAD_REQUEST
        );
    }
    assert!(receive.try_recv().is_err());
    proxy_task.abort();
    upstream_task.abort();
}
