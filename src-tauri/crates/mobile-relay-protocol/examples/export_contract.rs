//! Build-time only. Schemas never become Relay messages or runtime dependencies.
use mobile_relay_protocol::*;
use schemars::{generate::SchemaSettings, JsonSchema};
use serde_json::{json, Value};

fn schema<T: JsonSchema>() -> Value {
    json!({
        "input": SchemaSettings::draft07().for_deserialize().into_generator().into_root_schema_for::<T>(),
        "output": SchemaSettings::draft07().for_serialize().into_generator().into_root_schema_for::<T>(),
    })
}

fn main() {
    let contract = json!({
        "artifactVersion": 1,
        "crateVersion": env!("CARGO_PKG_VERSION"),
        "constants": {
            "RELAY_PROTOCOL_VERSION": RELAY_PROTOCOL_VERSION,
            "DESKTOP_WS_PATH": DESKTOP_WS_PATH,
            "MOBILE_WS_PATH": MOBILE_WS_PATH,
            "MOBILE_CONNECT_TICKET_PATH": MOBILE_CONNECT_TICKET_PATH,
            "PAIRINGS_PATH": PAIRINGS_PATH,
            "PAIRING_COMPLETE_PATH": PAIRING_COMPLETE_PATH,
            "DEVICES_PATH": DEVICES_PATH,
            "DEVICE_REVOKE_PATH": DEVICE_REVOKE_PATH,
            "PRIMARY_DESKTOP_PATH": PRIMARY_DESKTOP_PATH,
            "MAX_FRAME_BYTES": MAX_FRAME_BYTES,
        },
        "types": {
            "PermissionTier": schema::<PermissionTier>(),
            "MobileConnectTicketRequest": schema::<MobileConnectTicketRequest>(),
            "MobileConnectTicketResponse": schema::<MobileConnectTicketResponse>(),
            "PairingInitRequest": schema::<PairingInitRequest>(),
            "PairingInitResponse": schema::<PairingInitResponse>(),
            "PairingCompleteRequest": schema::<PairingCompleteRequest>(),
            "RevokeDeviceRequest": schema::<RevokeDeviceRequest>(),
            "SetPrimaryDesktopRequest": schema::<SetPrimaryDesktopRequest>(),
            "PairedDeviceInfo": schema::<PairedDeviceInfo>(),
            "RelayWireFrame": schema::<RelayWireFrame>(),
        },
    });
    println!(
        "{}",
        serde_json::to_string_pretty(&contract).expect("contract JSON")
    );
}
