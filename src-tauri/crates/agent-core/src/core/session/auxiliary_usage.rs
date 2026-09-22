//! Transparent provider decorator for auxiliary calls. Immutable attribution
//! follows the provider through spawned jobs, without ambient/task-local state.
//! Every returned response is persisted before a parser retry or a later tool
//! failure/cancellation can discard its usage. Foreground providers are untouched.
use std::sync::{atomic::AtomicBool, Arc};

use crate::foundation::session_bridge::{self, AuxiliaryUsageRow};
use crate::providers::traits::LLMResponse;
use crate::providers::traits::{ChatOptions, ProviderError, SideQueryExecution, StreamDelta};
use crate::providers::LLMProvider;
use async_trait::async_trait;
use serde_json::Value;

pub(crate) struct AuxiliaryUsageProvider<'a> {
    provider: ProviderHandle<'a>,
    session_id: String,
    purpose: &'static str,
    account_id: Option<String>,
}

enum ProviderHandle<'a> {
    Borrowed(&'a dyn LLMProvider),
    Owned(Arc<dyn LLMProvider>),
}

impl<'a> AuxiliaryUsageProvider<'a> {
    pub(crate) fn borrowed(
        provider: &'a dyn LLMProvider,
        session_id: &str,
        purpose: &'static str,
        account_id: Option<&str>,
    ) -> Self {
        Self {
            provider: ProviderHandle::Borrowed(provider),
            session_id: session_id.into(),
            purpose,
            account_id: account_id.map(str::to_owned),
        }
    }
    fn inner(&self) -> &dyn LLMProvider {
        match &self.provider {
            ProviderHandle::Borrowed(p) => *p,
            ProviderHandle::Owned(p) => p.as_ref(),
        }
    }
    async fn record(&self, model: &str, result: &Result<LLMResponse, ProviderError>) {
        let Ok(response) = result else {
            return;
        };
        if response.usage.is_empty() {
            return;
        }
        let row = AuxiliaryUsageRow {
            response_id: uuid::Uuid::new_v4().to_string(),
            credential_source: self.inner().credential_source().map(str::to_owned),
            session_id: self.session_id.clone(),
            purpose: self.purpose.to_owned(),
            model: model.to_owned(),
            account_id: self.account_id.clone(),
            provider: self.inner().provider_name().to_owned(),
            usage: response.usage.clone(),
        };
        // Starts before the next await. Cancelling the caller cannot cancel a
        // write already handed to the blocking pool; no retry loop is created.
        let result =
            tokio::task::spawn_blocking(move || session_bridge::record_auxiliary_usage(&row)).await;
        match result {
            Ok(Ok(())) => {}
            error => {
                tracing::error!(?error, session_id = %self.session_id, "failed to persist auxiliary response usage")
            }
        }
    }
}
impl AuxiliaryUsageProvider<'static> {
    pub(crate) fn owned(
        provider: Arc<dyn LLMProvider>,
        session_id: &str,
        purpose: &'static str,
        account_id: Option<&str>,
    ) -> Self {
        Self {
            provider: ProviderHandle::Owned(provider),
            session_id: session_id.into(),
            purpose,
            account_id: account_id.map(str::to_owned),
        }
    }
}

#[async_trait]
impl LLMProvider for AuxiliaryUsageProvider<'_> {
    async fn chat(
        &self,
        messages: &[Value],
        tools: Option<&[Value]>,
        model: &str,
        max_tokens: u32,
        temperature: f32,
    ) -> Result<LLMResponse, ProviderError> {
        let result = self
            .inner()
            .chat(messages, tools, model, max_tokens, temperature)
            .await;
        self.record(model, &result).await;
        result
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
        let result = self
            .inner()
            .chat_with_options(messages, tools, model, max_tokens, temperature, options)
            .await;
        self.record(model, &result).await;
        result
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
        let result = self
            .inner()
            .chat_streaming(
                messages,
                tools,
                model,
                max_tokens,
                temperature,
                on_delta,
                cancel_flag,
            )
            .await;
        self.record(model, &result).await;
        result
    }
    fn auxiliary_model(&self, model: &str) -> crate::providers::auxiliary_model::AuxiliaryModel {
        self.inner().auxiliary_model(model)
    }
    fn credential_source(&self) -> Option<&str> {
        self.inner().credential_source()
    }
    fn default_model(&self) -> &str {
        self.inner().default_model()
    }
    fn provider_name(&self) -> &str {
        self.inner().provider_name()
    }
    fn set_session_context(&self, session_id: &str) {
        self.inner().set_session_context(session_id);
    }
    fn begin_logical_turn(&self, session_id: &str, turn_id: &str) {
        self.inner().begin_logical_turn(session_id, turn_id);
    }
    fn side_query_execution(&self) -> SideQueryExecution {
        self.inner().side_query_execution()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::{reliable::ReliableProvider, usage_key};
    use std::collections::VecDeque;
    use std::sync::{Mutex, OnceLock};
    static ROWS: OnceLock<Mutex<Vec<AuxiliaryUsageRow>>> = OnceLock::new();
    fn capture(row: &AuxiliaryUsageRow) -> rusqlite::Result<()> {
        ROWS.get_or_init(Default::default)
            .lock()
            .unwrap()
            .push(row.clone());
        Ok(())
    }
    struct Fake(Mutex<VecDeque<Result<LLMResponse, ProviderError>>>);
    #[async_trait]
    impl LLMProvider for Fake {
        async fn chat(
            &self,
            _: &[Value],
            _: Option<&[Value]>,
            _: &str,
            _: u32,
            _: f32,
        ) -> Result<LLMResponse, ProviderError> {
            let response = self.0.lock().unwrap().pop_front().unwrap();
            tokio::spawn(async move { response }).await.unwrap()
        }
        fn default_model(&self) -> &str {
            "fixture-model"
        }
        fn provider_name(&self) -> &str {
            "fixture"
        }
        fn credential_source(&self) -> Option<&str> {
            Some("fixture-source")
        }
    }
    fn response(text: &str) -> LLMResponse {
        let mut response = LLMResponse::text(text);
        response.usage = [
            (usage_key::PROMPT_TOKENS.into(), 10),
            (usage_key::COMPLETION_TOKENS.into(), 2),
            (usage_key::CACHE_READ_TOKENS.into(), 70),
            (usage_key::CACHE_WRITE_TOKENS.into(), 20),
        ]
        .into();
        response
    }
    fn fake(responses: Vec<Result<LLMResponse, ProviderError>>) -> Arc<dyn LLMProvider> {
        Arc::new(Fake(Mutex::new(responses.into())))
    }

    #[tokio::test]
    async fn auxiliary_provider_records_direct_and_reliable_calls_without_scope_leaks() {
        session_bridge::register_record_auxiliary_usage(capture);
        let title_sid = format!("title-{}", uuid::Uuid::new_v4());
        let memory_sid = format!("memory-{}", uuid::Uuid::new_v4());
        let title_inner = ReliableProvider::single(
            "fixture".into(),
            Box::new(Fake(Mutex::new(
                vec![Ok(response("")), Ok(response("A title"))].into(),
            ))),
            0,
            1,
        );
        let title_provider = AuxiliaryUsageProvider::borrowed(
            &title_inner,
            &title_sid,
            "session_title",
            Some("title-account"),
        );
        // Direct dynamic/native providers have no ReliableProvider layer.
        let shared = fake(vec![
            Ok(response("first iteration")),
            Err(ProviderError::Cancelled),
            Ok(response("main")),
        ]);
        let memory_provider = AuxiliaryUsageProvider::owned(
            shared.clone(),
            &memory_sid,
            "workspace_memory",
            Some("memory-account"),
        );
        let memory = tokio::spawn(async move {
            let on_delta = |_: StreamDelta| {};
            memory_provider
                .chat_streaming(&[], None, "fixture-model", 128, 0.0, &on_delta, None)
                .await
                .unwrap();
            memory_provider
                .chat(&[], None, "fixture-model", 128, 0.0)
                .await
        });
        let title = crate::session::title::generate_session_title(
            &title_provider,
            "fixture-model",
            Some("title-account"),
            "a request",
        )
        .await;
        assert_eq!(title.unwrap(), "A title");
        assert!(matches!(
            memory.await.unwrap(),
            Err(ProviderError::Cancelled)
        ));
        shared
            .chat(&[], None, "fixture-model", 128, 0.0)
            .await
            .unwrap();
        let rows = ROWS.get().unwrap().lock().unwrap();
        let title_rows: Vec<_> = rows.iter().filter(|r| r.session_id == title_sid).collect();
        let memory_rows: Vec<_> = rows.iter().filter(|r| r.session_id == memory_sid).collect();
        assert_eq!(
            title_rows.len(),
            2,
            "both actual side-query responses survive parser retry"
        );
        assert_eq!(
            memory_rows.len(),
            1,
            "completed response survives later cancellation; shared main provider is untouched"
        );
        assert_ne!(title_rows[0].response_id, title_rows[1].response_id);
        assert!(title_rows
            .iter()
            .all(|r| r.account_id.as_deref() == Some("title-account")));
        assert_eq!(memory_rows[0].account_id.as_deref(), Some("memory-account"));
        assert_eq!(
            memory_rows[0].credential_source.as_deref(),
            Some("fixture-source")
        );
        assert_eq!(memory_rows[0].usage[usage_key::CACHE_READ_TOKENS], 70);
    }

    #[tokio::test]
    async fn direct_anthropic_http_response_reaches_auxiliary_receipt_with_cache_lifetime() {
        use crate::providers::{
            anthropic_native::AnthropicClient,
            registry::{find_by_name, provider_id},
            traits::ProviderConfig,
        };
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        session_bridge::register_record_auxiliary_usage(capture);
        crate::test_support::install_crypto_provider_for_tests();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut received = Vec::new();
            let mut buf = [0u8; 4096];
            loop {
                let n = stream.read(&mut buf).await.unwrap();
                assert!(n > 0);
                received.extend_from_slice(&buf[..n]);
                assert!(received.len() < 131_072);
                if let Some(end) = received.windows(4).position(|w| w == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&received[..end]).to_lowercase();
                    let length: usize = headers
                        .lines()
                        .find_map(|l| l.strip_prefix("content-length:").map(str::trim))
                        .unwrap()
                        .parse()
                        .unwrap();
                    if received.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            let body = r#"{"id":"fixture","type":"message","role":"assistant","model":"claude-sonnet-5","content":[{"type":"text","text":"ok"}],"stop_reason":"end_turn","usage":{"input_tokens":2,"output_tokens":242,"cache_read_input_tokens":7067,"cache_creation_input_tokens":518,"cache_creation":{"ephemeral_1h_input_tokens":518,"ephemeral_5m_input_tokens":0}}}"#;
            let http = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
            stream.write_all(http.as_bytes()).await.unwrap();
        });
        let client = AnthropicClient::new(
            ProviderConfig {
                api_key: "fixture-only".into(),
                api_base: Some(format!("http://{addr}")),
                extra_headers: Default::default(),
                is_azure: false,
            },
            find_by_name(provider_id::CUSTOM).unwrap(),
            "claude-sonnet-5".into(),
        );
        let sid = format!("http-{}", uuid::Uuid::new_v4());
        let wrapped =
            AuxiliaryUsageProvider::owned(Arc::new(client), &sid, "workspace_memory", None);
        let result = wrapped
            .chat_with_options(
                &[serde_json::json!({"role":"user","content":"fixture"})],
                None,
                "claude-sonnet-5",
                128,
                0.0,
                ChatOptions {
                    skip_cache_write: true,
                },
            )
            .await
            .unwrap();
        assert_eq!(result.content.as_deref(), Some("ok"));
        server.await.unwrap();
        let rows = ROWS.get().unwrap().lock().unwrap();
        let matching: Vec<_> = rows.iter().filter(|r| r.session_id == sid).collect();
        assert_eq!(matching.len(), 1);
        assert_eq!(matching[0].usage[usage_key::PROMPT_TOKENS], 2);
        assert_eq!(matching[0].usage[usage_key::CACHE_WRITE_TOKENS], 518);
        assert_eq!(matching[0].usage["cache_write_1h_tokens"], 518);
        assert_eq!(matching[0].usage["cache_write_5m_tokens"], 0);
    }
    #[tokio::test]
    async fn responses_http_cache_usage_reaches_auxiliary_receipt_without_double_counting() {
        use crate::providers::{openai_responses::OpenAIResponsesClient, traits::ProviderConfig};
        use wiremock::{
            matchers::{method, path},
            Mock, MockServer, ResponseTemplate,
        };
        session_bridge::register_record_auxiliary_usage(capture);
        crate::test_support::install_crypto_provider_for_tests();
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/responses"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "output": [{"type":"message", "content":[{"type":"output_text", "text":"ok"}]}],
                "usage": {"input_tokens":4544, "output_tokens":265, "total_tokens":4809,
                          "input_tokens_details":{"cached_tokens":3584}}
            })))
            .expect(1)
            .mount(&server)
            .await;
        let client = OpenAIResponsesClient::new(
            ProviderConfig {
                api_key: "fixture-only".into(),
                api_base: Some(server.uri()),
                extra_headers: Default::default(),
                is_azure: false,
            },
            "gpt-5.6-luna".into(),
        );
        let sid = format!("responses-cache-{}", uuid::Uuid::new_v4());
        let wrapped =
            AuxiliaryUsageProvider::owned(Arc::new(client), &sid, "workspace_memory", None);
        let result = wrapped
            .chat_with_options(
                &[serde_json::json!({"role":"user", "content":"fixture"})],
                None,
                "gpt-5.6-luna",
                128,
                0.0,
                ChatOptions {
                    skip_cache_write: true,
                },
            )
            .await
            .unwrap();
        assert_eq!(result.content.as_deref(), Some("ok"));
        let rows = ROWS.get().unwrap().lock().unwrap();
        let matching: Vec<_> = rows.iter().filter(|row| row.session_id == sid).collect();
        assert_eq!(matching.len(), 1);
        assert_eq!(matching[0].purpose, "workspace_memory");
        assert_eq!(matching[0].usage[usage_key::PROMPT_TOKENS], 960);
        assert_eq!(matching[0].usage[usage_key::CACHE_READ_TOKENS], 3584);
        assert_eq!(matching[0].usage[usage_key::COMPLETION_TOKENS], 265);
        assert_eq!(matching[0].usage[usage_key::TOTAL_TOKENS], 4809);
    }
}
