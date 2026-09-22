//! Exercises reactive compaction and the real durable summary commit together.
use super::*;
use crate::definitions::{resolved::ResolvedAgent, AgentDefinition};
use crate::memory::background::MemoryJobCompletion;
use crate::providers::{
    auxiliary_model::AuxiliaryModel,
    traits::{LLMProvider, LLMResponse, ProviderError},
};
use crate::session::turn::post_turn::extract_and_persist_session_memory;
use crate::state::{AgentSession, SessionRuntime};
use async_trait::async_trait;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

struct FixtureProvider {
    calls: AtomicUsize,
    fail: bool,
}
#[async_trait]
impl LLMProvider for FixtureProvider {
    async fn chat(
        &self,
        _: &[Value],
        _: Option<&[Value]>,
        _: &str,
        _: u32,
        _: f32,
    ) -> Result<LLMResponse, ProviderError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self.fail {
            Err(ProviderError::RequestFailed(
                "injected compaction failure".into(),
            ))
        } else {
            Ok(LLMResponse::text(
                "### Current State\nNew committed summary",
            ))
        }
    }
    fn default_model(&self) -> &str {
        "test/model"
    }
    fn provider_name(&self) -> &str {
        "reactive-fixture"
    }
    fn auxiliary_model(&self, _: &str) -> AuxiliaryModel {
        AuxiliaryModel {
            models: vec!["test/cheap".into()],
            scope: 17,
        }
    }
}

fn fixture(sid: &str, fail: bool) -> (UnifiedMessageProcessor, Arc<FixtureProvider>) {
    let conn = database::db::get_connection().unwrap();
    crate::persistence::test_schema::ensure_agent_sessions_schema(&conn);
    crate::persistence::session_snapshots::ensure_tables_with(&conn).unwrap();
    conn.execute("INSERT INTO agent_sessions (session_id,name,session_type,status,created_at,updated_at) VALUES (?1,'Reactive fixture','agent','running',datetime('now'),datetime('now'))", [sid]).unwrap();
    for i in 0..4 {
        unified_persistence::save_user_msg(
            sid,
            &format!("turn {i}: {}", "work ".repeat(100)),
            None,
        )
        .unwrap();
        unified_persistence::save_assistant_msg(sid, "done", "test/model").unwrap();
    }
    unified_persistence::save_session_memory_state(sid, "old memory", Some(3)).unwrap();
    let def = AgentDefinition {
        selected_model_id: Some("test/model".into()),
        ..Default::default()
    };
    let mut resolved = ResolvedAgent::resolve(&def, None, &Default::default()).unwrap();
    resolved.context_window = 100_000;
    resolved.context_window_configured = true;
    let session = Arc::new(AgentSession::new(sid.into(), def));
    let provider = Arc::new(FixtureProvider {
        calls: AtomicUsize::new(0),
        fail,
    });
    let policy = Arc::new(crate::tools::policy::ResolvedToolPolicy::permissive());
    let runtime = Arc::new(SessionRuntime {
        provider: provider.clone(),
        tool_registry: Arc::new(crate::tools::registry::ToolRegistry::new()),
        policy: policy.clone(),
        model: "test/model".into(),
        account_id: None,
        native_harness_type: None,
        workspace_state: Arc::new(parking_lot::RwLock::new(
            crate::session::workspace::SessionWorkspace::new(std::env::temp_dir()),
        )),
        mcp_auto_approved: vec![],
        resolved,
        integrations_snapshot: Default::default(),
        overrides: Default::default(),
        agent_soul: None,
        sovereign_prompt: false,
        policy_context_activator: None,
        agent_org_context: None,
        agent_org_current_member_id: None,
        agent_definition_id: None,
    });
    let mut processor = UnifiedMessageProcessor::new(super::super::ProcessorParams {
        runtime,
        session,
        policy,
        channel: None,
        chat_id: None,
        agent_mode: None,
        ide_context: None,
        app_handle: None,
        screenshot_store: Arc::new(Default::default()),
        event_handler_config: Default::default(),
    });
    processor.sm_compact_config.min_tokens_to_keep = 0;
    processor.sm_compact_config.min_text_messages_to_keep = 1;
    (processor, provider)
}

#[tokio::test(flavor = "multi_thread")]
async fn session_memory_reactive_compaction_allows_new_durable_commit() {
    let _sandbox = test_helpers::test_env::sandbox();
    let sid = "reactive-memory-cas";
    let (processor, provider) = fixture(sid, false);
    {
        let mut state = processor.sm_state.lock().await;
        state.content = Some("old memory".into());
        state.last_summarized_seq = Some(3);
        state.initialized = true;
    }
    let mut messages = unified_persistence::load_llm_history(sid).unwrap();
    let outcome = processor
        .run_reactive_compaction(sid, &mut messages, None)
        .await;
    assert!(matches!(outcome, CompactionOutcome::Compacted { .. }));
    assert_eq!(
        provider.calls.load(Ordering::SeqCst),
        0,
        "SM compaction is local"
    );
    assert_eq!(processor.sm_state.lock().await.last_summarized_seq, None);
    assert_eq!(
        unified_persistence::load_session_memory_state(sid)
            .unwrap()
            .last_seq,
        Some(3)
    );
    // Each view is current at extraction start: runtime anchor was reset,
    // while reactive compaction deliberately did not write a durable boundary.
    for tokens in [25_000, 31_000] {
        assert_eq!(
            extract_and_persist_session_memory(
                sid,
                processor.sm_state.clone(),
                &processor.sm_config,
                provider.as_ref(),
                "test/model",
                tokens,
                None
            )
            .await
            .unwrap(),
            MemoryJobCompletion::Completed
        );
        let durable = unified_persistence::load_session_memory_state(sid).unwrap();
        let state = processor.sm_state.lock().await;
        assert_eq!(state.content, durable.content);
        assert_eq!(state.last_summarized_seq, durable.last_seq);
    }
    assert_eq!(provider.calls.load(Ordering::SeqCst), 2);
}

#[tokio::test(flavor = "multi_thread")]
async fn session_memory_failed_reactive_compaction_preserves_growth() {
    let _sandbox = test_helpers::test_env::sandbox();
    for sm_enabled in [false, true] {
        let sid = format!("reactive-failed-{sm_enabled}");
        let (mut processor, provider) = fixture(&sid, true);
        processor.sm_config.enabled = sm_enabled;
        Arc::get_mut(&mut processor.runtime)
            .unwrap()
            .resolved
            .compaction
            .min_messages = 1;
        {
            let mut state = processor.sm_state.lock().await;
            state.content = Some("old memory".into());
            state.last_summarized_seq = Some(3);
            state.initialized = true;
        }
        assert!(
            crate::session::turn::post_turn::prepare_session_memory_baseline(
                &sid,
                processor.sm_state.clone(),
                20_000
            )
            .await
        );
        {
            let mut state = processor.sm_state.lock().await;
            state.extraction_generation = 7;
            state.tool_calls_since_extraction = 8;
        }
        processor
            .session
            .last_context_tokens
            .store(45_000, Ordering::SeqCst);
        let original: Vec<Value> = (0..8).map(|i| serde_json::json!({
            "role": "user", "content": if i == 7 { "recent tail".to_owned() } else { "work ".repeat(40_000) }
        })).collect();
        let mut messages = original.clone();
        let outcome = processor
            .run_reactive_compaction(&sid, &mut messages, None)
            .await;
        assert!(
            matches!(outcome, CompactionOutcome::Failed { .. }),
            "{outcome:?}"
        );
        assert!(
            provider.calls.load(Ordering::SeqCst) >= 2,
            "normal and rescue must run"
        );
        assert_eq!(
            messages, original,
            "failed compaction must preserve the original frame"
        );
        {
            let state = processor.sm_state.lock().await;
            assert_eq!(state.tokens_at_last_extraction, Some(20_000));
            assert_eq!(state.last_summarized_seq, Some(3));
            assert_eq!(state.extraction_generation, 7);
            assert_eq!(state.tool_calls_since_extraction, 8);
        }
        assert_eq!(
            processor.session.last_context_tokens.load(Ordering::SeqCst),
            45_000
        );
        assert!(
            crate::session::turn::post_turn::prepare_session_memory_baseline(
                &sid,
                processor.sm_state.clone(),
                45_000
            )
            .await
        );
        let durable = unified_persistence::load_session_memory_state(&sid).unwrap();
        assert_eq!(durable.tokens_at_last_extraction, Some(20_000));
        assert_eq!(durable.last_seq, Some(3));
        assert_eq!(durable.content.as_deref(), Some("old memory"));
        processor.sm_config.enabled = true;
        let state = processor.sm_state.lock().await;
        assert_eq!(state.tokens_at_last_extraction, Some(20_000));
        assert!(session_memory::should_extract(
            &state,
            &processor.sm_config,
            45_000,
            false
        ));
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn session_memory_skipped_reactive_compaction_preserves_growth() {
    let _sandbox = test_helpers::test_env::sandbox();
    let sid = "reactive-skipped-memory";
    let (mut processor, provider) = fixture(sid, false);
    processor.sm_config.enabled = false;
    {
        let mut state = processor.sm_state.lock().await;
        state.content = Some("old memory".into());
        state.last_summarized_seq = Some(3);
        state.tokens_at_last_extraction = Some(20_000);
        state.initialized = true;
        state.extraction_generation = 7;
    }
    processor
        .session
        .last_context_tokens
        .store(45_000, Ordering::SeqCst);
    let original = unified_persistence::load_llm_history(sid).unwrap();
    let mut messages = original.clone();
    assert!(matches!(
        processor
            .run_reactive_compaction(sid, &mut messages, None)
            .await,
        CompactionOutcome::Skipped
    ));
    assert_eq!(provider.calls.load(Ordering::SeqCst), 0);
    assert_eq!(messages, original);
    let state = processor.sm_state.lock().await;
    assert_eq!(state.tokens_at_last_extraction, Some(20_000));
    assert_eq!(state.last_summarized_seq, Some(3));
    assert_eq!(state.extraction_generation, 7);
    assert_eq!(
        processor.session.last_context_tokens.load(Ordering::SeqCst),
        45_000
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn session_memory_pre_turn_skipped_compaction_preserves_baseline() {
    let _sandbox = test_helpers::test_env::sandbox();
    let sid = "pre-turn-skipped-memory";
    let (mut processor, provider) = fixture(sid, false);
    processor.sm_config.enabled = false;
    {
        let mut state = processor.sm_state.lock().await;
        state.content = Some("old memory".into());
        state.last_summarized_seq = Some(3);
        state.tokens_at_last_extraction = Some(20_000);
        state.initialized = true;
        state.extraction_generation = 7;
    }
    // A stale provider observation opens the gate, but there is no current
    // compactable tail. The compactor returns Skipped without an LLM call.
    processor
        .session
        .last_context_tokens
        .store(100_000, Ordering::SeqCst);
    let mut messages = Vec::new();
    assert!(matches!(
        processor.run_pre_turn_compaction(sid, &mut messages).await,
        CompactionPhaseOutcome::Continue
    ));
    assert_eq!(provider.calls.load(Ordering::SeqCst), 0);
    assert!(messages.is_empty());
    let state = processor.sm_state.lock().await;
    assert_eq!(state.tokens_at_last_extraction, Some(20_000));
    assert_eq!(state.last_summarized_seq, Some(3));
    assert_eq!(state.extraction_generation, 7);
    assert_eq!(
        processor.session.last_context_tokens.load(Ordering::SeqCst),
        100_000
    );
    assert_eq!(unified_persistence::load_llm_history(sid).unwrap().len(), 8);
}
