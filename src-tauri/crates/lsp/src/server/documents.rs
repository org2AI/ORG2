//! Document synchronisation (`textDocument/didOpen` / `didChange` /
//! `didClose`) plus the read side of the diagnostics cache those
//! notifications keep warm.

use std::collections::HashMap;

use super::super::types::*;
use super::helpers::{parse_uri, resolve_sync_kind};
use super::lifecycle::LspServer;

impl LspServer {
    /// Notify server that a document was opened.
    pub async fn did_open(
        &self,
        uri: &str,
        language_id: &str,
        version: i32,
        text: &str,
    ) -> Result<(), String> {
        let params = DidOpenTextDocumentParams {
            text_document: TextDocumentItem {
                uri: parse_uri(uri)?,
                language_id: language_id.to_string(),
                version,
                text: text.to_string(),
            },
        };
        self.send_typed_notification("textDocument/didOpen", &params)
            .await
    }

    /// Full-text synchronization for the agent query and post-edit callers.
    /// Both use `sync_document` to share this server generation's open/version
    /// state. Full and Incremental accept a replacement event without range;
    /// None skips changes. The archived CodeMirror client is not a producer.
    pub async fn did_change(&self, uri: &str, version: i32, text: &str) -> Result<(), String> {
        let kind = self.resolved_sync_kind().await;
        if kind == TextDocumentSyncKind::NONE {
            log::debug!(
                "[LSP] {} skipping didChange (server advertised sync kind None) for {}",
                self.language,
                uri
            );
            return Ok(());
        }

        let params = DidChangeTextDocumentParams {
            text_document: VersionedTextDocumentIdentifier {
                uri: parse_uri(uri)?,
                version,
            },
            content_changes: vec![TextDocumentContentChangeEvent {
                range: None,
                range_length: None,
                text: text.to_string(),
            }],
        };
        self.send_typed_notification("textDocument/didChange", &params)
            .await
    }

    /// Before initialization default to Full; initialized servers use their
    /// advertised sync kind. Current agent callers provide complete file text.
    async fn resolved_sync_kind(&self) -> TextDocumentSyncKind {
        resolve_sync_kind(self.capabilities.read().await.as_ref())
    }

    /// Notify server that a document was closed.
    ///
    /// Releases this generation's document version and cached diagnostics.
    pub async fn did_close(&self, uri: &str) -> Result<(), String> {
        let mut documents = self.documents.lock().await;
        let params = DidCloseTextDocumentParams {
            text_document: TextDocumentIdentifier {
                uri: parse_uri(uri)?,
            },
        };
        let result = self
            .send_typed_notification("textDocument/didClose", &params)
            .await;

        documents.remove(uri);
        self.diagnostics_cache.write().await.evict(uri);

        result
    }

    /// Get a read-only snapshot of all cached diagnostics.
    /// Returns a map of file URI → typed `PublishDiagnosticsParams`.
    pub async fn get_cached_diagnostics(&self) -> HashMap<String, PublishDiagnosticsParams> {
        self.diagnostics_cache.read().await.snapshot()
    }

    /// Get cached diagnostics for a single file URI.
    /// Returns the typed `Diagnostic` list, or empty if none cached.
    pub async fn get_file_diagnostics(
        &self,
        uri: &str,
    ) -> Result<Vec<lsp_types::Diagnostic>, String> {
        if self.is_closed() {
            return Err("LSP server closed".into());
        }
        let cache = self.diagnostics_cache.read().await;
        if self.is_closed() {
            return Err("LSP server closed".into());
        }
        Ok(cache
            .get(uri)
            .map(|params| params.diagnostics.clone())
            .unwrap_or_default())
    }
}

impl LspServer {
    /// The server generation owns open state and versions, shared by every
    /// agent tool and the post-edit hook. A restarted lease starts empty.
    pub async fn sync_document(&self, uri: &str, language: &str, text: &str) -> Result<(), String> {
        let mut documents = self.documents.lock().await;
        if !documents.contains_key(uri) && documents.len() >= 500 {
            if let Some(oldest) = documents.keys().next().cloned() {
                self.send_typed_notification(
                    "textDocument/didClose",
                    &DidCloseTextDocumentParams {
                        text_document: TextDocumentIdentifier {
                            uri: parse_uri(&oldest)?,
                        },
                    },
                )
                .await?;
                documents.remove(&oldest);
                self.diagnostics_cache.write().await.evict(&oldest);
            }
        }
        let version = documents
            .get(uri)
            .copied()
            .unwrap_or(0)
            .checked_add(1)
            .ok_or("LSP document version exhausted; restart server")?;
        if version == 1 {
            self.did_open(uri, language, version, text).await?;
        } else {
            self.did_change(uri, version, text).await?;
        }
        documents.insert(uri.to_string(), version);
        Ok(())
    }
}
