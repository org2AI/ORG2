use super::*;

async fn fixture() -> (Arc<AgentSession>, Arc<SessionRuntime>) {
    let definition = AgentDefinition {
        selected_model_id: Some("e2e-fake-provider".into()),
        ..Default::default()
    };
    let runtime = Arc::new(SessionRuntime {
        provider: Arc::new(crate::providers::e2e_fake::E2eFakeProvider),
        tool_registry: Arc::new(ToolRegistry::new()),
        policy: Arc::new(ResolvedToolPolicy::permissive()),
        model: "e2e-fake-provider".into(),
        account_id: Some("account-a".into()),
        native_harness_type: None,
        workspace_state: Arc::new(parking_lot::RwLock::new(SessionWorkspace::new(
            std::env::temp_dir(),
        ))),
        mcp_auto_approved: vec![],
        resolved: crate::definitions::resolved::ResolvedAgent::resolve(
            &definition,
            None,
            &Default::default(),
        )
        .unwrap(),
        integrations_snapshot: Default::default(),
        overrides: Default::default(),
        agent_soul: None,
        sovereign_prompt: false,
        policy_context_activator: None,
        agent_org_context: None,
        agent_org_current_member_id: None,
        agent_definition_id: None,
    });
    let session = Arc::new(AgentSession::new("identity-mutation".into(), definition));
    session.set_runtime(runtime.clone()).await.unwrap();
    (session, runtime)
}

#[tokio::test]
async fn pinned_admission_rejects_identity_edit_and_release_allows_retry() {
    let (session, runtime) = fixture().await;
    let reservation = session
        .reserve_runtime_admission(&runtime, "prepared-turn")
        .await
        .unwrap();
    let error = match session.begin_identity_mutation().await {
        Ok(_) => panic!("a pinned runtime must reject identity edits before persistence"),
        Err(error) => error,
    };
    assert!(error.starts_with("agent_org_runtime_admission_conflict:"));
    assert!(Arc::ptr_eq(&runtime, &session.get_runtime().await.unwrap()));
    assert!(
        session
            .runtime_admission_is_current(&reservation, &runtime)
            .await
    );
    session.release_runtime_admission(&reservation).await;
    session
        .begin_identity_mutation()
        .await
        .unwrap()
        .invalidate_runtime()
        .await;
    assert!(session.get_runtime().await.is_none());
    assert_eq!(runtime.account_id.as_deref(), Some("account-a"));
}

#[tokio::test]
async fn failed_identity_write_keeps_runtime_and_allows_new_admission() {
    let (session, runtime) = fixture().await;
    let mutation = session.begin_identity_mutation().await.unwrap();
    drop(mutation); // The persistence write failed; no invalidation is committed.
    assert!(Arc::ptr_eq(&runtime, &session.get_runtime().await.unwrap()));
    assert!(session
        .reserve_runtime_admission(&runtime, "retry")
        .await
        .is_ok());
}

#[tokio::test]
async fn new_admission_waits_for_identity_write_then_rejects_stale_provider() {
    let (session, runtime) = fixture().await;
    let mutation = session.begin_identity_mutation().await.unwrap();
    let admission = {
        let session = session.clone();
        let runtime = runtime.clone();
        tokio::spawn(async move {
            session
                .reserve_runtime_admission(&runtime, "competing-turn")
                .await
        })
    };
    tokio::task::yield_now().await;
    assert!(!admission.is_finished());
    mutation.invalidate_runtime().await;
    let error = admission.await.unwrap().unwrap_err();
    assert!(error.starts_with("agent_org_runtime_admission_stale:"));
    assert!(session.get_runtime().await.is_none());
}

#[tokio::test]
async fn admitted_turn_control_keeps_old_lease_and_cannot_clear_replacement() {
    let (session, admitted) = fixture().await;
    let admitted_lease = session.runtime_lease_for(&admitted).await.unwrap();
    session
        .begin_identity_mutation()
        .await
        .unwrap()
        .invalidate_runtime()
        .await;
    let (_, replacement) = fixture().await;
    let replacement_lease = session.set_runtime(replacement.clone()).await.unwrap();
    assert_ne!(admitted_lease, replacement_lease);
    assert!(session.runtime_lease_for(&admitted).await.is_err());
    let generation = session
        .begin_turn_with_runtime_lease(
            "queued turn".into(),
            Some("turn-a".into()),
            Some(admitted_lease.clone()),
        )
        .await;
    let turn = session.runtime_turn_identity().await.unwrap();
    assert_eq!(turn.runtime_lease_id, admitted_lease);
    assert_eq!(
        session
            .turn_process_control()
            .unwrap()
            .owner
            .runtime_lease_id,
        admitted_lease
    );
    assert!(
        !session
            .release_runtime_if_current(&admitted_lease, &generation)
            .await
    );
    assert!(Arc::ptr_eq(
        &replacement,
        &session.get_runtime().await.unwrap()
    ));
    session
        .end_turn(DialogTurnState::Completed, TurnStats::default())
        .await;
    assert!(
        !session
            .release_runtime_lease_if_current(&admitted_lease)
            .await
    );
    assert!(Arc::ptr_eq(
        &replacement,
        &session.get_runtime().await.unwrap()
    ));
}
