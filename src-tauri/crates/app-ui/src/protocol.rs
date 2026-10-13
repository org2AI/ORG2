use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const VERSION: u32 = 1;
pub const MAX_BODY: usize = 64 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Workspace {
    Global {},
    Session {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Target {
    pub instance_id: String,
    pub window_id: String,
    pub workspace: Workspace,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub protocol_version: u32,
    pub request_id: String,
    pub command: String,
    pub target: Target,
    #[serde(default = "empty_params")]
    pub params: Value,
    #[serde(default)]
    pub reveal: bool,
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,
}
fn empty_params() -> Value {
    json!({})
}
fn default_timeout() -> u64 {
    10_000
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Response {
    pub protocol_version: u32,
    pub request_id: String,
    pub status: Status,
    pub target: Target,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<Failure>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Applied,
    Failed,
    Unknown,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Failure {
    pub code: String,
    pub message: String,
}
impl Response {
    pub fn error(request: &Request, code: &str, message: &str, unknown: bool) -> Self {
        Self {
            protocol_version: VERSION,
            request_id: request.request_id.clone(),
            target: request.target.clone(),
            status: if unknown {
                Status::Unknown
            } else {
                Status::Failed
            },
            result: None,
            error: Some(Failure {
                code: code.into(),
                message: message.into(),
            }),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dispatch {
    pub generation: String,
    pub request: Request,
}
