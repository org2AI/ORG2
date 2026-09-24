use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::{table_exists, READ_ONLY_ERROR};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HistoryMode {
    Current,
    HistoryOnly,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryMember {
    pub session_id: String,
    pub member_id: Option<String>,
    pub name: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryDescriptor {
    pub mode: HistoryMode,
    pub root_session_id: Option<String>,
    pub title: Option<String>,
    pub members: Vec<HistoryMember>,
}

pub fn descriptor(
    conn: &Connection,
    session_id: &str,
) -> rusqlite::Result<Option<HistoryDescriptor>> {
    if !table_exists(conn, "org_history_sessions")? {
        return Ok(None);
    }
    let historical = conn
        .query_row(
            "SELECT root_session_id,title FROM org_history_sessions WHERE session_id=?1",
            [session_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                ))
            },
        )
        .optional()?;
    if let Some((root, title)) = historical {
        let mut stmt = conn.prepare(
            "SELECT session_id,member_id,COALESCE(member_name,title) FROM org_history_sessions
             WHERE COALESCE(root_session_id,session_id)=?1 ORDER BY session_id",
        )?;
        let members = stmt
            .query_map([root.as_deref().unwrap_or(session_id)], |row| {
                Ok(HistoryMember {
                    session_id: row.get(0)?,
                    member_id: row.get(1)?,
                    name: row.get(2)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        return Ok(Some(HistoryDescriptor {
            mode: HistoryMode::HistoryOnly,
            root_session_id: root,
            title,
            members,
        }));
    }
    if table_exists(conn, "agent_sessions")? {
        let copy_title = conn
            .query_row(
                "SELECT s.name FROM org_history_copies c
            JOIN agent_sessions s ON s.session_id=c.copy_session_id WHERE c.copy_session_id=?1",
                [session_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if let Some(title) = copy_title {
            return Ok(Some(HistoryDescriptor {
                mode: HistoryMode::HistoryOnly,
                root_session_id: Some(session_id.into()),
                title: Some(title.clone()),
                members: vec![HistoryMember {
                    session_id: session_id.into(),
                    member_id: None,
                    name: Some(title),
                }],
            }));
        }
    }
    if !table_exists(conn, "agent_org_execution_runs")? {
        return Ok(None);
    }
    let current = conn.query_row(
        "SELECT r.id,r.root_session_id,s.name FROM agent_org_execution_runs r
         LEFT JOIN agent_sessions s ON s.session_id=r.root_session_id
         WHERE r.root_session_id=?1 OR EXISTS(SELECT 1 FROM agent_org_execution_member_materializations m
             WHERE m.org_run_id=r.id AND m.session_id=?1) LIMIT 1", [session_id],
        |row| Ok((row.get::<_,String>(0)?,row.get::<_,Option<String>>(1)?,row.get::<_,Option<String>>(2)?)),
    ).optional()?;
    if let Some((run, root, title)) = current {
        let mut stmt = conn.prepare(
            "SELECT m.session_id,m.member_id,s.name FROM agent_org_execution_member_materializations m
             LEFT JOIN agent_sessions s ON s.session_id=m.session_id WHERE m.org_run_id=?1 ORDER BY m.member_id")?;
        let members = stmt
            .query_map([run], |row| {
                Ok(HistoryMember {
                    session_id: row.get(0)?,
                    member_id: row.get(1)?,
                    name: row.get(2)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        return Ok(Some(HistoryDescriptor {
            mode: HistoryMode::Current,
            root_session_id: root,
            title,
            members,
        }));
    }
    Ok(None)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    pub id: String,
    pub source_session_id: Option<String>,
    pub kind: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    pub items: Vec<HistoryItem>,
    pub next_cursor: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct Cursor {
    session: String,
    time: String,
    id: String,
}

pub fn page(
    conn: &Connection,
    session_id: &str,
    cursor: Option<&str>,
    limit: usize,
) -> Result<HistoryPage, String> {
    let descriptor = descriptor(conn, session_id)
        .map_err(|e| e.to_string())?
        .filter(|value| matches!(value.mode, HistoryMode::HistoryOnly))
        .ok_or_else(|| "agent_org_history_not_found".to_string())?;
    let root = descriptor.root_session_id.as_deref().unwrap_or(session_id);
    let cursor = cursor
        .map(|raw| {
            if raw.len() > 2048 {
                return Err("invalid_history_cursor".to_string());
            }
            URL_SAFE_NO_PAD
                .decode(raw)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<Cursor>(&bytes).ok())
                .filter(|value| {
                    value.session == session_id && value.time.len() <= 96 && value.id.len() <= 512
                })
                .ok_or_else(|| "invalid_history_cursor".to_string())
        })
        .transpose()?;
    let limit = limit.clamp(1, 100);
    let time = cursor.as_ref().map(|c| c.time.as_str()).unwrap_or("");
    let id = cursor.as_ref().map(|c| c.id.as_str()).unwrap_or("");
    let mut stmt = conn
        .prepare(
            "SELECT id,source_session_id,kind,content,created_at FROM org_history_items
         WHERE root_session_id=?1 AND (created_at,id)>(?2,?3)
         ORDER BY created_at,id LIMIT ?4",
        )
        .map_err(|e| e.to_string())?;
    let mut items = stmt
        .query_map(params![root, time, id, (limit + 1) as i64], |row| {
            Ok(HistoryItem {
                id: row.get(0)?,
                source_session_id: row.get(1)?,
                kind: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    let next_cursor = if items.len() > limit {
        items.truncate(limit);
        let last = &items[limit - 1];
        Some(
            URL_SAFE_NO_PAD.encode(
                serde_json::to_vec(&Cursor {
                    session: session_id.into(),
                    time: last.created_at.clone(),
                    id: last.id.clone(),
                })
                .map_err(|e| e.to_string())?,
            ),
        )
    } else {
        None
    };
    Ok(HistoryPage { items, next_cursor })
}

pub fn require_current_run(conn: &Connection, run_id: &str) -> Result<(), String> {
    if !table_exists(conn, "org_history_sessions").map_err(|e| e.to_string())? {
        return Ok(());
    }
    let retired: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM org_history_sessions WHERE run_id=?1)",
            [run_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if retired {
        Err(READ_ONLY_ERROR.into())
    } else {
        Ok(())
    }
}
