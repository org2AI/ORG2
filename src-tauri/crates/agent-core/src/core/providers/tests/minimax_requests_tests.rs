//! Exercise the real HTTP clients with synthetic credentials and a local server.
use crate::providers::anthropic_native::AnthropicClient;
use crate::providers::openai_compat::OpenAICompatClient;
use crate::providers::registry::{find_by_name, provider_id};
use crate::providers::traits::{LLMProvider, ProviderConfig};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

fn fixture_response(anthropic: bool, stream: bool, with_tools: bool) -> String {
    if !with_tools {
        return match (anthropic, stream) {
            (false, false) => json!({"id":"plain","choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]}).to_string(),
            (false, true) => "data: {\"id\":\"plain\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"ok\"},\"finish_reason\":null}]}\n\ndata: {\"id\":\"plain\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n".into(),
            (true, false) => json!({"id":"plain","type":"message","role":"assistant","content":[{"type":"text","text":"ok"}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1}}).to_string(),
            (true, true) => "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"plain\",\"type\":\"message\",\"role\":\"assistant\",\"content\":[],\"usage\":{\"input_tokens\":1,\"output_tokens\":0}}}\n\nevent: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\nevent: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"ok\"}}\n\nevent: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":0}\n\nevent: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":1}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n".into(),
        };
    }
    if !stream {
        return if anthropic {
            json!({"id":"fixture","type":"message","role":"assistant","model":"MiniMax-M3.1-Flash","content":[{"type":"thinking","thinking":"Keep this reasoning."},{"type":"tool_use","id":"call_1","name":"lookup","input":{"q":"hello"}}],"stop_reason":"tool_use","usage":{"input_tokens":1,"output_tokens":2}}).to_string()
        } else {
            json!({"id":"fixture","choices":[{"index":0,"message":{"role":"assistant","content":null,"reasoning_content":"Keep this reasoning.","tool_calls":[{"id":"call_1","type":"function","function":{"name":"lookup","arguments":"{\"q\":\"hello\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":1,"completion_tokens":2}}).to_string()
        };
    }
    if !anthropic {
        return [
            json!({"id":"fixture","choices":[{"index":0,"delta":{"reasoning_content":"Keep this reasoning."},"finish_reason":null}]}),
            json!({"id":"fixture","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"lookup","arguments":"{\"q\":\"hello\"}"}}]},"finish_reason":null}]}),
            json!({"id":"fixture","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}),
        ].into_iter().map(|event| format!("data: {event}\n\n")).collect::<String>() + "data: [DONE]\n\n";
    }
    [
        ("message_start", json!({"type":"message_start","message":{"id":"fixture","type":"message","role":"assistant","model":"MiniMax-M3.1-Flash","content":[],"usage":{"input_tokens":1,"output_tokens":0}}})),
        ("content_block_start", json!({"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}})),
        ("content_block_delta", json!({"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Keep this reasoning."}})),
        ("content_block_stop", json!({"type":"content_block_stop","index":0})),
        ("content_block_start", json!({"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call_1","name":"lookup","input":{}}})),
        ("content_block_delta", json!({"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"q\":\"hello\"}"}})),
        ("content_block_stop", json!({"type":"content_block_stop","index":1})),
        ("message_delta", json!({"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":2}})),
        ("message_stop", json!({"type":"message_stop"})),
    ].into_iter().map(|(event, data)| format!("event: {event}\ndata: {data}\n\n")).collect()
}

async fn check_transport(
    anthropic: bool,
    stream: bool,
    model: &str,
    effort: &str,
    with_tools: bool,
) {
    crate::test_support::install_crypto_provider_for_tests();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let prefix = if anthropic { "/anthropic/v1" } else { "/v1" };
    let endpoint = format!("http://{}{prefix}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let mut captured = Vec::new();
        for _ in 0..2 {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = Vec::new();
            let (header_end, length) = loop {
                let mut buffer = [0; 4096];
                let n = socket.read(&mut buffer).await.unwrap();
                assert!(n > 0 && bytes.len() + n < 131_072);
                bytes.extend_from_slice(&buffer[..n]);
                if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                    let length: usize = headers
                        .lines()
                        .find_map(|l| l.strip_prefix("content-length:"))
                        .unwrap()
                        .trim()
                        .parse()
                        .unwrap();
                    break (end + 4, length);
                }
            };
            while bytes.len() < header_end + length {
                let mut buffer = [0; 4096];
                let n = socket.read(&mut buffer).await.unwrap();
                assert!(n > 0 && bytes.len() + n < 131_072);
                bytes.extend_from_slice(&buffer[..n]);
            }
            let headers = String::from_utf8_lossy(&bytes[..header_end]).to_lowercase();
            let body: Value =
                serde_json::from_slice(&bytes[header_end..header_end + length]).unwrap();
            let response = fixture_response(anthropic, stream, with_tools);
            let content_type = if stream {
                "text/event-stream"
            } else {
                "application/json"
            };
            socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}", response.len()).as_bytes()).await.unwrap();
            captured.push((headers, body));
        }
        captured
    });
    let config = ProviderConfig {
        api_key: "fixture-key".into(),
        api_base: Some(endpoint),
        extra_headers: Default::default(),
        is_azure: false,
    };
    let spec = find_by_name(provider_id::MINIMAX).unwrap();
    let client: Box<dyn LLMProvider> = if anthropic {
        Box::new(AnthropicClient::new(config, spec, model.into()))
    } else {
        Box::new(OpenAICompatClient::new(config, spec, model.into()))
    };
    let image = "data:image/png;base64,aGVsbG8=";
    let remote_image = "https://example.invalid/fixture.png";
    let mut messages = vec![
        json!({"role":"user","content":[{"type":"text","text":"Inspect these images"},{"type":"image_url","image_url":{"url":image}},{"type":"image_url","image_url":{"url":remote_image}}]}),
    ];
    let tools = [
        json!({"type":"function","function":{"name":"lookup","description":"Lookup","parameters":{"type":"object","properties":{"q":{"type":"string"}}}}}),
    ];
    let request_tools = if with_tools {
        Some(tools.as_slice())
    } else {
        None
    };
    for turn in 0..2 {
        let response = if stream {
            client
                .chat_streaming(&messages, request_tools, model, 4096, 0.1, &|_| {}, None)
                .await
        } else {
            client
                .chat(&messages, request_tools, model, 4096, 0.1)
                .await
        }
        .unwrap();
        if !with_tools {
            assert_eq!(response.content.as_deref(), Some("ok"));
            assert!(response.tool_calls.is_empty());
            continue;
        }
        assert_eq!(
            response.reasoning_content.as_deref(),
            Some("Keep this reasoning.")
        );
        assert_eq!(response.tool_calls.len(), 1);
        if turn == 0 {
            let call = &response.tool_calls[0];
            messages.push(json!({"role":"assistant","content":response.content,"reasoning_content":response.reasoning_content,"tool_calls":[{"id":call.id,"type":"function","function":{"name":call.name,"arguments":call.arguments.to_string()},"extra_content":call.thought_signature}]}));
            messages.push(json!({"role":"tool","tool_call_id":call.id,"content":"found"}));
        }
    }
    let captured = server.await.unwrap();
    for (headers, body) in &captured {
        let base = crate::providers::thinking_mode::parse_model_variant(model).base_model;
        assert_eq!(body["model"], base);
        if effort.is_empty() {
            assert!(body.get("thinking").is_none());
            assert!(body.get("reasoning_effort").is_none());
            assert!(body.get("output_config").is_none());
        } else {
            assert_eq!(body["thinking"]["type"], "adaptive");
        }
        assert!(body.get("service_tier").is_none());
        assert!(body.get("reasoning_split").is_none());
        assert_eq!(body["stream"].as_bool().unwrap_or(false), stream);
        if anthropic {
            assert!(headers.starts_with("post /anthropic/v1/messages "));
            assert!(headers.contains("x-api-key: fixture-key"));
            if !effort.is_empty() {
                assert_eq!(body["output_config"]["effort"], effort);
            }
            assert!(body.get("reasoning_effort").is_none());
            assert_eq!(
                body["messages"][0]["content"][1]["source"]["data"],
                "aGVsbG8="
            );
            assert_eq!(
                body["messages"][0]["content"][2]["source"]["url"],
                remote_image
            );
            if with_tools {
                assert_eq!(body["tools"][0]["name"], "lookup");
            } else {
                assert!(body.get("tools").is_none());
            }
        } else {
            assert!(headers.starts_with("post /v1/chat/completions "));
            assert!(headers.contains("authorization: bearer fixture-key"));
            if !effort.is_empty() {
                assert_eq!(body["reasoning_effort"], effort);
            }
            assert!(body.get("output_config").is_none());
            assert_eq!(body["messages"][0]["content"][1]["image_url"]["url"], image);
            assert_eq!(
                body["messages"][0]["content"][2]["image_url"]["url"],
                remote_image
            );
            if with_tools {
                assert_eq!(body["tools"][0]["function"]["name"], "lookup");
            } else {
                assert!(body.get("tools").is_none());
            }
        }
    }
    if !with_tools {
        return;
    }
    let history = &captured[1].1["messages"];
    if anthropic {
        assert_eq!(history[1]["content"][0]["type"], "thinking");
        assert_eq!(history[1]["content"][0]["thinking"], "Keep this reasoning.");
        assert!(history[1]["content"][0].get("signature").is_none());
        assert_eq!(history[1]["content"][1]["id"], "call_1");
        assert_eq!(history[2]["content"][0]["tool_use_id"], "call_1");
    } else {
        assert_eq!(history[1]["reasoning_content"], "Keep this reasoning.");
        assert_eq!(history[1]["tool_calls"][0]["id"], "call_1");
        assert_eq!(history[2]["tool_call_id"], "call_1");
    }
}

#[test]
fn minimax_direct_context_does_not_override_gateway_contracts() {
    use crate::providers::model_capabilities::{resolve, ThinkingSupport};
    let flash = resolve("MiniMax-M3.1-Flash", None);
    assert_eq!(flash.context_window, 1_000_000);
    assert_eq!(flash.thinking, ThinkingSupport::AlwaysOn);
    assert_eq!(resolve("MiniMax-M3", None).context_window, 1_000_000);
    for gateway in ["minimax/minimax-m3.1-flash:free", "minimax-m3.1-flash-free"] {
        assert_eq!(resolve(gateway, None).context_window, 200_000);
    }
}

#[tokio::test]
async fn minimax_flash_http_default_effort_tools_history_and_images() {
    tokio::time::timeout(Duration::from_secs(30), async {
        for anthropic in [false, true] {
            for stream in [false, true] {
                for (model, effort) in [
                    ("MiniMax-M3.1-Flash", "max"),
                    ("MiniMax-M3.1-Flash-low", "low"),
                    ("MiniMax-M3.1-Flash-medium", "medium"),
                    ("MiniMax-M3.1-Flash-high", "high"),
                    ("MiniMax-M3.1-Flash-xhigh", "xhigh"),
                    ("MiniMax-M3.1-Flash-none", "max"),
                    ("MiniMax-M3", ""),
                    ("MiniMax-M2.7", ""),
                ] {
                    check_transport(anthropic, stream, model, effort, true).await;
                    if model == "MiniMax-M3.1-Flash" {
                        check_transport(anthropic, stream, model, effort, false).await;
                    }
                }
            }
        }
    })
    .await
    .expect("MiniMax HTTP fixture timed out");
}
