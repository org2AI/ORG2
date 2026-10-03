use super::*;

#[test]
fn pinned_history_uses_the_same_identity_and_excludes_ordinary_copies_before_limit() {
    let _sandbox = crate::test_utils::test_env::sandbox();
    let conn = get_connection().unwrap();
    conn.execute_batch(
        "INSERT INTO agent_sessions
        (session_id,name,status,session_type,created_at,updated_at,org_member_id,pinned)
        VALUES ('sdeagent-retired','Preserved team','archived','sde','now','now','coordinator',1),
               ('sdeagent-copy','Copy','idle','sde','now','newer',NULL,1);
        INSERT INTO org_history_sessions(session_id,root_session_id,title,source_table)
        VALUES ('sdeagent-retired','sdeagent-retired','Preserved team','fixture');
        INSERT INTO org_history_copies VALUES ('sdeagent-retired','sdeagent-copy');",
    )
    .unwrap();
    let rows = list_pinned_native_sidebar_sessions(1, None).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].session_id, "sdeagent-retired");
    assert_eq!(
        rows[0].agent_org_mode,
        Some(agent_core::coordination::agent_org_history_store::HistoryMode::HistoryOnly)
    );
    assert!(
        rows[0].agent_org_id.is_none(),
        "history must not invent an operational team identity"
    );
}
