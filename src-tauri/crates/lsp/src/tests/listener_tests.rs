use super::server_request_response;
use serde_json::json;
#[test]
fn server_request_preserves_string_id_and_rejects_unimplemented_methods() {
    let result = server_request_response(
        json!("string-id"),
        "workspace/applyEdit",
        Some(&json!({})),
        &json!({}),
    );
    assert_eq!(result["id"], "string-id");
    assert_eq!(result["error"]["code"], -32601);
}
#[test]
fn configuration_expansion_is_bounded_before_cloning_settings() {
    let too_many = json!({"items":vec![json!({});129]});
    let result = server_request_response(
        json!(2),
        "workspace/configuration",
        Some(&too_many),
        &json!({"a":true}),
    );
    assert_eq!(result["error"]["code"], -32602);
    let repeated = json!({"items":vec![json!({});128]});
    let settings = json!({"a":"x".repeat(20*1024)});
    let result = server_request_response(
        json!(3),
        "workspace/configuration",
        Some(&repeated),
        &settings,
    );
    assert_eq!(result["error"]["code"], -32603);
    assert!(result.to_string().len() < 256);
    let result = server_request_response(
        json!(4),
        "workspace/configuration",
        Some(&json!({"items":[{"section":"a.b"},{"section":"missing"}]})),
        &json!({"a":{"b":true}}),
    );
    assert_eq!(result["result"], json!([true, null]));
}
