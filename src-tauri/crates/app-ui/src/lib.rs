//! Harness-independent UI command protocol and bounded request broker.
//! No Tauri, agent sessions, provider clients, filesystem watchers or polling.
pub mod agent_tools;
mod broker;
pub mod docs;
pub mod protocol;
pub use broker::{Broker, SendRequest};
pub use protocol::*;
use std::sync::OnceLock;

pub fn broker() -> &'static Broker {
    static INSTANCE: OnceLock<Broker> = OnceLock::new();
    INSTANCE.get_or_init(Broker::new)
}

pub fn catalog() -> &'static serde_json::Value {
    static CATALOG: OnceLock<serde_json::Value> = OnceLock::new();
    CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!("../catalog.json")).expect("validated bundled UI catalog")
    })
}
pub fn command_exists(command: &str) -> bool {
    catalog()["commands"]
        .as_array()
        .is_some_and(|items| items.iter().any(|item| item["id"] == command))
}

pub fn capabilities() -> serde_json::Value {
    let catalog = catalog();
    serde_json::json!({"protocolVersion":VERSION,"instanceId":broker().instance_id,"catalogHash":catalog["hash"],
        "ready":broker().ready(),"windows":[{"windowId":"main","station":"my-station","ready":broker().ready()}],
        "commands":catalog["commands"],"limitations":["Main window only; detached station targets are not supported", "Line navigation is queued; receipts do not confirm editor scroll", "UI presentation requires the app's ADE Manager setting"]})
}
