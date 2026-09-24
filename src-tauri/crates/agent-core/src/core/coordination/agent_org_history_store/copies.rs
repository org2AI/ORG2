//! Inert ordinary-session representations understood by official v2.0.8.
//! Called inside the source writer transaction; never invokes session/cloud hooks.
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use super::{stable_id, table_exists};

fn ensure_copy(conn: &Connection, source: &str) -> rusqlite::Result<Option<String>> {
    if !table_exists(conn, "org_history_copies")? || !table_exists(conn, "agent_sessions")? {
        return Ok(None);
    }
    let is_copy: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM org_history_copies WHERE copy_session_id=?1)",
        [source],
        |row| row.get(0),
    )?;
    if is_copy {
        return Ok(None);
    }
    let existing = conn
        .query_row(
            "SELECT copy_session_id FROM org_history_copies WHERE source_session_id=?1",
            [source],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if existing.is_some() {
        return Ok(existing);
    }
    let retired: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM org_history_sessions WHERE session_id=?1)",
        [source],
        |row| row.get(0),
    )?;
    let current = if table_exists(conn, "agent_org_execution_runs")? {
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM agent_org_execution_runs r WHERE r.root_session_id=?1)
                 OR EXISTS(SELECT 1 FROM agent_org_execution_member_materializations m WHERE m.session_id=?1)",
            [source], |row| row.get::<_,bool>(0),
        )?
    } else {
        false
    };
    if !retired && !current {
        return Ok(None);
    }
    let copy = format!(
        "{}{}",
        crate::definitions::prefix_lookup::SDE_SESSION_PREFIX,
        stable_id("session", source)
    );
    let inserted = conn.execute(
        "INSERT OR IGNORE INTO agent_sessions
         (session_id,name,status,user_input,created_at,updated_at,session_type)
         SELECT ?2,CASE WHEN s.parent_session_id IS NOT NULL THEN
             COALESCE((SELECT parent.name FROM agent_sessions parent WHERE parent.session_id=s.parent_session_id)||' · ','')||s.name
             ELSE s.name END,'idle',s.user_input,s.created_at,s.updated_at,'sde'
         FROM agent_sessions s WHERE s.session_id=?1",
        params![source, copy],
    )?;
    if inserted == 0 {
        return Ok(None);
    }
    conn.execute(
        "INSERT INTO org_history_copies VALUES (?1,?2)",
        params![source, copy],
    )?;
    Ok(Some(copy))
}

/// Persist only the changed event IDs. The original event writer owns atomicity.
pub fn mirror_events(
    conn: &Connection,
    session_id: &str,
    event_ids: &[&str],
) -> rusqlite::Result<()> {
    let Some(copy) = ensure_copy(conn, session_id)? else {
        return Ok(());
    };
    for id in event_ids {
        copy_event(conn, session_id, &copy, id)?;
    }
    Ok(())
}

fn inert_json(raw: &str, copy_session: &str) -> String {
    let Ok(mut value) = serde_json::from_str::<Value>(raw) else {
        return raw.to_owned();
    };
    if let Some(object) = value.as_object_mut() {
        // Direct user input remains visible after its execution provenance is
        // removed. Internal scheduler inputs keep their existing hidden flag.
        if object.get("agentOrgDirectSource").and_then(Value::as_bool) == Some(true) {
            object.remove("syntheticUserInput");
        }
        object.retain(|key, _| {
            !key.starts_with("agent_org_")
                && !key.starts_with("agentOrg")
                && !matches!(
                    key.as_str(),
                    "turnIntentId" | "turn_intent_id" | "orgRunId" | "org_run_id" | "execution"
                )
        });
        for key in ["sessionId", "session_id"] {
            if object.contains_key(key) {
                object.insert(key.into(), Value::String(copy_session.into()));
            }
        }
    }
    value.to_string()
}

fn copy_event(conn: &Connection, source: &str, copy: &str, id: &str) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare_cached("SELECT * FROM events WHERE session_id=?1 AND id=?2")?;
    let mut rows = stmt.query(params![source, id])?;
    let Some(row) = rows.next()? else {
        return Ok(());
    };
    let function: Option<String> = row.get("function_name")?;
    if function.as_deref() == Some("agent_org_execution") {
        return Ok(());
    }
    let result: String = row.get("result_json")?;
    let meta: Option<String> = row.get("meta_json")?;
    let copy_event_id = stable_id("event", &format!("{source}:{id}"));
    let fresh = !event_exists(conn, &copy_event_id)?;
    let changed=conn.execute(
        "INSERT INTO events
         (id,session_id,event_type,function_name,thread_id,args_json,result_json,content,
          created_at,meta_json,history_sequence)
         VALUES (?1,?2,?3,?4,NULL,?5,?6,?7,?8,?9,?10)
         ON CONFLICT(id) DO UPDATE SET result_json=excluded.result_json,
             args_json=excluded.args_json,content=excluded.content,meta_json=excluded.meta_json,
             history_sequence=excluded.history_sequence
         WHERE events.content IS NOT excluded.content OR events.result_json IS NOT excluded.result_json
            OR events.args_json IS NOT excluded.args_json OR events.meta_json IS NOT excluded.meta_json
            OR events.history_sequence IS NOT excluded.history_sequence",
        params![
            copy_event_id,
            copy,
            row.get::<_, String>("event_type")?,
            function,
            inert_json(&row.get::<_, String>("args_json")?,copy),
            inert_json(&result, copy),
            row.get::<_, String>("content")?,
            row.get::<_, String>("created_at")?,
            meta.map(|raw| {
                let mut value=serde_json::from_str::<Value>(&inert_json(&raw,copy)).unwrap_or(Value::Null);
                if let Some(object)=value.as_object_mut() { object.insert("chunk_id".into(),Value::String(copy_event_id.clone())); }
                value.to_string()
            }),
            row.get::<_, Option<i64>>("history_sequence")?
        ],
    )?;
    if changed > 0 {
        let time: String = row.get("created_at")?;
        refresh_copy_cache(conn, copy, &time, fresh)?;
        let value = serde_json::from_str::<Value>(&result).unwrap_or(Value::Null);
        if value
            .pointer("/agent_org_user_directed_reply/source_kind")
            .and_then(Value::as_str)
            == Some("group_mention")
        {
            // During the first v2.0.8 cutover, retired events are copied
            // before the isolated execution schema is created. A saved group
            // mention is still valid transcript history, but it cannot be
            // projected through current-run tables that do not exist yet.
            let run: Option<String> =
                if table_exists(conn, "agent_org_execution_member_materializations")?
                    && table_exists(conn, "agent_org_execution_runs")?
                {
                    conn.query_row(
                        "SELECT m.org_run_id FROM agent_org_execution_member_materializations m
                     JOIN agent_org_execution_runs r ON r.id=m.org_run_id
                     WHERE m.session_id=?1 AND r.root_session_id<>?1 LIMIT 1",
                        [source],
                        |r| r.get(0),
                    )
                    .optional()?
                } else {
                    None
                };
            if let Some(run) = run {
                let content = value
                    .get("content")
                    .or_else(|| value.pointer("/message/content"))
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if !content.is_empty() {
                    mirror_visible_item(conn, &run, id, "group_reply", content, &time)?;
                }
            }
        }
    }
    Ok(())
}

pub(super) fn backfill_retired(conn: &Connection) -> rusqlite::Result<()> {
    if !table_exists(conn, "events")? {
        return Ok(());
    }
    let mut sessions = conn.prepare(
        "SELECT session_id FROM org_history_sessions h WHERE NOT EXISTS
         (SELECT 1 FROM org_history_copies c WHERE c.source_session_id=h.session_id)",
    )?;
    let sources = sessions
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for source in sources {
        let Some(copy) = ensure_copy(conn, &source)? else {
            continue;
        };
        // Stream IDs from the existing session index: bounded memory even for
        // large archives. Bodies are fetched and written one at a time.
        let mut stmt = conn.prepare("SELECT id FROM events WHERE session_id=?1")?;
        let mut rows = stmt.query([&source])?;
        while let Some(row) = rows.next()? {
            let id: String = row.get(0)?;
            copy_event(conn, &source, &copy, &id)?;
        }
        backfill_items(conn, &source)?;
    }
    Ok(())
}

fn backfill_items(conn: &Connection, source: &str) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(
        "SELECT i.id,i.content,i.created_at,c.copy_session_id,i.kind FROM org_history_items i
         JOIN org_history_copies c ON c.source_session_id=i.root_session_id
         WHERE i.root_session_id=?1 AND (i.kind<>'conversation' OR i.source_session_id<>i.root_session_id)",
    )?;
    let mut rows = stmt.query([source])?;
    while let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        let content: String = row.get(1)?;
        let kind: String = row.get(4)?;
        let role = if matches!(kind.as_str(), "initial_input" | "member_input") {
            "user"
        } else {
            "assistant"
        };
        let result = serde_json::json!({"type":role,"content":content,"message":{"role":role,"content":content}});
        let event_id = stable_id("item-event", &id);
        let copy: String = row.get(3)?;
        let created_at: String = row.get(2)?;
        let fresh = !event_exists(conn, &event_id)?;
        conn.execute(
            "INSERT OR IGNORE INTO events
             (id,session_id,event_type,function_name,args_json,result_json,content,created_at)
             VALUES (?1,?2,'raw','message','{}',?3,?4,?5)",
            params![
                event_id,
                row.get::<_, String>(3)?,
                result.to_string(),
                content,
                row.get::<_, String>(2)?
            ],
        )?;
        if fresh {
            refresh_copy_cache(conn, &copy, &created_at, true)?;
        }
    }
    Ok(())
}

/// Incremental projection of content whose authoritative row is team-specific.
pub(crate) fn mirror_visible_item(
    conn: &Connection,
    run_id: &str,
    source_id: &str,
    kind: &str,
    content: &str,
    created_at: &str,
) -> rusqlite::Result<()> {
    if !table_exists(conn, "org_history_copies")? {
        return Ok(());
    }
    let root: Option<String> = conn
        .query_row(
            "SELECT root_session_id FROM agent_org_execution_runs WHERE id=?1",
            [run_id],
            |r| r.get(0),
        )
        .optional()?
        .flatten();
    let Some(root) = root else {
        return Ok(());
    };
    let Some(copy) = ensure_copy(conn, &root)? else {
        return Ok(());
    };
    let id = stable_id("visible", &format!("{run_id}:{kind}:{source_id}"));
    conn.execute(
        "INSERT INTO org_history_items (id,root_session_id,kind,content,created_at,source_json)
         VALUES (?1,?2,?3,?4,?5,'{}') ON CONFLICT(id) DO UPDATE SET content=excluded.content WHERE org_history_items.content IS NOT excluded.content",
        params![id, root, kind, content, created_at],
    )?;
    let role = if kind == "group_message" {
        "user"
    } else {
        "assistant"
    };
    let result = serde_json::json!({"type":role,"content":content,"message":{"role":role,"content":content}});
    let event_id = stable_id("visible-event", &id);
    let fresh = !event_exists(conn, &event_id)?;
    let changed=conn.execute(
        "INSERT INTO events (id,session_id,event_type,function_name,args_json,result_json,content,created_at)
         VALUES (?1,?2,'raw','message','{}',?3,?4,?5)
         ON CONFLICT(id) DO UPDATE SET content=excluded.content,result_json=excluded.result_json WHERE events.content IS NOT excluded.content OR events.result_json IS NOT excluded.result_json",
        params![event_id,copy,result.to_string(),content,created_at],
    )?;
    if changed > 0 {
        refresh_copy_cache(conn, &copy, created_at, fresh)?;
    }
    Ok(())
}

pub(crate) fn mirror_task_output(
    conn: &Connection,
    task: &super::super::agent_org_tasks::Task,
) -> Result<(), String> {
    let Some(output) = task.output.as_ref() else {
        return Ok(());
    };
    let text = match output.content.as_deref() {
        Some(content) => format!("{}\n\n{}\n\n{}", task.subject, output.summary, content),
        None => format!("{}\n\n{}", task.subject, output.summary),
    };
    mirror_visible_item(
        conn,
        &task.org_run_id,
        &task.id,
        "output",
        &text,
        &output.produced_at,
    )
    .map_err(|error| error.to_string())
}

fn event_exists(conn: &Connection, id: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM events WHERE id=?1)",
        [id],
        |r| r.get(0),
    )
}

fn refresh_copy_cache(
    conn: &Connection,
    copy: &str,
    time: &str,
    fresh: bool,
) -> rusqlite::Result<()> {
    if table_exists(conn, "sessions")? {
        conn.execute("INSERT INTO sessions
            (session_id,event_count,cached_at,content_revision,time_range_start,time_range_end)
            VALUES (?1,?2,?3,1,?4,?4)
            ON CONFLICT(session_id) DO UPDATE SET
                event_count=sessions.event_count+excluded.event_count,
                cached_at=excluded.cached_at,content_revision=sessions.content_revision+1,
                time_range_start=MIN(COALESCE(sessions.time_range_start,excluded.time_range_start),excluded.time_range_start),
                time_range_end=MAX(COALESCE(sessions.time_range_end,excluded.time_range_end),excluded.time_range_end)",
            params![copy,i64::from(fresh),chrono::Utc::now().timestamp_millis(),time])?;
    }
    if table_exists(conn, "session_turn_index_state")? {
        conn.execute(
            "DELETE FROM session_turn_index_state WHERE session_id=?1",
            [copy],
        )?;
    }
    Ok(())
}
