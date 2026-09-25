//! Resolve the logical thread through the vendor's authoritative current row.
//! Physical generations retained for forks are not alternate current threads.
use rusqlite::{Connection, OpenFlags};
use std::{
    fs,
    path::{Component, Path, PathBuf},
    time::Duration,
};

const INDEX: &str = "state_5.sqlite";

pub(super) fn exists(home: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(home.join(INDEX)) {
        Ok(meta) if meta.is_file() => Ok(true),
        Ok(_) => Err("Codex native index must be a regular file".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("Inspect Codex native index: {error}")),
    }
}

/// None means there is no native index, permitting bounded legacy discovery.
/// Once present, missing rows, invalid paths and unreadable state are errors;
/// neither retained physical files nor an imported cache may replace authority.
pub(super) fn resolve(
    home: &Path,
    runner_home: Option<&Path>,
    id: &str,
) -> Result<Option<PathBuf>, String> {
    uuid::Uuid::parse_str(id).map_err(|_| "Invalid native transcript UUID")?;
    if !exists(home)? {
        return Ok(None);
    }
    for suffix in ["-wal", "-shm", "-journal"] {
        match fs::symlink_metadata(home.join(format!("{INDEX}{suffix}"))) {
            Ok(meta) if !meta.is_file() => {
                return Err("Codex index sidecar must be a regular file".into())
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Inspect Codex index sidecar: {error}")),
        }
    }
    let db = Connection::open_with_flags(home.join(INDEX), OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("Open Codex native index: {error}"))?;
    db.busy_timeout(Duration::from_millis(100))
        .map_err(|error| error.to_string())?;
    let mut query = db.prepare(
        "SELECT CASE WHEN length(CAST(rollout_path AS BLOB)) BETWEEN 1 AND 8192 THEN rollout_path ELSE NULL END FROM threads WHERE id=?1 LIMIT 2"
    ).map_err(|error| format!("Read Codex native index: {error}"))?;
    let rows = query
        .query_map([id], |row| row.get::<_, String>(0))
        .map_err(|error| format!("Read Codex indexed rollout: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Invalid Codex indexed rollout: {error}"))?;
    let [path] = rows.as_slice() else {
        return Err("Codex native index has no unique current thread".into());
    };
    let path = Path::new(path);
    if !path.is_absolute()
        || path.components().any(|part| part == Component::ParentDir)
        || path
            .extension()
            .is_none_or(|extension| extension != "jsonl")
    {
        return Err("Invalid Codex indexed rollout path".into());
    }
    let current = fs::canonicalize(path)
        .map_err(|error| format!("Resolve Codex indexed rollout: {error}"))?;
    // sqlite_home controls only the vendor index. Fresh own-key threads write
    // raw history under CODEX_HOME, owned by the persisted account. Accept that
    // exact second owner, never another account or an arbitrary indexed path.
    for home in std::iter::once(home).chain(runner_home) {
        let root = match fs::canonicalize(home) {
            Ok(root) => root,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("Resolve Codex history home: {error}")),
        };
        let Ok(relative) = current.strip_prefix(&root) else {
            continue;
        };
        if !matches!(relative.components().next(), Some(Component::Normal(part)) if part == "sessions" || part == "archived_sessions")
            || !current.is_file()
        {
            return Err("Codex indexed rollout is not a stored transcript".into());
        }
        // Retain the caller's root spelling (macOS /var vs /private/var).
        return Ok(Some(home.join(relative)));
    }
    Err("Codex indexed rollout escaped its store".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    const ID: &str = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

    #[test]
    fn indexed_codex_path_is_current_bounded_and_store_scoped() {
        let home = tempfile::tempdir().unwrap();
        assert_eq!(resolve(home.path(), None, ID).unwrap(), None);
        let db = Connection::open(home.path().join(INDEX)).unwrap();
        db.execute_batch("CREATE TABLE threads(id TEXT, rollout_path TEXT)")
            .unwrap();
        assert!(resolve(home.path(), None, ID).is_err());
        let archived = home.path().join("archived_sessions/physical.jsonl");
        fs::create_dir_all(archived.parent().unwrap()).unwrap();
        fs::write(&archived, "{}\n").unwrap();
        db.execute(
            "INSERT INTO threads VALUES (?1,?2)",
            [ID, archived.to_str().unwrap()],
        )
        .unwrap();
        assert_eq!(
            resolve(home.path(), None, ID).unwrap(),
            Some(archived.clone())
        );
        for invalid in [
            "relative.jsonl".to_string(),
            "x".repeat(8193),
            home.path()
                .join("outside.jsonl")
                .to_string_lossy()
                .into_owned(),
        ] {
            db.execute("UPDATE threads SET rollout_path=?1", [&invalid])
                .unwrap();
            assert!(resolve(home.path(), None, ID).is_err());
        }
        db.execute(
            "UPDATE threads SET rollout_path=?1",
            [archived.to_str().unwrap()],
        )
        .unwrap();
        db.execute("INSERT INTO threads SELECT * FROM threads", [])
            .unwrap();
        assert!(resolve(home.path(), None, ID).is_err());
        db.execute("DELETE FROM threads WHERE rowid=2", []).unwrap();
        db.execute_batch("BEGIN EXCLUSIVE").unwrap();
        assert!(resolve(home.path(), None, ID).is_err());
        db.execute_batch("ROLLBACK; DROP TABLE threads").unwrap();
        assert!(resolve(home.path(), None, ID).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn indexed_codex_path_rejects_cross_store_links() {
        let home = tempfile::tempdir().unwrap();
        let foreign = tempfile::tempdir().unwrap();
        let db = Connection::open(home.path().join(INDEX)).unwrap();
        db.execute_batch("CREATE TABLE threads(id TEXT PRIMARY KEY, rollout_path TEXT)")
            .unwrap();
        fs::create_dir(home.path().join("sessions")).unwrap();
        let outside = foreign.path().join("foreign.jsonl");
        fs::write(&outside, "{}\n").unwrap();
        let alias = home.path().join("sessions/alias.jsonl");
        std::os::unix::fs::symlink(&outside, &alias).unwrap();
        db.execute(
            "INSERT INTO threads VALUES (?1,?2)",
            [ID, alias.to_str().unwrap()],
        )
        .unwrap();
        assert!(resolve(home.path(), None, ID).is_err());
    }
}
