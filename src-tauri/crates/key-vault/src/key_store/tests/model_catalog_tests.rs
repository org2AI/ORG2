use crate::commands::KeyInfo;
use crate::key_store::{
    AuthMethod, DefaultVariant, HealthStatus, KeyService, ModelAlias, ModelCatalogRefresh,
    ModelKey, ModelType, ModelVariant,
};
use std::collections::HashMap;

fn variant(model: &str, base: &str, context_window: Option<u64>) -> ModelVariant {
    ModelVariant {
        model: model.into(),
        base_model: base.into(),
        reasoning: Some("high".into()),
        fast: false,
        context_window,
    }
}
fn default(model: &str, base: &str) -> DefaultVariant {
    DefaultVariant {
        model: model.into(),
        base_model: base.into(),
    }
}
fn discovery(key: &ModelKey) -> ModelCatalogRefresh {
    ModelCatalogRefresh {
        expected_credential_generation: key.credential_generation,
        expected_catalog_generation: key.model_catalog_generation,
        available_models: vec!["model".into(), "new-family".into()],
        model_variants: Some(vec![
            variant("model-high", "model", Some(9000)),
            variant("new-family-high", "new-family", None),
        ]),
        default_variants: Some(vec![
            default("model-high", "model"),
            default("new-family-high", "new-family"),
        ]),
        model_context_lengths: HashMap::from([("model".into(), 9000)]),
    }
}

#[test]
fn refresh_commits_full_metadata_and_preserves_latest_user_choices_after_reload() {
    let dir = tempfile::tempdir().unwrap();
    let service = KeyService::new(Some(dir.path().to_path_buf()));
    let mut key = ModelKey::new(ModelType::CustomApi);
    key.api_key = Some("fixture-key".into());
    key.available_models = vec!["model".into(), "removed".into()];
    key.enabled_models = vec!["model".into()];
    key.model_variants = vec![variant("model-low", "model", Some(1000))];
    let snapshot = service.save_key(key).unwrap();
    // The request began before the user disabled the family, chose a default,
    // and added a manual request ID. Merge these values under the write lock.
    let mut latest = snapshot.clone();
    latest.enabled_models = vec![];
    latest.health_status = HealthStatus::Degraded;
    latest.default_variants = vec![default("model-manual", "model")];
    latest.model_aliases.push(ModelAlias {
        alias: "manual".into(),
        display_name: "Manual".into(),
        icon: None,
    });
    service.save_key(latest).unwrap();
    service
        .refresh_model_catalog(&snapshot.id, discovery(&snapshot))
        .unwrap();
    let reloaded = KeyService::new(Some(dir.path().to_path_buf()))
        .get_key_by_id(&snapshot.id)
        .unwrap();
    assert!(reloaded.enabled_models.is_empty());
    assert!(matches!(reloaded.health_status, HealthStatus::Degraded));
    assert!(reloaded.available_models.contains(&"manual".into()));
    assert!(!reloaded.available_models.contains(&"removed".into()));
    assert!(!reloaded
        .model_variants
        .iter()
        .any(|v| v.model == "model-low"));
    assert!(reloaded
        .model_variants
        .iter()
        .any(|v| v.model == "model-high" && v.context_window == Some(9000)));
    assert_eq!(reloaded.discovered_default_variants.len(), 2);
    let info = KeyInfo::from(reloaded);
    assert!(info.selectable_model_ids().is_empty());
    assert!(info
        .default_variants
        .iter()
        .any(|v| v.base_model == "model" && v.model == "model-manual"));
    assert!(info
        .default_variants
        .iter()
        .any(|v| v.base_model == "new-family" && v.model == "new-family-high"));
}

#[test]
fn refresh_rejects_late_catalog_and_replaced_credential_results() {
    let dir = tempfile::tempdir().unwrap();
    let service = KeyService::new(Some(dir.path().to_path_buf()));
    let key = service
        .save_key(ModelKey::new(ModelType::CustomApi))
        .unwrap();
    let first = discovery(&key);
    service
        .refresh_model_catalog(&key.id, first.clone())
        .unwrap();
    assert!(service.refresh_model_catalog(&key.id, first).is_err());
    let snapshot = service.get_key_by_id(&key.id).unwrap();
    let mut replaced = snapshot.clone();
    replaced.api_key = Some("new-fixture-key".into());
    service.save_key(replaced).unwrap();
    assert!(service
        .refresh_model_catalog(&key.id, discovery(&snapshot))
        .is_err());
    let stored = service.get_key_by_id(&key.id).unwrap();
    assert_eq!(stored.model_catalog_generation, 1);
    assert_eq!(stored.api_key.as_deref(), Some("new-fixture-key"));
}

#[test]
fn empty_discovery_leaves_stored_catalog_unchanged_and_retry_succeeds() {
    let dir = tempfile::tempdir().unwrap();
    let service = KeyService::new(Some(dir.path().to_path_buf()));
    let key = service
        .save_key(ModelKey::new(ModelType::CustomApi))
        .unwrap();
    let before = std::fs::read(service.get_storage_file()).unwrap();
    let mut empty = discovery(&key);
    empty.available_models.clear();
    assert!(service.refresh_model_catalog(&key.id, empty).is_err());
    assert_eq!(before, std::fs::read(service.get_storage_file()).unwrap());
    service
        .refresh_model_catalog(&key.id, discovery(&key))
        .unwrap();
    assert_eq!(
        service
            .get_key_by_id(&key.id)
            .unwrap()
            .model_catalog_generation,
        1
    );
}

#[test]
fn selectable_catalog_inherits_metadata_base_but_never_enables_empty_accounts() {
    let mut key = ModelKey::new(ModelType::CustomApi);
    key.available_models = vec!["base".into(), "manual".into()];
    // An opaque ID proves this uses metadata, not suffix parsing.
    key.model_variants = vec![variant("opaque-variant", "base", None)];
    assert!(KeyInfo::from(key.clone()).selectable_model_ids().is_empty());
    key.enabled_models = vec!["base".into(), "manual".into()];
    assert_eq!(
        KeyInfo::from(key.clone()).selectable_model_ids(),
        vec!["base", "manual", "opaque-variant"]
    );
    key.enabled = false;
    assert!(KeyInfo::from(key).selectable_model_ids().is_empty());
}

#[test]
fn codex_product_completion_and_cursor_projection_do_not_enable_disabled_models() {
    let mut key = ModelKey::new(ModelType::Codex);
    key.auth_method = AuthMethod::Oauth;
    key.session_token = Some("fixture-token".into());
    key.normalize_model_catalog();
    assert!(!key.available_models.is_empty());
    assert!(KeyInfo::from(key).selectable_model_ids().is_empty());
    let mut cursor = ModelKey::new(ModelType::CursorCli);
    cursor.session_token = Some("fixture-token".into());
    let info = crate::commands::key_info_from_entry(cursor).unwrap();
    assert!(info.available_models.contains(&"composer-2".into()));
    assert!(info.enabled_models.is_empty());
    assert!(info.selectable_model_ids().is_empty());
}

#[test]
fn live_variant_context_survives_without_parallel_context_map_and_provider_default_refreshes() {
    let dir = tempfile::tempdir().unwrap();
    let service = KeyService::new(Some(dir.path().to_path_buf()));
    let mut key = ModelKey::new(ModelType::CustomApi);
    key.discovered_default_variants = vec![default("model-old", "model")];
    let key = service.save_key(key).unwrap();
    let mut refresh = discovery(&key);
    refresh.model_context_lengths.clear();
    refresh
        .model_variants
        .as_mut()
        .unwrap()
        .push(variant("model", "model", Some(12345)));
    let stored = service.refresh_model_catalog(&key.id, refresh).unwrap();
    assert!(stored
        .model_variants
        .iter()
        .any(|v| v.model == "model" && v.context_window == Some(12345)));
    assert_eq!(
        KeyInfo::from(stored.clone()).default_variants[0].model,
        "model-high"
    );
    assert_eq!(
        crate::commands::FullKeyResponse::from(stored).default_variants[0].model,
        "model-high"
    );
}

#[test]
fn catalog_writers_invalidate_old_refresh_but_preference_edits_do_not() {
    let dir = tempfile::tempdir().unwrap();
    let service = KeyService::new(Some(dir.path().to_path_buf()));
    let snapshot = service
        .save_key(ModelKey::new(ModelType::CustomApi))
        .unwrap();
    service
        .update_key_health(
            &snapshot.id,
            HealthStatus::Valid,
            None,
            Some(vec!["validated".into()]),
            None,
            None,
            None,
        )
        .unwrap();
    assert!(service
        .refresh_model_catalog(&snapshot.id, discovery(&snapshot))
        .is_err());
    let snapshot = service.get_key_by_id(&snapshot.id).unwrap();
    let mut edited = snapshot.clone();
    edited.available_models.push("user-configured-model".into());
    service.save_key(edited).unwrap();
    assert!(service
        .refresh_model_catalog(&snapshot.id, discovery(&snapshot))
        .is_err());
    let snapshot = service.get_key_by_id(&snapshot.id).unwrap();
    let mut edited = snapshot.clone();
    edited.enabled_models.clear();
    edited.default_variants.push(default("model-user", "model"));
    service.save_key(edited).unwrap();
    assert!(service
        .refresh_model_catalog(&snapshot.id, discovery(&snapshot))
        .is_ok());
}

#[test]
fn stale_account_edit_cannot_erase_a_completed_discovery() {
    let dir = tempfile::tempdir().unwrap();
    let service = KeyService::new(Some(dir.path().to_path_buf()));
    let snapshot = service
        .save_key(ModelKey::new(ModelType::CustomApi))
        .unwrap();
    service
        .refresh_model_catalog(&snapshot.id, discovery(&snapshot))
        .unwrap();
    let mut stale = snapshot.clone();
    stale.name = Some("rename from stale snapshot".into());
    assert!(service.save_key(stale).is_err());
    assert!(service
        .get_key_by_id(&snapshot.id)
        .unwrap()
        .available_models
        .contains(&"model".into()));
}

#[test]
fn family_delta_keeps_other_provider_defaults_discovered_across_refresh() {
    let dir = tempfile::tempdir().unwrap();
    let service = KeyService::new(Some(dir.path().to_path_buf()));
    let key = service
        .save_key(ModelKey::new(ModelType::CustomApi))
        .unwrap();
    let key = service
        .refresh_model_catalog(&key.id, discovery(&key))
        .unwrap();
    let saved = service
        .update_default_variant_overrides(
            &key.id,
            &ModelType::CustomApi,
            vec![default("model", "model")],
        )
        .unwrap();
    assert_eq!(saved.default_variants, vec![default("model", "model")]);
    let mut refreshed = discovery(&saved);
    refreshed.default_variants = Some(vec![
        default("model-high", "model"),
        default("new-family", "new-family"),
    ]);
    let saved = service.refresh_model_catalog(&key.id, refreshed).unwrap();
    let reloaded = KeyService::new(Some(dir.path().to_path_buf()))
        .get_key_by_id(&key.id)
        .unwrap();
    assert_eq!(reloaded.default_variants, vec![default("model", "model")]);
    let info = KeyInfo::from(saved);
    assert!(info
        .default_variants
        .iter()
        .any(|v| v.base_model == "model" && v.model == "model"));
    assert!(info
        .default_variants
        .iter()
        .any(|v| v.base_model == "new-family" && v.model == "new-family"));
}

#[test]
fn concurrent_family_deltas_merge_at_persistence_boundary() {
    let dir = tempfile::tempdir().unwrap();
    let service = std::sync::Arc::new(KeyService::new(Some(dir.path().to_path_buf())));
    let key = service
        .save_key(ModelKey::new(ModelType::CustomApi))
        .unwrap();
    let key = service
        .refresh_model_catalog(&key.id, discovery(&key))
        .unwrap();
    let mut threads = Vec::new();
    for family in ["model", "new-family"] {
        let service = service.clone();
        let id = key.id.clone();
        threads.push(std::thread::spawn(move || {
            service
                .update_default_variant_overrides(
                    &id,
                    &ModelType::CustomApi,
                    vec![default(family, family)],
                )
                .unwrap()
        }));
    }
    for thread in threads {
        thread.join().unwrap();
    }
    let stored = service.get_key_by_id(&key.id).unwrap();
    assert_eq!(stored.default_variants.len(), 2);
    assert!(stored.default_variants.contains(&default("model", "model")));
    assert!(stored
        .default_variants
        .contains(&default("new-family", "new-family")));
}

#[test]
fn changed_provider_route_clears_discovered_defaults_but_preserves_explicit_choices() {
    let dir = tempfile::tempdir().unwrap();
    let service = KeyService::new(Some(dir.path().to_path_buf()));
    let key = service
        .save_key(ModelKey::new(ModelType::CustomApi))
        .unwrap();
    let key = service
        .refresh_model_catalog(&key.id, discovery(&key))
        .unwrap();
    let mut key = service
        .update_default_variant_overrides(
            &key.id,
            &ModelType::CustomApi,
            vec![default("model", "model")],
        )
        .unwrap();
    key.base_url = Some("https://new-route.example/v1".into());
    let saved = service.save_key(key).unwrap();
    let reloaded = service.get_key_by_id(&saved.id).unwrap();
    assert!(reloaded.discovered_default_variants.is_empty());
    assert_eq!(reloaded.default_variants, vec![default("model", "model")]);
    assert!(!KeyInfo::from(reloaded)
        .default_variants
        .iter()
        .any(|v| v.base_model == "new-family"));
}

#[test]
fn invalid_family_delta_does_not_mutate_saved_preferences() {
    let dir = tempfile::tempdir().unwrap();
    let service = KeyService::new(Some(dir.path().to_path_buf()));
    let key = service
        .save_key(ModelKey::new(ModelType::CustomApi))
        .unwrap();
    let key = service
        .refresh_model_catalog(&key.id, discovery(&key))
        .unwrap();
    assert!(service
        .update_default_variant_overrides(
            &key.id,
            &ModelType::CustomApi,
            vec![default("", "model")]
        )
        .is_err());
    assert!(service
        .get_key_by_id(&key.id)
        .unwrap()
        .default_variants
        .is_empty());
    assert!(service
        .update_default_variant_overrides(
            &key.id,
            &ModelType::Codex,
            vec![default("model", "model")]
        )
        .is_err());
}
