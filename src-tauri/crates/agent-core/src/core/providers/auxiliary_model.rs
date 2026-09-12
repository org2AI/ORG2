//! Auxiliary model preferences are constrained by the resolved account route.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use key_vault::key_store::ModelKey;

use super::model_hints::wire_model_name;
use super::registry::{guess_provider_by_model, provider_id, ProviderSpec};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuxiliaryModel {
    pub model: String,
    /// Opaque account/endpoint/configuration fingerprint, never a credential.
    pub scope: u64,
}

impl AuxiliaryModel {
    pub fn inherit(parent_model: &str) -> Self {
        Self {
            model: parent_model.to_owned(),
            scope: 0,
        }
    }
}

#[derive(Debug, Clone)]
pub struct AuxiliaryModelPolicy {
    spec: &'static ProviderSpec,
    candidate: Option<String>,
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

        // Codex's catalog is completed from static product defaults, including
        // models an individual ChatGPT account can reject. It is not access
        // evidence. Azure deployment names and custom IDs are literal, too.
        let preferred = if is_codex_oauth || is_azure_proxy || !account.enabled {
            None
        } else {
            match spec.name {
                provider_id::OPENAI => Some("gpt-5.4-mini"),
                provider_id::ANTHROPIC => Some("claude-haiku-4-5"),
                provider_id::GEMINI => Some("gemini-3.1-flash"),
                provider_id::DEEPSEEK => Some("deepseek-chat"),
                _ => None,
            }
        };
        let candidate = preferred.and_then(|preferred| {
            let matches = |model: &String| auxiliary_model_id(spec, model) == preferred;
            account
                .available_models
                .iter()
                .any(matches)
                .then(|| {
                    account
                        .enabled_models
                        .iter()
                        .find(|model| matches(model))
                        .cloned()
                })
                .flatten()
        });
        Self {
            spec,
            candidate,
            scope: scope.finish(),
        }
    }

    pub fn resolve(&self, parent_model: &str) -> AuxiliaryModel {
        let same_family =
            guess_provider_by_model(parent_model).is_some_and(|spec| spec.name == self.spec.name);
        let already_fast = self.candidate.as_ref().is_some_and(|candidate| {
            auxiliary_model_id(
                self.spec,
                &super::thinking_mode::parse_model_variant(&wire_model_name(
                    self.spec,
                    parent_model,
                ))
                .base_model,
            ) == auxiliary_model_id(self.spec, candidate)
        });
        AuxiliaryModel {
            model: if same_family && !already_fast {
                self.candidate.as_deref()
            } else {
                None
            }
            .unwrap_or(parent_model)
            .to_owned(),
            scope: self.scope,
        }
    }
}

/// Compare only known aliases; never manufacture a request ID or treat an
/// arbitrary dated/custom deployment as an entitled model. The selected value
/// remains the original ID in the account's enabled catalog.
fn auxiliary_model_id(spec: &ProviderSpec, model: &str) -> String {
    let wire = wire_model_name(spec, model);
    if spec.name == provider_id::ANTHROPIC
        && matches!(
            wire.as_str(),
            "claude-haiku-4.5" | "claude-haiku-4-5" | "claude-haiku-4-5-20251001"
        )
    {
        "claude-haiku-4-5".to_owned()
    } else {
        wire
    }
}
