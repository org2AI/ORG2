//! Contracts at the actual HTTP boundary, including the reliable wrapper.
use super::OpenAICompatClient;
use crate::providers::registry::{find_by_name, provider_id};
use crate::providers::reliable::ReliableProvider;
use crate::providers::traits::{LLMProvider, LLMResponse, ProviderConfig, ProviderError};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use wiremock::{matchers::method, Mock, MockServer, Request, ResponseTemplate};

fn client(server: &MockServer) -> OpenAICompatClient {
    crate::test_support::install_crypto_provider_for_tests();
    OpenAICompatClient::new(
        ProviderConfig {
            api_key: "fixture-key".into(),
            api_base: Some(server.uri()),
            extra_headers: Default::default(),
            is_azure: false,
        },
        find_by_name(provider_id::VLLM).unwrap(),
        "fixture-model".into(),
    )
}

async fn call(
    provider: &dyn LLMProvider,
    tools: Option<&[Value]>,
    stream: bool,
) -> Result<LLMResponse, ProviderError> {
    let messages = [json!({"role":"user","content":"summarize"})];
    if stream {
        provider
            .chat_streaming(&messages, tools, "fixture-model", 64, 0.0, &|_| {}, None)
            .await
    } else {
        provider
            .chat(&messages, tools, "fixture-model", 64, 0.0)
            .await
    }
}

fn success(request: &Request) -> ResponseTemplate {
    let body: Value = request.body_json().unwrap();
    if body["stream"] == true {
        ResponseTemplate::new(200).insert_header("content-type", "text/event-stream")
            .set_body_string("data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
    } else {
        ResponseTemplate::new(200).set_body_json(json!({
            "choices":[{"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]
        }))
    }
}

fn tool() -> Value {
    json!({"type":"function","function":{"name":"emit","parameters":{"type":"object"}}})
}

fn choice(value: Value) -> Value {
    json!({"_orgii_tool_choice_override":value})
}

#[tokio::test]
async fn text_only_requests_omit_both_fields_after_internal_markers_are_removed() {
    for stream in [false, true] {
        for tools in [None, Some(vec![]), Some(vec![choice(json!("auto"))])] {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .respond_with(|request: &Request| {
                    let body: Value = request.body_json().unwrap();
                    if body.get("tools").is_some() || body.get("tool_choice").is_some() {
                        ResponseTemplate::new(400)
                            .set_body_json(json!({"error":{"message":"invalid tool parameters"}}))
                    } else {
                        success(request)
                    }
                })
                .mount(&server)
                .await;
            assert_eq!(
                call(&client(&server), tools.as_deref(), stream)
                    .await
                    .unwrap()
                    .content
                    .as_deref(),
                Some("ok")
            );
            let requests = server.received_requests().await.unwrap();
            assert_eq!(requests.len(), 1);
            let body: Value = requests[0].body_json().unwrap();
            assert!(body.get("tools").is_none());
            assert!(body.get("tool_choice").is_none());
        }
    }
}

#[tokio::test]
async fn normal_and_forced_tools_survive_without_internal_metadata() {
    for stream in [false, true] {
        for forced in [false, true] {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .respond_with(success)
                .mount(&server)
                .await;
            let mut definition = tool();
            definition["x_orgii_tool_schema_cache_scope"] = json!("stable_prefix");
            let mut tools = vec![definition];
            if forced {
                tools.push(choice(json!({"type":"tool","name":"emit"})));
            }
            call(&client(&server), Some(&tools), stream).await.unwrap();
            let requests = server.received_requests().await.unwrap();
            let body: Value = requests[0].body_json().unwrap();
            assert_eq!(body["tools"], json!([tool()]));
            assert_eq!(
                body["tool_choice"],
                if forced {
                    json!({"type":"function","function":{"name":"emit"}})
                } else {
                    json!("auto")
                }
            );
        }
    }
}

#[tokio::test]
async fn missing_forced_tool_fails_locally_without_http() {
    for stream in [false, true] {
        let server = MockServer::start().await;
        for tools in [
            vec![choice(json!({"type":"tool","name":"missing"}))],
            vec![tool(), choice(json!({"type":"tool","name":"missing"}))],
            vec![choice(json!("required"))],
        ] {
            assert!(matches!(call(&client(&server), Some(&tools), stream).await,
                Err(ProviderError::InvalidRequest { status: None, parameter: Some(parameter), .. }) if parameter == "tool_choice"));
        }
        assert!(server.received_requests().await.unwrap().is_empty());
    }
}

#[test]
fn bad_request_preserves_http_status_parameter_and_reason() {
    for (body, parameter) in [
        (
            r#"{"error":{"message":"empty tools","param":"tools"}}"#,
            Some("tools"),
        ),
        (
            r#"{"error":{"message":"empty tools","parameter":"tools"}}"#,
            Some("tools"),
        ),
        (
            r#"{"error":{"message":"empty tools","code":"invalid_request_error","param":"tools"}}"#,
            Some("tools"),
        ),
        ("invalid parameters", None),
        (
            r#"{"message":"empty tools","parameter":"tools"}"#,
            Some("tools"),
        ),
        ("{broken", None),
        ("", None),
    ] {
        let error = OpenAICompatClient::parse_error_response(400, body, None);
        match error {
            ProviderError::InvalidRequest {
                status,
                parameter: actual,
                message,
            } => {
                assert_eq!(status, Some(400));
                assert_eq!(actual.as_deref(), parameter);
                assert!(!message.is_empty());
            }
            other => panic!("unexpected error: {other}"),
        }
    }
    assert!(matches!(
        OpenAICompatClient::parse_error_response(
            400,
            r#"{"error":{"message":"maximum context length exceeded"}}"#,
            None
        ),
        ProviderError::ContextTooLong(_)
    ));
    assert!(matches!(
        OpenAICompatClient::parse_error_response(
            400,
            r#"{"error":{"code":"model_not_found","message":"unknown model"}}"#,
            None
        ),
        ProviderError::ModelNotFound(_)
    ));
    assert!(matches!(
        OpenAICompatClient::parse_error_response(
            429,
            r#"{"error":{"type":"usage_limit_reached","message":"quota exhausted"}}"#,
            None
        ),
        ProviderError::UsageLimitReached(_)
    ));
}

#[tokio::test]
async fn invalid_requests_are_sent_once_and_can_fall_back() {
    for stream in [false, true] {
        let primary = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(
                ResponseTemplate::new(400).set_body_json(
                    json!({"error":{"message":"invalid parameter","param":"tools"}}),
                ),
            )
            .mount(&primary)
            .await;
        let reliable =
            ReliableProvider::single("primary".into(), Box::new(client(&primary)), 3, 50);
        assert!(matches!(
            call(&reliable, None, stream).await,
            Err(ProviderError::InvalidRequest { .. })
        ));
        assert_eq!(primary.received_requests().await.unwrap().len(), 1);
        primary.reset().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(400).set_body_string("invalid parameters"))
            .mount(&primary)
            .await;
        let fallback = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(success)
            .mount(&fallback)
            .await;
        let reliable = ReliableProvider::with_fallbacks(
            vec![
                ("primary".into(), Box::new(client(&primary))),
                ("fallback".into(), Box::new(client(&fallback))),
            ],
            3,
            50,
        );
        assert_eq!(
            call(&reliable, None, stream)
                .await
                .unwrap()
                .content
                .as_deref(),
            Some("ok")
        );
        assert_eq!(primary.received_requests().await.unwrap().len(), 1);
        assert_eq!(fallback.received_requests().await.unwrap().len(), 1);
    }
}

#[tokio::test]
async fn transient_http_failures_still_retry_and_exhaust_the_budget() {
    for stream in [false, true] {
        for status in [429, 503] {
            let server = MockServer::start().await;
            let count = Arc::new(AtomicUsize::new(0));
            let seen = count.clone();
            Mock::given(method("POST"))
                .respond_with(move |request: &Request| {
                    if seen.fetch_add(1, Ordering::SeqCst) == 0 {
                        ResponseTemplate::new(status)
                            .set_body_json(json!({"error":{"message":"temporary failure"}}))
                    } else {
                        success(request)
                    }
                })
                .mount(&server)
                .await;
            let reliable =
                ReliableProvider::single("fixture".into(), Box::new(client(&server)), 2, 50);
            call(&reliable, None, stream).await.unwrap();
            assert_eq!(count.load(Ordering::SeqCst), 2);
        }
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(503).set_body_string("unavailable"))
            .mount(&server)
            .await;
        let reliable = ReliableProvider::single("fixture".into(), Box::new(client(&server)), 2, 50);
        assert!(call(&reliable, None, stream).await.is_err());
        assert_eq!(server.received_requests().await.unwrap().len(), 3);
    }
}
