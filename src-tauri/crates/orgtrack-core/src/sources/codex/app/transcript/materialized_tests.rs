use serde_json::json;

use super::super::materialized_tool::{encode_tool_output, MATERIALIZED_TOOL_ID_PREFIX};
use super::{load_codex_app_from_path, visit_codex_app_from_path};

#[test]
fn materialized_tool_results_preserve_opaque_body_and_explicit_status() {
    let dir = std::env::temp_dir().join(format!("orgii-opaque-results-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("rollout.jsonl");
    let outputs = [
        "{\"output\":\"file contents\",\"session_id\":123}",
        "Script failed\nExit code: 1\n",
        "Script running with cell ID cell-example\n",
        "  leading\r\n中文 😀\ntrailing\t\n",
        "",
        "{}",
    ];
    let mut records = Vec::new();
    for (index, output) in outputs.iter().enumerate() {
        records.push(json!({"type":"response_item","payload":{
            "type":"function_call","id":format!("{MATERIALIZED_TOOL_ID_PREFIX}{index}"),
            "call_id":format!("call_{index}"),"name":"read_file","arguments":"{}"
        }}));
        records.push(json!({"type":"response_item","payload":{
            "type":"function_call_output","call_id":format!("call_{index}"),
            "output":encode_tool_output(output, false, false)
        }}));
    }
    let bytes = records
        .iter()
        .map(|record| format!("{record}\n"))
        .collect::<String>();
    std::fs::write(&path, &bytes).unwrap();
    for _ in 0..2 {
        let full = load_codex_app_from_path("opaque", &path).unwrap();
        let mut visited = Vec::new();
        visit_codex_app_from_path("opaque", &path, &mut |chunks| {
            visited.extend(chunks);
            Ok(())
        })
        .unwrap();
        for chunks in [&full, &visited] {
            assert_eq!(chunks.len(), outputs.len());
            for (chunk, expected) in chunks.iter().zip(outputs) {
                assert_eq!(chunk.result["output"], expected);
                assert_eq!(
                    chunk.result["success"], true,
                    "body is not execution status"
                );
                assert_eq!(chunk.result["status"], "completed");
            }
        }
    }
    assert_eq!(std::fs::read(&path).unwrap(), bytes.as_bytes());
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn materialized_tool_identity_preserves_names_args_and_rejects_bad_envelopes() {
    let dir = std::env::temp_dir().join(format!("orgii-typed-results-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("rollout.jsonl");
    let call = json!({"type":"response_item","payload":{
        "type":"function_call","id":format!("{MATERIALIZED_TOOL_ID_PREFIX}test"),
        "call_id":"tool","name":"exec_command","arguments":"{\"command\":\"echo literal\"}"
    }});
    for (is_error, interrupted, code) in [(false, false, 0), (true, false, 1), (false, true, 130)] {
        let result = json!({"type":"response_item","payload":{
            "type":"function_call_output","call_id":"tool",
            "output":encode_tool_output("\"output\": nested\n", is_error, interrupted)
        }});
        std::fs::write(&path, format!("{call}\n{result}\n")).unwrap();
        let chunks = load_codex_app_from_path("typed", &path).unwrap();
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].function, "exec_command");
        assert_eq!(chunks[0].args["command"], "echo literal");
        assert_eq!(chunks[0].result["output"], "\"output\": nested\n");
        assert_eq!(chunks[0].result["exit_code"], code);
        assert_eq!(chunks[0].result["is_error"], code != 0);
    }
    for invalid in [
        json!(null),
        json!("plain output"),
        json!("{}"),
        json!("{\"exit_code\":0}"),
        json!("{\"output\":\"x\",\"exit_code\":5}"),
    ] {
        let result = json!({"type":"response_item","payload":{
            "type":"function_call_output","call_id":"tool","output":invalid
        }});
        std::fs::write(&path, format!("{call}\n{result}\n")).unwrap();
        let error = load_codex_app_from_path("typed", &path).unwrap_err();
        assert!(error.to_lowercase().contains("materialized"));
    }
    // Provenance is protocol metadata, not a tool argument. A native tool can
    // legitimately read data with an ORG2-looking field; it cannot select the
    // injected-result decoder by supplying that field itself.
    let native_call = json!({"type":"response_item","payload":{
        "type":"function_call","call_id":"native","name":"read_file",
        "arguments":json!({"path":"fixture","__orgiiSourceEventId":"fc_orgii_v1_fake"}).to_string()
    }});
    let result = json!({"type":"response_item","payload":{
        "type":"function_call_output","call_id":"native","output":"plain literal"
    }});
    std::fs::write(&path, format!("{native_call}\n{result}\n")).unwrap();
    let chunks = load_codex_app_from_path("native", &path).unwrap();
    assert_eq!(chunks.len(), 1);
    assert_eq!(chunks[0].result["output"], "plain literal");
    std::fs::remove_dir_all(dir).unwrap();
}
