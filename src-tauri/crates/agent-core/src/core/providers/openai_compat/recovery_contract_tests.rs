//! Existing request repairs must remain reachable through typed rejections.
use crate::core::side_query::{side_query, SideQueryConfig};
use crate::providers::openai_adaptive::OpenAiAdaptiveClient;
use crate::providers::registry::{find_by_name, provider_id};
use crate::providers::traits::{LLMProvider, ProviderConfig, ProviderError};
use serde_json::{json, Value};
use wiremock::{
    matchers::{method, path},
    Mock, MockServer, Request, ResponseTemplate,
};

fn config(server: &MockServer) -> ProviderConfig {
    crate::test_support::install_crypto_provider_for_tests();
    ProviderConfig {
        api_key: "fixture-key".into(),
        api_base: Some(server.uri()),
        extra_headers: Default::default(),
        is_azure: false,
    }
}

fn success(request: &Request) -> ResponseTemplate {
    let body: Value = request.body_json().unwrap();
    if body["stream"] == true {
        ResponseTemplate::new(200).insert_header("content-type", "text/event-stream")
            .set_body_string("data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
    } else {
        ResponseTemplate::new(200).set_body_json(json!({"choices":[{
            "message":{"role":"assistant","content":"ok"},"finish_reason":"stop"
        }]}))
    }
}

#[tokio::test]
async fn adaptive_client_changes_unsupported_token_parameter_after_typed_400() {
    let _sandbox = test_helpers::test_env::sandbox();
    for stream in [false, true] {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .respond_with(|request: &Request| {
                let body: Value = request.body_json().unwrap();
                if body.get("max_tokens").is_some() {
                    ResponseTemplate::new(400).set_body_json(json!({"error":{
                        "message":"Unsupported parameter: max_tokens", "param":"max_tokens"
                    }}))
                } else {
                    assert_eq!(body["max_completion_tokens"], 64);
                    success(request)
                }
            })
            .mount(&server)
            .await;
        let client = OpenAiAdaptiveClient::new(
            config(&server),
            find_by_name(provider_id::OPENAI).unwrap(),
            "fixture-model".into(),
            Some(format!("fixture-{stream}")),
            Some(server.uri()),
        );
        let messages = [json!({"role":"user","content":"hello"})];
        let response = if stream {
            client
                .chat_streaming(&messages, None, "fixture-model", 64, 0.0, &|_| {}, None)
                .await
        } else {
            client.chat(&messages, None, "fixture-model", 64, 0.0).await
        };
        assert_eq!(response.unwrap().content.as_deref(), Some("ok"));
        assert_eq!(server.received_requests().await.unwrap().len(), 2);
    }
}

#[tokio::test]
async fn adaptive_client_can_switch_endpoint_after_typed_400() {
    let _sandbox = test_helpers::test_env::sandbox();
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/chat/completions"))
        .respond_with(ResponseTemplate::new(400).set_body_json(json!({"error":{
            "message":"Chat completions not supported with this model; use /responses"
        }})))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/responses"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id":"response", "status":"completed", "output":[{"type":"message", "role":"assistant",
                "content":[{"type":"output_text","text":"ok"}]}],
            "usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}
        })))
        .mount(&server)
        .await;
    let client = OpenAiAdaptiveClient::new(
        config(&server),
        find_by_name(provider_id::OPENAI).unwrap(),
        "fixture-model".into(),
        Some("endpoint-fixture".into()),
        Some(server.uri()),
    );
    let response = client
        .chat(
            &[json!({"role":"user","content":"hello"})],
            None,
            "fixture-model",
            64,
            0.0,
        )
        .await
        .unwrap();
    assert_eq!(response.content.as_deref(), Some("ok"));
    assert_eq!(server.received_requests().await.unwrap().len(), 2);
}

#[tokio::test]
async fn side_query_keeps_thinking_recovery_after_typed_400() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(|request: &Request| {
            let body: Value = request.body_json().unwrap();
            if body["max_tokens"] == 64 {
                ResponseTemplate::new(400)
                    .set_body_json(json!({"error":{"message":"thinking disabled rejected"}}))
            } else {
                success(request)
            }
        })
        .mount(&server)
        .await;
    let client = super::OpenAICompatClient::new(
        config(&server),
        find_by_name(provider_id::VLLM).unwrap(),
        "fixture-model".into(),
    );
    let result = side_query(
        &client,
        &[json!({"role":"user","content":"hello"})],
        &SideQueryConfig {
            max_tokens: 64,
            ..Default::default()
        },
        "fixture-model",
    )
    .await
    .unwrap();
    assert_eq!(result.content, "ok");
    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 2);
    let body: Value = requests[1].body_json().unwrap();
    assert_eq!(body["max_tokens"], 2112);
}

#[test]
fn parameter_rejection_is_not_projected_as_retryable_network_failure() {
    let error = crate::core::session::turn::streaming::StreamingError::from(
        ProviderError::InvalidRequest {
            status: Some(400),
            parameter: Some("tools".into()),
            message: "invalid tools".into(),
        },
    );
    assert_eq!(error.error_code.wire_value(), "UNKNOWN");
    assert!(!error.is_retryable);
    assert_eq!(
        error.details.unwrap(),
        json!({"reason":"invalid_request","status":400,"parameter":"tools"})
    );
}
