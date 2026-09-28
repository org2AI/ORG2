//! One auth-store location for the frontend writer, Market and mobile relay.
//! Custom data homes must never inherit credentials from a reused bundle ID.

use std::path::{Path, PathBuf};
use tauri::Manager;

const FILENAME: &str = "shared-service-auth.json";

fn default_home(identifier: &str, user_home: &Path) -> PathBuf {
    crate::runtime_instance::RuntimeInstanceProfile::from_identifier(identifier)
        .default_orgii_home(user_home)
        .unwrap_or_else(|| user_home.join(".orgii"))
}

// Deliberately compare path components without following symlinks. An explicit
// alias is treated as a custom home, so it cannot silently opt into legacy auth.
fn is_default_home(identifier: &str, root: &Path, user_home: &Path) -> bool {
    root == default_home(identifier, user_home)
}

fn resolve(identifier: &str, directory: &Path, root: &Path, user_home: &Path) -> PathBuf {
    if !is_default_home(identifier, root, user_home) {
        return root.join(FILENAME);
    }
    let directory = if identifier == "org2ai.org2.dev" {
        // Tauri app_data_dir always ends with the bundle identifier.
        directory.with_file_name("org2ai.org2")
    } else {
        directory.to_path_buf()
    };
    directory.join(FILENAME)
}

pub(crate) fn uses_default_home(app: &tauri::AppHandle) -> bool {
    is_default_home(
        &app.config().identifier,
        &app_paths::orgii_root(),
        &app_paths::home_dir(),
    )
}

pub(crate) fn shared_auth_store_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = resolve(
        &app.config().identifier,
        &directory,
        &app_paths::orgii_root(),
        &app_paths::home_dir(),
    );
    // LazyStore resolves relative paths against app_data_dir; native readers do
    // not. Make this boundary absolute once so all three consumers agree.
    std::path::absolute(path).map_err(|e| e.to_string())
}

// LazyStore reload requires an existing file even on the first login. Publish
// the empty store atomically: concurrent primary/dev startup must never observe
// a partial file or overwrite the other process's newly saved credentials.
fn ensure_auth_store(path: &Path) -> std::io::Result<()> {
    use std::io::Write;
    if path.try_exists()? {
        return Ok(());
    }
    let parent = path
        .parent()
        .ok_or_else(|| std::io::Error::other("Auth store has no parent"))?;
    std::fs::create_dir_all(parent)?;
    let mut pending = tempfile::NamedTempFile::new_in(parent)?;
    pending.write_all(b"{}")?;
    pending.as_file().sync_all()?;
    match pending.persist_noclobber(path) {
        Ok(_) => Ok(()),
        Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(error.error),
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedAuthStorageProfile {
    path: String,
    allow_legacy_migration: bool,
}

#[tauri::command]
pub async fn shared_service_auth_storage_profile(
    app: tauri::AppHandle,
) -> Result<SharedAuthStorageProfile, String> {
    let store_path = shared_auth_store_path(&app)?;
    let path = store_path
        .clone()
        .into_os_string()
        .into_string()
        .map_err(|_| "Auth store path is not valid UTF-8".to_string())?;
    tauri::async_runtime::spawn_blocking(move || ensure_auth_store(&store_path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    Ok(SharedAuthStorageProfile {
        path,
        allow_legacy_migration: uses_default_home(&app),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_store_is_valid_private_json_and_existing_credentials_are_preserved() {
        let fixture = tempfile::tempdir().unwrap();
        let path = fixture.path().join("fresh-profile").join(FILENAME);
        ensure_auth_store(&path).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"{}");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        std::fs::write(&path, br#"{"existing":"credentials"}"#).unwrap();
        ensure_auth_store(&path).unwrap();
        assert_eq!(
            std::fs::read(&path).unwrap(),
            br#"{"existing":"credentials"}"#
        );
    }

    #[test]
    fn default_profiles_preserve_existing_store_locations() {
        let home = Path::new("/users/test");
        for (id, expected) in [
            ("org2ai.org2", "org2ai.org2"),
            ("org2ai.org2.dev", "org2ai.org2"),
            ("org2ai.org2.instance89", "org2ai.org2.instance89"),
            ("org2ai.org2.e2e.instance88", "org2ai.org2.e2e.instance88"),
        ] {
            assert_eq!(
                resolve(
                    id,
                    &Path::new("/data").join(id),
                    &default_home(id, home),
                    home
                ),
                Path::new("/data").join(expected).join(FILENAME)
            );
        }
    }

    #[test]
    fn reused_identifier_cannot_import_another_homes_credentials() {
        let fixture = tempfile::tempdir().unwrap();
        let user_home = fixture.path().join("user");
        for id in ["org2ai.org2", "org2ai.org2.dev", "org2ai.org2.instance88"] {
            let legacy = fixture.path().join("app-data").join(id);
            std::fs::create_dir_all(&legacy).unwrap();
            std::fs::write(legacy.join(FILENAME), b"stale legacy credentials").unwrap();
            let a = resolve(id, &legacy, &fixture.path().join("a"), &user_home);
            let b = resolve(id, &legacy, &fixture.path().join("b"), &user_home);
            std::fs::create_dir_all(a.parent().unwrap()).unwrap();
            std::fs::write(&a, b"profile A credentials").unwrap();
            assert!(!b.exists());
            assert_eq!(std::fs::read(&a).unwrap(), b"profile A credentials");
            assert_eq!(
                std::fs::read(legacy.join(FILENAME)).unwrap(),
                b"stale legacy credentials"
            );
            assert_eq!(
                a,
                resolve(id, &legacy, &fixture.path().join("a"), &user_home)
            );
        }
    }

    #[test]
    fn explicit_alias_does_not_opt_into_default_auth() {
        let user = Path::new("/users/test");
        let root = user.join("other/../.orgii");
        assert_eq!(
            resolve("org2ai.org2.dev", Path::new("/data/dev"), &root, user),
            root.join(FILENAME)
        );
    }
}
