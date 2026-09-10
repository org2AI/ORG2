//! Export the full HTML document from a browser webview.

use tauri::{AppHandle, Manager};

use super::logging::eval_js_with_result;

// ============================================
// Save HTML to File
// ============================================

/// Get the full HTML document (including doctype) ready for saving.
///
/// This is useful for previewing what will be saved.
#[tauri::command]
pub async fn get_full_html_document(app: AppHandle, label: String) -> Result<String, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    let script = r#"
        (function() {
            return '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
        })()
    "#;

    let html_content = eval_js_with_result(&webview, script, "").await;

    if html_content.is_empty() {
        return Err("Failed to get HTML document".to_string());
    }

    Ok(html_content)
}
