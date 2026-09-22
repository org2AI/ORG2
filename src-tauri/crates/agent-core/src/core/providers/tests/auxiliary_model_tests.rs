use crate::providers::auxiliary_model::AuxiliaryModelPolicy;
use crate::providers::registry::{find_by_name, provider_id};
use key_vault::key_store::{ModelKey, ModelType};
use key_vault::AuthMethod;

fn account(model_type: ModelType, model: &str) -> ModelKey {
    let mut account = ModelKey::new(model_type);
    account.available_models = vec![model.to_owned()];
    account.enabled_models = account.available_models.clone();
    account
}

#[test]
fn auxiliary_model_respects_account_access_and_enabled_models() {
    for (family, model_type, parent, fast) in [
        (
            provider_id::OPENAI,
            ModelType::OpenaiApi,
            "gpt-5.6-luna-medium",
            "gpt-5.4-mini",
        ),
        (
            provider_id::ANTHROPIC,
            ModelType::AnthropicApi,
            "claude-sonnet-4.5",
            "claude-haiku-4-5-20251001",
        ),
        (
            provider_id::GEMINI,
            ModelType::GeminiApi,
            "gemini-3.1-pro",
            "gemini-3.1-flash",
        ),
        (
            provider_id::DEEPSEEK,
            ModelType::DeepseekApi,
            "deepseek-reasoner",
            "deepseek-chat",
        ),
    ] {
        let spec = find_by_name(family).unwrap();
        let mut key = account(model_type, fast);
        let resolve = |key: &ModelKey| {
            AuxiliaryModelPolicy::from_account(spec, key, spec.default_api_base, false, false)
                .resolve(parent)
        };
        assert_eq!(resolve(&key).models, vec![fast], "{family}");
        key.enabled_models.clear();
        assert_eq!(
            resolve(&key).models,
            Vec::<String>::new(),
            "disabled {family}"
        );
        key.enabled_models.push(fast.into());
        key.available_models.clear();
        assert_eq!(
            resolve(&key).models,
            Vec::<String>::new(),
            "unknown access {family}"
        );
    }
}

#[test]
fn auxiliary_model_anthropic_aliases_keep_the_enabled_catalog_id() {
    let spec = find_by_name(provider_id::ANTHROPIC).unwrap();
    let parent = "claude-sonnet-4-5-20250929";
    let aliases = [
        "claude-haiku-4.5",
        "claude-haiku-4-5",
        "claude-haiku-4-5-20251001",
        "anthropic/claude-haiku-4-5-20251001",
        "haiku-4-5",
    ];
    for available in aliases {
        for enabled in aliases {
            let mut key = account(ModelType::AnthropicApi, available);
            key.enabled_models = vec![enabled.into()];
            let policy = AuxiliaryModelPolicy::from_account(spec, &key, None, false, false);
            assert_eq!(
                policy.resolve(parent).models,
                vec![enabled],
                "{available} / {enabled}"
            );
            assert_eq!(policy.resolve("claude-opus-4-8-high").models, vec![enabled]);
        }
    }
    for unknown in [
        "claude-haiku-4-5-20990101",
        "claude-haiku-4-50",
        "claude-haiku-4-5-custom",
    ] {
        for (available, enabled) in [(unknown, aliases[0]), (aliases[0], unknown)] {
            let mut key = account(ModelType::AnthropicApi, available);
            key.enabled_models = vec![enabled.into()];
            let policy = AuxiliaryModelPolicy::from_account(spec, &key, None, false, false);
            assert_eq!(
                policy.resolve(parent).models,
                Vec::<String>::new(),
                "{available} / {enabled}"
            );
        }
    }
}

#[test]
fn auxiliary_model_codex_oauth_does_not_trust_completed_catalog() {
    let mut key = account(ModelType::Codex, "gpt-5.4-mini");
    key.auth_method = AuthMethod::Oauth;
    key.available_models = vec!["gpt-5.6-luna".into()];
    key.session_token = Some("fixture-oauth-token".into());
    let dir = tempfile::tempdir().unwrap();
    let service = key_vault::key_store::KeyService::new(Some(dir.path().into()));
    let mut key = service.save_key(key).unwrap();
    assert!(key
        .available_models
        .iter()
        .any(|model| model == "gpt-5.4-mini"));
    let mini_only = AuxiliaryModelPolicy::from_account(
        find_by_name(provider_id::OPENAI).unwrap(),
        &key,
        None,
        true,
        false,
    );
    assert!(mini_only.resolve("gpt-6-astra-high").models.is_empty());
    // Static catalog completion must not turn disabled cheap models on.
    key.enabled_models
        .extend(["gpt-5.6-terra".into(), "gpt-5.6-luna".into()]);
    let policy = AuxiliaryModelPolicy::from_account(
        find_by_name(provider_id::OPENAI).unwrap(),
        &key,
        None,
        true,
        false,
    );
    assert_eq!(
        policy.resolve("gpt-6-astra-high").models,
        vec!["gpt-5.6-luna", "gpt-5.6-terra"]
    );
    // Both auth modes use an OpenAI family name; only API access can select mini.
    key.auth_method = AuthMethod::ApiKey;
    let api = AuxiliaryModelPolicy::from_account(
        find_by_name(provider_id::OPENAI).unwrap(),
        &key,
        None,
        false,
        false,
    );
    assert_eq!(
        api.resolve("gpt-6-astra-high").models,
        vec!["gpt-5.4-mini", "gpt-5.6-luna", "gpt-5.6-terra"]
    );
    assert_ne!(
        api.resolve("gpt-5.5").scope,
        policy.resolve("gpt-5.5").scope
    );
}

#[test]
fn auxiliary_model_preserves_literal_custom_and_azure_ids() {
    let key = account(ModelType::CustomApi, "gpt-5.4-mini");
    for (family, azure) in [
        (provider_id::CUSTOM, false),
        (provider_id::OPENAI, true),
        (provider_id::AZURE_OPENAI, false),
    ] {
        let policy = AuxiliaryModelPolicy::from_account(
            find_by_name(family).unwrap(),
            &key,
            Some("https://proxy.invalid/v1"),
            false,
            azure,
        );
        assert_eq!(
            policy.resolve("gpt-deployment-high").models,
            vec!["gpt-5.4-mini"]
        );
    }
}

#[test]
fn auxiliary_model_never_guesses_unknown_deployment_ids() {
    for family in [
        provider_id::CUSTOM,
        provider_id::AZURE_OPENAI,
        provider_id::VLLM,
    ] {
        let key = account(ModelType::CustomApi, "cheap-deployment");
        let policy = AuxiliaryModelPolicy::from_account(
            find_by_name(family).unwrap(),
            &key,
            None,
            false,
            false,
        );
        assert!(policy.resolve("expensive-deployment").models.is_empty());
    }
}

#[test]
fn auxiliary_model_aggregators_keep_namespaces_and_bound_candidates() {
    for family in [
        provider_id::OPENROUTER,
        provider_id::ZENMUX,
        provider_id::CUSTOM,
    ] {
        let mut key = account(ModelType::CustomApi, "anthropic/claude-haiku-4-5-20251001");
        key.available_models.extend(
            [
                "openai/gpt-5.6-terra",
                "openai/gpt-5.6-luna",
                "google/gemini-2.5-flash-lite",
                "openai/gpt-5.4-mini",
            ]
            .map(str::to_owned),
        );
        key.enabled_models = key.available_models.clone();
        let policy = AuxiliaryModelPolicy::from_account(
            find_by_name(family).unwrap(),
            &key,
            None,
            false,
            false,
        );
        assert_eq!(
            policy.resolve("claude-opus-4-8").models,
            vec![
                "google/gemini-2.5-flash-lite",
                "openai/gpt-5.6-luna",
                "openai/gpt-5.4-mini"
            ]
        );
    }
}

#[test]
fn auxiliary_model_supports_provider_specific_cheap_tiers() {
    for (family, model) in [
        (provider_id::GROQ, "openai/gpt-oss-20b"),
        (provider_id::ZHIPU, "glm-4.7-flash"),
        (provider_id::DASHSCOPE, "qwen-flash"),
        (provider_id::MINIMAX, "MiniMax-M2.5"),
        (provider_id::LONGCAT, "LongCat-Flash-Chat"),
        (provider_id::MOONSHOT, "kimi-k2.5"),
        (
            provider_id::BEDROCK,
            "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        ),
    ] {
        let mut key = account(ModelType::CustomApi, model);
        let spec = find_by_name(family).unwrap();
        assert_eq!(
            AuxiliaryModelPolicy::from_account(spec, &key, None, false, false)
                .resolve("expensive-parent")
                .models,
            vec![model],
            "{family}"
        );
        key.enabled = false;
        assert!(
            AuxiliaryModelPolicy::from_account(spec, &key, None, false, false)
                .resolve("expensive-parent")
                .models
                .is_empty()
        );
    }
}

#[test]
fn auxiliary_model_scope_changes_with_account_endpoint_and_catalog() {
    let mut key = account(ModelType::OpenaiApi, "gpt-5.4-mini");
    let spec = find_by_name(provider_id::OPENAI).unwrap();
    let resolve = |key: &ModelKey, url| {
        AuxiliaryModelPolicy::from_account(spec, key, Some(url), false, false).resolve("gpt-5.5")
    };
    let original = resolve(&key, "https://one.invalid");
    assert_eq!(original, resolve(&key, "https://one.invalid"));
    assert_ne!(original.scope, resolve(&key, "https://two.invalid").scope);
    key.id.push_str("-other-account");
    assert_ne!(original.scope, resolve(&key, "https://one.invalid").scope);
    let other = resolve(&key, "https://one.invalid");
    key.enabled_models.clear();
    assert_ne!(other.scope, resolve(&key, "https://one.invalid").scope);
}

#[test]
fn auxiliary_model_never_uses_retired_xai_fast_redirects() {
    let key = account(ModelType::CustomApi, "grok-4-1-fast-non-reasoning");
    let policy = AuxiliaryModelPolicy::from_account(
        find_by_name(provider_id::XAI).unwrap(),
        &key,
        None,
        false,
        false,
    );
    assert!(policy.resolve("grok-4.6").models.is_empty());
}

#[test]
fn auxiliary_model_aggregator_native_vendor_ids_keep_the_original_wire_name() {
    for (family, model) in [
        (provider_id::SILICONFLOW, "deepseek-ai/DeepSeek-V3.2"),
        (provider_id::SILICONFLOW, "Pro/deepseek-ai/DeepSeek-V3.2"),
        (provider_id::SILICONFLOW, "MiniMaxAI/MiniMax-M2.5"),
        (provider_id::MODELSCOPE, "deepseek-ai/DeepSeek-V3.2"),
        (provider_id::ATLASCLOUD, "zai-org/GLM-4.7-Flash"),
    ] {
        let key = account(ModelType::CustomApi, model);
        let policy = AuxiliaryModelPolicy::from_account(
            find_by_name(family).unwrap(),
            &key,
            None,
            false,
            false,
        );
        assert_eq!(
            policy.resolve("expensive-parent").models,
            vec![model],
            "{family}"
        );
    }
}
