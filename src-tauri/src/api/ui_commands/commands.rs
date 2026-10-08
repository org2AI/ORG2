use std::sync::Arc;
use tauri::ipc::Channel;

pub(super) fn main_only(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("UI command owner must be the main window".into())
    }
}
#[tauri::command]
pub fn ui_runtime_register(
    window: tauri::WebviewWindow,
    channel: Channel<app_ui::Dispatch>,
    catalog_hash: String,
) -> Result<String, String> {
    main_only(&window)?;
    if app_ui::catalog()["hash"] != catalog_hash {
        return Err("UI catalog mismatch".into());
    }
    Ok(app_ui::broker().register(Arc::new(move |message| {
        channel.send(message).map_err(|e| e.to_string())
    })))
}
#[tauri::command]
pub fn ui_runtime_unregister(
    window: tauri::WebviewWindow,
    generation: String,
) -> Result<(), String> {
    main_only(&window)?;
    app_ui::broker().unregister(&generation);
    Ok(())
}
#[tauri::command]
pub fn ui_command_active(
    window: tauri::WebviewWindow,
    generation: String,
    request: app_ui::Request,
) -> Result<bool, String> {
    main_only(&window)?;
    Ok(app_ui::broker().active(&generation, &request))
}
#[tauri::command]
pub fn ui_command_result(
    window: tauri::WebviewWindow,
    generation: String,
    response: app_ui::Response,
) -> Result<bool, String> {
    main_only(&window)?;
    Ok(app_ui::broker().resolve(&generation, response))
}

/// Validate the actual readable file before registering a tab. Does not change editor state.
#[tauri::command]
pub async fn ui_prepare_file(
    window: tauri::WebviewWindow,
    path: String,
    repo_path: Option<String>,
) -> Result<String, String> {
    main_only(&window)?;
    tokio::task::spawn_blocking(move || prepare_file(&path, repo_path.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}
fn prepare_file(path: &str, repo: Option<&str>) -> Result<String, String> {
    use std::{io::Read, path::PathBuf};
    let path = PathBuf::from(path);
    let path = if path.is_absolute() {
        path
    } else {
        PathBuf::from(repo.ok_or("A relative file path requires a target repository")?).join(path)
    };
    let path = path
        .canonicalize()
        .map_err(|e| format!("FILE_NOT_FOUND: {e}"))?;
    if !std::fs::metadata(&path)
        .map_err(|e| format!("FILE_NOT_READABLE: {e}"))?
        .is_file()
    {
        return Err("FILE_NOT_READABLE: expected a regular file".into());
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        // A replacement with a FIFO between metadata and open must not retain a worker.
        options.custom_flags(libc::O_NONBLOCK);
    }
    let mut file = options
        .open(&path)
        .map_err(|e| format!("FILE_NOT_READABLE: {e}"))?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("FILE_NOT_READABLE: expected a regular file".into());
    }
    let mut byte = [0u8; 1];
    file.read(&mut byte)
        .map_err(|e| format!("FILE_NOT_READABLE: {e}"))?;
    path.into_os_string()
        .into_string()
        .map_err(|_| "File path is not valid UTF-8".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_real_file_and_rejects_missing_directory_and_unbound_relative() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("file.txt");
        std::fs::write(&file, "hello").unwrap();
        assert_eq!(
            prepare_file("file.txt", dir.path().to_str()).unwrap(),
            file.canonicalize().unwrap().to_str().unwrap()
        );
        assert!(prepare_file("missing", dir.path().to_str())
            .unwrap_err()
            .starts_with("FILE_NOT_FOUND"));
        assert!(prepare_file(dir.path().to_str().unwrap(), None)
            .unwrap_err()
            .starts_with("FILE_NOT_READABLE"));
        assert!(prepare_file("file.txt", None).is_err());
    }
}
