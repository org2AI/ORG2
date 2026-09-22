use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Strategy {
    Leave,
    Bring,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Switched,
    SwitchedWithConflicts,
    Blocked,
    RecoveryRequired,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwitchTarget {
    pub branch: String,
    #[serde(default)]
    pub create: bool,
    pub start_point: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Blocked {
    /// Stable key the UI localizes; `message` is the English fallback.
    pub code: String,
    pub message: String,
    /// Code-specific parameter: the Git operation kind or a raw Git error.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub worktree_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Preparation {
    pub current_branch: String,
    pub target_branch: String,
    pub fingerprint: String,
    pub changed_files: Vec<String>,
    pub default_strategy: Strategy,
    pub same_branch: bool,
    pub blocked: Option<Blocked>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecuteRequest {
    pub target: SwitchTarget,
    pub fingerprint: String,
    pub strategy: Strategy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwitchResult {
    pub outcome: Outcome,
    pub current_branch: String,
    /// Stable key the UI localizes (empty for a plain switch); `message` is
    /// the English fallback.
    #[serde(default)]
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub snapshot_id: Option<String>,
    pub conflicts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SnapshotPhase {
    Saving,
    Saved,
    Switching,
    Applying,
    Brought,
    Restoring,
    Restored,
    NeedsResolution,
}

/// An additive recovery journal; the Git stash remains usable by older apps/CLI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub id: String,
    pub source_branch: String,
    pub source_head: String,
    pub worktree_path: String,
    pub target_branch: String,
    pub created_at: String,
    pub files: Vec<String>,
    pub oid: Option<String>,
    pub phase: SnapshotPhase,
}
