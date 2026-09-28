//! Shared automatic-history presentation. Adapters own their state and work;
//! this module only defines the snapshot and target-scoped invalidation event.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum HistorySyncState {
    #[default]
    Idle,
    Active,
    Paused,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistorySyncView {
    pub state: HistorySyncState,
    pub reason: Option<String>,
    pub native_version: Option<String>,
    pub shared: usize,
    pub conflicts: usize,
    pub pending: usize,
}

pub(crate) fn emit_changed(agent: &str) {
    if let Some(app) = crate::api::get_app_handle() {
        use tauri::Emitter;
        let _ = app.emit("native-history-state-changed", agent);
    }
}
