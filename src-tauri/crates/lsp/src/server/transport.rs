//! Bounded JSON-RPC transport with owned request registrations.
use super::{
    control::{Stop, WriteGuard},
    helpers::strip_framing_prefix,
    lifecycle::LspServer,
};
use crate::protocol::*;
use std::{
    collections::HashMap,
    sync::{atomic::Ordering, Arc},
    time::Duration,
};
use tokio::{io::AsyncWriteExt, sync::oneshot};

pub(super) type RpcResult = Result<serde_json::Value, JsonRpcError>;
pub(super) type Pending = Arc<parking_lot::Mutex<HashMap<u64, oneshot::Sender<RpcResult>>>>;
const WRITE_TIMEOUT: Duration = Duration::from_secs(5);
const CANCEL_TIMEOUT: Duration = Duration::from_millis(100);
const MAX_PENDING: usize = 256;

/// Owns the registration until response, timeout, or caller cancellation.
pub struct PendingResponse {
    id: u64,
    pending: Pending,
    receiver: oneshot::Receiver<RpcResult>,
    stdin: Arc<tokio::sync::Mutex<Option<tokio::process::ChildStdin>>>,
    stop: Arc<Stop>,
    cancel_slots: Arc<tokio::sync::Semaphore>,
}
impl Drop for PendingResponse {
    fn drop(&mut self) {
        let abandoned = self.pending.lock().remove(&self.id).is_some();
        if abandoned && !self.stop.is_closed() {
            let Ok(permit) = self.cancel_slots.clone().try_acquire_owned() else {
                return;
            };
            if let Ok(runtime) = tokio::runtime::Handle::try_current() {
                let stdin = self.stdin.clone();
                let stop = self.stop.clone();
                let id = self.id;
                runtime.spawn(async move {
                    let _permit = permit;
                    let body=serde_json::json!({"jsonrpc":"2.0","method":"$/cancelRequest","params":{"id":id}}).to_string();
                    let _=tokio::time::timeout(CANCEL_TIMEOUT,write_frame(&stdin,&stop,&format_lsp_message(&body))).await;
                });
            }
        }
    }
}
impl PendingResponse {
    pub async fn receive(mut self) -> Result<serde_json::Value, String> {
        match (&mut self.receiver).await {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(error)) => Err(format!(
                "LSP JSON-RPC error {}: {}{}",
                error.code,
                error.message,
                error.data.map(|d| format!(" ({d})")).unwrap_or_default()
            )),
            Err(_) => Err("LSP response channel closed".into()),
        }
    }
}

pub(super) async fn write_frame(
    stdin: &Arc<tokio::sync::Mutex<Option<tokio::process::ChildStdin>>>,
    stop: &Arc<Stop>,
    message: &str,
) -> Result<(), String> {
    let write = async {
        let mut stdin = stdin.lock().await;
        let stdin = stdin.as_mut().ok_or("LSP stdin closed")?;
        // The guard starts after acquiring the writer: abandoning a queued
        // write cannot corrupt someone else's frame.
        let mut guard = WriteGuard(stop.clone(), false);
        stdin
            .write_all(message.as_bytes())
            .await
            .map_err(|e| format!("LSP write failed: {e}"))?;
        stdin
            .flush()
            .await
            .map_err(|e| format!("LSP flush failed: {e}"))?;
        guard.1 = true;
        Ok(())
    };
    tokio::select! {
        biased;
        _ = stop.cancelled() => Err("LSP server closed".into()),
        result = tokio::time::timeout(WRITE_TIMEOUT, write) => result.map_err(|_| "LSP write timed out".to_string())?,
    }
}

impl LspServer {
    async fn write_message(&self, message: &str) -> Result<(), String> {
        write_frame(&self.stdin, &self.stop, message).await?;
        self.log_buffer.push(
            crate::log_buffer::IoKind::StdIn,
            strip_framing_prefix(message),
        );
        Ok(())
    }
    pub async fn send_request_with_response(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<(u64, PendingResponse), String> {
        if self.stop.is_closed() {
            return Err("LSP server closed".into());
        }
        let id = self.next_request_id.fetch_add(1, Ordering::Relaxed);
        let json = serde_json::to_string(&JsonRpcRequest::new(id, method.to_string(), params))
            .map_err(|e| e.to_string())?;
        let (sender, receiver) = oneshot::channel();
        {
            let mut pending = self.pending_requests.lock();
            if pending.len() >= MAX_PENDING {
                return Err("Too many pending LSP requests".into());
            }
            pending.insert(id, sender);
        }
        let response = PendingResponse {
            id,
            pending: self.pending_requests.clone(),
            receiver,
            stdin: self.stdin.clone(),
            stop: self.stop.clone(),
            cancel_slots: self.cancel_slots.clone(),
        };
        self.write_message(&format_lsp_message(&json)).await?;
        Ok((id, response))
    }
    pub async fn send_request(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<u64, String> {
        let id = self.next_request_id.fetch_add(1, Ordering::Relaxed);
        let json = serde_json::to_string(&JsonRpcRequest::new(id, method.to_string(), params))
            .map_err(|e| e.to_string())?;
        self.write_message(&format_lsp_message(&json)).await?;
        Ok(id)
    }
    pub async fn send_notification(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<(), String> {
        let json = serde_json::to_string(&JsonRpcNotification::new(method.to_string(), params))
            .map_err(|e| e.to_string())?;
        self.write_message(&format_lsp_message(&json)).await
    }
    pub(super) async fn send_typed_notification<P: serde::Serialize>(
        &self,
        method: &str,
        params: &P,
    ) -> Result<(), String> {
        self.send_notification(
            method,
            Some(serde_json::to_value(params).map_err(|e| e.to_string())?),
        )
        .await
    }
    pub(super) async fn send_typed_request<P: serde::Serialize, R: serde::de::DeserializeOwned>(
        &self,
        method: &'static str,
        params: &P,
        timeout: Duration,
    ) -> Result<R, String> {
        let value = self
            .request_with_timeout(
                method,
                serde_json::to_value(params).map_err(|e| e.to_string())?,
                timeout,
            )
            .await?;
        serde_json::from_value(value).map_err(|e| format!("Invalid {method} response: {e}"))
    }
    pub(super) async fn request_with_timeout(
        &self,
        method: &'static str,
        params: serde_json::Value,
        timeout: Duration,
    ) -> Result<serde_json::Value, String> {
        let operation = async {
            let (_, response) = self
                .send_request_with_response(
                    method,
                    if params.is_null() { None } else { Some(params) },
                )
                .await?;
            let result = response.receive().await;
            if self.is_closed() {
                return Err("LSP server closed".into());
            }
            result
        };
        match tokio::time::timeout(timeout, operation).await {
            Ok(result) => result,
            Err(_) => Err(format!("{method} timed out after {timeout:?}")),
        }
    }
}

/// Generic so legacy response-channel tests exercise the same cleanup.
pub(crate) async fn drain_pending_on_close<T>(
    pending: &Arc<parking_lot::Mutex<HashMap<u64, oneshot::Sender<T>>>>,
    _language: &str,
) {
    pending.lock().clear();
}
