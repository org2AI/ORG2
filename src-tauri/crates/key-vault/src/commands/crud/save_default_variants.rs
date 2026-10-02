//! A default pick is a family-scoped intent, not a replacement of the
//! effective (user + provider + product fallback) defaults shown by the UI.
use super::{key_info_from_entry, KeyInfo, SaveKeyRequest};
use crate::key_store::{DefaultVariant, ModelType, KEY_SERVICE};

pub(super) fn save_default_variant_overrides(request: SaveKeyRequest) -> Result<KeyInfo, String> {
    // Keep this patch contract narrow. Silently ignoring another account edit
    // would look successful even though it never reached persistence.
    if request.name.is_some()
        || request.description.is_some()
        || request.api_key.is_some()
        || request.session_token.is_some()
        || request.base_url.is_some()
        || request.protocol.is_some()
        || request.env_vars.is_some()
        || request.account_metadata.is_some()
        || request.available_models.is_some()
        || request.enabled_models.is_some()
        || request.model_aliases.is_some()
        || request.model_variants.is_some()
        || request.default_variants.is_some()
        || request.quota_info.is_some()
        || request.has_local_key.is_some()
        || request.is_listed.is_some()
        || request.auth_method.is_some()
        || request.listing_id.is_some()
        || request.enabled.is_some()
    {
        return Err("Save default variant overrides separately from other account edits".into());
    }
    let id = request
        .id
        .ok_or("Default variant overrides require an existing account")?;
    let model_type = ModelType::from_str(&request.agent_type).ok_or("Unknown agent type")?;
    let overrides = request
        .default_variant_overrides
        .unwrap_or_default()
        .into_iter()
        .map(|variant| DefaultVariant {
            base_model: variant.base_model,
            model: variant.model,
        })
        .collect();
    KEY_SERVICE
        .update_default_variant_overrides(&id, &model_type, overrides)
        .and_then(key_info_from_entry)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mixed_delta_and_full_account_edits_are_rejected_before_persistence() {
        let request = serde_json::from_value(serde_json::json!({
            "id": "fixture", "agent_type": "custom_api", "name": "other edit",
            "default_variant_overrides": [{ "base_model": "model", "model": "model-high" }]
        }))
        .unwrap();
        assert!(save_default_variant_overrides(request).is_err());
    }
}
