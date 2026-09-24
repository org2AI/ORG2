//! Optional history provenance; formal execution and inbox stores remain authoritative.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentOrgInputSource {
    UserInput,
    MemberMessages,
    TaskDispatch,
    FinalSummary,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentOrgHistorySender {
    pub member_id: Option<String>,
    pub name: Option<String>,
    pub count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentOrgExecution {
    pub turn_intent_id: String,
    pub source_kind: AgentOrgInputSource,
    pub participant_id: String,
    pub participant_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inbox_count: Option<usize>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub senders: Vec<AgentOrgHistorySender>,
}
