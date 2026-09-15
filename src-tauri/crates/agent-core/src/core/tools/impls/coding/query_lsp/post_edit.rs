//! Post-edit diagnostics hook called by `processor.rs` after every file
//! mutation tool. Spins up the LSP server on demand, opens / changes the
//! document, and returns the error/warning slice formatted for inline
//! injection into the assistant turn.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use lsp::types::{Diagnostic, DiagnosticSeverity};
use tauri::AppHandle;
use tokio::sync::Mutex;
use tracing::debug;

use lsp::LspManager;

use super::format::format_diagnostics;
use super::language::{
    document_language_id_for_file, infer_workspace_root, language_for_file, path_to_uri,
};

/// Fetch diagnostics for a file from the LSP manager.
/// Used by the post-edit diagnostics hook in `processor.rs`.
pub async fn get_post_edit_diagnostics(
    lsp_manager: &Arc<Mutex<LspManager>>,
    app_handle: &AppHandle,
    workspace_root: &Path,
    file_path: &str,
) -> Option<String> {
    let language = language_for_file(file_path)?;
    let document_language_id = document_language_id_for_file(file_path)?;
    let uri = path_to_uri(file_path);
    let manager = lsp_manager.lock().await.clone();
    let root = infer_workspace_root(file_path, workspace_root);
    let server = manager
        .start_server(language, &root.to_string_lossy(), app_handle.clone())
        .await
        .ok()?;

    let content = match tokio::fs::read_to_string(file_path).await {
        Ok(text) => text,
        Err(err) => {
            debug!(
                "post-edit diagnostics: failed to read {}: {}",
                file_path, err
            );
            return None;
        }
    };

    server
        .sync_document(&uri, document_language_id, &content)
        .await
        .ok()?;
    tokio::time::sleep(Duration::from_millis(500)).await;
    if server.is_closed() {
        return None;
    }
    let diagnostics = server.get_file_diagnostics(&uri).await.ok()?;

    let issues: Vec<Diagnostic> = diagnostics
        .into_iter()
        .filter(is_actionable_diagnostic)
        .collect();

    if issues.is_empty() {
        return None;
    }

    Some(format!(
        "\n\n[LSP diagnostics after edit]:\n{}",
        format_diagnostics(&issues)
    ))
}

/// Whether a diagnostic should be surfaced to the agent in the
/// post-edit hook. Only `Error` and `Warning` qualify — info and hint
/// would just bloat the assistant's context, and a missing severity
/// means the server didn't classify the issue, which we treat as
/// "don't surface".
///
/// Pure on the typed `Diagnostic` so it can be unit-tested without a
/// running LSP server.
pub(super) fn is_actionable_diagnostic(diagnostic: &Diagnostic) -> bool {
    matches!(
        diagnostic.severity,
        Some(DiagnosticSeverity::ERROR) | Some(DiagnosticSeverity::WARNING)
    )
}

#[cfg(test)]
mod tests {
    use super::{is_actionable_diagnostic, Diagnostic, DiagnosticSeverity};
    use lsp::types::{Position, Range};

    fn diag(severity: Option<DiagnosticSeverity>) -> Diagnostic {
        Diagnostic {
            range: Range {
                start: Position {
                    line: 0,
                    character: 0,
                },
                end: Position {
                    line: 0,
                    character: 0,
                },
            },
            severity,
            code: None,
            code_description: None,
            source: None,
            message: "test".to_string(),
            related_information: None,
            tags: None,
            data: None,
        }
    }

    #[test]
    fn surface_errors() {
        assert!(is_actionable_diagnostic(&diag(Some(
            DiagnosticSeverity::ERROR
        ))));
    }

    #[test]
    fn surface_warnings() {
        assert!(is_actionable_diagnostic(&diag(Some(
            DiagnosticSeverity::WARNING
        ))));
    }

    #[test]
    fn drop_info_and_hint() {
        // Info and hint are too noisy to inject into the assistant turn.
        assert!(!is_actionable_diagnostic(&diag(Some(
            DiagnosticSeverity::INFORMATION
        ))));
        assert!(!is_actionable_diagnostic(&diag(Some(
            DiagnosticSeverity::HINT
        ))));
    }

    #[test]
    fn drop_when_severity_missing() {
        // A server that didn't classify the issue: don't surface.
        assert!(!is_actionable_diagnostic(&diag(None)));
    }
}
