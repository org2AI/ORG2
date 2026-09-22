use super::{static_tool_list, ToolRegistryData};

/// Keep fixture output stable even if another dependency enables serde_json's
/// preserve_order feature. The production array ordering is preserved.
fn canonicalize_objects(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            for value in map.values_mut() {
                canonicalize_objects(value);
            }
            let sorted: std::collections::BTreeMap<_, _> =
                std::mem::take(map).into_iter().collect();
            map.extend(sorted);
        }
        serde_json::Value::Array(values) => {
            for value in values {
                canonicalize_objects(value);
            }
        }
        _ => {}
    }
}

#[test]
fn rust_tool_registry_matches_shared_frontend_contract() {
    let data = ToolRegistryData {
        tools: static_tool_list(),
        cli_aliases: core_types::cli_alias::get_all_cli_aliases(),
    };
    assert!(!data.tools.is_empty());
    assert!(!data.cli_aliases.is_empty());
    assert!(data.tools.iter().all(|tool| tool.source != "mcp"));

    let mut actual = serde_json::to_value(data).expect("serialize production tool registry");
    canonicalize_objects(&mut actual);
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../src/test/fixtures/tool-registry.rust.json");
    if std::env::var("ORGII_UPDATE_TOOL_CONTRACT").as_deref() == Ok("1") {
        std::fs::create_dir_all(fixture.parent().unwrap()).expect("create fixture directory");
        let contents = serde_json::to_string_pretty(&actual).expect("format tool registry") + "\n";
        std::fs::write(&fixture, contents).expect("update shared tool registry fixture");
    }

    let expected: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&fixture).unwrap_or_else(|error| {
            panic!(
                "read {}: {error}; regenerate explicitly with ORGII_UPDATE_TOOL_CONTRACT=1",
                fixture.display()
            )
        }))
        .expect("parse shared tool registry fixture");
    assert_eq!(
        actual, expected,
        "Rust tool registry wire contract changed; review the change, then regenerate with ORGII_UPDATE_TOOL_CONTRACT=1 and run the frontend contract test"
    );
}
