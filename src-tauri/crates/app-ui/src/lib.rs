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
/// Catalog capability tiers. Every enforcement point keys on one of these;
/// none of them re-derive privilege from the command id.
pub const CAPABILITY_READ: &str = "ui.read";
pub const CAPABILITY_TERMINAL_READ: &str = "terminal.read";
pub const CAPABILITY_PRESENT: &str = "ui.present";
pub const CAPABILITY_TERMINAL_WRITE: &str = "terminal.write";

pub fn command_exists(command: &str) -> bool {
    command_capability(command).is_some()
}

/// The catalog capability a command requires. Every enforcement point keys on
/// this rather than re-deriving "is this a mutation" from the command id.
pub fn command_capability(command: &str) -> Option<&'static str> {
    catalog()["commands"]
        .as_array()?
        .iter()
        .find(|item| item["id"] == command)?["capability"]
        .as_str()
}

pub fn capabilities() -> serde_json::Value {
    let catalog = catalog();
    serde_json::json!({"protocolVersion":VERSION,"instanceId":broker().instance_id,"catalogHash":catalog["hash"],
        "ready":broker().ready(),"windows":[{"windowId":"main","station":"my-station","ready":broker().ready()}],
        "commands":catalog["commands"],"limitations":["Main window only; detached station targets are not supported", "Line navigation is queued; receipts do not confirm editor scroll", "UI presentation requires the app's ADE Manager setting"]})
}
