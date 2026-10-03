use super::*;

#[test]
fn retired_archived_roots_remain_discoverable_and_copies_do_not_consume_page_slots() {
    let _sandbox = test_helpers::test_env::sandbox();
    let conn = get_connection().unwrap();
    crate::persistence::test_schema::ensure_agent_sessions_schema(&conn);
    crate::coordination::init_agent_org_schemas(&conn).unwrap();
    conn.execute_batch(
        "INSERT INTO agent_sessions
        (session_id,name,status,session_type,created_at,updated_at,org_member_id)
        VALUES ('old-root','Old team','archived','sde','now','now','coordinator'),
               ('copy','Ordinary old-reader copy','idle','sde','now','now',NULL),
               ('ordinary','Ordinary session','idle','sde','now','now',NULL);
        INSERT INTO org_history_sessions(session_id,root_session_id,source_table)
        VALUES ('old-root','old-root','fixture');
        INSERT INTO org_history_copies VALUES ('old-root','copy');",
    )
    .unwrap();
    let roots = list_agent_org_root_sessions_page(1, None).unwrap();
    assert_eq!(roots.len(), 1);
    assert_eq!(roots[0].session_id, "old-root");
    let ordinary = list_standalone_coding_sessions_page(1, None).unwrap();
    assert_eq!(ordinary.len(), 1);
    assert_eq!(ordinary[0].session_id, "ordinary");
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM agent_org_execution_runs", [], |r| r
            .get::<_, i64>(
            0
        ))
        .unwrap(),
        0
    );
}
