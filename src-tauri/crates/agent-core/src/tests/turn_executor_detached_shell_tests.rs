use super::*;
use crate::tools::impls::coding::exec::registry;

struct CompleteTaskProvider(AtomicU32);

#[async_trait]
impl LLMProvider for CompleteTaskProvider {
    async fn chat(
        &self,
        _messages: &[Value],
        _tools: Option<&[Value]>,
        _model: &str,
        _max_tokens: u32,
        _temperature: f32,
    ) -> Result<LLMResponse, ProviderError> {
        let call = self.0.fetch_add(1, Ordering::SeqCst);
        Ok(LLMResponse {
            content: Some("service delivered".into()),
            tool_calls: if call == 0 {
                vec![ToolCallRequest {
                    id: "complete-with-service".into(),
                    name: crate::tools::names::TASK_UPDATE.into(),
                    arguments: serde_json::json!({"operation":"complete", "id":"service-task", "output":{"summary":"available"}}),
                    thought_signature: None,
                }]
            } else {
                Vec::new()
            },
            finish_reason: finish_reason::STOP.into(),
            usage: HashMap::new(),
            reasoning_content: None,
            blocks: Vec::new(),
            stream_error_kind: None,
            retry_after_ms: None,
        })
    }
    fn default_model(&self) -> &str {
        "complete-task"
    }
    fn provider_name(&self) -> &str {
        "complete-task"
    }
}

#[tokio::test]
async fn task_completion_and_final_reply_do_not_wait_for_a_detached_service() {
    let _sandbox = test_helpers::test_env::sandbox();
    let control = TurnProcessControl {
        owner: TurnProcessOwner {
            session_id: "delivered-service-session".into(),
            turn_intent_id: "service-intent".into(),
            runtime_lease_id: "service-lease".into(),
            dialog_turn_generation: "service-generation".into(),
        },
        background_cancel: CancellationToken::new(),
        is_agent_org: true,
    };
    let cancel = CancellationToken::new();
    let completion = registry::register_owned_shell_replay(
        99_940,
        "delivered server".into(),
        std::path::PathBuf::new(),
        control.owner.session_id.clone(),
        "service-call".into(),
        &control,
        cancel.clone(),
    );
    let handle = completion.handle.clone();
    let provider = CompleteTaskProvider(AtomicU32::new(0));
    let executions = Arc::new(AtomicU32::new(0));
    let mut tools = ToolRegistry::new();
    tools.register(Box::new(RecordingTaskUpdateTool {
        executions: Arc::clone(&executions),
    }));
    let mut config = test_config();
    config.turn_intent_id = control.owner.turn_intent_id.clone();
    config.turn_process_control = Some(control.clone());
    let mut messages =
        vec![serde_json::json!({"role":"user","content":"deliver the running service"})];
    let result = execute_turn(
        &mut messages,
        &provider,
        &tools,
        &empty_policy(),
        &config,
        &control.owner.session_id,
        &MockRetryHandler::new(),
        None,
        None,
        None,
    )
    .await;
    let still_running = matches!(
        registry::get_status(&handle),
        Some((registry::JobStatus::Running, _))
    );
    registry::mark_exited(&handle, registry::JobStatus::Exited(0));
    completion.finish(Ok(()));
    registry::remove(&handle);
    assert_eq!(
        result.unwrap().content.as_deref(),
        Some("service delivered")
    );
    assert_eq!(
        executions.load(Ordering::SeqCst),
        1,
        "task completion must reach its authoritative tool boundary"
    );
    assert_eq!(
        provider.0.load(Ordering::SeqCst),
        2,
        "no additional cleanup model iteration"
    );
    assert!(still_running && !cancel.is_cancelled());
}
