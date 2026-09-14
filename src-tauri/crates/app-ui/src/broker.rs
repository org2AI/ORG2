use crate::{command_exists, protocol::*};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::watch;

pub type SendRequest = Arc<dyn Fn(Dispatch) -> Result<(), String> + Send + Sync>;
const MAX_PENDING: usize = 50;
const MAX_RECEIPTS: usize = 256;
const RECEIPT_TTL: Duration = Duration::from_secs(60);
struct Runtime {
    generation: String,
    send: SendRequest,
}
struct Entry {
    request: Request,
    generation: String,
    result: watch::Sender<Option<Response>>,
    finished: Option<Instant>,
}
#[derive(Default)]
struct State {
    runtime: Option<Runtime>,
    entries: HashMap<(String, String), Entry>,
}
pub struct Broker {
    pub instance_id: String,
    state: Mutex<State>,
}
impl Default for Broker {
    fn default() -> Self {
        Self::new()
    }
}
impl Broker {
    pub fn new() -> Self {
        Self {
            instance_id: uuid::Uuid::new_v4().to_string(),
            state: Mutex::new(State::default()),
        }
    }
    pub fn register(&self, send: SendRequest) -> String {
        let mut state = self.state.lock().unwrap();
        Self::invalidate(&mut state);
        let generation = uuid::Uuid::new_v4().to_string();
        state.runtime = Some(Runtime {
            generation: generation.clone(),
            send,
        });
        generation
    }
    pub fn unregister(&self, generation: &str) {
        let mut state = self.state.lock().unwrap();
        if state
            .runtime
            .as_ref()
            .is_some_and(|r| r.generation == generation)
        {
            Self::invalidate(&mut state);
        }
    }
    fn invalidate(state: &mut State) {
        state.runtime = None;
        for entry in state.entries.values_mut().filter(|e| e.finished.is_none()) {
            entry.result.send_replace(Some(Response::error(
                &entry.request,
                "UI_NOT_READY",
                "UI runtime disconnected; execution outcome is unknown",
                true,
            )));
            entry.finished = Some(Instant::now());
        }
        Self::prune(state);
    }
    fn prune(state: &mut State) {
        state
            .entries
            .retain(|_, e| e.finished.is_none_or(|at| at.elapsed() < RECEIPT_TTL));
        while state
            .entries
            .values()
            .filter(|e| e.finished.is_some())
            .count()
            > MAX_RECEIPTS
        {
            let oldest = state
                .entries
                .iter()
                .filter_map(|(k, e)| e.finished.map(|t| (k.clone(), t)))
                .min_by_key(|(_, t)| *t)
                .map(|(k, _)| k);
            if let Some(key) = oldest {
                state.entries.remove(&key);
            } else {
                break;
            }
        }
    }
    pub fn disconnect(&self) {
        Self::invalidate(&mut self.state.lock().unwrap());
    }
    pub fn ready(&self) -> bool {
        self.state.lock().unwrap().runtime.is_some()
    }
    pub fn receipt(&self, caller: &str, id: &str) -> Option<Response> {
        let mut state = self.state.lock().unwrap();
        Self::prune(&mut state);
        state
            .entries
            .get(&(caller.into(), id.into()))
            .and_then(|e| e.result.borrow().clone())
    }
    // A frontend must re-check this after asynchronous preparation and before any write.
    pub fn active(&self, generation: &str, request: &Request) -> bool {
        self.state
            .lock()
            .unwrap()
            .entries
            .values()
            .any(|e| e.request == *request && e.generation == generation && e.finished.is_none())
    }
    pub fn resolve(&self, generation: &str, response: Response) -> bool {
        if serde_json::to_vec(&response).map_or(true, |b| b.len() > MAX_BODY) {
            return false;
        }
        let mut state = self.state.lock().unwrap();
        let Some(entry) = state.entries.values_mut().find(|e| {
            e.request.request_id == response.request_id
                && e.generation == generation
                && e.finished.is_none()
        }) else {
            return false;
        };
        if response.target != entry.request.target || response.protocol_version != VERSION {
            return false;
        }
        entry.result.send_replace(Some(response));
        entry.finished = Some(Instant::now());
        Self::prune(&mut state);
        true
    }
    fn abandon(&self, key: &(String, String)) {
        let mut state = self.state.lock().unwrap();
        if let Some(entry) = state.entries.get_mut(key).filter(|e| e.finished.is_none()) {
            entry.result.send_replace(Some(Response::error(
                &entry.request,
                "DEADLINE_EXCEEDED",
                "Execution outcome is unknown; inspect the receipt before retrying",
                true,
            )));
            entry.finished = Some(Instant::now());
        }
        Self::prune(&mut state);
    }
    pub async fn execute(&self, caller: &str, request: Request) -> Response {
        if request.protocol_version != VERSION {
            return Response::error(
                &request,
                "PROTOCOL_MISMATCH",
                "Unsupported UI protocol",
                false,
            );
        }
        if request.target.instance_id != self.instance_id || request.target.window_id != "main" {
            return Response::error(
                &request,
                "TARGET_NOT_FOUND",
                "Only this instance's main window is currently supported",
                false,
            );
        }
        if request.request_id.is_empty()
            || request.request_id.len() > 128
            || !(1..=30_000).contains(&request.timeout_ms)
            || !request.params.is_object()
            || !command_exists(&request.command)
            || serde_json::to_vec(&request).map_or(true, |bytes| bytes.len() > MAX_BODY)
            || matches!(&request.target.workspace, Workspace::Session { session_id }
                if session_id.is_empty() || session_id.len() > 512)
        {
            return Response::error(
                &request,
                "INVALID_PARAMS",
                "Unknown command, invalid request ID, workspace, params, timeout or oversized request",
                false,
            );
        }
        let key = (caller.to_string(), request.request_id.clone());
        let (mut receiver, dispatch) = {
            let mut state = self.state.lock().unwrap();
            Self::prune(&mut state);
            if let Some(entry) = state.entries.get(&key) {
                if entry.request != request {
                    return Response::error(
                        &request,
                        "INVALID_PARAMS",
                        "Request ID was already used for another payload",
                        false,
                    );
                }
                (entry.result.subscribe(), None)
            } else {
                // Correlation IDs must also be unique across callers; never let one caller resolve another's request.
                if state
                    .entries
                    .values()
                    .any(|e| e.request.request_id == request.request_id)
                {
                    return Response::error(
                        &request,
                        "INVALID_PARAMS",
                        "Request ID collision",
                        false,
                    );
                }
                if state
                    .entries
                    .values()
                    .filter(|e| e.finished.is_none())
                    .count()
                    >= MAX_PENDING
                {
                    return Response::error(&request, "BUSY", "Too many UI requests", false);
                }
                let Some(runtime) = &state.runtime else {
                    return Response::error(
                        &request,
                        "UI_NOT_READY",
                        "Main UI runtime is not connected",
                        false,
                    );
                };
                let generation = runtime.generation.clone();
                let send = runtime.send.clone();
                let (result, receiver) = watch::channel(None);
                state.entries.insert(
                    key.clone(),
                    Entry {
                        request: request.clone(),
                        generation: generation.clone(),
                        result,
                        finished: None,
                    },
                );
                (
                    receiver,
                    Some((
                        send,
                        Dispatch {
                            generation,
                            request: request.clone(),
                        },
                    )),
                )
            }
        };
        let _guard = dispatch.as_ref().map(|_| CancelGuard { broker: self, key });
        if let Some((send, message)) = dispatch {
            if send(message).is_err() {
                self.disconnect();
            }
        }
        let wait = async {
            loop {
                if let Some(result) = receiver.borrow_and_update().clone() {
                    return result;
                }
                if receiver.changed().await.is_err() {
                    return Response::error(&request, "UI_NOT_READY", "UI channel closed", true);
                }
            }
        };
        tokio::time::timeout(Duration::from_millis(request.timeout_ms), wait)
            .await
            .unwrap_or_else(|_| {
                Response::error(
                    &request,
                    "DEADLINE_EXCEEDED",
                    "Execution outcome is unknown; inspect state before retrying",
                    true,
                )
            })
    }
}
struct CancelGuard<'a> {
    broker: &'a Broker,
    key: (String, String),
}
impl Drop for CancelGuard<'_> {
    fn drop(&mut self) {
        self.broker.abandon(&self.key);
    }
}

#[cfg(test)]
mod tests;
