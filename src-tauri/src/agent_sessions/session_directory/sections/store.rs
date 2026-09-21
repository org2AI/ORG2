//! Personal sidebar organization. Never writes provider, project, or pin metadata.
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

pub const MAX_SECTIONS: usize = 100;
pub const MAX_MEMBERS: usize = 10_000;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub id: String,
    pub name: String,
    pub position: i64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub session_id: String,
    pub section_id: String,
}
#[derive(Debug, Serialize)]
pub struct Snapshot {
    pub sections: Vec<Section>,
    pub members: Vec<Member>,
}
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Mutation {
    Create {
        name: String,
        #[serde(rename = "sessionId")]
        session_id: Option<String>,
    },
    Rename {
        id: String,
        name: String,
    },
    Delete {
        id: String,
    },
    Reorder {
        ids: Vec<String>,
    },
    Assign {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "sectionId")]
        section_id: Option<String>,
    },
}

pub fn init(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS sidebar_sections (
        id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80), position INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sidebar_section_members (
        session_id TEXT PRIMARY KEY, section_id TEXT NOT NULL REFERENCES sidebar_sections(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS sidebar_section_members_page ON sidebar_section_members(section_id, session_id);")
        .map_err(|e| e.to_string())
}

pub fn snapshot(conn: &Connection) -> Result<Snapshot, String> {
    let mut stmt = conn
        .prepare("SELECT id,name,position FROM sidebar_sections ORDER BY position,id")
        .map_err(|e| e.to_string())?;
    let sections = stmt
        .query_map([], |r| {
            Ok(Section {
                id: r.get(0)?,
                name: r.get(1)?,
                position: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT session_id,section_id FROM sidebar_section_members ORDER BY session_id")
        .map_err(|e| e.to_string())?;
    let members = stmt
        .query_map([], |r| {
            Ok(Member {
                session_id: r.get(0)?,
                section_id: r.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(Snapshot { sections, members })
}

fn name(value: &str) -> Result<&str, String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 80 || value.chars().any(char::is_control) {
        return Err("Section names must contain 1–80 characters and no control characters".into());
    }
    Ok(value)
}
fn require_section(conn: &Connection, id: &str) -> Result<(), String> {
    if !conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sidebar_sections WHERE id=?1)",
            [id],
            |r| r.get::<_, bool>(0),
        )
        .map_err(|e| e.to_string())?
    {
        return Err("Section no longer exists".into());
    }
    Ok(())
}
fn assign(conn: &Connection, session_id: &str, section_id: Option<&str>) -> Result<(), String> {
    if let Some(id) = section_id {
        require_section(conn, id)?;
        let count: usize = conn
            .query_row(
                "SELECT count(*) FROM sidebar_section_members WHERE session_id != ?1",
                [session_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if count >= MAX_MEMBERS {
            return Err("Sidebar section membership limit reached".into());
        }
        conn.execute("INSERT INTO sidebar_section_members(session_id,section_id) VALUES(?1,?2) ON CONFLICT(session_id) DO UPDATE SET section_id=excluded.section_id", params![session_id, id]).map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "DELETE FROM sidebar_section_members WHERE session_id=?1",
            [session_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The caller validates session identity against its owning directory before writing.
pub fn mutate(conn: &mut Connection, mutation: Mutation) -> Result<Snapshot, String> {
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    match mutation {
        Mutation::Create {
            name: raw,
            session_id,
        } => {
            let name = name(&raw)?;
            let count: usize = tx
                .query_row("SELECT count(*) FROM sidebar_sections", [], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            if count >= MAX_SECTIONS {
                return Err("Maximum 100 sidebar sections".into());
            }
            let id = uuid::Uuid::new_v4().to_string();
            tx.execute("INSERT INTO sidebar_sections(id,name,position) SELECT ?1,?2,COALESCE(MAX(position),-1)+1 FROM sidebar_sections", params![id,name]).map_err(|e| e.to_string())?;
            if let Some(session_id) = session_id {
                assign(&tx, &session_id, Some(&id))?;
            }
        }
        Mutation::Rename { id, name: raw } => {
            require_section(&tx, &id)?;
            tx.execute(
                "UPDATE sidebar_sections SET name=?2 WHERE id=?1",
                params![id, name(&raw)?],
            )
            .map_err(|e| e.to_string())?;
        }
        Mutation::Delete { id } => {
            require_section(&tx, &id)?;
            tx.execute(
                "DELETE FROM sidebar_section_members WHERE section_id=?1",
                [&id],
            )
            .map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM sidebar_sections WHERE id=?1", [&id])
                .map_err(|e| e.to_string())?;
        }
        Mutation::Assign {
            session_id,
            section_id,
        } => assign(&tx, &session_id, section_id.as_deref())?,
        Mutation::Reorder { ids } => {
            let current = snapshot(&tx)?;
            let unique: std::collections::HashSet<_> = ids.iter().collect();
            if ids.len() != current.sections.len()
                || unique.len() != ids.len()
                || current.sections.iter().any(|s| !unique.contains(&s.id))
            {
                return Err("Reorder must contain every section exactly once".into());
            }
            for (position, id) in ids.iter().enumerate() {
                tx.execute(
                    "UPDATE sidebar_sections SET position=?2 WHERE id=?1",
                    params![id, position as i64],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }
    let result = snapshot(&tx)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(result)
}

pub fn page_ids(
    conn: &Connection,
    id: &str,
    after: Option<&str>,
    limit: usize,
) -> Result<Vec<String>, String> {
    require_section(conn, id)?;
    if !(1..=50).contains(&limit) {
        return Err("Section page limit must be 1–50".into());
    }
    let mut stmt = conn.prepare("SELECT session_id FROM sidebar_section_members WHERE section_id=?1 AND session_id>?2 ORDER BY session_id LIMIT ?3").map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![id, after.unwrap_or(""), (limit + 1) as i64], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}
