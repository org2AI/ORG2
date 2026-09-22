//! Bounded historical read for review surfaces. Never consult the live file.
use super::{paths, types::FileSnapshot};
use rusqlite::OptionalExtension;
use std::{
    fs::File,
    io::{self, Read},
    path::{Component, Path},
};

const MAX_BYTES: u64 = 512 * 1024;

fn safe_segment(value: &str) -> bool {
    !value.is_empty()
        && Path::new(value).components().count() == 1
        && matches!(
            Path::new(value).components().next(),
            Some(Component::Normal(_))
        )
}

fn bounded_bytes(path: &Path) -> io::Result<Vec<u8>> {
    if !std::fs::symlink_metadata(path)?.is_file() {
        return Err(io::Error::other("not a regular backup"));
    }
    let file = File::open(path)?;
    if !file.metadata()?.is_file() {
        return Err(io::Error::other("not a regular backup"));
    }
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(io::Error::other("snapshot exceeds review budget"));
    }
    Ok(bytes)
}

/// Return the pre-tool whole file only when the exact owner/tool/path backup
/// exists and its content hash verifies. Missing/evicted/binary backups stay
/// unavailable. An empty string means a captured non-existent file, not error.
pub fn read_pre_tool_file(session_id: &str, tool_call_id: &str, file_path: &str) -> Option<String> {
    if !safe_segment(session_id) {
        return None;
    }
    let conn = database::db::get_connection().ok()?;
    let id: Option<String> = conn.query_row(
        "SELECT hash FROM agent_snapshots WHERE session_id = ?1 AND tool_call_id = ?2 ORDER BY created_at ASC LIMIT 1",
        rusqlite::params![session_id, tool_call_id], |row| row.get(0)
    ).optional().ok()?;
    read_file(session_id, &id?, file_path).ok()
}

fn read_file(session_id: &str, id: &str, file_path: &str) -> io::Result<String> {
    if !safe_segment(session_id) || !safe_segment(id) {
        return Err(io::Error::other("invalid snapshot identity"));
    }
    let snapshot: FileSnapshot =
        serde_json::from_slice(&bounded_bytes(&paths::snapshot_file(session_id, id))?)
            .map_err(io::Error::other)?;
    let backup = snapshot
        .backups
        .get(file_path)
        .ok_or_else(|| io::Error::other("file not captured"))?;
    if backup.untrackable {
        return Err(io::Error::other("untrackable file"));
    }
    let Some(hash) = &backup.content_hash else {
        return Ok(String::new());
    };
    if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(io::Error::other("invalid backup hash"));
    }
    let bytes = bounded_bytes(&paths::backup_file(session_id, hash))?;
    if bytes.contains(&0) || paths::hash_bytes(&bytes) != *hash {
        return Err(io::Error::other("unavailable backup"));
    }
    String::from_utf8(bytes).map_err(io::Error::other)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn historical_reader_uses_capture_not_current_file_and_rejects_corruption() {
        let sandbox = test_helpers::test_env::sandbox();
        let path = sandbox.path().join("review.txt");
        std::fs::write(&path, "before\n").unwrap();
        let id = super::super::make_tool_snapshot("review-owner", std::slice::from_ref(&path)).unwrap();
        let conn = database::db::get_connection().unwrap();
        crate::persistence::session_snapshots::ensure_tables_with(&conn).unwrap();
        crate::core::session::persistence::save_snapshot("review-owner", "edit-call", &id).unwrap();
        std::fs::write(&path, "unrelated later change\n").unwrap();
        assert_eq!(
            read_file("review-owner", &id, path.to_str().unwrap()).unwrap(),
            "before\n"
        );
        assert_eq!(
            read_pre_tool_file("review-owner", "edit-call", path.to_str().unwrap()).as_deref(),
            Some("before\n")
        );
        assert!(
            read_pre_tool_file("review-owner", "unrelated-call", path.to_str().unwrap()).is_none()
        );
        assert!(read_file("other-owner", &id, path.to_str().unwrap()).is_err());
        assert!(read_file("../outside", &id, path.to_str().unwrap()).is_err());
        let hash = paths::hash_bytes(b"before\n");
        std::fs::write(paths::backup_file("review-owner", &hash), "corrupt").unwrap();
        assert!(read_file("review-owner", &id, path.to_str().unwrap()).is_err());
    }
}
