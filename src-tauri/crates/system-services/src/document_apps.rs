//! On-demand OS document handlers. No scanning, timers, or retained file contents.
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentApplication {
    pub path: String,
    pub name: String,
    pub is_default: bool,
}

fn validate_document(path: &str) -> Result<(), String> {
    let path = Path::new(path);
    if !path.is_absolute() || !path.is_file() {
        return Err("Expected an existing absolute local file path".into());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn applications(path: &str) -> Vec<DocumentApplication> {
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSFileManager, NSString, NSURL};
    objc2::rc::autoreleasepool(|_| {
        let workspace = NSWorkspace::sharedWorkspace();
        let url = NSURL::fileURLWithPath(&NSString::from_str(path));
        let default_path = workspace
            .URLForApplicationToOpenURL(&url)
            .and_then(|url| url.path());
        let manager = NSFileManager::defaultManager();
        let mut apps = Vec::new();
        for url in workspace.URLsForApplicationsToOpenURL(&url).iter() {
            let Some(path) = url.path() else { continue };
            let app_path = path.to_string();
            if apps
                .iter()
                .any(|app: &DocumentApplication| app.path == app_path)
            {
                continue;
            }
            apps.push(DocumentApplication {
                is_default: default_path
                    .as_ref()
                    .is_some_and(|default| **default == *path),
                name: manager.displayNameAtPath(&path).to_string(),
                path: app_path,
            });
        }
        apps.sort_by(|a, b| {
            b.is_default
                .cmp(&a.is_default)
                .then_with(|| a.name.cmp(&b.name))
        });
        apps.truncate(64);
        apps
    })
}

#[cfg(not(target_os = "macos"))]
fn applications(_path: &str) -> Vec<DocumentApplication> {
    Vec::new()
}

#[tauri::command]
pub async fn document_applications(path: String) -> Result<Vec<DocumentApplication>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_document(&path)?;
        Ok(applications(&path))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn document_open(path: String, application: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_document(&path)?;
        if let Some(application) = application {
            #[cfg(target_os = "macos")]
            {
                let app_path = Path::new(&application);
                if !app_path.is_absolute()
                    || !app_path.is_dir()
                    || app_path.extension().is_none_or(|ext| ext != "app")
                {
                    return Err("Expected an installed application bundle".into());
                }
                let status = std::process::Command::new("/usr/bin/open")
                    .arg("-a")
                    .arg(application)
                    .arg("--")
                    .arg(path)
                    .status()
                    .map_err(|error| error.to_string())?;
                if !status.success() {
                    return Err("The application could not open this file".into());
                }
                Ok(())
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = application;
                Err("Application selection is only supported on macOS".into())
            }
        } else {
            open::that(path).map_err(|error| error.to_string())
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_urls_relative_paths_and_directories() {
        for path in ["https://example.com/file.pdf", "file.pdf", "/"] {
            assert!(validate_document(path).is_err());
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn discovers_native_pdf_handlers_without_launching_apps() {
        let path =
            std::env::temp_dir().join(format!("orgii-document-apps-{}.pdf", std::process::id()));
        std::fs::write(&path, b"%PDF-1.4\n%%EOF\n").unwrap();
        let result = applications(path.to_str().unwrap());
        std::fs::remove_file(path).unwrap();
        assert!(
            !result.is_empty(),
            "macOS should have a registered PDF handler"
        );
        assert!(result.len() <= 64);
        assert!(result
            .iter()
            .all(|app| Path::new(&app.path).is_absolute() && !app.name.is_empty()));
        assert!(result.iter().filter(|app| app.is_default).count() <= 1);
    }

    #[test]
    fn application_wire_contract() {
        let app = DocumentApplication {
            path: "/Applications/Preview.app".into(),
            name: "Preview".into(),
            is_default: true,
        };
        assert_eq!(
            serde_json::to_value(app).unwrap(),
            serde_json::json!({"path":"/Applications/Preview.app", "name":"Preview", "isDefault":true})
        );
    }
}
