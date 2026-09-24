//! Provider execution must retain the runtime admitted before a model edit.

use std::sync::Arc;

use async_trait::async_trait;
use parking_lot::Mutex;
use serde_json::Value;

use super::{process_message, process_message_with_runtime, TurnInput};
use crate::definitions::{resolved::ResolvedAgent, AgentDefinition};
use crate::providers::traits::{LLMProvider, LLMResponse, ProviderError};
use crate::session::persistence::{self, UnifiedSessionRecord};
use crate::state::{AgentSession, SessionRuntime};

struct RecordingProvider {
    account: &'static str,
    calls: Arc<Mutex<Vec<(String, String)>>>,
}

#[async_trait]
impl LLMProvider for RecordingProvider {
    async fn chat(
        &self,
        _: &[Value],
        _: Option<&[Value]>,
        model: &str,
        _: u32,
        _: f32,
    ) -> Result<LLMResponse, ProviderError> {
        self.calls
            .lock()
            .push((self.account.to_string(), model.to_string()));
        Ok(LLMResponse::text(&format!("{}:{model}", self.account)))
    }

    fn default_model(&self) -> &str {
        "model-a"
    }

    fn provider_name(&self) -> &str {
        "captured-runtime-fixture"
    }
}

fn runtime(
    model: &str,
    account: &'static str,
    workspace: &std::path::Path,
    calls: Arc<Mutex<Vec<(String, String)>>>,
) -> Arc<SessionRuntime> {
    let definition = AgentDefinition {
        selected_model_id: Some(model.to_string()),
        ..Default::default()
    };
    let resolved = ResolvedAgent::resolve(&definition, None, &Default::default()).unwrap();
    Arc::new(SessionRuntime {
        provider: Arc::new(RecordingProvider { account, calls }),
        tool_registry: Arc::new(crate::tools::registry::ToolRegistry::new()),
        policy: Arc::new(crate::tools::policy::ResolvedToolPolicy::permissive()),
        model: model.to_string(),
        account_id: Some(account.to_string()),
        native_harness_type: None,
        workspace_state: Arc::new(parking_lot::RwLock::new(
            crate::session::workspace::SessionWorkspace::new(workspace.to_path_buf()),
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
    })
}

fn init_schema() {
    let connection = database::db::get_connection().unwrap();
    crate::persistence::test_schema::ensure_agent_sessions_schema(&connection);
    crate::persistence::session_snapshots::ensure_tables_with(&connection).unwrap();
    persistence::init(&connection).unwrap();
    crate::coordination::init_agent_org_schemas(&connection).unwrap();
}

fn input(content: &str) -> TurnInput {
    TurnInput {
        content: content.to_string(),
        turn_intent_id: uuid::Uuid::new_v4().to_string(),
        ..Default::default()
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn admitted_turn_executes_captured_provider_after_cache_invalidation_or_replacement() {
    let sandbox = test_helpers::test_env::sandbox();
    init_schema();
    for replace_cache in [false, true] {
        let sid = format!("captured-runtime-{replace_cache}");
        let session = Arc::new(AgentSession::new(sid.clone(), AgentDefinition::default()));
        persistence::upsert_session(&UnifiedSessionRecord {
            session_id: sid.clone(),
            model: Some("model-a".to_string()),
            account_id: Some("account-a".to_string()),
            ..Default::default()
        })
        .unwrap();
        let calls = Arc::new(Mutex::new(Vec::new()));
        let admitted = runtime("model-a", "account-a", sandbox.path(), Arc::clone(&calls));
        let next = runtime("model-b", "account-b", sandbox.path(), Arc::clone(&calls));
        session.set_runtime(Arc::clone(&admitted)).await.unwrap();

        // Reproduce the model edit after preparation releases its identity lock.
        let mutation = session.begin_identity_mutation().await.unwrap();
        persistence::update_model_and_account(&sid, "model-b", Some("account-b")).unwrap();
        mutation.invalidate_runtime().await;
        if replace_cache {
            session.set_runtime(Arc::clone(&next)).await.unwrap();
        }

        let result = process_message_with_runtime(
            Arc::clone(&session),
            admitted,
            input("First admitted request"),
            None,
        )
        .await
        .expect("a later model edit cannot uninitialize the admitted request");
        assert_eq!(result.content, "account-a:model-a");
        assert_eq!(*calls.lock(), vec![("account-a".into(), "model-a".into())]);
        let saved = persistence::get_session(&sid).unwrap().unwrap();
        assert_eq!(saved.model.as_deref(), Some("model-b"));
        assert_eq!(saved.account_id.as_deref(), Some("account-b"));

        if !replace_cache {
            session.set_runtime(next).await.unwrap();
        }
        let result = process_message(session, input("Next request"), None)
            .await
            .unwrap();
        assert_eq!(result.content, "account-b:model-b");
        assert_eq!(
            calls.lock().last().unwrap(),
            &("account-b".into(), "model-b".into())
        );
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn gateway_preprocessing_preserves_captured_provider_and_persists_complete_seed() {
    let sandbox = test_helpers::test_env::sandbox();
    init_schema();
    let sid = "captured-gateway-runtime";
    let session = Arc::new(AgentSession::new(sid.into(), AgentDefinition::default()));
    let calls = Arc::new(Mutex::new(Vec::new()));
    let admitted = runtime("model-a", "account-a", sandbox.path(), Arc::clone(&calls));
    session.set_runtime(Arc::clone(&admitted)).await.unwrap();
    session
        .begin_identity_mutation()
        .await
        .unwrap()
        .invalidate_runtime()
        .await;
    let mut message = crate::bus::InboundMessage::new("fixture", "user", "chat", "Request");
    message.session_key_override = Some(sid.into());

    let response = crate::session::gateway_pipeline::process_gateway_message_with_runtime(
        message, session, admitted, None, None,
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(response.content, "account-a:model-a");
    assert_eq!(*calls.lock(), vec![("account-a".into(), "model-a".into())]);
    let saved = persistence::get_session(sid).unwrap().unwrap();
    assert_eq!(saved.model.as_deref(), Some("model-a"));
    assert_eq!(saved.account_id.as_deref(), Some("account-a"));
}
