//! Credential generations isolate auth, while native session files retain the
//! existing Vault-account history scope. Never link a whole HOME or auth DB.

use std::path::Path;

pub(super) fn share_history_directory(
    history: &Path,
    generation_history: &Path,
) -> Result<(), String> {
    std::fs::create_dir_all(history).map_err(|err| format!("Create native history: {err}"))?;
    if history == generation_history {
        return Ok(());
    }
    let canonical_history =
        std::fs::canonicalize(history).map_err(|err| format!("Resolve native history: {err}"))?;
    if std::fs::symlink_metadata(generation_history).is_ok() {
        if std::fs::canonicalize(generation_history).is_ok_and(|path| path == canonical_history) {
            return Ok(());
        }
        return Err("Credential generation has a conflicting native history directory".into());
    }
    let parent = generation_history
        .parent()
        .ok_or("Native history has no parent")?;
    std::fs::create_dir_all(parent).map_err(|err| format!("Create generation directory: {err}"))?;
    #[cfg(unix)]
    let result = std::os::unix::fs::symlink(history, generation_history);
    #[cfg(windows)]
    let result = junction::create(history, generation_history);
    match result {
        Ok(()) => Ok(()),
        // Two cooperating launches can create the same link concurrently.
        Err(_)
            if std::fs::canonicalize(generation_history)
                .is_ok_and(|path| path == canonical_history) =>
        {
            Ok(())
        }
        Err(err) => Err(format!(
            "Link native history into credential generation: {err}"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generations_share_live_history_but_not_credentials() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let first = root.join("credential-generations/1");
        let second = root.join("credential-generations/2");
        for home in [&first, &second] {
            share_history_directory(&root.join("sessions"), &home.join("sessions")).unwrap();
        }
        std::fs::write(first.join("auth.json"), "old login").unwrap();
        std::fs::write(second.join("auth.json"), "new login").unwrap();
        std::fs::write(first.join("sessions/turn.json"), "conversation").unwrap();
        assert_eq!(
            std::fs::read_to_string(second.join("sessions/turn.json")).unwrap(),
            "conversation"
        );
        std::fs::write(first.join("auth.json"), "late old rotation").unwrap();
        assert_eq!(
            std::fs::read_to_string(second.join("auth.json")).unwrap(),
            "new login"
        );
        // Native writers commonly replace files rather than updating in place.
        std::fs::write(first.join("sessions/next.json"), "continued").unwrap();
        std::fs::rename(
            first.join("sessions/next.json"),
            first.join("sessions/turn.json"),
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(second.join("sessions/turn.json")).unwrap(),
            "continued"
        );
        share_history_directory(&root.join("sessions"), &second.join("sessions")).unwrap();
    }

    #[test]
    fn conflicting_history_is_not_deleted_or_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let existing = dir.path().join("generation/sessions");
        std::fs::create_dir_all(&existing).unwrap();
        std::fs::write(existing.join("keep"), "history").unwrap();
        assert!(share_history_directory(&dir.path().join("sessions"), &existing).is_err());
        assert_eq!(
            std::fs::read_to_string(existing.join("keep")).unwrap(),
            "history"
        );
    }
}
