//! Own the lifetime of a frontend CLI permission prompt, including cancelled futures.

pub(super) struct PermissionLifetime {
    session_id: String,
    request_id: String,
    cleanup: fn(&str),
}

impl PermissionLifetime {
    pub(super) fn new(session_id: &str, request_id: &str, cleanup: fn(&str)) -> Self {
        Self {
            session_id: session_id.into(),
            request_id: request_id.into(),
            cleanup,
        }
    }
}

impl Drop for PermissionLifetime {
    fn drop(&mut self) {
        (self.cleanup)(&self.request_id);
        crate::api::websocket_handler::broadcast(
            serde_json::json!({
                "type": "permission:resolved",
                "session_id": self.session_id,
                "sessionId": self.session_id,
                "requestId": self.request_id,
            })
            .to_string(),
        );
    }
}
