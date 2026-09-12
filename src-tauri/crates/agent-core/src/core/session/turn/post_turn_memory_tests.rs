use super::*;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex as StdMutex;

use crate::providers::auxiliary_model::AuxiliaryModel;
use crate::providers::codex_native::CodexNativeClient;
use crate::providers::reliable::ReliableProvider;
use crate::providers::traits::{LLMResponse, ProviderConfig, ProviderError};

const PARENT: &str = "gpt-5.6-luna-medium";
const FAST: &str = "gpt-5.4-mini";

struct MemoryProvider {
    selection: AuxiliaryModel,
    calls: Arc<StdMutex<Vec<String>>>,
    results: StdMutex<VecDeque<Result<LLMResponse, ProviderError>>>,
    transport: Option<CodexNativeClient>,
    cancel_on_call: Option<Arc<AtomicBool>>,
}

#[async_trait]
impl LLMProvider for MemoryProvider {
    async fn chat(
        &self,
        messages: &[Value],
        tools: Option<&[Value]>,
        model: &str,
        max_tokens: u32,
        temperature: f32,
    ) -> Result<LLMResponse, ProviderError> {
        self.calls.lock().unwrap().push(model.into());
        if let Some(flag) = &self.cancel_on_call {
            flag.store(true, Ordering::SeqCst);
        }
        if let Some(transport) = &self.transport {
            transport
                .chat(messages, tools, model, max_tokens, temperature)
                .await
        } else {
            self.results
                .lock()
                .unwrap()
                .pop_front()
                .expect("unexpected additional request")
        }
    }
    fn default_model(&self) -> &str {
        PARENT
    }
    fn provider_name(&self) -> &str {
        "memory-fixture"
    }
    fn auxiliary_model(&self, _: &str) -> AuxiliaryModel {
        self.selection.clone()
    }
}

fn provider(results: Vec<Result<LLMResponse, ProviderError>>) -> MemoryProvider {
    MemoryProvider {
        selection: AuxiliaryModel {
            model: FAST.into(),
            scope: 42,
        },
        calls: Arc::new(StdMutex::new(Vec::new())),
        results: StdMutex::new(results.into()),
        transport: None,
        cancel_on_call: None,
    }
}

fn seed(session_id: &str) {
    super::tests::seed_agent_session(session_id);
    unified_persistence::save_user_msg(session_id, "Summarize this work", None).unwrap();
    unified_persistence::save_assistant_msg(session_id, "Work completed", PARENT).unwrap();
}

fn persisted(session_id: &str) -> (Option<String>, Option<i64>) {
    database::db::get_connection()
        .unwrap()
        .query_row(
            "SELECT sm_content, sm_last_seq FROM agent_sessions WHERE session_id = ?1",
            [session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap()
}

async fn run(
    session_id: &str,
    state: Arc<Mutex<SessionMemoryState>>,
    provider: &dyn LLMProvider,
    cancel: Option<&Arc<AtomicBool>>,
) -> Result<MemoryJobCompletion, String> {
    extract_and_persist_session_memory(
        session_id,
        state,
        &SessionMemoryConfig::default(),
        provider,
        PARENT,
        20_000,
        cancel,
    )
    .await
}

#[tokio::test(flavor = "multi_thread")]
async fn session_memory_http_rejection_falls_back_and_persists_across_fresh_providers() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let _sandbox = test_helpers::test_env::sandbox();
    crate::test_support::install_crypto_provider_for_tests();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!(
        "http://{}/backend-api/codex",
        listener.local_addr().unwrap()
    );
    let server = tokio::spawn(async move {
        let mut models = Vec::new();
        for _ in 0..3 {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = Vec::new();
            let (end, length) = loop {
                let mut buffer = [0; 4096];
                let n = socket.read(&mut buffer).await.unwrap();
                assert!(n > 0 && bytes.len() + n < 131_072);
                bytes.extend_from_slice(&buffer[..n]);
                if let Some(end) = bytes.windows(4).position(|b| b == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                    assert!(headers.starts_with("post /backend-api/codex/responses "));
                    assert!(headers.contains("authorization: bearer fixture-token"));
                    let length: usize = headers
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length:"))
                        .unwrap()
                        .trim()
                        .parse()
                        .unwrap();
                    break (end + 4, length);
                }
            };
            while bytes.len() < end + length {
                let mut buffer = [0; 4096];
                let n = socket.read(&mut buffer).await.unwrap();
                assert!(n > 0 && bytes.len() + n < 131_072);
                bytes.extend_from_slice(&buffer[..n]);
            }
            let body: Value = serde_json::from_slice(&bytes[end..end + length]).unwrap();
            let model = body["model"].as_str().unwrap().to_owned();
            models.push(model.clone());
            let (status, content_type, response) = if model == FAST {
                ("400 Bad Request", "application/json", json!({"detail": "The 'gpt-5.4-mini' model is not supported when using Codex with a ChatGPT account."}).to_string())
            } else {
                assert_eq!(model, "gpt-5.6-luna");
                assert_eq!(body["reasoning"]["effort"], "medium");
                assert!(body.get("max_output_tokens").is_none());
                assert!(body.get("temperature").is_none());
                let delta = json!({"type":"response.output_text.delta", "delta":"### Current State\nWork completed"});
                let done = json!({"type":"response.completed","response":{"id":"fixture","status":"completed","output":[],"usage":{"input_tokens":10,"output_tokens":10}}});
                (
                    "200 OK",
                    "text/event-stream",
                    format!("data: {delta}\n\ndata: {done}\n\n"),
                )
            };
            socket.write_all(format!("HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}", response.len()).as_bytes()).await.unwrap();
        }
        models
    });
    let sid = "memory-http-fallback";
    seed(sid);
    let state = Arc::new(Mutex::new(SessionMemoryState::default()));
    let original = persisted(sid);
    tokio::time::timeout(Duration::from_secs(15), async {
        for turn in 0..2 {
            let mut fixture = provider(vec![]);
            fixture.transport = Some(CodexNativeClient::new(
                ProviderConfig {
                    api_key: "fixture-token".into(),
                    api_base: Some(endpoint.clone()),
                    extra_headers: Default::default(),
                    is_azure: false,
                },
                PARENT.into(),
            ));
            // Exercise typed-error propagation through the production wrapper.
            let wrapped = ReliableProvider::single("fixture".into(), Box::new(fixture), 3, 50);
            if turn == 1 {
                unified_persistence::save_assistant_msg(sid, "More completed work", PARENT)
                    .unwrap();
            }
            assert_eq!(
                run(sid, state.clone(), &wrapped, None).await.unwrap(),
                MemoryJobCompletion::Completed
            );
            let row = persisted(sid);
            assert_eq!(row.0.as_deref(), Some("### Current State\nWork completed"));
            assert!(row.1 > original.1);
            assert_eq!(
                row.1,
                unified_persistence::load_llm_history_text_only(sid)
                    .unwrap()
                    .1
                    .last()
                    .copied()
            );
            assert!(!state.lock().await.extraction_in_progress);
        }
        assert_eq!(
            server.await.unwrap(),
            vec![FAST, "gpt-5.6-luna", "gpt-5.6-luna"]
        );
    })
    .await
    .expect("bounded HTTP test");
}

#[tokio::test(flavor = "multi_thread")]
async fn session_memory_failed_parent_keeps_durable_state_and_cools_down() {
    let _sandbox = test_helpers::test_env::sandbox();
    let sid = "memory-failed-parent";
    seed(sid);
    unified_persistence::save_session_memory_state(sid, "previous memory", Some(0)).unwrap();
    let state = Arc::new(Mutex::new(SessionMemoryState {
        content: Some("previous memory".into()),
        last_summarized_seq: Some(0),
        ..Default::default()
    }));
    let fixture = provider(vec![
        Err(ProviderError::ModelNotFound("fast".into())),
        Err(ProviderError::ModelNotFound("parent".into())),
    ]);
    assert!(run(sid, state.clone(), &fixture, None).await.is_err());
    assert_eq!(fixture.calls.lock().unwrap().as_slice(), [FAST, PARENT]);
    assert_eq!(persisted(sid), (Some("previous memory".into()), Some(0)));
    let mut guard = state.lock().await;
    assert_eq!(guard.content.as_deref(), Some("previous memory"));
    assert_eq!(guard.last_summarized_seq, Some(0));
    assert!(!guard.extraction_in_progress);
    let now = std::time::Instant::now();
    assert!(guard
        .auxiliary_retry
        .take_warning(now)
        .unwrap()
        .contains("unavailable"));
    assert!(guard.auxiliary_retry.take_warning(now).is_none());
    drop(guard);
    // A fresh connection on the next eligible turn must issue no requests.
    let next = provider(vec![]);
    assert_eq!(
        run(sid, state, &next, None).await.unwrap(),
        MemoryJobCompletion::Skipped
    );
    assert!(next.calls.lock().unwrap().is_empty());
    assert_eq!(persisted(sid), (Some("previous memory".into()), Some(0)));
}

#[tokio::test(flavor = "multi_thread")]
async fn session_memory_does_not_fallback_for_other_errors_or_cancellation() {
    let _sandbox = test_helpers::test_env::sandbox();
    for (idx, error) in [
        ProviderError::RequestFailed("HTTP 400: invalid tool schema".into()),
        ProviderError::AuthError("bad account".into()),
        ProviderError::RateLimited {
            message: "slow down".into(),
            retry_after_secs: None,
        },
        ProviderError::Cancelled,
    ]
    .into_iter()
    .enumerate()
    {
        let sid = format!("memory-no-fallback-{idx}");
        seed(&sid);
        let before = persisted(&sid);
        let state = Arc::new(Mutex::new(SessionMemoryState::default()));
        let fixture = provider(vec![Err(error)]);
        assert!(run(&sid, state.clone(), &fixture, None).await.is_err());
        assert_eq!(fixture.calls.lock().unwrap().len(), 1);
        assert_eq!(persisted(&sid), before);
        assert!(!state.lock().await.extraction_in_progress);
    }
    let sid = "memory-cancel-before-fallback";
    seed(sid);
    let flag = Arc::new(AtomicBool::new(false));
    let mut fixture = provider(vec![Err(ProviderError::ModelNotFound("fast".into()))]);
    fixture.cancel_on_call = Some(flag.clone());
    assert!(run(
        sid,
        Arc::new(Mutex::new(SessionMemoryState::default())),
        &fixture,
        Some(&flag)
    )
    .await
    .is_err());
    assert_eq!(fixture.calls.lock().unwrap().as_slice(), [FAST]);
}

#[tokio::test(flavor = "multi_thread")]
async fn session_memory_parent_selection_has_no_redundant_model_retry() {
    let _sandbox = test_helpers::test_env::sandbox();
    let sid = "memory-parent-only";
    seed(sid);
    let before = persisted(sid);
    let state = Arc::new(Mutex::new(SessionMemoryState::default()));
    let mut fixture = provider(vec![Err(ProviderError::ModelNotFound("parent".into()))]);
    fixture.selection.model = PARENT.into();
    assert!(run(sid, state.clone(), &fixture, None).await.is_err());
    assert_eq!(fixture.calls.lock().unwrap().as_slice(), [PARENT]);
    assert_eq!(persisted(sid), before);
    assert!(!state.lock().await.extraction_in_progress);
}

#[tokio::test(flavor = "multi_thread")]
async fn session_memory_preflight_auth_failure_cools_down_before_acquisition() {
    use crate::providers::factory::ensure_account_key_fresh_with_service;
    use key_vault::key_store::{KeyService, ModelKey, ModelType};
    use std::sync::atomic::AtomicUsize;

    let _sandbox = test_helpers::test_env::sandbox();
    let dir = tempfile::tempdir().unwrap();
    let service = KeyService::new(Some(dir.path().into()));
    let mut key = ModelKey::new(ModelType::ClaudeCode);
    key.auth_method = key_vault::AuthMethod::Oauth;
    // Missing access/refresh tokens make the real factory preflight fail
    // locally, before client construction or any HTTP request.
    let key = service.save_key(key).unwrap();
    let sid = "memory-preflight-auth-failure";
    seed(sid);
    unified_persistence::save_session_memory_state(sid, "previous memory", Some(0)).unwrap();
    let before = persisted(sid);
    let state = Arc::new(Mutex::new(SessionMemoryState {
        content: before.0.clone(),
        last_summarized_seq: before.1,
        extraction_in_progress: true,
        ..Default::default()
    }));
    let acquisitions = AtomicUsize::new(0);
    for turn in 0..3 {
        let result = acquire_session_memory_provider(&state, 42, async {
            acquisitions.fetch_add(1, Ordering::SeqCst);
            ensure_account_key_fresh_with_service(&service, Some(&key.id)).await?;
            panic!("invalid OAuth fixture must not construct a provider");
        })
        .await;
        if turn == 0 {
            assert!(matches!(result, Err(ProviderError::AuthError(_))));
        } else {
            assert!(matches!(result, Ok(None)));
        }
        assert_eq!(acquisitions.load(Ordering::SeqCst), 1);
        assert_eq!(persisted(sid), before);
        let mut state = state.lock().await;
        assert_eq!(state.content, before.0);
        assert_eq!(state.last_summarized_seq, before.1);
        assert!(!state.extraction_in_progress);
        let warning = state
            .auxiliary_retry
            .take_warning(std::time::Instant::now());
        if turn == 0 {
            assert!(warning.unwrap().contains("authenticate"));
        } else {
            assert!(warning.is_none());
        }
    }
    // A changed account/endpoint route bypasses the failed route's cooldown.
    let next = acquire_session_memory_provider(&state, 43, async {
        acquisitions.fetch_add(1, Ordering::SeqCst);
        let response =
            serde_json::from_value(json!({"content": "### Current State\nRecovered memory"}))
                .unwrap();
        Ok(Arc::new(provider(vec![Ok(response)])) as Arc<dyn LLMProvider>)
    })
    .await
    .unwrap();
    run(sid, state.clone(), next.unwrap().as_ref(), None)
        .await
        .unwrap();
    assert_eq!(
        persisted(sid).0.as_deref(),
        Some("### Current State\nRecovered memory")
    );
    assert!(persisted(sid).1 > before.1);
    assert!(!state.lock().await.extraction_in_progress);
    assert_eq!(acquisitions.load(Ordering::SeqCst), 2);
}

#[tokio::test(flavor = "multi_thread")]
async fn session_memory_chat_auth_cooldown_also_skips_fresh_provider_acquisition() {
    let _sandbox = test_helpers::test_env::sandbox();
    let sid = "memory-chat-auth-acquisition";
    seed(sid);
    let before = persisted(sid);
    let state = Arc::new(Mutex::new(SessionMemoryState::default()));
    let first = acquire_session_memory_provider(&state, 42, async {
        Ok(Arc::new(provider(vec![Err(ProviderError::AuthError(
            "fixture".into(),
        ))])) as Arc<dyn LLMProvider>)
    })
    .await
    .unwrap()
    .unwrap();
    assert!(run(sid, state.clone(), first.as_ref(), None).await.is_err());
    let next = acquire_session_memory_provider(&state, 42, async {
        panic!("chat auth cooldown must also suppress provider preflight");
    })
    .await
    .unwrap();
    assert!(next.is_none());
    assert_eq!(persisted(sid), before);
}

#[tokio::test(flavor = "multi_thread")]
async fn session_memory_cooldown_jobs_are_skipped_not_completed() {
    let _sandbox = test_helpers::test_env::sandbox();
    let sid = "memory-cooldown-accounting";
    seed(sid);
    unified_persistence::save_session_memory_state(sid, "previous memory", Some(0)).unwrap();
    let before = persisted(sid);
    let state = Arc::new(Mutex::new(SessionMemoryState {
        content: before.0.clone(),
        last_summarized_seq: before.1,
        ..Default::default()
    }));

    for turn in 0..3 {
        state.lock().await.extraction_in_progress = true;
        // No account is a local factory AuthError, never a remote request.
        // Later turns must skip this same production acquisition path.
        let job = session_memory_job(SessionMemoryExtractionInput {
            session_id: sid,
            agent_id: None,
            current_tokens: 20_000,
            sm_state: Arc::clone(&state),
            sm_config: SessionMemoryConfig::default(),
            fork_provider: ForkProviderSpec {
                model: PARENT.into(),
                account_id: None,
                reliability: ReliabilityConfig::default(),
                native_harness_type: None,
                workspace: SessionWorkspace::new(std::env::temp_dir()),
            },
        });
        let metrics = tokio::time::timeout(
            Duration::from_secs(5),
            crate::memory::background::run_memory_job_for_test(job),
        )
        .await
        .expect("local auth failure and cooldown jobs must finish promptly");
        assert_eq!(metrics.started, 1);
        assert_eq!(metrics.completed, 0);
        assert_eq!(metrics.failed, u64::from(turn == 0));
        assert_eq!(metrics.skipped, u64::from(turn > 0));
        assert_eq!(metrics.cancelled + metrics.timed_out, 0);
        assert_eq!(persisted(sid), before);
        let guard = state.lock().await;
        assert_eq!(guard.content, before.0);
        assert_eq!(guard.last_summarized_seq, before.1);
        assert!(
            !guard.extraction_in_progress,
            "cleanup must run for skipped jobs"
        );
    }
}
