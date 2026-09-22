//! Auxiliary model preferences are constrained by the resolved account route.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use key_vault::key_store::ModelKey;

use super::model_hints::wire_model_name;
use super::registry::{provider_id, ProviderSpec};

/// Bound both request fanout and the session-owned rejection bitmap.
pub const MAX_AUXILIARY_CANDIDATES: usize = 3;

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct AuxiliaryModel {
    /// Ordered low-cost models on this exact account route. Empty means skip.
    pub models: Vec<String>,
    /// Opaque account/endpoint/configuration fingerprint, never a credential.
    pub scope: u64,
}

#[derive(Debug, Clone)]
pub struct AuxiliaryModelPolicy {
    candidates: Vec<String>,
    scope: u64,
}

impl AuxiliaryModelPolicy {
    pub(super) fn from_account(
        spec: &'static ProviderSpec,
        account: &ModelKey,
        endpoint: Option<&str>,
        is_codex_oauth: bool,
        is_azure_proxy: bool,
    ) -> Self {
        let mut scope = DefaultHasher::new();
        (
            &account.id,
            spec.name,
            endpoint,
            format!(
                "{:?}/{:?}/{:?}",
                account.model_type, account.auth_method, account.protocol
            ),
            is_codex_oauth,
            is_azure_proxy,
            account.enabled,
            &account.available_models,
            &account.enabled_models,
        )
            .hash(&mut scope);

        // Catalog membership is permission to try, not proof of entitlement.
        // Use supported cheap models only; a rejection tries the next cheap
        // candidate and never upgrades to the expensive parent.
        let mut candidates = Vec::new();
        if account.enabled {
            for preferred in preferences(spec, is_codex_oauth) {
                let matches = |model: &String| auxiliary_model_id(spec, model) == *preferred;
                if !account.available_models.iter().any(matches) {
                    continue;
                }
                if let Some(model) = account.enabled_models.iter().find(|model| matches(model)) {
                    candidates.push(model.clone());
                    if candidates.len() == MAX_AUXILIARY_CANDIDATES {
                        break;
                    }
                }
            }
        }
        Self {
            candidates,
            scope: scope.finish(),
        }
    }

    pub fn resolve(&self, _parent_model: &str) -> AuxiliaryModel {
        AuxiliaryModel {
            models: self.candidates.clone(),
            scope: self.scope,
        }
    }
}

/// Preference tiers, not a live price comparison. Literal deployment/local IDs
/// without a recognized catalog model are intentionally not guessed.
fn preferences(spec: &ProviderSpec, codex_oauth: bool) -> &'static [&'static str] {
    match spec.name {
        provider_id::OPENAI if codex_oauth => &["gpt-5.6-luna", "gpt-5.6-terra"],
        provider_id::OPENAI => &["gpt-5.4-mini", "gpt-5.6-luna", "gpt-5.6-terra"],
        provider_id::ANTHROPIC | provider_id::BEDROCK => {
            &["claude-haiku-4-5", "claude-3-5-haiku-20241022"]
        }
        provider_id::GEMINI => &[
            "gemini-3.5-flash-lite",
            "gemini-3.1-flash-lite",
            "gemini-2.5-flash-lite",
            "gemini-3.1-flash",
            "gemini-2.5-flash",
        ],
        provider_id::DEEPSEEK => &["deepseek-chat"],
        provider_id::GROQ => &["gpt-oss-20b", "llama-3.1-8b-instant"],
        // Retired xAI Fast aliases redirect to higher-priced Grok 4.3.
        // No independently supported cheap tier is currently certified here.
        provider_id::XAI => &[],
        provider_id::ZHIPU => &[
            "glm-4.7-flash",
            "glm-4.5-flash",
            "glm-5.3-flash",
            "glm-4.7-flashx",
        ],
        provider_id::DASHSCOPE => &["qwen-flash", "qwen-turbo", "qwen3.5-flash"],
        provider_id::MINIMAX => &["minimax-m2.5", "minimax-m2.1", "minimax-m2"],
        provider_id::LONGCAT => &["longcat-flash-chat", "longcat-flash"],
        provider_id::MOONSHOT => &["kimi-k2-0905-preview", "kimi-k2.5", "kimi-k2"],
        provider_id::OPENROUTER
        | provider_id::ZENMUX
        | provider_id::OPENCODE
        | provider_id::AIHUBMIX
        | provider_id::CHERRYIN
        | provider_id::ATLASCLOUD
        | provider_id::SILICONFLOW
        | provider_id::MODELSCOPE
        | provider_id::AZURE_OPENAI
        | provider_id::VLLM
        | provider_id::CUSTOM => &[
            "gemini-3.5-flash-lite",
            "gemini-3.1-flash-lite",
            "gemini-2.5-flash-lite",
            "gpt-5.6-luna",
            "gpt-5.4-mini",
            "gpt-5.6-terra",
            "claude-haiku-4-5",
            "glm-4.7-flash",
            "glm-5.3-flash",
            "qwen-flash",
            "deepseek-chat",
            "deepseek-v3.2",
            "minimax-m2.5",
            "kimi-k2.5",
            "llama-3.1-8b-instant",
        ],
        _ => &[],
    }
}

/// Compare known model aliases while returning the original enabled wire ID.
fn auxiliary_model_id(spec: &ProviderSpec, model: &str) -> String {
    let wire = wire_model_name(spec, model);
    let wire = spec
        .litellm_prefix
        .and_then(|prefix| wire.strip_prefix(prefix))
        .unwrap_or(&wire);
    let mut id = wire.to_ascii_lowercase();
    // SiliconFlow also namespaces dedicated versions with Pro/.
    if spec.name == provider_id::SILICONFLOW {
        id = id.strip_prefix("pro/").unwrap_or(&id).to_owned();
    }
    // Aggregator vendor namespaces are part of the wire ID, not its tier.
    for prefix in [
        "openai/",
        "anthropic/",
        "google/",
        "deepseek/",
        "deepseek-ai/",
        "qwen/",
        "meta-llama/",
        "minimax/",
        "minimaxai/",
        "moonshotai/",
        "z-ai/",
        "zai-org/",
        "x-ai/",
    ] {
        if let Some(base) = id.strip_prefix(prefix) {
            id = base.to_owned();
            break;
        }
    }
    let id = super::thinking_mode::parse_model_variant(&id).base_model;
    if matches!(
        id.as_str(),
        "claude-haiku-4.5" | "claude-haiku-4-5" | "claude-haiku-4-5-20251001"
    ) {
        return "claude-haiku-4-5".to_owned();
    }
    if spec.name == provider_id::BEDROCK {
        let base = ["us.", "eu.", "apac.", "global."]
            .iter()
            .find_map(|prefix| id.strip_prefix(prefix))
            .unwrap_or(&id);
        if base == "anthropic.claude-haiku-4-5-20251001-v1:0" {
            return "claude-haiku-4-5".to_owned();
        }
    }
    id
}
