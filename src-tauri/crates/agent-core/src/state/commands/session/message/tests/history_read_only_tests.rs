use crate::coordination::agent_org_history_store::READ_ONLY_ERROR;
use crate::foundation::session_bridge::TurnIntentBridgeSource;
use crate::state::commands::session::identity::IdentityOverrides;
use crate::state::AgentAppState;

#[tokio::test(flavor = "multi_thread")]
async fn all_send_sources_and_tool_entries_reject_history_before_loading_a_runtime() {
    let _sandbox = test_helpers::test_env::sandbox();
    let conn = database::db::get_connection().unwrap();
    crate::persistence::test_schema::ensure_agent_sessions_schema(&conn);
    crate::coordination::init_agent_org_schemas(&conn).unwrap();
    conn.execute(
        "INSERT INTO org_history_sessions (session_id,root_session_id,source_table)
        VALUES ('sdeagent-history','sdeagent-history','fixture')",
        [],
    )
    .unwrap();
    let state = AgentAppState::new();
    for source in [
        TurnIntentBridgeSource::UserSubmit,
        TurnIntentBridgeSource::Queue,
        TurnIntentBridgeSource::ForceSend,
        TurnIntentBridgeSource::Resume,
        TurnIntentBridgeSource::AgentOrg,
        TurnIntentBridgeSource::MobileRemote,
    ] {
        let result = super::super::send::send_message_impl(
            &state,
            "sdeagent-history".into(),
            "Try to run".into(),
            None,
            IdentityOverrides::default(),
            None,
            None,
            None,
            false,
            None,
            None,
            false,
            None,
            None,
            None,
            None,
            None,
            source,
            None,
        )
        .await;
        assert!(matches!(result,Err(ref error) if error==READ_ONLY_ERROR));
        assert!(
            state.get_session("sdeagent-history").await.is_none(),
            "no Provider runtime may be registered"
        );
    }
    let registry = crate::tools::registry::ToolRegistry::new();
    let context = crate::tools::call_context::CallContext::new("attempt", "sdeagent-history");
    let direct = registry
        .execute("run_shell", serde_json::json!({}), &context)
        .await;
    assert!(matches!(direct,Err(ref error) if error==READ_ONLY_ERROR));
    let policy = crate::tools::policy::ResolvedToolPolicy::permissive();
    let checked = registry
        .execute_with_policy("run_shell", serde_json::json!({}), &policy, &context)
        .await;
    assert!(matches!(checked,Err(ref error) if error==READ_ONLY_ERROR));
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM agent_org_execution_runs", [], |r| r
            .get::<_, i64>(
            0
        ))
        .unwrap(),
        0
    );
}
