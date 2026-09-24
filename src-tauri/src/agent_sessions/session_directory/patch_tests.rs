use super::*;
use agent_core::definitions::{resolved::ResolvedAgent, AgentDefinition};
use agent_core::state::{AgentAppState, AgentSession, SessionRuntime};
use key_vault::key_store::{ModelKey, ModelType};
use std::sync::Arc;

const FIRST_MODEL: &str = "e2e-fake-provider-a";
const SECOND_MODEL: &str = "e2e-fake-provider-b";

fn lookup(account: &str) -> Result<Option<ModelKey>, String> {
    if account == "missing" {
        return Ok(None);
    }
    let mut key = ModelKey::new(ModelType::OpenaiApi);
    key.id = account.into();
    key.available_models = vec![FIRST_MODEL.into(), SECOND_MODEL.into()];
    key.enabled_models = key.available_models.clone();
    if account == "disabled" {
        key.enabled_models.clear();
    }
    Ok(Some(key))
}

async fn fixture(state: &AgentAppState, sid: &str, root: &std::path::Path) -> Arc<AgentSession> {
    let conn = get_connection().unwrap();
    conn.execute(
        "INSERT INTO agent_sessions (session_id,name,session_type,status,model,account_id,workspace_path,created_at,updated_at) VALUES (?1,'Model fixture','agent','idle',?2,'account-a',?3,datetime('now'),datetime('now'))",
        params![sid, FIRST_MODEL, root.to_string_lossy()],
    ).unwrap();
    let definition = AgentDefinition {
        selected_model_id: Some(FIRST_MODEL.into()),
        ..Default::default()
    };
    let resolved = ResolvedAgent::resolve(&definition, None, &Default::default()).unwrap();
    let handle = state
        .register_session(AgentSession::new(sid.into(), definition))
        .await;
    handle
        .set_runtime(Arc::new(SessionRuntime {
            provider: Arc::new(agent_core::providers::e2e_fake::E2eFakeProvider),
            tool_registry: Arc::new(agent_core::tools::registry::ToolRegistry::new()),
            policy: Arc::new(agent_core::tools::policy::ResolvedToolPolicy::permissive()),
            model: FIRST_MODEL.into(),
            account_id: Some("account-a".into()),
            native_harness_type: None,
            workspace_state: Arc::new(parking_lot::RwLock::new(
                agent_core::session::workspace::SessionWorkspace::new(root.into()),
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
        }))
        .await
        .unwrap();
    handle
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn identity_patch_commits_pair_invalidates_runtime_and_next_mobile_send_uses_it() {
    crate::test_utils::install_crypto_provider_for_tests();
    let sandbox = crate::test_utils::test_env::sandbox();
    let state = AgentAppState::new();
    for (sid, model) in [
        ("model-patch-same", FIRST_MODEL),
        ("model-patch-both", SECOND_MODEL),
    ] {
        let handle = fixture(&state, sid, sandbox.path()).await;
        let active_runtime = handle.get_runtime().await.unwrap();
        patch_session_with_account_lookup(
            &state,
            sid.into(),
            SessionPatch {
                model: Some(model.into()),
                account_id: Some("account-b".into()),
                ..Default::default()
            },
            lookup,
        )
        .await
        .unwrap();
        let stored = session_persistence::get_session(sid).unwrap().unwrap();
        assert_eq!(stored.model.as_deref(), Some(model));
        assert_eq!(stored.account_id.as_deref(), Some("account-b"));
        assert!(handle.get_runtime().await.is_none());
        // A running reply's captured provider remains unchanged.
        assert_eq!(active_runtime.account_id.as_deref(), Some("account-a"));
        agent_core::state::commands::session::message::send_message_impl_for_mobile_remote(
            &state,
            sid.into(),
            "continue".into(),
            Some(format!("turn-{sid}")),
            Some(model.into()),
            None,
        )
        .await
        .unwrap();
        let next = handle.get_runtime().await.unwrap();
        assert_eq!(next.account_id.as_deref(), Some("account-b"));
        assert_eq!(next.model, model);
        let stored = session_persistence::get_session(sid).unwrap().unwrap();
        assert_eq!(stored.account_id.as_deref(), Some("account-b"));
        // Let the local fake-provider turn settle before dropping its sandbox.
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while handle.scheduler.is_processing() || handle.scheduler.pending_count() > 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        state.remove_session(sid).await;
    }
    state
        .begin_shutdown(std::time::Duration::from_secs(1))
        .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn failed_patch_preserves_persisted_pair_and_runtime_and_can_retry() {
    let sandbox = crate::test_utils::test_env::sandbox();
    let state = AgentAppState::new();
    let sid = "model-patch-invalid";
    let handle = fixture(&state, sid, sandbox.path()).await;
    let runtime = handle.get_runtime().await.unwrap();
    for account in ["missing", "disabled"] {
        assert!(patch_session_with_account_lookup(
            &state,
            sid.into(),
            SessionPatch {
                model: Some(SECOND_MODEL.into()),
                account_id: Some(account.into()),
                ..Default::default()
            },
            lookup
        )
        .await
        .is_err());
        assert!(Arc::ptr_eq(&runtime, &handle.get_runtime().await.unwrap()));
        let stored = session_persistence::get_session(sid).unwrap().unwrap();
        assert_eq!(stored.model.as_deref(), Some(FIRST_MODEL));
        assert_eq!(stored.account_id.as_deref(), Some("account-a"));
    }
    assert!(patch_session_with_account_lookup(
        &state,
        sid.into(),
        SessionPatch {
            model: Some("unlisted-model".into()),
            ..Default::default()
        },
        lookup
    )
    .await
    .is_err());
    patch_session_with_account_lookup(
        &state,
        sid.into(),
        SessionPatch {
            model: Some(SECOND_MODEL.into()),
            account_id: Some("account-b".into()),
            ..Default::default()
        },
        lookup,
    )
    .await
    .unwrap();
    assert!(handle.get_runtime().await.is_none());
    state
        .begin_shutdown(std::time::Duration::from_secs(1))
        .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn identity_patch_waits_for_prior_admission_then_wins_persistence() {
    let sandbox = crate::test_utils::test_env::sandbox();
    let state = Arc::new(AgentAppState::new());
    let sid = "model-patch-admission";
    let handle = fixture(&state, sid, sandbox.path()).await;
    let guard = agent_core::state::session_identity_lock(sid)
        .await
        .lock_owned()
        .await;
    let patch_state = state.clone();
    let patch = tokio::spawn(async move {
        patch_session_with_account_lookup(
            &patch_state,
            sid.into(),
            SessionPatch {
                model: Some(SECOND_MODEL.into()),
                account_id: Some("account-b".into()),
                ..Default::default()
            },
            lookup,
        )
        .await
    });
    tokio::task::yield_now().await;
    assert!(!patch.is_finished());
    assert!(handle.get_runtime().await.is_some());
    session_persistence::update_model_and_account(sid, FIRST_MODEL, Some("account-a")).unwrap();
    drop(guard);
    patch.await.unwrap().unwrap();
    let stored = session_persistence::get_session(sid).unwrap().unwrap();
    assert_eq!(stored.model.as_deref(), Some(SECOND_MODEL));
    assert_eq!(stored.account_id.as_deref(), Some("account-b"));
    assert!(handle.get_runtime().await.is_none());
    state
        .begin_shutdown(std::time::Duration::from_secs(1))
        .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn persistence_failure_keeps_old_identity_and_runtime_until_retry_succeeds() {
    let sandbox = crate::test_utils::test_env::sandbox();
    let state = AgentAppState::new();
    let sid = "model-patch-storage-failure";
    let handle = fixture(&state, sid, sandbox.path()).await;
    let runtime = handle.get_runtime().await.unwrap();
    get_connection().unwrap().execute_batch(
        "CREATE TRIGGER reject_identity_patch BEFORE UPDATE OF model, account_id ON agent_sessions
         WHEN NEW.session_id = 'model-patch-storage-failure'
         BEGIN SELECT RAISE(ABORT, 'simulated identity storage failure'); END;",
    ).unwrap();
    let patch = SessionPatch {
        model: Some(SECOND_MODEL.into()),
        account_id: Some("account-b".into()),
        ..Default::default()
    };
    let error = patch_session_with_account_lookup(&state, sid.into(), patch.clone(), lookup)
        .await
        .unwrap_err();
    assert!(error.contains("simulated identity storage failure"));
    assert!(Arc::ptr_eq(&runtime, &handle.get_runtime().await.unwrap()));
    let stored = session_persistence::get_session(sid).unwrap().unwrap();
    assert_eq!(stored.model.as_deref(), Some(FIRST_MODEL));
    assert_eq!(stored.account_id.as_deref(), Some("account-a"));
    get_connection()
        .unwrap()
        .execute_batch("DROP TRIGGER reject_identity_patch;")
        .unwrap();
    patch_session_with_account_lookup(&state, sid.into(), patch, lookup)
        .await
        .unwrap();
    assert!(handle.get_runtime().await.is_none());
    assert_eq!(
        session_persistence::get_session(sid)
            .unwrap()
            .unwrap()
            .account_id
            .as_deref(),
        Some("account-b")
    );
    state
        .begin_shutdown(std::time::Duration::from_secs(1))
        .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancelled_mobile_response_still_finishes_admitted_identity_mutation() {
    let sandbox = crate::test_utils::test_env::sandbox();
    let state = Arc::new(AgentAppState::new());
    let sid = "model-patch-disconnected";
    let handle = fixture(&state, sid, sandbox.path()).await;
    let (started, admitted) = tokio::sync::oneshot::channel();
    let started = std::sync::Mutex::new(Some(started));
    let (release, resume) = std::sync::mpsc::channel();
    let resume = std::sync::Mutex::new(resume);
    let task_state = state.clone();
    let caller = tokio::spawn(async move {
        patch_session_with_account_lookup(
            &task_state,
            sid.into(),
            SessionPatch {
                model: Some(SECOND_MODEL.into()),
                account_id: Some("account-b".into()),
                ..Default::default()
            },
            move |account| {
                started.lock().unwrap().take().unwrap().send(()).unwrap();
                resume.lock().unwrap().recv().unwrap();
                lookup(account)
            },
        )
        .await
    });
    admitted.await.unwrap();
    caller.abort();
    assert!(caller.await.unwrap_err().is_cancelled());
    release.send(()).unwrap();
    // The admitted lifecycle still owns the identity lock until the DB write,
    // invalidation and notifications have all completed after disconnect.
    let _settled = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        agent_core::state::session_identity_lock(sid)
            .await
            .lock_owned()
            .await
    })
    .await
    .unwrap();
    let stored = session_persistence::get_session(sid).unwrap().unwrap();
    assert_eq!(stored.model.as_deref(), Some(SECOND_MODEL));
    assert_eq!(stored.account_id.as_deref(), Some("account-b"));
    assert!(handle.get_runtime().await.is_none());
    state
        .begin_shutdown(std::time::Duration::from_secs(1))
        .await;
}

#[test]
fn project_derives_build_and_ordinary_modes_never_gain_pm_capability() {
    assert_eq!(
        resolve_atomic_mode_axes(Some("project"), Some("ask")).unwrap(),
        Some(("project".to_string(), "build".to_string()))
    );
    assert_eq!(
        resolve_atomic_mode_axes(Some("build"), Some("build")).unwrap(),
        Some(("build".to_string(), "build".to_string()))
    );
    assert_eq!(
        resolve_atomic_mode_axes(Some("plan"), Some("plan")).unwrap(),
        Some(("plan".to_string(), "plan".to_string()))
    );
    assert!(resolve_atomic_mode_axes(Some("project-ish"), Some("build")).is_err());
    assert!(resolve_atomic_mode_axes(Some("project"), Some("unrestricted")).is_err());
}

#[test]
fn double_option_distinguishes_absent_null_value() {
    // Field absent → None → "leave alone"
    let absent: SessionPatch = serde_json::from_str("{}").unwrap();
    assert!(absent.draft_text.is_none());
    assert!(absent.reply_target_event_id.is_none());

    // Field is JSON null → Some(None) → "clear"
    let nulled: SessionPatch =
        serde_json::from_str(r#"{"draftText": null, "replyTargetEventId": null}"#).unwrap();
    assert_eq!(nulled.draft_text, Some(None));
    assert_eq!(nulled.reply_target_event_id, Some(None));

    // Field is a string → Some(Some(_)) → "set"
    let set: SessionPatch =
        serde_json::from_str(r#"{"draftText": "hello", "replyTargetEventId": "evt_42"}"#).unwrap();
    assert_eq!(set.draft_text, Some(Some("hello".to_string())));
    assert_eq!(set.reply_target_event_id, Some(Some("evt_42".to_string())));
}

#[test]
fn empty_patch_is_rejected() {
    let patch = SessionPatch::default();
    let err = apply_session_patch("nonexistent", &patch, &|_| Ok(None)).unwrap_err();
    assert!(err.contains("at least one field"), "got: {err}");
}

#[test]
fn account_without_model_is_rejected() {
    let patch = SessionPatch {
        account_id: Some("acc_1".to_string()),
        ..SessionPatch::default()
    };
    let err = apply_session_patch("nonexistent", &patch, &|_| Ok(None)).unwrap_err();
    assert!(
        err.contains("account_id provided without model"),
        "got: {err}"
    );
}
