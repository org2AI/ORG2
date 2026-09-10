use mobile_relay_protocol::*;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;

fn round_trip<T: DeserializeOwned + Serialize>(value: Value) -> Result<Value, serde_json::Error> {
    serde_json::from_value::<T>(value).and_then(serde_json::to_value)
}

#[test]
fn frozen_v1_wire_examples_match_real_serde_behavior() {
    let cases: Vec<Value> = serde_json::from_str(include_str!("fixtures/v1.json")).unwrap();
    for case in cases {
        let input = case["input"].clone();
        let result = match case["type"].as_str().unwrap() {
            "PermissionTier" => round_trip::<PermissionTier>(input),
            "MobileConnectTicketRequest" => round_trip::<MobileConnectTicketRequest>(input),
            "MobileConnectTicketResponse" => round_trip::<MobileConnectTicketResponse>(input),
            "PairingInitRequest" => round_trip::<PairingInitRequest>(input),
            "PairingInitResponse" => round_trip::<PairingInitResponse>(input),
            "PairingCompleteRequest" => round_trip::<PairingCompleteRequest>(input),
            "RevokeDeviceRequest" => round_trip::<RevokeDeviceRequest>(input),
            "SetPrimaryDesktopRequest" => round_trip::<SetPrimaryDesktopRequest>(input),
            "PairedDeviceInfo" => round_trip::<PairedDeviceInfo>(input),
            "RelayWireFrame" => round_trip::<RelayWireFrame>(input),
            other => panic!("uncovered contract type: {other}"),
        };
        if case["reject"] == true {
            assert!(result.is_err(), "{} accepted invalid input", case["name"]);
        } else {
            assert_eq!(result.unwrap(), case["canonical"], "{}", case["name"]);
        }
    }
}
