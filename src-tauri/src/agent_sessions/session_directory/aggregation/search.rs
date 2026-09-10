//! Demand-driven name search over the Desktop's indexed directory, not its
//! currently rendered sidebar. The cursor counts source rows, including rows
//! removed while hydrating, so a missing/hidden row cannot repeat a page.

use database::db::get_connection;
use rusqlite::{params_from_iter, types::Value, Connection};

use super::external_history::EXTERNAL_HISTORY_SOURCE_LOADERS;
use super::native_page::hydrate_directory_row;
use crate::agent_sessions::session_directory::conversion::AgentMetadataResolver;
use crate::agent_sessions::session_directory::types::SessionAggregateRecord;

pub struct SessionNameSearchPage {
    pub sessions: Vec<SessionAggregateRecord>,
    pub next_offset: usize,
    pub has_more: bool,
}

fn candidates(
    conn: &Connection,
    query: &str,
    limit: usize,
    offset: usize,
) -> Result<Vec<(String, String)>, String> {
    let sources = [
        orgtrack_core::canonical::SOURCE_ORGII_CLI_SESSIONS,
        orgtrack_core::canonical::SOURCE_ORGII_RUST_AGENTS,
    ]
    .into_iter()
    .chain(
        EXTERNAL_HISTORY_SOURCE_LOADERS
            .iter()
            .map(|loader| loader.source),
    );
    let mut values = sources
        .map(|source| Value::Text(source.to_string()))
        .collect::<Vec<_>>();
    let placeholders = vec!["?"; values.len()].join(",");
    // instr treats %, _ and backslashes literally. Query values never become SQL.
    let sql = format!(
        "SELECT session_id, source FROM orgtrack_core_sessions
        WHERE source IN ({placeholders}) AND instr(lower(title), lower(?)) > 0
        ORDER BY updated_at DESC, session_id ASC LIMIT ? OFFSET ?"
    );
    values.extend([
        Value::Text(query.to_string()),
        Value::Integer((limit + 1) as i64),
        Value::Integer(offset as i64),
    ]);
    let mut statement = conn.prepare(&sql).map_err(|err| err.to_string())?;
    let rows = statement
        .query_map(params_from_iter(values), |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())
}

pub fn search_session_names(
    query: &str,
    limit: usize,
    offset: usize,
) -> Result<SessionNameSearchPage, String> {
    let limit = limit.clamp(1, 200);
    let offset = offset.min(i64::MAX as usize - 201);
    let conn = get_connection().map_err(|err| err.to_string())?;
    let rows = candidates(&conn, query, limit, offset)?;
    let mut resolver = AgentMetadataResolver::new();
    hydrate_page(rows, limit, offset, |id, source| {
        hydrate_directory_row(&conn, id, source, &mut resolver)
    })
}

fn hydrate_page(
    rows: Vec<(String, String)>,
    limit: usize,
    offset: usize,
    mut hydrate: impl FnMut(&str, &str) -> Result<Option<SessionAggregateRecord>, String>,
) -> Result<SessionNameSearchPage, String> {
    let has_more = rows.len() > limit;
    let consumed = rows.len().min(limit);
    let mut sessions = Vec::with_capacity(consumed);
    for (id, source) in rows.into_iter().take(limit) {
        if let Some(row) = hydrate(&id, &source)? {
            sessions.push(row);
        }
    }
    Ok(SessionNameSearchPage {
        sessions,
        next_offset: offset + consumed,
        has_more,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn search_cursor_consumes_missing_rows_without_hydrating_lookahead() {
        let rows = (0..3)
            .map(|n| (n.to_string(), "source".to_string()))
            .collect();
        let mut calls = 0;
        let page = hydrate_page(rows, 2, 50, |_, _| {
            calls += 1;
            Ok(None)
        })
        .unwrap();
        assert_eq!(calls, 2);
        assert!(page.sessions.is_empty());
        assert_eq!(page.next_offset, 52);
        assert!(page.has_more);
        let empty =
            hydrate_page(vec![], 2, 52, |_, _| panic!("empty page must not hydrate")).unwrap();
        assert_eq!(empty.next_offset, 52);
        assert!(!empty.has_more);
    }

    #[test]
    fn search_hydration_failure_is_not_reported_as_empty_success() {
        let page = hydrate_page(vec![("id".into(), "source".into())], 2, 0, |_, _| {
            Err("read failure".into())
        });
        assert_eq!(page.err().as_deref(), Some("read failure"));
    }

    #[test]
    fn searches_history_before_paging_with_literal_queries_and_stable_ties() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE orgtrack_core_sessions (session_id TEXT, source TEXT, title TEXT, updated_at TEXT)").unwrap();
        for i in 0..151 {
            conn.execute(
                "INSERT INTO orgtrack_core_sessions VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![
                    format!("s-{i:03}"),
                    orgtrack_core::canonical::SOURCE_ORGII_CLI_SESSIONS,
                    if i == 150 {
                        "old 认证_100%"
                    } else {
                        "ordinary"
                    },
                    "2026-09-08"
                ],
            )
            .unwrap();
        }
        assert_eq!(candidates(&conn, "认证_100%", 50, 0).unwrap()[0].0, "s-150");
        assert!(candidates(&conn, "' OR 1=1 --", 50, 0).unwrap().is_empty());
        assert_eq!(candidates(&conn, "ORDINARY", 50, 0).unwrap().len(), 51);
        assert_eq!(candidates(&conn, "ordinary", 50, 50).unwrap()[0].0, "s-050");
        assert_eq!(candidates(&conn, "ordinary", 50, 100).unwrap().len(), 50);
        assert!(candidates(&conn, "ordinary", 50, 150).unwrap().is_empty());
        conn.execute("INSERT INTO orgtrack_core_sessions VALUES ('foreign', 'unrelated-source', 'ordinary', '9999')", []).unwrap();
        assert_eq!(candidates(&conn, "ordinary", 200, 0).unwrap().len(), 150);
        assert_eq!(
            conn.query_row("SELECT count(*) FROM orgtrack_core_sessions", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            152
        );
    }
}
