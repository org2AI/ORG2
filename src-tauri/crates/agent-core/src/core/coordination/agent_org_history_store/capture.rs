//! Tolerant fact extraction: missing old fields stay unknown, never inferred states.
use rusqlite::{params, Connection};
use serde_json::Value;

use super::{optional_text as text, quoted, root_for_run, stable_id, table_exists};

pub(super) fn retired_sessions(conn: &Connection, fresh: bool) -> rusqlite::Result<()> {
    for table in ["agent_org_runtime_runs", "agent_org_runs"] {
        if !table_exists(conn, table)? {
            continue;
        }
        let mut stmt = conn.prepare(&format!("SELECT * FROM {}", quoted(table)))?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let Some(root) = text(row, "root_session_id") else {
                continue;
            };
            let snapshot = text(row, "org_snapshot_json")
                .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
            let name = snapshot
                .as_ref()
                .and_then(|v| v.get("orgName").or_else(|| v.get("name")))
                .and_then(Value::as_str);
            let run_id = text(row, "id");
            conn.execute(
                "INSERT OR IGNORE INTO org_history_sessions
                 (session_id,root_session_id,run_id,member_name,title,source_table,original_status)
                 VALUES (?1,?1,?2,?3,?3,?4,?5)",
                params![root, run_id, name, table, text(row, "status")],
            )?;
            capture_roster(conn, table, run_id.as_deref(), &root, snapshot.as_ref())?;
        }
    }
    if table_exists(conn, "agent_sessions")? {
        // First cutover also captures orphaned member sessions whose execution
        // table is missing. On re-upgrade, exclude current execution identities.
        let current_filter = if fresh {
            "1"
        } else {
            "NOT EXISTS(SELECT 1 FROM agent_org_execution_runs r
              WHERE r.root_session_id=s.session_id OR r.root_session_id=s.parent_session_id)
             AND NOT EXISTS(SELECT 1 FROM agent_org_execution_member_materializations m WHERE m.session_id=s.session_id)"
        };
        let mut stmt = conn.prepare(&format!(
            "SELECT s.* FROM agent_sessions s WHERE s.org_member_id IS NOT NULL
              AND {current_filter} AND NOT EXISTS(SELECT 1 FROM org_history_copies c
                  WHERE c.copy_session_id=s.session_id)"
        ))?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let Some(session) = text(row, "session_id") else {
                continue;
            };
            // A persisted parent link is a fact. An absent link remains NULL.
            conn.execute(
                "INSERT OR IGNORE INTO org_history_sessions
                 (session_id,root_session_id,member_id,member_name,title,source_table,original_status)
                 VALUES (?1,?2,?3,?4,?4,'agent_sessions',?5)",
                params![session,text(row,"parent_session_id"),text(row,"org_member_id"),
                    text(row,"name"),text(row,"status")],
            )?;
        }
        conn.execute(
            "INSERT OR IGNORE INTO org_history_sessions
             (session_id,root_session_id,title,source_table,original_status)
             SELECT s.session_id,s.session_id,s.name,'agent_sessions',s.status
             FROM agent_sessions s WHERE EXISTS(SELECT 1 FROM org_history_sessions h
                 WHERE h.root_session_id=s.session_id)",
            [],
        )?;
        conn.execute(
            "UPDATE org_history_sessions SET
                title=COALESCE(title,(SELECT name FROM agent_sessions s
                    WHERE s.session_id=org_history_sessions.session_id)),
                original_status=COALESCE(original_status,(SELECT status FROM agent_sessions s
                    WHERE s.session_id=org_history_sessions.session_id))",
            [],
        )?;
    }
    Ok(())
}

fn capture_roster(
    conn: &Connection,
    source: &str,
    run_id: Option<&str>,
    root: &str,
    snapshot: Option<&Value>,
) -> rusqlite::Result<()> {
    let table = "agent_org_runtime_member_materializations";
    if !table_exists(conn, table)? {
        return Ok(());
    }
    let mut stmt = conn
        .prepare("SELECT * FROM agent_org_runtime_member_materializations WHERE org_run_id=?1")?;
    let mut rows = stmt.query([run_id])?;
    while let Some(row) = rows.next()? {
        let Some(session) = text(row, "session_id") else {
            continue;
        };
        let member = text(row, "member_id");
        let name = snapshot
            .and_then(|snapshot| snapshot.get("members"))
            .and_then(Value::as_array)
            .and_then(|members| {
                members.iter().find(|item| {
                    item.get("id")
                        .or_else(|| item.get("memberId"))
                        .and_then(Value::as_str)
                        == member.as_deref()
                })
            })
            .and_then(|item| item.get("name"))
            .and_then(Value::as_str);
        conn.execute(
            "INSERT OR IGNORE INTO org_history_sessions
             (session_id,root_session_id,run_id,member_id,member_name,source_table)
             VALUES (?1,?2,?3,?4,?5,?6)",
            params![session, root, run_id, member, name, source],
        )?;
    }
    Ok(())
}

pub(super) fn retired_items(conn: &Connection) -> rusqlite::Result<()> {
    for table in [
        "agent_org_runtime_inbox_materializations",
        "agent_inbox_materializations",
    ] {
        if !table_exists(conn, table)? {
            continue;
        }
        let mut stmt = conn.prepare(&format!("SELECT * FROM {}", quoted(table)))?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            if let (Some(session), Some(message)) =
                (text(row, "session_id"), text(row, "transcript_message_id"))
            {
                conn.execute(
                    "INSERT OR IGNORE INTO org_history_inbox_messages VALUES (?1,?2)",
                    params![session, message],
                )?;
            }
        }
    }
    for (table, field, kind) in [
        ("agent_org_runtime_tasks", "output_json", "output"),
        ("agent_org_tasks", "output_json", "output"),
        ("agent_org_runtime_inbox", "payload_json", "group_message"),
        ("agent_inbox", "payload_json", "group_message"),
        (
            "agent_org_runtime_initial_inputs",
            "content",
            "initial_input",
        ),
        (
            "agent_org_runtime_member_intervention_turns",
            "display_content",
            "member_input",
        ),
        ("agent_org_runtime_plan_revisions", "plan_content", "plan"),
    ] {
        if !table_exists(conn, table)? {
            continue;
        }
        let mut stmt = conn.prepare(&format!(
            "SELECT rowid AS __source_rowid,* FROM {}",
            quoted(table)
        ))?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let Some(run) = text(row, "org_run_id") else {
                continue;
            };
            let Some(root) = root_for_run(conn, &run)? else {
                continue;
            };
            let Some(raw) = text(row, field) else {
                continue;
            };
            let value = serde_json::from_str::<Value>(&raw).ok();
            if kind == "group_message" && text(row, "payload_kind").as_deref() != Some("plain") {
                continue;
            }
            let mut content = text(row, "display_text")
                .or_else(|| {
                    value
                        .as_ref()
                        .and_then(|v| {
                            v.get("content")
                                .or_else(|| v.get("text"))
                                .or_else(|| v.get("summary"))
                        })
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                })
                .unwrap_or_else(|| raw.clone());
            if kind == "output" {
                if let Some(output) = value.as_ref() {
                    content = [
                        text(row, "subject"),
                        output
                            .get("summary")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                        output
                            .get("content")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                    ]
                    .into_iter()
                    .flatten()
                    .collect::<Vec<_>>()
                    .join("\n\n");
                    if content.is_empty() {
                        content = raw.clone();
                    }
                }
            }
            let key = text(row, "id")
                .or_else(|| text(row, "turn_intent_id"))
                .unwrap_or_else(|| {
                    row.get::<_, i64>("__source_rowid")
                        .unwrap_or_default()
                        .to_string()
                });
            conn.execute(
                "INSERT OR IGNORE INTO org_history_items
                 (id,root_session_id,source_session_id,kind,content,created_at,source_json)
                 VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![
                    stable_id("item", &format!("{table}:{run}:{key}")),
                    root,
                    text(row, "session_id"),
                    kind,
                    content,
                    text(row, "created_at").unwrap_or_default(),
                    raw
                ],
            )?;
        }
    }
    capture_visible_events(conn)?;
    Ok(())
}

fn capture_visible_events(conn: &Connection) -> rusqlite::Result<()> {
    let has_sessions: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM org_history_sessions WHERE root_session_id IS NOT NULL)",
        [],
        |row| row.get(0),
    )?;
    if !has_sessions {
        return Ok(());
    }
    if !table_exists(conn, "events")? {
        return Ok(());
    }
    let mut stmt = conn.prepare(
        "SELECT e.*,h.root_session_id FROM org_history_sessions h
         JOIN events e ON e.session_id=h.session_id
         WHERE h.root_session_id IS NOT NULL
         AND NOT EXISTS(SELECT 1 FROM org_history_copies c WHERE c.source_session_id=h.session_id) AND (
             (h.root_session_id=e.session_id AND e.function_name IN
                 ('user_message','user_input','user','message','assistant_message','assistant'))
             OR (json_valid(e.result_json) AND (
                 json_type(e.result_json,'$.agent_org_group_root_reply') IS NOT NULL
                 OR json_type(e.result_json,'$.agent_org_user_directed_reply') IS NOT NULL
                 OR json_type(e.result_json,'$.agent_org_initial_reply') IS NOT NULL)))",
    )?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let id: String = row.get("id")?;
        let source: String = row.get("session_id")?;
        let raw: String = row.get("result_json")?;
        let value = serde_json::from_str::<Value>(&raw).ok();
        let content = value
            .as_ref()
            .and_then(|v| v.get("content").or_else(|| v.pointer("/message/content")))
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or(row.get("content")?);
        if content.is_empty() {
            continue;
        }
        conn.execute(
            "INSERT OR IGNORE INTO org_history_items
            (id,root_session_id,source_session_id,kind,content,created_at,source_json)
            VALUES (?1,?2,?3,'conversation',?4,?5,?6)",
            params![
                stable_id("conversation", &format!("{source}:{id}")),
                row.get::<_, String>("root_session_id")?,
                source,
                content,
                row.get::<_, String>("created_at")?,
                raw
            ],
        )?;
    }
    Ok(())
}
