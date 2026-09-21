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

const PARENT: &str = "gpt-6-astra-high";
const BACKUP: &str = "gpt-5.6-terra-medium";
const FAST: &str = "gpt-5.6-luna";

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
            models: vec![FAST.into(), BACKUP.into()],
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
                ("400 Bad Request", "application/json", json!({"detail": "The 'gpt-5.6-luna' model is not supported when using Codex with a ChatGPT account."}).to_string())
            } else {
                assert_eq!(model, "gpt-5.6-terra");
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
            vec![FAST, "gpt-5.6-terra", "gpt-5.6-terra"]
        );
    })
    .await
    .expect("bounded HTTP test");
}

#[tokio::test(flavor = "multi_thread")]
async fn session_memory_exhausted_cheap_models_skip_silently_and_keep_durable_state() {
    let _sandbox = test_helpers::test_env::sandbox();
    let sid = "memory-exhausted-cheap";
    seed(sid);
    unified_persistence::save_session_memory_state(sid, "previous memory", Some(0)).unwrap();
    let state = Arc::new(Mutex::new(SessionMemoryState {
        content: Some("previous memory".into()),
        last_summarized_seq: Some(0),
        ..Default::default()
    }));
    let fixture = provider(vec![
        Err(ProviderError::ModelNotFound("fast".into())),
        Err(ProviderError::ModelNotFound("cheap backup".into())),
    ]);
    assert_eq!(
        run(sid, state.clone(), &fixture, None).await.unwrap(),
        MemoryJobCompletion::Skipped
    );
    assert_eq!(fixture.calls.lock().unwrap().as_slice(), [FAST, BACKUP]);
    assert_eq!(persisted(sid), (Some("previous memory".into()), Some(0)));
    let mut guard = state.lock().await;
    assert_eq!(guard.content.as_deref(), Some("previous memory"));
    assert_eq!(guard.last_summarized_seq, Some(0));
    assert!(!guard.extraction_in_progress);
    let now = std::time::Instant::now();
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
async fn session_memory_single_cheap_selection_never_retries_parent() {
    let _sandbox = test_helpers::test_env::sandbox();
    let sid = "memory-single-cheap";
    seed(sid);
    let before = persisted(sid);
    let state = Arc::new(Mutex::new(SessionMemoryState::default()));
    let mut fixture = provider(vec![Err(ProviderError::ModelNotFound(
        "cheap backup".into(),
    ))]);
    fixture.selection.models = vec![FAST.into()];
    assert_eq!(
        run(sid, state.clone(), &fixture, None).await.unwrap(),
        MemoryJobCompletion::Skipped
    );
    assert_eq!(fixture.calls.lock().unwrap().as_slice(), [FAST]);
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
        // No account is a local factory AuthError, never a remote request.
        // Later turns must skip this same production acquisition path.
        let job = session_memory_job(SessionMemoryExtractionInput {
            session_id: sid,
            agent_id: None,
            current_tokens: 20_000,
            sm_state: Arc::clone(&state),
            sm_config: SessionMemoryConfig::default(),
            fork_provider: ForkProviderSpec {
                credential_source: None,
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

#[tokio::test(flavor = "multi_thread")]
async fn session_memory_no_cheap_candidate_skips_without_request_or_write() {
    let _sandbox = test_helpers::test_env::sandbox();
    let sid = "memory-no-cheap-candidate";
    seed(sid);
    unified_persistence::save_session_memory_state(sid, "previous memory", Some(0)).unwrap();
    let before = persisted(sid);
    let state = Arc::new(Mutex::new(SessionMemoryState {
        content: before.0.clone(),
        last_summarized_seq: before.1,
        ..Default::default()
    }));
    for _ in 0..3 {
        let mut fixture = provider(vec![]);
        fixture.selection.models.clear();
        assert_eq!(
            run(sid, state.clone(), &fixture, None).await.unwrap(),
            MemoryJobCompletion::Skipped
        );
        assert!(fixture.calls.lock().unwrap().is_empty());
        assert_eq!(persisted(sid), before);
        let guard = state.lock().await;
        assert_eq!(guard.content, before.0);
        assert_eq!(guard.last_summarized_seq, before.1);
        assert!(!guard.extraction_in_progress);
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn session_memory_database_failure_preserves_runtime_and_durable_state() {
    let _sandbox = test_helpers::test_env::sandbox();
    let sid = "memory-commit-db-failure";
    seed(sid);
    unified_persistence::save_session_memory_state(sid, "old memory", Some(0)).unwrap();
    let state = Arc::new(Mutex::new(SessionMemoryState {
        content: Some("old memory".into()),
        last_summarized_seq: Some(0),
        tool_calls_since_extraction: 8,
        tokens_at_last_extraction: Some(12_000),
        initialized: true,
        ..Default::default()
    }));
    database::db::get_connection().unwrap().execute_batch(
        "CREATE TRIGGER reject_memory BEFORE UPDATE OF sm_content ON agent_sessions BEGIN SELECT RAISE(FAIL, 'injected memory write failure'); END;"
    ).unwrap();
    let fixture = provider(vec![Ok(LLMResponse::text("### Current State\nnew memory"))]);
    assert!(run(sid, state.clone(), &fixture, None)
        .await
        .unwrap_err()
        .contains("injected memory write failure"));
    assert_eq!(persisted(sid), (Some("old memory".into()), Some(0)));
    let current = state.lock().await;
    assert_eq!(current.content.as_deref(), Some("old memory"));
    assert_eq!(current.last_summarized_seq, Some(0));
    assert_eq!(current.tokens_at_last_extraction, Some(12_000));
    assert_eq!(current.tool_calls_since_extraction, 8);
    assert!(current.initialized);
    assert!(!current.extraction_in_progress);
}

fn commit_update(
    content: &str,
    last_seq: Option<i64>,
) -> unified_persistence::SessionMemoryUpdate<'_> {
    unified_persistence::SessionMemoryUpdate {
        content: Some(content),
        last_seq,
        tokens_at_last_extraction: Some(20_000),
    }
}

fn commit_draft() -> session_memory::extract::SessionMemoryExtraction {
    session_memory::extract::SessionMemoryExtraction {
        content: "new memory".into(),
        last_seq: Some(1),
        expected_content: Some("old memory".into()),
        expected_seq: Some(0),
        current_tokens: 20_000,
        consumed_tool_calls: 8,
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn session_memory_dropped_owner_cancels_already_started_blocking_writer() {
    let _sandbox = test_helpers::test_env::sandbox();
    let sid = "memory-commit-dropped-owner";
    seed(sid);
    unified_persistence::save_session_memory_state(sid, "old memory", Some(0)).unwrap();
    let state = Arc::new(Mutex::new(SessionMemoryState {
        content: Some("old memory".into()),
        last_summarized_seq: Some(0),
        tool_calls_since_extraction: 8,
        ..Default::default()
    }));
    let (held_tx, held_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let holder = std::thread::spawn(move || {
        let _writer = database::db::sessions_writer_guard();
        held_tx.send(()).unwrap();
        release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    });
    held_rx.await.unwrap();
    let (started_tx, started_rx) = tokio::sync::oneshot::channel();
    let worker_state = state.clone();
    let task = tokio::spawn(async move {
        let lease = session_memory_commit::ExtractionLease::begin(worker_state).await;
        started_tx.send(()).unwrap();
        lease
            .commit(
                sid.into(),
                commit_draft(),
                unified_persistence::session_memory_commit_snapshot(sid).unwrap(),
                None,
            )
            .await
    });
    started_rx.await.unwrap();
    // The blocking worker owns the state mutex before waiting for the DB writer.
    tokio::time::timeout(Duration::from_secs(3), async {
        while state.try_lock().is_ok() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    release_tx.send(()).unwrap();
    holder.join().unwrap();
    let current = tokio::time::timeout(Duration::from_secs(3), state.lock())
        .await
        .unwrap();
    assert_eq!(current.content.as_deref(), Some("old memory"));
    assert_eq!(current.tool_calls_since_extraction, 8);
    assert_eq!(persisted(sid), (Some("old memory".into()), Some(0)));
}

#[tokio::test(flavor = "multi_thread")]
async fn session_memory_old_generation_cannot_commit_or_clear_new_owner() {
    let _sandbox = test_helpers::test_env::sandbox();
    let sid = "memory-commit-generation";
    seed(sid);
    unified_persistence::save_session_memory_state(sid, "old memory", Some(0)).unwrap();
    let state = Arc::new(Mutex::new(SessionMemoryState {
        content: Some("old memory".into()),
        last_summarized_seq: Some(0),
        tool_calls_since_extraction: 11,
        ..Default::default()
    }));
    let old = session_memory_commit::ExtractionLease::begin(state.clone()).await;
    let new = session_memory_commit::ExtractionLease::begin(state.clone()).await;
    assert!(!old
        .commit(
            sid.into(),
            commit_draft(),
            unified_persistence::session_memory_commit_snapshot(sid).unwrap(),
            None
        )
        .await
        .unwrap());
    old.finish().await;
    assert!(state.lock().await.extraction_in_progress);
    assert!(new
        .commit(
            sid.into(),
            commit_draft(),
            unified_persistence::session_memory_commit_snapshot(sid).unwrap(),
            None
        )
        .await
        .unwrap());
    new.finish().await;
    let current = state.lock().await;
    assert_eq!(current.content.as_deref(), Some("new memory"));
    assert_eq!(current.last_summarized_seq, Some(1));
    assert_eq!(current.tokens_at_last_extraction, Some(20_000));
    assert_eq!(current.tool_calls_since_extraction, 3);
    assert!(!current.extraction_in_progress);
    assert_eq!(persisted(sid), (Some("new memory".into()), Some(1)));
}

#[test]
fn session_memory_commit_rejects_stale_snapshot_and_missing_session() {
    let _sandbox = test_helpers::test_env::sandbox();
    let sid = "memory-commit-durable-cas";
    seed(sid);
    let snapshot = unified_persistence::session_memory_commit_snapshot(sid).unwrap();
    unified_persistence::save_session_memory_state(sid, "newer memory", Some(10)).unwrap();
    assert!(!unified_persistence::commit_session_memory_state(
        sid,
        commit_update("stale memory", Some(1)),
        &snapshot,
        || false,
        || {},
    )
    .unwrap());
    assert_eq!(persisted(sid), (Some("newer memory".into()), Some(10)));
    assert!(
        unified_persistence::save_session_memory_state("missing-session", "lost", Some(1)).is_err()
    );
    assert!(unified_persistence::commit_session_memory_state(
        "missing-session",
        commit_update("lost", Some(1)),
        &snapshot,
        || false,
        || {},
    )
    .is_err());
}

#[test]
fn session_memory_commit_rejects_changed_history_without_publishing() {
    let _sandbox = test_helpers::test_env::sandbox();
    for transition in ["append", "compact", "truncate"] {
        let sid = format!("memory-history-{transition}");
        seed(&sid);
        unified_persistence::save_session_memory_state(&sid, "old memory", Some(0)).unwrap();
        let snapshot = unified_persistence::session_memory_commit_snapshot(&sid).unwrap();
        match transition {
            "append" => {
                unified_persistence::save_user_msg(&sid, "new turn", None).unwrap();
            }
            "compact" => {
                unified_persistence::append_compact_boundary(&sid, "compacted", 1, None, None)
                    .unwrap();
            }
            "truncate" => {
                unified_persistence::truncate_messages_from_sequence(&sid, 1).unwrap();
            }
            _ => unreachable!(),
        }
        let before = persisted(&sid);
        assert!(!unified_persistence::commit_session_memory_state(
            &sid,
            commit_update("stale summary", Some(1)),
            &snapshot,
            || false,
            || panic!("stale history must not publish runtime state"),
        )
        .unwrap());
        assert_eq!(persisted(&sid), before);
    }
}

#[test]
fn session_memory_writer_admission_is_bounded_without_publishing() {
    let _sandbox = test_helpers::test_env::sandbox();
    let sid = "memory-writer-budget";
    seed(sid);
    let snapshot = unified_persistence::session_memory_commit_snapshot(sid).unwrap();
    let (held_tx, held_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let holder = std::thread::spawn(move || {
        let _writer = database::db::sessions_writer_guard();
        held_tx.send(()).unwrap();
        release_rx.recv_timeout(Duration::from_secs(4)).unwrap();
    });
    held_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    let result = unified_persistence::commit_session_memory_state(
        sid,
        commit_update("new memory", Some(1)),
        &snapshot,
        || false,
        || panic!("a busy writer must not publish"),
    );
    release_tx.send(()).unwrap();
    holder.join().unwrap();
    assert_eq!(
        result.unwrap_err().sqlite_error_code(),
        Some(rusqlite::ErrorCode::DatabaseBusy)
    );
    assert_eq!(persisted(sid), (None, None));
}

fn restored_memory_state(sid: &str) -> SessionMemoryState {
    let saved = unified_persistence::load_session_memory_state(sid).unwrap();
    SessionMemoryState {
        initialized: saved.content.is_some(),
        content: saved.content,
        last_summarized_seq: saved.last_seq,
        tokens_at_last_extraction: saved.tokens_at_last_extraction,
        ..Default::default()
    }
}

#[tokio::test]
async fn session_memory_restart_retains_committed_growth_baseline() {
    let _sandbox = test_helpers::test_env::sandbox();
    let sid = "memory-baseline-restart";
    seed(sid);
    unified_persistence::save_session_memory_state(sid, "old memory", Some(0)).unwrap();
    let state = Arc::new(Mutex::new(restored_memory_state(sid)));
    let lease = session_memory_commit::ExtractionLease::begin(state).await;
    assert!(lease
        .commit(
            sid.into(),
            commit_draft(),
            unified_persistence::session_memory_commit_snapshot(sid).unwrap(),
            None
        )
        .await
        .unwrap());
    lease.finish().await;
    let restored = restored_memory_state(sid);
    assert_eq!(restored.tokens_at_last_extraction, Some(20_000));
    assert_eq!(restored.content.as_deref(), Some("new memory"));
    assert_eq!(restored.last_summarized_seq, Some(1));
    let config = SessionMemoryConfig::default();
    assert!(
        !crate::model_context::session_memory::extract::should_extract(
            &restored, &config, 20_500, false
        )
    );
    assert!(
        crate::model_context::session_memory::extract::should_extract(
            &restored, &config, 25_000, false
        )
    );
}

#[tokio::test]
async fn session_memory_legacy_baseline_and_compaction_rebase_without_summary_write() {
    let _sandbox = test_helpers::test_env::sandbox();
    let sid = "memory-baseline-legacy";
    seed(sid);
    unified_persistence::save_session_memory_state(sid, "old memory", Some(0)).unwrap();
    let state = Arc::new(Mutex::new(restored_memory_state(sid)));
    state.lock().await.tool_calls_since_extraction = 7;
    assert!(prepare_session_memory_baseline(sid, state.clone(), 40_000).await);
    assert_eq!(persisted(sid), (Some("old memory".into()), Some(0)));
    assert_eq!(
        restored_memory_state(sid).tokens_at_last_extraction,
        Some(40_000)
    );
    assert_eq!(state.lock().await.tool_calls_since_extraction, 7);
    // A normal turn must not issue another metadata write.
    database::db::get_connection().unwrap().execute_batch(
        "CREATE TRIGGER reject_baseline BEFORE UPDATE ON agent_sessions BEGIN SELECT RAISE(FAIL, 'unexpected write'); END;"
    ).unwrap();
    assert!(prepare_session_memory_baseline(sid, state.clone(), 40_500).await);
    database::db::get_connection()
        .unwrap()
        .execute_batch("DROP TRIGGER reject_baseline")
        .unwrap();
    unified_persistence::save_session_memory_state(sid, "old memory", None).unwrap();
    state.lock().await.reset_after_compaction();
    assert!(prepare_session_memory_baseline(sid, state.clone(), 8_000).await);
    let restored = restored_memory_state(sid);
    assert_eq!(restored.tokens_at_last_extraction, Some(8_000));
    assert_eq!(restored.last_summarized_seq, None);
    let config = SessionMemoryConfig::default();
    assert!(
        !crate::model_context::session_memory::extract::should_extract(
            &restored, &config, 8_500, false
        )
    );
    assert!(
        crate::model_context::session_memory::extract::should_extract(
            &restored, &config, 13_000, false
        )
    );
}

#[tokio::test]
async fn session_memory_context_shrink_rebases_and_failed_write_preserves_baseline() {
    let _sandbox = test_helpers::test_env::sandbox();
    let sid = "memory-baseline-shrink";
    seed(sid);
    unified_persistence::save_session_memory_state(sid, "old memory", Some(0)).unwrap();
    let state = Arc::new(Mutex::new(restored_memory_state(sid)));
    assert!(prepare_session_memory_baseline(sid, state.clone(), 40_000).await);
    database::db::get_connection().unwrap().execute_batch(
        "CREATE TRIGGER reject_baseline BEFORE UPDATE ON agent_sessions BEGIN SELECT RAISE(FAIL, 'injected failure'); END;"
    ).unwrap();
    assert!(!prepare_session_memory_baseline(sid, state.clone(), 8_000).await);
    assert_eq!(state.lock().await.tokens_at_last_extraction, Some(40_000));
    assert_eq!(
        restored_memory_state(sid).tokens_at_last_extraction,
        Some(40_000)
    );
    database::db::get_connection()
        .unwrap()
        .execute_batch("DROP TRIGGER reject_baseline")
        .unwrap();
    assert!(prepare_session_memory_baseline(sid, state.clone(), 8_000).await);
    assert_eq!(
        restored_memory_state(sid).tokens_at_last_extraction,
        Some(8_000)
    );
    assert_eq!(persisted(sid), (Some("old memory".into()), Some(0)));
}

#[test]
fn session_memory_baseline_change_invalidates_old_commit_snapshot() {
    let _sandbox = test_helpers::test_env::sandbox();
    let sid = "memory-baseline-cas";
    seed(sid);
    unified_persistence::save_session_memory_state(sid, "old memory", Some(0)).unwrap();
    let snapshot = unified_persistence::session_memory_commit_snapshot(sid).unwrap();
    assert!(unified_persistence::commit_session_memory_state(
        sid,
        commit_update("old memory", Some(0)),
        &snapshot,
        || false,
        || {},
    )
    .unwrap());
    assert!(!unified_persistence::commit_session_memory_state(
        sid,
        commit_update("stale memory", Some(1)),
        &snapshot,
        || false,
        || panic!("baseline changed while extraction was running"),
    )
    .unwrap());
    assert_eq!(persisted(sid), (Some("old memory".into()), Some(0)));
    assert_eq!(
        restored_memory_state(sid).tokens_at_last_extraction,
        Some(20_000)
    );
}
