use super::*;
use key_vault::key_store::{ModelKey, ModelType};

fn state(model: Option<&str>, account_id: Option<&str>) -> MobileSessionModelState {
    MobileSessionModelState {
        model: model.map(str::to_string),
        account_id: account_id.map(str::to_string),
        key_source: "own_key".into(),
        cli_agent_type: None,
        model_editable: true,
    }
}

fn account(provider: ModelType, id: &str, models: &[&str]) -> KeyInfo {
    let mut key = ModelKey::new(provider);
    key.id = id.into();
    key.api_key = Some("fixture-key".into());
    key.available_models = models.iter().map(|model| model.to_string()).collect();
    key.enabled_models = key.available_models.clone();
    KeyInfo::from(key)
}

#[test]
fn empty_enabled_inventory_never_becomes_selectable() {
    let mut key = account(ModelType::AnthropicApi, "account", &["model-a"]);
    key.enabled_models.clear();
    let options = collect_model_options(
        &[key],
        MobileSessionExecution::NativeAgent,
        &state(None, None),
    );
    assert!(options.is_empty());
}

#[test]
fn disabled_and_unhealthy_accounts_are_not_selectable() {
    let mut disabled = account(ModelType::AnthropicApi, "disabled", &["model-a"]);
    disabled.enabled = false;
    let mut invalid = account(ModelType::AnthropicApi, "invalid", &["model-a"]);
    invalid.health_status = "invalid".into();
    assert!(collect_model_options(
        &[disabled, invalid],
        MobileSessionExecution::NativeAgent,
        &state(None, None),
    )
    .is_empty());
}

#[test]
fn cli_catalog_uses_registry_provider_compatibility_and_launch_capability() {
    let mut selection = state(None, None);
    selection.cli_agent_type = Some("codex".into());
    let mut native = account(ModelType::Codex, "native", &["gpt-5.5"]);
    native.can_launch_cli = false;
    let keys = [
        native,
        account(ModelType::OpenaiApi, "compatible", &["gpt-5.5"]),
        account(
            ModelType::AnthropicApi,
            "incompatible",
            &["claude-sonnet-4-5"],
        ),
    ];
    let options = collect_model_options(&keys, MobileSessionExecution::ManagedCli, &selection);
    assert_eq!(options.len(), 1);
    assert_eq!(options[0].account_id, "compatible");
}

#[test]
fn current_selection_is_retained_once_inside_wire_limit() {
    let models = (0..300)
        .map(|i| format!("custom-model-{i}"))
        .collect::<Vec<_>>();
    let model_refs = models.iter().map(String::as_str).collect::<Vec<_>>();
    let keys = [account(ModelType::AnthropicApi, "account", &model_refs)];
    for current_model in ["no-longer-listed", "custom-model-250"] {
        let options = collect_model_options(
            &keys,
            MobileSessionExecution::NativeAgent,
            &state(Some(current_model), Some("account")),
        );
        assert_eq!(options.len(), MAX_MOBILE_MODEL_OPTIONS);
        assert_eq!(options[0].id, current_model);
        assert_eq!(
            options
                .iter()
                .filter(|option| option.id == current_model)
                .count(),
            1
        );
    }
}

#[tokio::test]
async fn invalid_and_imported_patch_requests_do_not_reach_mutation() {
    let invalid = session_patch(&json!({"sessionId": "sde:fixture", "patch": {"model": " "}}))
        .await
        .unwrap_err();
    assert_eq!(invalid.code, RpcErrorCode::InvalidParams);
    // Imported history is read-only at the adapter before any application state
    // or persistence mutation is requested.
    let read_only =
        session_patch(&json!({"sessionId": "codexapp-fixture", "patch": {"model": "model-b"}}))
            .await
            .unwrap_err();
    assert_eq!(read_only.code, RpcErrorCode::InvalidRequest);
    assert!(read_only.message.contains("cannot be changed"));
}

#[test]
fn parse_session_id_rejects_empty() {
    assert_eq!(
        parse_session_id(&json!({"sessionId": " "}))
            .unwrap_err()
            .code,
        RpcErrorCode::InvalidParams
    );
}
