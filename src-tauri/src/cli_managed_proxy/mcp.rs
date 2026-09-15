//! Stateless MCP relay scoped to an already-owned execution route.
//! Provider credentials stay native; clients inherit only the local capability.
use super::{json_error, session_routes};
use axum::{
    body::{to_bytes, Body},
    extract::Path,
    http::{Request, Response, StatusCode},
};
use serde_json::Value;
use std::{sync::OnceLock, time::Duration};

const MAX_FRAME: usize = 2 * 1024 * 1024;
static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

pub(super) async fn handle(Path(agent): Path<String>, request: Request<Body>) -> Response<Body> {
    if request.headers().contains_key("origin") {
        return json_error(
            StatusCode::FORBIDDEN,
            "Browser MCP requests are not allowed".into(),
        );
    }
    let Some(token) = request
        .headers()
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .map(str::to_owned)
    else {
        return json_error(
            StatusCode::UNAUTHORIZED,
            "Missing local MCP authorization".into(),
        );
    };
    let context = match session_routes::resolve(&agent, &token) {
        Ok(Some(context)) => context,
        _ => {
            return json_error(
                StatusCode::UNAUTHORIZED,
                "Inactive local MCP authorization".into(),
            )
        }
    };
    let source = match crate::dynamic_credentials::source(&context.key_id) {
        Ok(Some(source)) => source,
        _ => {
            return json_error(
                StatusCode::PRECONDITION_FAILED,
                "MCP source unavailable".into(),
            )
        }
    };
    let endpoint = match source.mcp_endpoint(&context.key_id, &agent) {
        Ok(Some(endpoint)) => endpoint,
        _ => {
            return json_error(
                StatusCode::PRECONDITION_FAILED,
                "MCP endpoint unavailable".into(),
            )
        }
    };
    let bytes = match to_bytes(request.into_body(), MAX_FRAME).await {
        Ok(bytes) => bytes,
        Err(_) => return json_error(StatusCode::PAYLOAD_TOO_LARGE, "MCP frame too large".into()),
    };
    let frame: Value = match serde_json::from_slice(&bytes) {
        Ok(frame) => frame,
        Err(_) => return json_error(StatusCode::BAD_REQUEST, "Invalid MCP frame".into()),
    };
    if frame.get("jsonrpc").and_then(Value::as_str) != Some("2.0")
        || frame.get("method").and_then(Value::as_str).is_none()
        || frame
            .get("id")
            .is_some_and(|id| !id.is_string() && !id.is_number())
    {
        return json_error(StatusCode::BAD_REQUEST, "Invalid MCP request".into());
    }
    let credential = match source.credential(&context.key_id, &agent).await {
        Ok(credential) => credential,
        Err(_) => {
            return json_error(
                StatusCode::PRECONDITION_FAILED,
                "MCP authorization unavailable".into(),
            )
        }
    };
    // Recheck after potentially slow credential refresh. A released generation
    // must not dispatch new tool work using a completed refresh.
    if !matches!(session_routes::resolve(&agent, &token), Ok(Some(_))) {
        return json_error(
            StatusCode::UNAUTHORIZED,
            "Inactive local MCP authorization".into(),
        );
    }
    let client = match CLIENT.get() {
        Some(client) => client,
        None => {
            let client = match reqwest::Client::builder()
                .timeout(Duration::from_secs(60))
                .redirect(reqwest::redirect::Policy::none())
                .build()
            {
                Ok(client) => client,
                Err(_) => {
                    return json_error(StatusCode::BAD_GATEWAY, "MCP transport unavailable".into())
                }
            };
            let _ = CLIENT.set(client);
            CLIENT.get().expect("MCP client initialized")
        }
    };
    let mut response = match client
        .post(endpoint)
        .bearer_auth(credential.secret)
        .header("content-type", "application/json")
        .body(bytes)
        .send()
        .await
    {
        Ok(response) => response,
        Err(_) => return json_error(StatusCode::BAD_GATEWAY, "MCP endpoint unavailable".into()),
    };
    let status = response.status();
    if !status.is_success() {
        // Do not expose upstream error bodies, headers or redirect locations.
        return json_error(
            StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
            "MCP endpoint refused the request".into(),
        );
    }
    if matches!(status.as_u16(), 202 | 204) && frame.get("id").is_none() {
        return Response::builder()
            .status(StatusCode::ACCEPTED)
            .body(Body::empty())
            .unwrap();
    }
    let mut body = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) if body.len() + chunk.len() <= MAX_FRAME => {
                body.extend_from_slice(&chunk)
            }
            Ok(None) => break,
            _ => return json_error(StatusCode::BAD_GATEWAY, "Invalid MCP response size".into()),
        }
    }
    let valid = serde_json::from_slice::<Value>(&body)
        .ok()
        .is_some_and(|reply| {
            frame.get("id").is_some()
                && reply.get("id") == frame.get("id")
                && reply.get("jsonrpc").and_then(Value::as_str) == Some("2.0")
                && reply.get("method").is_none()
                && (reply.get("result").is_some() ^ reply.get("error").is_some())
        });
    if !valid {
        return json_error(StatusCode::BAD_GATEWAY, "Invalid MCP response".into());
    }
    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "application/json")
        .body(Body::from(body))
        .unwrap()
}

pub(crate) fn server_config(agent: &str, token: &str) -> agent_core::mcp::config::McpServerConfig {
    use agent_core::mcp::config::{McpServerConfig, McpTransportType};
    McpServerConfig {
        transport_type: McpTransportType::StreamableHttp,
        command: None,
        args: None,
        cwd: None,
        env: None,
        url: Some(format!(
            "{}/cli/{agent}/mcp",
            agent_cli::managed_config::managed_proxy_url().trim_end_matches('/')
        )),
        headers: Some(std::collections::HashMap::from([(
            "Authorization".into(),
            format!("Bearer {token}"),
        )])),
        auto_approve: None,
        disabled: false,
        timeout: 60,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dynamic_credentials::{Authentication, Credential, Destination, Source};
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    };

    struct Fixture {
        endpoint: String,
        minted: Arc<AtomicUsize>,
    }
    impl Source for Fixture {
        fn namespace(&self) -> &'static str {
            "mcp-fixture"
        }
        fn destination(&self, _: &str, _: &str) -> Result<Destination, String> {
            Ok(Destination {
                authentication: Authentication::Bearer,
                provider: "fixture".into(),
                base_url: "https://unused.invalid/v1".into(),
            })
        }
        fn mcp_endpoint(&self, _: &str, _: &str) -> Result<Option<String>, String> {
            Ok(Some(self.endpoint.clone()))
        }
        fn credential<'a>(
            &'a self,
            key: &'a str,
            agent: &'a str,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<Credential, String>> + Send + 'a>,
        > {
            Box::pin(async move {
                let n = self.minted.fetch_add(1, Ordering::SeqCst) + 1;
                Ok(Credential {
                    destination: self.destination(key, agent)?,
                    secret: format!("upstream-only-{n}"),
                })
            })
        }
    }

    #[tokio::test]
    async fn real_router_forwards_only_owned_mcp_requests_and_validates_responses() {
        crate::test_utils::install_crypto_provider_for_tests();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let capture = Arc::clone(&seen);
        let upstream = axum::Router::new().route("/v1/skill/mcp/ws_fixture", axum::routing::post(move |request: Request<Body>| {
            let capture = Arc::clone(&capture);
            async move {
                let authorization = request.headers().get("authorization").unwrap().to_str().unwrap().to_owned();
                assert!(request.headers().get("cookie").is_none());
                let body = to_bytes(request.into_body(), MAX_FRAME).await.unwrap();
                let frame: Value = serde_json::from_slice(&body).unwrap();
                capture.lock().unwrap().push(authorization);
                if frame.get("id").is_none() {
                    return Response::builder().status(202).body(Body::empty()).unwrap();
                }
                let reply = if frame["method"] == "inject" {
                    serde_json::json!({"jsonrpc":"2.0","id":frame["id"],"method":"sampling/createMessage","params":{}})
                } else {
                    serde_json::json!({"jsonrpc":"2.0","id":frame["id"],"result":{"tools":[]}})
                };
                Response::builder().header("content-type","application/json").body(Body::from(reply.to_string())).unwrap()
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let upstream_task = tokio::spawn(async move {
            axum::serve(listener, upstream).await.unwrap();
        });
        let minted = Arc::new(AtomicUsize::new(0));
        crate::dynamic_credentials::register(Arc::new(Fixture {
            endpoint: format!("http://{address}/v1/skill/mcp/ws_fixture"),
            minted: Arc::clone(&minted),
        }))
        .unwrap();
        let router = super::super::proxy_router(super::super::ContextResolver(Arc::new(|_| {
            Err("must not read global account".into())
        })));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let local = listener.local_addr().unwrap();
        let proxy_task = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let id = format!("mcp-test-{}", uuid::Uuid::new_v4());
        let context = super::super::ProxyContext {
            authentication: Authentication::Bearer,
            key_id: "mcp-fixture:selection".into(),
            provider: "fixture".into(),
            model: "fixture".into(),
            upstream_base_url: "https://unused.invalid".into(),
            api_key: String::new(),
            proxy_token: String::new(),
            protocol: super::super::ProxyProtocol::OpenAi,
        };
        let token = session_routes::reserve(&id, "codex", context).unwrap();
        let client = reqwest::Client::new();
        let url = format!("http://{local}/cli/codex/mcp");
        let frame = serde_json::json!({"jsonrpc":"2.0","id":1,"method":"tools/list"});
        assert_eq!(
            client
                .post(&url)
                .json(&frame)
                .send()
                .await
                .unwrap()
                .status(),
            401
        );
        assert_eq!(
            client
                .post(&url)
                .bearer_auth(&token)
                .header("origin", "https://browser.invalid")
                .json(&frame)
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
        assert_eq!(
            client
                .post(format!("http://{local}/cli/claude_code/mcp"))
                .bearer_auth(&token)
                .json(&frame)
                .send()
                .await
                .unwrap()
                .status(),
            401
        );
        assert_eq!(minted.load(Ordering::SeqCst), 0);
        for _ in 0..2 {
            let reply = client
                .post(&url)
                .bearer_auth(&token)
                .header("cookie", "do-not-forward")
                .json(&frame)
                .send()
                .await
                .unwrap();
            assert_eq!(reply.status(), 200);
            assert_eq!(reply.json::<Value>().await.unwrap()["id"], 1);
        }
        assert_eq!(
            *seen.lock().unwrap(),
            vec!["Bearer upstream-only-1", "Bearer upstream-only-2"]
        );
        let injected = client
            .post(&url)
            .bearer_auth(&token)
            .json(&serde_json::json!({"jsonrpc":"2.0","id":2,"method":"inject"}))
            .send()
            .await
            .unwrap();
        assert_eq!(injected.status(), 502);
        assert!(!injected.text().await.unwrap().contains("sampling"));
        let notification = client
            .post(&url)
            .bearer_auth(&token)
            .json(&serde_json::json!({"jsonrpc":"2.0","method":"notifications/initialized"}))
            .send()
            .await
            .unwrap();
        assert_eq!(notification.status(), 202);
        session_routes::release(&id).unwrap();
        assert_eq!(
            client
                .post(&url)
                .bearer_auth(&token)
                .json(&frame)
                .send()
                .await
                .unwrap()
                .status(),
            401
        );
        assert_eq!(minted.load(Ordering::SeqCst), 4);
        assert_eq!(client.get(&url).send().await.unwrap().status(), 405);
        proxy_task.abort();
        upstream_task.abort();
    }
}
