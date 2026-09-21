//! Native SDE adapter. Persist only the selector; resolve short-lived credentials
//! at each request through the same bounded authorization source as App Connection.
use super::source::Selection;
use crate::dynamic_credentials::Source;
use agent_core::providers::{
    anthropic_native::{AnthropicAuthMode, AnthropicClient},
    dynamic::NativeProviderSource,
    openai_responses::OpenAIResponsesClient,
    registry::{find_by_name, provider_id},
    thinking_mode::parse_model_variant,
    traits::{ChatOptions, LLMProvider, LLMResponse, ProviderConfig, ProviderError, StreamDelta},
};
use async_trait::async_trait;
use serde_json::Value;
use std::sync::{atomic::AtomicBool, Arc};

pub(super) struct NativeSource;
impl NativeProviderSource for NativeSource {
    fn namespace(&self) -> &'static str {
        "market"
    }
    fn build(&self, selection: &str, model: &str) -> Result<Box<dyn LLMProvider>, ProviderError> {
        Ok(Box::new(NativeProvider::new(
            selection,
            model,
            super::source::instance(),
        )?))
    }
}

struct NativeProvider {
    selection: String,
    model: String,
    wire_model: String,
    protocol: String,
    source: Arc<dyn Source>,
    // One delegate per live native runtime. Tokens remain memory-only; source
    // failures never reach this cache, and a rotated token replaces it.
    delegate: tokio::sync::Mutex<Option<(String, Arc<dyn LLMProvider>)>>,
}
impl NativeProvider {
    fn new(key: &str, model: &str, source: Arc<dyn Source>) -> Result<Self, ProviderError> {
        let selection = Selection::parse(key, "rust_agent").map_err(ProviderError::AuthError)?;
        let wire_model = selection
            .model
            .ok_or_else(|| ProviderError::AuthError("Missing Package model".into()))?;
        if parse_model_variant(model).base_model != wire_model {
            return Err(ProviderError::ModelNotFound(
                "Package selection model mismatch".into(),
            ));
        }
        Ok(Self {
            selection: key.into(),
            model: model.into(),
            wire_model,
            protocol: selection.native_protocol.unwrap(),
            source,
            delegate: tokio::sync::Mutex::new(None),
        })
    }
    async fn provider(&self, model: &str) -> Result<Arc<dyn LLMProvider>, ProviderError> {
        if parse_model_variant(model).base_model != self.wire_model {
            return Err(ProviderError::ModelNotFound(
                "Package session cannot switch to an unselected model".into(),
            ));
        }
        let agent = if self.protocol == "openai_responses" {
            "codex"
        } else {
            "claude_code"
        };
        let credential = self
            .source
            .credential(&self.selection, agent)
            .await
            .map_err(ProviderError::AuthError)?;
        let mut cached = self.delegate.lock().await;
        if let Some((token, provider)) = cached.as_ref() {
            if *token == credential.secret {
                return Ok(Arc::clone(provider));
            }
        }
        let token = credential.secret.clone();
        let config = ProviderConfig {
            api_key: credential.secret,
            api_base: Some(credential.destination.base_url),
            extra_headers: Default::default(),
            is_azure: false,
        };
        let provider: Arc<dyn LLMProvider> = match self.protocol.as_str() {
            "anthropic_messages" => Arc::new(AnthropicClient::new_with_auth_mode(
                config,
                find_by_name(provider_id::ANTHROPIC)
                    .ok_or_else(|| ProviderError::Other("Anthropic provider unavailable".into()))?,
                self.model.clone(),
                AnthropicAuthMode::Bearer,
            )),
            "openai_responses" => Arc::new(OpenAIResponsesClient::new(config, self.model.clone())),
            _ => return Err(ProviderError::Other("Unsupported Package protocol".into())),
        };
        *cached = Some((token, Arc::clone(&provider)));
        Ok(provider)
    }
}
#[async_trait]
impl LLMProvider for NativeProvider {
    async fn chat(
        &self,
        messages: &[Value],
        tools: Option<&[Value]>,
        model: &str,
        max_tokens: u32,
        temperature: f32,
    ) -> Result<LLMResponse, ProviderError> {
        self.provider(model)
            .await?
            .chat(messages, tools, model, max_tokens, temperature)
            .await
    }
    async fn chat_with_options(
        &self,
        messages: &[Value],
        tools: Option<&[Value]>,
        model: &str,
        max_tokens: u32,
        temperature: f32,
        options: ChatOptions,
    ) -> Result<LLMResponse, ProviderError> {
        self.provider(model)
            .await?
            .chat_with_options(messages, tools, model, max_tokens, temperature, options)
            .await
    }
    async fn chat_streaming(
        &self,
        messages: &[Value],
        tools: Option<&[Value]>,
        model: &str,
        max_tokens: u32,
        temperature: f32,
        on_delta: &(dyn Fn(StreamDelta) + Send + Sync),
        cancel_flag: Option<&AtomicBool>,
    ) -> Result<LLMResponse, ProviderError> {
        if cancel_flag.is_some_and(|flag| flag.load(std::sync::atomic::Ordering::Relaxed)) {
            return Err(ProviderError::Cancelled);
        }
        self.provider(model)
            .await?
            .chat_streaming(
                messages,
                tools,
                model,
                max_tokens,
                temperature,
                on_delta,
                cancel_flag,
            )
            .await
    }
    fn credential_source(&self) -> Option<&str> {
        Some(&self.selection)
    }
    fn default_model(&self) -> &str {
        &self.model
    }
    fn provider_name(&self) -> &str {
        "market"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dynamic_credentials::{Authentication, Credential, Destination};
    use std::collections::VecDeque;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    struct Credentials {
        base: String,
        tokens: std::sync::Mutex<VecDeque<Result<String, String>>>,
    }
    impl Source for Credentials {
        fn namespace(&self) -> &'static str {
            "market"
        }
        fn destination(&self, _: &str, agent: &str) -> Result<Destination, String> {
            Ok(Destination {
                provider: "market".into(),
                authentication: Authentication::Bearer,
                base_url: super::super::source::protocol_base_url(&self.base, agent),
            })
        }
        fn credential<'a>(
            &'a self,
            _: &'a str,
            agent: &'a str,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<Credential, String>> + Send + 'a>,
        > {
            Box::pin(async move {
                Ok(Credential {
                    destination: self.destination("", agent)?,
                    secret: self
                        .tokens
                        .lock()
                        .unwrap()
                        .pop_front()
                        .expect("unexpected credential request")?,
                })
            })
        }
    }
    fn selection(protocol: &str, model: &str) -> String {
        Selection {
            metadata: market_connect::ConnectionMetadata {
                identity_user_id: "11111111-1111-4111-8111-111111111111".into(),
                workspace_id: "ws_account".into(),
                target: market_connect::Target::Org2,
            },
            workspace_id: "ws_fixture".into(),
            entitlement_id: "pa_fixture".into(),
            model: Some(model.into()),
            session_id: Some(uuid::Uuid::new_v4().to_string()),
            native_protocol: Some(protocol.into()),
        }
        .key()
        .unwrap()
    }
    async fn capture_server(
        count: usize,
        response: Value,
    ) -> (String, tokio::task::JoinHandle<Vec<(String, Value)>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            let mut captured = vec![];
            for _ in 0..count {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut bytes = Vec::new();
                let (header_end, length) = loop {
                    let mut buf = [0u8; 4096];
                    let n = socket.read(&mut buf).await.unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&buf[..n]);
                    if let Some(end) = bytes.windows(4).position(|s| s == b"\r\n\r\n") {
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
                    let mut buf = [0u8; 4096];
                    let n = socket.read(&mut buf).await.unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&buf[..n]);
                }
                captured.push((
                    String::from_utf8(bytes[..header_end].to_vec()).unwrap(),
                    serde_json::from_slice(&bytes[header_end..header_end + length]).unwrap(),
                ));
                let body = response.to_string();
                socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}", body.len(), body).as_bytes()).await.unwrap();
            }
            captured
        });
        (format!("http://{addr}/p/pa_fixture"), task)
    }

    #[tokio::test]
    async fn selected_native_protocol_keeps_model_and_refreshes_credentials_without_fallback() {
        let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
        for (protocol, model, variant, response, endpoint) in [
            (
                "anthropic_messages",
                "claude-sonnet-4",
                "claude-sonnet-4",
                serde_json::json!({"id":"msg_fixture","type":"message","role":"assistant","model":"claude-sonnet-4","content":[{"type":"text","text":"ok"}],"stop_reason":"end_turn","usage":{"input_tokens":3,"output_tokens":1}}),
                "/v1/messages",
            ),
            (
                "openai_responses",
                "gpt-5.5",
                "gpt-5.5-high",
                serde_json::json!({"id":"resp_fixture","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"ok"}]}],"usage":{"input_tokens":3,"output_tokens":1,"total_tokens":4}}),
                "/v1/responses",
            ),
        ] {
            let (base, capture) = capture_server(2, response).await;
            let source: Arc<dyn Source> = Arc::new(Credentials {
                base,
                tokens: std::sync::Mutex::new(VecDeque::from([
                    Ok("token-first".into()),
                    Ok("token-rotated".into()),
                    Err("authorization revoked".into()),
                ])),
            });
            let key = selection(protocol, model);
            let provider = NativeProvider::new(&key, variant, Arc::clone(&source)).unwrap();
            assert_eq!(provider.credential_source(), Some(key.as_str()));
            assert!(provider.provider("unselected-model").await.is_err());
            let messages = [serde_json::json!({"role":"user","content":"hello"})];
            for _ in 0..2 {
                tokio::time::timeout(
                    std::time::Duration::from_secs(5),
                    provider.chat(&messages, None, variant, 64, 0.0),
                )
                .await
                .unwrap()
                .unwrap();
            }
            assert!(matches!(
                provider.chat(&messages, None, variant, 64, 0.0).await,
                Err(ProviderError::AuthError(_))
            ));
            let requests = tokio::time::timeout(std::time::Duration::from_secs(5), capture)
                .await
                .unwrap()
                .unwrap();
            for (index, (headers, body)) in requests.iter().enumerate() {
                assert!(headers.starts_with(&format!("POST /p/pa_fixture{endpoint} HTTP/1.1")));
                assert!(headers.to_lowercase().contains(
                    &format!(
                        "authorization: Bearer token-{}",
                        if index == 0 { "first" } else { "rotated" }
                    )
                    .to_lowercase()
                ));
                assert!(!headers.to_lowercase().contains("x-api-key:"));
                assert_eq!(body["model"], model);
                if protocol == "openai_responses" {
                    assert_eq!(body["reasoning"]["effort"], "high");
                }
            }
            // Restart reconstructs from only the public selector and refuses
            // a revoked grant even if the old runtime had a successful token.
            let restarted = NativeProvider::new(
                &key,
                variant,
                Arc::new(Credentials {
                    base: "http://127.0.0.1:1".into(),
                    tokens: std::sync::Mutex::new(VecDeque::from([Err(
                        "authorization revoked".into()
                    )])),
                }),
            )
            .unwrap();
            assert!(restarted
                .chat(&messages, None, variant, 64, 0.0)
                .await
                .is_err());
        }
    }
}
