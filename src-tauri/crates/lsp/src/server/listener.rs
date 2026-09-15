//! Bounded stdio pumps and bidirectional JSON-RPC dispatch.
use super::{
    lifecycle::LspServer,
    transport::{drain_pending_on_close, write_frame},
};
use crate::types::PublishDiagnosticsParams;
use tokio::io::{AsyncReadExt, BufReader};

impl LspServer {
    pub fn start_listening(
        &mut self,
        _app_handle: tauri::AppHandle,
        language: String,
    ) -> Result<(), String> {
        self.start_stdio(language)
    }
    pub(crate) fn start_stdio(&mut self, language: String) -> Result<(), String> {
        let stdout = self.stdout.take().ok_or("LSP stdout already consumed")?;
        if let Some(stderr) = self.stderr.take() {
            let stop = self.stop.clone();
            let log = self.log_buffer.clone();
            self.pumps.get_mut().push(tokio::spawn(async move {
                // read_line allocates until newline; fixed chunks bound even a
                // child emitting an endless line. The log itself is bounded.
                let mut reader = BufReader::new(stderr);
                let mut bytes = [0u8; 2048];
                loop {
                    let result = tokio::select! { biased; _ = stop.cancelled() => break, r = reader.read(&mut bytes) => r };
                    match result {
                        Ok(0) | Err(_) => break,
                        Ok(n) => log.push(crate::log_buffer::IoKind::StdErr, String::from_utf8_lossy(&bytes[..n]).as_ref()),
                    }
                }
            }));
        }
        let cache = self.diagnostics_cache.clone();
        let pending = self.pending_requests.clone();
        let log = self.log_buffer.clone();
        let stop = self.stop.clone();
        let stdin = self.stdin.clone();
        let settings = self.workspace_settings.clone();
        self.pumps.get_mut().push(tokio::spawn(async move {
            use futures::StreamExt;
            let mut framed = tokio_util::codec::FramedRead::with_capacity(stdout, crate::codec::LspCodec::new(), 8*1024);
            loop {
                let frame = tokio::select! { biased; _ = stop.cancelled() => break, frame = framed.next() => frame };
                let body = match frame { Some(Ok(body)) => body, Some(Err(error)) => {log::warn!("LSP {language} framing failed: {error}");break;}, None => break };
                log.push(crate::log_buffer::IoKind::StdOut, String::from_utf8_lossy(&body).as_ref());
                let value: serde_json::Value = match serde_json::from_slice(&body) { Ok(value) => value, Err(_) => continue };
                if let Some(method) = value.get("method").and_then(|m| m.as_str()) {
                    if let Some(id) = value.get("id") {
                        let response = if id.as_str().is_some_and(|id| id.len() > 128) || !(id.is_string() || id.is_number() || id.is_null()) {
                            serde_json::json!({"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"Invalid or oversized request id"}})
                        } else { server_request_response(id.clone(), method, value.get("params"), &*settings.read().await) };
                        let message = crate::protocol::format_lsp_message(&response.to_string());
                        if write_frame(&stdin, &stop, &message).await.is_err() { break; }
                    } else if method == "textDocument/publishDiagnostics" {
                        if let Some(params) = value.get("params").and_then(|p| serde_json::from_value::<PublishDiagnosticsParams>(p.clone()).ok()) {
                            cache.write().await.upsert(params.uri.to_string(), params);
                        }
                    }
                } else if let Some(id) = value.get("id").and_then(|id| id.as_u64()) {
                    if let Some(sender) = pending.lock().remove(&id) {
                        let response = if let Some(error) = value.get("error") {
                            serde_json::from_value(error.clone()).map_or_else(|_| Err(crate::protocol::JsonRpcError {code:-32603,message:"Malformed JSON-RPC error".into(),data:Some(error.clone())}), Err)
                        } else if let Some(result) = value.get("result") { Ok(result.clone()) }
                        else { Err(crate::protocol::JsonRpcError {code:-32603,message:"Response missing result/error".into(),data:None}) };
                        let _ = sender.send(response);
                    }
                }
            }
            stop.close();
            drain_pending_on_close(&pending, &language).await;
        }));
        Ok(())
    }
}

fn server_request_response(
    id: serde_json::Value,
    method: &str,
    params: Option<&serde_json::Value>,
    settings: &serde_json::Value,
) -> serde_json::Value {
    if method == "workspace/configuration" {
        let Some(items) = params
            .and_then(|p| p.get("items"))
            .and_then(|i| i.as_array())
        else {
            return serde_json::json!({"jsonrpc":"2.0","id":id,"error":{"code":-32602,"message":"configuration.items must be an array"}});
        };
        if items.len() > 128 {
            return serde_json::json!({"jsonrpc":"2.0","id":id,"error":{"code":-32602,"message":"Too many configuration items (maximum 128)"}});
        }
        let mut budget = JsonBudget(1024 * 1024 - 512);
        let mut values = Vec::with_capacity(items.len());
        for item in items {
            let section = item.get("section").and_then(|s| s.as_str()).unwrap_or("");
            let value = if section.is_empty() {
                settings
            } else {
                section
                    .split('.')
                    .try_fold(settings, |value, key| value.get(key))
                    .unwrap_or(&serde_json::Value::Null)
            };
            if serde_json::to_writer(&mut budget, value).is_err() {
                return serde_json::json!({"jsonrpc":"2.0","id":id,"error":{"code":-32603,"message":"Configuration response exceeds byte budget"}});
            }
            values.push(value.clone());
        }

        serde_json::json!({"jsonrpc":"2.0","id":id,"result":values})
    } else {
        serde_json::json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":format!("Unsupported client method: {method}")}})
    }
}

// Counts serialized bytes without first allocating the expanded response.
struct JsonBudget(usize);
impl std::io::Write for JsonBudget {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > self.0 {
            return Err(std::io::Error::other("JSON byte budget exceeded"));
        }
        self.0 -= bytes.len();
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
#[path = "../tests/listener_tests.rs"]
mod tests;
