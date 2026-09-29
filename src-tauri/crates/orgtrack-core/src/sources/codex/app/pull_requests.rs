//! Explicit Codex thread attachments, never inferred from prose or shell output.
use std::{
    collections::HashSet,
    fs::File,
    io::{BufRead, BufReader, Read},
    path::Path,
};

use rusqlite::{Connection, OpenFlags};
use serde_json::Value;

const MAX_ATTACHMENTS: usize = 100;

pub fn load_codex_pull_requests_from_path(path: &Path) -> Result<Vec<String>, String> {
    let Some(home) = path
        .ancestors()
        .find(|ancestor| {
            matches!(
                ancestor.file_name().and_then(|name| name.to_str()),
                Some("sessions" | "archived_sessions")
            )
        })
        .and_then(Path::parent)
    else {
        return Ok(Vec::new());
    };
    let mut header = String::new();
    BufReader::new(
        File::open(path)
            .map_err(|err| format!("Read Codex attachment scope: {err}"))?
            .take(1024 * 1024),
    )
    .read_line(&mut header)
    .map_err(|err| format!("Read Codex attachment scope: {err}"))?;
    let meta: Value = serde_json::from_str(&header)
        .map_err(|err| format!("Read Codex attachment scope: {err}"))?;
    if meta["type"] != "session_meta" {
        return Ok(Vec::new());
    }
    let Some(thread_id) = meta["payload"]["id"]
        .as_str()
        .filter(|id| !id.is_empty() && id.len() <= 128)
    else {
        return Ok(Vec::new());
    };
    // The rollout owns its provider home; never fall back to the desktop user's
    // default home, which may belong to a different managed Codex instance.
    let db = std::fs::read_dir(home)
        .map_err(|err| format!("Read Codex attachment store: {err}"))?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name();
            let version = name
                .to_str()?
                .strip_prefix("state_")?
                .strip_suffix(".sqlite")?
                .parse::<u32>()
                .ok()?;
            Some((version, entry.path()))
        })
        .max_by_key(|(version, _)| *version);
    let Some((_, db)) = db else {
        return Ok(Vec::new());
    };
    let conn = Connection::open_with_flags(
        db,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|err| format!("Read Codex attachment store: {err}"))?;
    conn.busy_timeout(std::time::Duration::from_millis(250))
        .map_err(|err| err.to_string())?;
    read_attachments(&conn, thread_id)
}

fn canonical_pull_request_url(raw: &str) -> Option<String> {
    let tail = raw.strip_prefix("https://github.com/")?;
    let parts: Vec<_> = tail.trim_end_matches('/').split('/').collect();
    if parts.len() != 4
        || parts[2] != "pull"
        || parts[..2].iter().any(|part| {
            part.is_empty()
                || !part
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
        })
    {
        return None;
    }
    let number = parts[3].parse::<u64>().ok().filter(|number| *number > 0)?;
    Some(format!(
        "https://github.com/{}/{}/pull/{number}",
        parts[0].to_lowercase(),
        parts[1].to_lowercase()
    ))
}

fn read_attachments(conn: &Connection, thread_id: &str) -> Result<Vec<String>, String> {
    let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='thread_attachments')", [], |row| row.get(0)).map_err(|err| err.to_string())?;
    if !exists {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare("SELECT payload FROM thread_attachments WHERE thread_id = ?1 AND attachment_type = 'pull_request' AND length(payload) <= 16384 ORDER BY created_at DESC, id DESC LIMIT ?2").map_err(|err| format!("Read Codex attachments: {err}"))?;
    let rows = stmt
        .query_map(
            rusqlite::params![thread_id, MAX_ATTACHMENTS as i64],
            |row| row.get::<_, String>(0),
        )
        .map_err(|err| err.to_string())?;
    let mut seen = HashSet::new();
    let mut urls = Vec::new();
    for row in rows {
        let payload = row.map_err(|err| err.to_string())?;
        if let Ok(value) = serde_json::from_str::<Value>(&payload) {
            if let Some(url) = value["url"].as_str().and_then(canonical_pull_request_url) {
                if seen.insert(url.clone()) {
                    urls.push(url);
                }
            }
        }
    }
    Ok(urls)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE thread_attachments (id INTEGER PRIMARY KEY, thread_id TEXT, attachment_type TEXT, payload TEXT, created_at INTEGER)").unwrap();
        conn
    }
    fn add(conn: &Connection, thread: &str, kind: &str, url: &str, time: i64) {
        conn.execute("INSERT INTO thread_attachments (thread_id, attachment_type, payload, created_at) VALUES (?1,?2,?3,?4)", rusqlite::params![thread,kind,serde_json::json!({"url":url}).to_string(),time]).unwrap();
    }
    #[test]
    fn exact_thread_explicit_attachments_are_deduplicated_newest_first() {
        let conn = fixture();
        add(
            &conn,
            "current",
            "pull_request",
            "https://github.com/org2AI/ORG2/pull/2152",
            1,
        );
        add(
            &conn,
            "current",
            "pull_request",
            "https://github.com/org2AI/ORG2/pull/2153",
            2,
        );
        add(
            &conn,
            "current",
            "pull_request",
            "https://github.com/ORG2AI/ORG2/pull/2153",
            3,
        );
        add(
            &conn,
            "other",
            "pull_request",
            "https://github.com/org2AI/ORG2/pull/999",
            4,
        );
        add(
            &conn,
            "current",
            "worktree",
            "https://github.com/org2AI/ORG2/pull/998",
            5,
        );
        assert_eq!(
            read_attachments(&conn, "current").unwrap(),
            vec![
                "https://github.com/org2ai/org2/pull/2153",
                "https://github.com/org2ai/org2/pull/2152"
            ]
        );
        assert!(read_attachments(&conn, "missing").unwrap().is_empty());
    }
    #[test]
    fn malformed_and_unsupported_links_are_not_associations() {
        let conn = fixture();
        for url in [
            "file:///secret",
            "https://github.com/acme/repo/issues/1",
            "https://github.com.evil/acme/repo/pull/1",
            "https://github.com/acme/repo/pull/0",
        ] {
            add(&conn, "current", "pull_request", url, 1);
        }
        assert!(read_attachments(&conn, "current").unwrap().is_empty());
    }
    #[test]
    fn bounded_and_legacy_missing_table_is_empty() {
        let conn = fixture();
        for i in 1..=110 {
            add(
                &conn,
                "current",
                "pull_request",
                &format!("https://github.com/acme/repo/pull/{i}"),
                i,
            );
        }
        assert_eq!(read_attachments(&conn, "current").unwrap().len(), 100);
        assert!(
            read_attachments(&Connection::open_in_memory().unwrap(), "current")
                .unwrap()
                .is_empty()
        );
    }
    #[test]
    fn path_reader_uses_own_home_and_observes_removal() {
        let root = std::env::temp_dir().join(format!(
            "org2-attachments-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let home = root.join("managed-profile");
        let path = home.join("sessions/2026/09/25/rollout.jsonl");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(
            &path,
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"thread-a\"}}\n",
        )
        .unwrap();
        assert!(load_codex_pull_requests_from_path(&path)
            .unwrap()
            .is_empty());
        let conn = Connection::open(home.join("state_5.sqlite")).unwrap();
        conn.execute_batch("CREATE TABLE thread_attachments (id INTEGER PRIMARY KEY, thread_id TEXT, attachment_type TEXT, payload TEXT, created_at INTEGER)").unwrap();
        add(
            &conn,
            "thread-a",
            "pull_request",
            "https://github.com/acme/repo/pull/1",
            1,
        );
        add(
            &conn,
            "thread-b",
            "pull_request",
            "https://github.com/acme/repo/pull/2",
            2,
        );
        assert_eq!(
            load_codex_pull_requests_from_path(&path).unwrap(),
            vec!["https://github.com/acme/repo/pull/1"]
        );
        conn.execute(
            "DELETE FROM thread_attachments WHERE thread_id = 'thread-a'",
            [],
        )
        .unwrap();
        assert!(load_codex_pull_requests_from_path(&path)
            .unwrap()
            .is_empty());
        drop(conn);
        std::fs::write(home.join("state_6.sqlite"), "corrupt").unwrap();
        assert!(load_codex_pull_requests_from_path(&path).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
