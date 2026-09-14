//! Compose tool schemas from the canonical public command parameter schemas.
use super::Kind;
use serde_json::{json, Value};

fn object(properties: Value, required: &[&str]) -> Value {
    json!({"type":"object","properties":properties,"required":required,"additionalProperties":false})
}
fn command(id: &str) -> Value {
    crate::catalog()["commands"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == id)
        .expect("published command")["params"]
        .clone()
}
fn variant(id: &str, tag: &str) -> Value {
    let mut schema = command(id);
    schema["properties"]["type"] = json!({"type":"string","enum":[tag]});
    if schema.get("required").is_none() {
        schema["required"] = json!([]);
    }
    schema["required"]
        .as_array_mut()
        .unwrap()
        .push(json!("type"));
    schema
}
fn workspace() -> Value {
    json!({"description":"Omit to use the calling workspace. Specify only when the user intends another destination.","anyOf":[
        object(json!({"kind":{"type":"string","enum":["global"]}}), &["kind"]),
        object(json!({"kind":{"type":"string","enum":["session"]},"sessionId":{"type":"string","minLength":1}}), &["kind","sessionId"])
    ]})
}

pub(super) fn parameters(kind: Kind) -> Value {
    let mut schema = match kind {
        Kind::Open => {
            let mut terminal = variant("ui.terminal.focus", "terminal");
            terminal["required"] = json!(["type"]);
            // URI is not a supported Responses strict-schema format. Keep URL
            // validation in the canonical command handler, and expose its intent
            // as prose in the portable agent schema.
            let mut browser = variant("ui.web.open", "browser");
            browser["properties"]["url"]
                .as_object_mut()
                .unwrap()
                .remove("format");
            browser["properties"]["url"]["description"] =
                json!("An absolute HTTP or HTTPS URL; validated by the app");
            let target = json!({"anyOf":[
                variant("ui.file.open", "file"), browser,
                object(json!({"type":{"type":"string","enum":["explorer"]}}), &["type"]),
                object(json!({"type":{"type":"string","enum":["source-control"]}}), &["type"]),
                terminal, variant("ui.terminal.new", "new-terminal"), variant("ui.tab.focus", "tab")
            ]});
            object(
                json!({"target":target,"reveal":{"type":"boolean","description":"Defaults to true. Set false for background registration; existing tab/terminal focus always requests presentation."}}),
                &["target"],
            )
        }
        Kind::Context => command("ui.context"),
        Kind::Tabs => command("ui.tabs.list"),
        Kind::Terminals => command("ui.terminal.list"),
        Kind::ReadTerminal => command("ui.terminal.read"),
        Kind::WriteTerminal => {
            let variants: Vec<Value> = [
                ("ui.terminal.execute", "execute"),
                ("ui.terminal.input", "input"),
                ("ui.terminal.interrupt", "interrupt"),
            ]
            .iter()
            .map(|(id, tag)| {
                let mut schema = variant(id, tag);
                schema["properties"]
                    .as_object_mut()
                    .unwrap()
                    .remove("terminalId");
                schema["required"]
                    .as_array_mut()
                    .unwrap()
                    .retain(|v| v != "terminalId");
                schema
            })
            .collect();
            object(
                json!({"terminalId":command("ui.terminal.read")["properties"]["terminalId"],
                "input":{"anyOf":variants}}),
                &["terminalId", "input"],
            )
        }
        Kind::Docs => object(
            json!({"topic":{"type":"string"},"query":{"type":"string"},"command":{"type":"string"}}),
            &[],
        ),
        Kind::Result => object(
            json!({"requestId":{"type":"string","minLength":1,"maxLength":128}}),
            &["requestId"],
        ),
    };
    if !matches!(kind, Kind::Docs | Kind::Result) {
        schema["properties"]["workspace"] = workspace();
    }
    schema
}
