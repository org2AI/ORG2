use super::*;
use crate::{Broker, Response, Status};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

fn target() -> Target {
    Target {
        instance_id: "instance".into(),
        window_id: "main".into(),
        workspace: Workspace::Session {
            session_id: "caller-session".into(),
        },
    }
}
fn request(kind: Kind, args: Value) -> Request {
    match prepare(kind, args, Some(&target()), "host-call").unwrap() {
        Call::Execute(request) => request,
        _ => panic!("expected request"),
    }
}
#[test]
fn opens_map_to_published_commands_with_presentation_and_caller_defaults() {
    for (target, command, params) in [
        (
            json!({"type":"file","path":"src/main.ts","line":42}),
            "ui.file.open",
            json!({"path":"src/main.ts","line":42}),
        ),
        (
            json!({"type":"browser","url":"https://example.com"}),
            "ui.web.open",
            json!({"url":"https://example.com"}),
        ),
        (
            json!({"type":"explorer"}),
            "ui.tab.open",
            json!({"kind":"explorer"}),
        ),
        (
            json!({"type":"source-control"}),
            "ui.tab.open",
            json!({"kind":"source-control"}),
        ),
        (json!({"type":"terminal"}), "ui.terminal.open", json!({})),
        (
            json!({"type":"terminal","terminalId":"shell"}),
            "ui.terminal.focus",
            json!({"terminalId":"shell"}),
        ),
        (
            json!({"type":"new-terminal","name":"Build"}),
            "ui.terminal.new",
            json!({"name":"Build"}),
        ),
        (
            json!({"type":"tab","tabId":"file:one","partition":"workspace"}),
            "ui.tab.focus",
            json!({"tabId":"file:one","partition":"workspace"}),
        ),
    ] {
        let req = request(Kind::Open, json!({"target":target}));
        assert_eq!(req.command, command);
        assert_eq!(req.params, params);
        assert!(req.reveal);
        assert_eq!(req.target, super::tests::target());
        assert_eq!(req.request_id, "host-call");
        assert_eq!(req.protocol_version, VERSION);
        assert!(crate::command_exists(command));
    }
    assert!(
        !request(
            Kind::Open,
            json!({"target":{"type":"file","path":"a"},"reveal":false})
        )
        .reveal
    );
    assert!(prepare(
        Kind::Open,
        json!({"target":{"type":"terminal","terminalId":"shell"},"reveal":false}),
        Some(&target()),
        "id"
    )
    .is_err());
}
#[test]
fn bindings_fail_closed_and_only_workspace_is_model_overridable() {
    assert!(prepare(Kind::Context, json!({}), None, "id").is_err());
    let mut empty = target();
    empty.workspace = Workspace::Session {
        session_id: String::new(),
    };
    assert!(prepare(Kind::Context, json!({}), Some(&empty), "id").is_err());
    assert!(prepare(
        Kind::Context,
        json!({"workspace":{"kind":"global"}}),
        Some(&empty),
        "id"
    )
    .is_ok());
    let req = request(
        Kind::Open,
        json!({"target":{"type":"explorer"},"workspace":{"kind":"session","sessionId":"other"}}),
    );
    assert_eq!(req.target.instance_id, target().instance_id);
    assert_eq!(
        req.target.workspace,
        Workspace::Session {
            session_id: "other".into()
        }
    );
    for args in [
        json!({"instanceId":"other"}),
        json!({"requestId":"model-id"}),
        json!({"protocolVersion":1}),
        json!({"workspace":{"kind":"global","sessionId":"hidden"}}),
    ] {
        assert!(prepare(Kind::Context, args, Some(&target()), "id").is_err());
    }
}
#[test]
fn terminal_input_preserves_literals_and_requires_an_explicit_id() {
    for (input, command, params) in [
        (
            json!({"type":"execute","command":"echo '$HOME'"}),
            "ui.terminal.execute",
            json!({"terminalId":"shell","command":"echo '$HOME'"}),
        ),
        (
            json!({"type":"input","data":"\u{1b}[A\n"}),
            "ui.terminal.input",
            json!({"terminalId":"shell","data":"\u{1b}[A\n"}),
        ),
        (
            json!({"type":"interrupt"}),
            "ui.terminal.interrupt",
            json!({"terminalId":"shell"}),
        ),
    ] {
        let req = request(
            Kind::WriteTerminal,
            json!({"terminalId":"shell","input":input}),
        );
        assert_eq!(req.command, command);
        assert_eq!(req.params, params);
        assert!(!req.reveal);
    }
    for args in [
        json!({"input":{"type":"interrupt"}}),
        json!({"terminalId":"shell","input":{"type":"execute","data":"wrong"}}),
        json!({"terminalId":"shell","input":{"type":"interrupt","command":"hidden"}}),
    ] {
        assert!(prepare(Kind::WriteTerminal, args, Some(&target()), "id").is_err());
    }
    assert_eq!(
        request(
            Kind::ReadTerminal,
            json!({"terminalId":"shell","maxBytes":512})
        )
        .params,
        json!({"terminalId":"shell","maxBytes":512})
    );
    for (kind, command) in [
        (Kind::Tabs, "ui.tabs.list"),
        (Kind::Terminals, "ui.terminal.list"),
    ] {
        let req = request(kind, json!({"limit":5,"cursor":2}));
        assert_eq!(req.command, command);
        assert_eq!(req.params, json!({"limit":5,"cursor":2}));
    }
}
#[test]
fn tool_shapes_reject_unknown_variants_fields_and_nonobjects() {
    for args in [
        json!([]),
        json!({"target":{"type":"file","path":"x","line":"42"}}),
        json!({"target":{"type":"explorer","path":"hidden"}}),
        json!({"target":{"type":"window"}}),
        json!({"target":{"type":"file","path":"x"},"params":{}}),
    ] {
        assert!(prepare(Kind::Open, args, Some(&target()), "id").is_err());
    }
    assert!(prepare(
        Kind::ReadTerminal,
        json!({"terminalId":"x","maxBytes":-1}),
        Some(&target()),
        "id"
    )
    .is_err());
}
#[test]
fn catalog_schemas_reuse_command_bounds_and_hide_transport_identity() {
    let catalog = catalog();
    assert_eq!(catalog["tools"].as_array().unwrap().len(), ALL.len());
    for kind in ALL {
        let schema = kind.parameters();
        assert_eq!(schema["type"], "object");
        assert_eq!(schema["additionalProperties"], false);
        assert!(schema["properties"].get("instanceId").is_none());
        assert_eq!(Kind::from_name(kind.name()), Some(*kind));
    }
    assert_eq!(
        Kind::ReadTerminal.parameters()["properties"]["maxBytes"],
        crate::catalog()["commands"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["id"] == "ui.terminal.read")
            .unwrap()["params"]["properties"]["maxBytes"]
    );
    let schema = Kind::Open.parameters();
    assert_eq!(
        schema["properties"]["target"]["anyOf"]
            .as_array()
            .unwrap()
            .len(),
        7
    );
    let browser = schema["properties"]["target"]["anyOf"]
        .as_array()
        .unwrap()
        .iter()
        .find(|variant| variant["properties"]["type"]["enum"] == json!(["browser"]))
        .unwrap();
    assert!(browser["properties"]["url"].get("format").is_none());
    let command = crate::catalog()["commands"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "ui.web.open")
        .unwrap();
    assert_eq!(command["params"]["properties"]["url"]["format"], "uri");
    assert_eq!(
        browser["properties"]["url"]["maxLength"],
        command["params"]["properties"]["url"]["maxLength"]
    );
    assert!(catalog.to_string().len() < 20_000);
}
#[test]
fn docs_work_offline_and_receipts_never_infer_failure_from_absence() {
    for args in [
        json!({}),
        json!({"topic":"native"}),
        json!({"topic":"cli"}),
        json!({"query":"terminal"}),
        json!({"command":"ui.file.open"}),
    ] {
        assert!(matches!(
            prepare(Kind::Docs, args, None, "").unwrap(),
            Call::Document(_)
        ));
    }
    assert!(prepare(
        Kind::Docs,
        json!({"topic":"native","query":"terminal"}),
        None,
        ""
    )
    .is_err());
    assert!(prepare(Kind::Result, json!({"requestId":""}), None, "").is_err());
    assert_eq!(
        receipt(&Broker::new(), "caller", "missing")["status"],
        "unknown"
    );
}
#[tokio::test]
async fn typed_calls_use_the_same_broker_receipts_and_deduplicate_host_identity() {
    let broker = Arc::new(Broker::new());
    let weak = Arc::downgrade(&broker);
    let calls = Arc::new(AtomicUsize::new(0));
    let count = calls.clone();
    broker.register(Arc::new(move |event| {
        count.fetch_add(1, Ordering::SeqCst);
        assert_eq!(
            event.request.target.workspace,
            Workspace::Session {
                session_id: "caller-session".into()
            }
        );
        assert_eq!(event.request.command, "ui.terminal.interrupt");
        weak.upgrade().unwrap().resolve(
            &event.generation,
            Response {
                protocol_version: VERSION,
                request_id: event.request.request_id,
                target: event.request.target,
                status: Status::Applied,
                result: Some(json!({"executionState":"unconfirmed"})),
                error: None,
            },
        );
        Ok(())
    }));
    let mut binding = target();
    binding.instance_id = broker.instance_id.clone();
    let Call::Execute(req) = prepare(
        Kind::WriteTerminal,
        json!({"terminalId":"shell","input":{"type":"interrupt"}}),
        Some(&binding),
        "stable-id",
    )
    .unwrap() else {
        panic!()
    };
    assert_eq!(
        broker
            .execute("native:caller-session", req.clone())
            .await
            .status,
        Status::Applied
    );
    assert_eq!(
        broker.execute("native:caller-session", req).await.status,
        Status::Applied
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        receipt(&broker, "native:caller-session", "stable-id")["status"],
        "applied"
    );
    assert_eq!(receipt(&broker, "cli", "stable-id")["status"], "unknown");
}

#[test]
fn strict_provider_nulls_preserve_optional_defaults() {
    let req = request(
        Kind::Open,
        json!({"target":{"type":"file","path":"src/main.ts","line":null},"workspace":null,"reveal":null}),
    );
    assert_eq!(req.target, target());
    assert!(req.reveal);
    assert_eq!(req.params, json!({"path":"src/main.ts"}));
    for kind in [Kind::Tabs, Kind::Terminals] {
        assert_eq!(
            request(kind, json!({"workspace":null,"limit":null,"cursor":null})).params,
            json!({})
        );
    }
    assert_eq!(
        request(Kind::Context, json!({"workspace":null})).target,
        target()
    );
    assert_eq!(
        request(
            Kind::ReadTerminal,
            json!({"terminalId":"shell","maxBytes":null,"workspace":null})
        )
        .params,
        json!({"terminalId":"shell"})
    );
    assert!(matches!(
        prepare(
            Kind::Docs,
            json!({"topic":null,"query":null,"command":null}),
            None,
            ""
        )
        .unwrap(),
        Call::Document(_)
    ));
    assert!(prepare(Kind::Context, json!({"workspace":null}), None, "id").is_err());
    assert!(!request(Kind::Open,json!({"target":{"type":"file","path":"x"},"workspace":{"kind":"global"},"reveal":false})).reveal);
}
