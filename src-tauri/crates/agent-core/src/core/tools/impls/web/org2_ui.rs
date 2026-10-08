//! Thin native adapter for the harness-independent agent tool surface.
use crate::tools::traits::{CallContext, Tool, ToolError};
use app_ui::agent_tools::{self, Call, Kind};
use async_trait::async_trait;
use serde_json::Value;
use sha2::{Digest, Sha256};

pub struct Org2UiTool(pub Kind);

#[async_trait]
impl Tool for Org2UiTool {
    fn name(&self) -> &str {
        self.0.name()
    }
    fn category(&self) -> &str {
        crate::tools::categories::WEB
    }
    fn description(&self) -> &str {
        self.0.description()
    }
    fn parameters(&self) -> Value {
        self.0.parameters()
    }

    async fn execute_text(&self, params: Value, ctx: &CallContext) -> Result<String, ToolError> {
        ctx.require_tool_authority(self.name())?;
        let broker = app_ui::broker();
        let target = app_ui::Target {
            instance_id: broker.instance_id.clone(),
            window_id: "main".into(),
            workspace: app_ui::Workspace::Session {
                session_id: ctx.session_id.clone(),
            },
        };
        // Stable for redispatch of the same host tool invocation; never model supplied.
        let request_id = if ctx.call_id.is_empty() {
            uuid::Uuid::new_v4().to_string()
        } else {
            // Call IDs are scoped to a turn; another turn may reuse one.
            let identity =
                serde_json::to_vec(&(&ctx.session_id, &ctx.turn_intent_id, &ctx.call_id))
                    .expect("host identity strings serialize");
            format!("{:x}", Sha256::digest(identity))
        };
        let call = agent_tools::prepare(self.0, params, Some(&target), &request_id)
            .map_err(ToolError::InvalidParams)?;
        let caller = format!("native:{}", ctx.session_id);
        let value = match call {
            Call::Execute(request) => serde_json::to_value(broker.execute(&caller, request).await),
            Call::Document(value) => Ok(value),
            Call::Receipt(id) => Ok(agent_tools::receipt(broker, &caller, &id)),
        }
        .map_err(|e| ToolError::ExecutionFailed(e.to_string()))?;
        Ok(value
            .get("markdown")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| value.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    #[test]
    fn native_metadata_and_schemas_match_shared_catalog_and_management_gate() {
        for kind in agent_tools::ALL {
            let tool = Org2UiTool(*kind);
            let entry = crate::tools::builtin_tools::BUILTIN_TOOLS
                .iter()
                .find(|entry| entry.name == tool.name())
                .unwrap();
            assert_eq!(tool.parameters(), kind.parameters());
            assert_eq!(entry.description, tool.description());
            assert_eq!(
                entry.required_capability,
                crate::definitions::capabilities::RequiredCapability::Management
            );
        }
    }

    /// Transcripts are the only place a user sees these calls happen, and
    /// `write_org2_terminal` is the first surface that lets an agent type
    /// into their shell. It must not render identically to a docs read.
    #[test]
    fn transcript_labels_separate_open_terminal_read_and_terminal_write() {
        let entry = |kind: &Kind| {
            crate::tools::builtin_tools::BUILTIN_TOOLS
                .iter()
                .find(|entry| entry.name == kind.name())
                .unwrap()
        };
        let labels = |kind: &Kind| {
            let e = entry(kind);
            (e.icon_id, e.label_running, e.label_done, e.label_failed)
        };
        let inspect = [Kind::Context, Kind::Tabs, Kind::Terminals, Kind::Docs];
        for kind in inspect {
            assert_eq!(labels(&kind), labels(&Kind::Result), "{}", kind.name());
        }
        let groups = [
            Kind::Open,
            Kind::ReadTerminal,
            Kind::WriteTerminal,
            Kind::Result,
        ];
        for (index, kind) in groups.iter().enumerate() {
            for other in &groups[index + 1..] {
                assert_ne!(
                    labels(kind),
                    labels(other),
                    "{} and {} share transcript labels",
                    kind.name(),
                    other.name()
                );
            }
        }
        // Every key the table names must resolve; the i18n key check owns
        // the catalog, this owns the shape the frontend reads.
        for kind in agent_tools::ALL {
            let e = entry(kind);
            for key in [e.label_running, e.label_done, e.label_failed] {
                assert!(key.starts_with("tools.orgiiGui"), "{key}");
            }
            assert!(!e.icon_id.is_empty());
        }
    }

    #[test]
    fn responses_and_codex_wire_schemas_make_optional_arguments_nullable() {
        use crate::providers::responses_common::convert_tools;
        let definitions: Vec<Value>=agent_tools::ALL.iter().map(|kind| json!({"type":"function","function":{"name":kind.name(),"description":kind.description(),"parameters":Org2UiTool(*kind).parameters()}})).collect();
        let wire = convert_tools(Some(&definitions)).unwrap();
        fn check_subset(schema: &Value) {
            if let Some(format) = schema["format"].as_str() {
                assert!(
                    [
                        "date-time",
                        "time",
                        "date",
                        "duration",
                        "email",
                        "hostname",
                        "ipv4",
                        "ipv6",
                        "uuid"
                    ]
                    .contains(&format),
                    "unsupported format: {format}"
                );
            }
            for keyword in [
                "allOf",
                "not",
                "dependentRequired",
                "dependentSchemas",
                "if",
                "then",
                "else",
            ] {
                assert!(
                    schema.get(keyword).is_none(),
                    "unsupported keyword: {keyword}"
                );
            }
            if let Some(properties) = schema["properties"].as_object() {
                assert_eq!(schema["additionalProperties"], false);
                let required = schema["required"].as_array().unwrap();
                assert_eq!(properties.len(), required.len());
                for (name, child) in properties {
                    assert!(required.contains(&json!(name)));
                    check_subset(child);
                }
            }
            if let Some(variants) = schema["anyOf"].as_array() {
                for child in variants {
                    check_subset(child);
                }
            }
            if let Some(items) = schema.get("items") {
                check_subset(items);
            }
        }
        for tool in &wire {
            let params = &tool["parameters"];
            check_subset(params);
            let properties = params["properties"].as_object().unwrap();
            let required = params["required"].as_array().unwrap();
            assert_eq!(properties.len(), required.len());
            assert!(properties.keys().all(|key| required.contains(&json!(key))));
        }
        let open = wire
            .iter()
            .find(|tool| tool["name"] == Kind::Open.name())
            .unwrap();
        for field in ["workspace", "reveal"] {
            assert!(open["parameters"]["properties"][field]["anyOf"]
                .as_array()
                .unwrap()
                .contains(&json!({"type":"null"})));
        }
    }

    #[test]
    fn read_only_modes_deny_mutations_but_keep_ui_discovery() {
        use crate::session::AgentExecMode;
        use crate::tools::policy::{ResolvedToolPolicy, ToolVerdict};
        for mode in [
            AgentExecMode::Ask,
            AgentExecMode::Plan,
            AgentExecMode::Review,
            AgentExecMode::Debug,
        ] {
            let policy =
                ResolvedToolPolicy::permissive().with_extra_layer(mode.policy_layer().unwrap());
            for kind in agent_tools::ALL {
                assert_eq!(
                    policy.verdict(kind.name()),
                    if matches!(kind, Kind::Open | Kind::WriteTerminal) {
                        ToolVerdict::Deny
                    } else {
                        ToolVerdict::Allow
                    }
                );
            }
        }
    }

    #[tokio::test]
    async fn native_boundary_checks_authority_binds_caller_and_preserves_receipt_ownership() {
        let tool = Org2UiTool(Kind::Open);
        let args = json!({"target":{"type":"file","path":"src/main.ts","line":null},"workspace":null,"reveal":null});
        assert!(tool
            .execute_text(args.clone(), &CallContext::default())
            .await
            .unwrap_err()
            .to_string()
            .contains("tool_authority_denied"));
        let broker = app_ui::broker();
        let count = Arc::new(AtomicUsize::new(0));
        let calls = count.clone();
        let generation = broker.register(Arc::new(move |event| {
            calls.fetch_add(1, Ordering::SeqCst);
            assert_eq!(
                event.request.target.workspace,
                app_ui::Workspace::Session {
                    session_id: "calling-session".into()
                }
            );
            assert!(event.request.reveal);
            assert_eq!(event.request.params, json!({"path":"src/main.ts"}));
            broker.resolve(
                &event.generation,
                app_ui::Response {
                    protocol_version: app_ui::VERSION,
                    request_id: event.request.request_id,
                    target: event.request.target,
                    status: app_ui::Status::Applied,
                    result: Some(json!({"presentationState":"requested","revealed":false})),
                    error: None,
                },
            );
            Ok(())
        }));
        struct Unregister(String);
        impl Drop for Unregister {
            fn drop(&mut self) {
                app_ui::broker().unregister(&self.0);
            }
        }
        let _guard = Unregister(generation);
        let mut ctx = CallContext::trusted_sde();
        ctx.session_id = "calling-session".into();
        ctx.call_id = "host-call".into();
        ctx.turn_intent_id = "turn-one".into();
        let result: Value =
            serde_json::from_str(&tool.execute_text(args.clone(), &ctx).await.unwrap()).unwrap();
        let replay: Value =
            serde_json::from_str(&tool.execute_text(args.clone(), &ctx).await.unwrap()).unwrap();
        assert_eq!(result, replay);
        assert_eq!(count.load(Ordering::SeqCst), 1);
        ctx.turn_intent_id = "turn-two".into();
        let next_turn: Value =
            serde_json::from_str(&tool.execute_text(args, &ctx).await.unwrap()).unwrap();
        assert_ne!(next_turn["requestId"], result["requestId"]);
        assert_eq!(next_turn["status"], "applied");
        assert_eq!(count.load(Ordering::SeqCst), 2);
        let receipt_tool = Org2UiTool(Kind::Result);
        let receipt_args = json!({"requestId":result["requestId"]});
        assert_eq!(
            serde_json::from_str::<Value>(
                &receipt_tool
                    .execute_text(receipt_args.clone(), &ctx)
                    .await
                    .unwrap()
            )
            .unwrap(),
            result
        );
        ctx.session_id = "other-session".into();
        let missing: Value =
            serde_json::from_str(&receipt_tool.execute_text(receipt_args, &ctx).await.unwrap())
                .unwrap();
        assert_eq!(missing["status"], "unknown");
        ctx.session_id.clear();
        assert!(Org2UiTool(Kind::Context)
            .execute_text(json!({}), &ctx)
            .await
            .unwrap_err()
            .to_string()
            .contains("UI_TARGET_UNBOUND"));
        assert!(Org2UiTool(Kind::Docs)
            .execute_text(json!({"topic":"native"}), &ctx)
            .await
            .unwrap()
            .contains("Native agent tools"));
    }
}
