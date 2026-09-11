use crate::key_store::{HealthStatus, KeyService, ModelAlias, ModelKey, ModelType};
use tempfile::tempdir;

fn custom_key() -> ModelKey {
    let mut key = ModelKey::new(ModelType::CustomApi);
    key.api_key = Some("fixture-key".into());
    key.base_url = Some("https://example.invalid/v1".into());
    key.model_aliases = ["new-provider/model-2026-09-01", "deployment-high"]
        .into_iter()
        .map(|id| ModelAlias {
            alias: id.into(),
            display_name: format!("Label for {id}"),
            icon: None,
        })
        .collect();
    key.enabled_models = vec![key.model_aliases[0].alias.clone()];
    key
}

#[test]
fn manual_models_survive_save_refresh_empty_discovery_and_reload() {
    let dir = tempdir().unwrap();
    let service = KeyService::new(Some(dir.path().into()));
    let saved = service.save_key(custom_key()).unwrap();
    assert_eq!(saved.available_models.len(), 2);
    for discovered in [
        vec!["detected".into(), saved.model_aliases[0].alias.clone()],
        vec![],
    ] {
        let updated = service
            .update_key_health(
                &saved.id,
                HealthStatus::Valid,
                None,
                Some(discovered),
                None,
                None,
                None,
            )
            .unwrap()
            .unwrap();
        for alias in &saved.model_aliases {
            assert_eq!(
                updated
                    .available_models
                    .iter()
                    .filter(|m| *m == &alias.alias)
                    .count(),
                1
            );
        }
        assert_eq!(updated.enabled_models, saved.enabled_models);
    }
    let reloaded = KeyService::new(Some(dir.path().into()))
        .get_key_by_id(&saved.id)
        .unwrap();
    assert_eq!(
        reloaded.model_aliases[0].display_name,
        saved.model_aliases[0].display_name
    );
    assert_eq!(reloaded.available_models.len(), 2);
    assert_eq!(reloaded.enabled_models, saved.enabled_models);
}

#[test]
fn manual_models_keep_explicit_disabled_choices_during_default_refresh() {
    let dir = tempdir().unwrap();
    let service = KeyService::new(Some(dir.path().into()));
    let saved = service.save_key(custom_key()).unwrap();
    let updated = service
        .update_key_health(
            &saved.id,
            HealthStatus::Valid,
            None,
            Some(vec!["detected".into()]),
            Some(vec!["detected".into(), "deployment-high".into()]),
            None,
            None,
        )
        .unwrap()
        .unwrap();
    assert_eq!(
        updated.enabled_models,
        vec!["detected", "new-provider/model-2026-09-01"]
    );
    let mut disabled = updated;
    disabled.enabled_models.clear();
    let disabled = service.save_key(disabled).unwrap();
    assert!(disabled.enabled_models.is_empty());
    assert!(!disabled.available_models.is_empty());
}

#[test]
fn manual_models_reject_invalid_writes_atomically() {
    let dir = tempdir().unwrap();
    let service = KeyService::new(Some(dir.path().into()));
    let saved = service.save_key(custom_key()).unwrap();
    let before = std::fs::read(dir.path().join("credentials.json")).unwrap();
    for id in [
        "".to_string(),
        "bad id".into(),
        "bad\nmodel".into(),
        "x".repeat(257),
    ] {
        let mut invalid = saved.clone();
        invalid.model_aliases[0].alias = id;
        assert!(service.save_key(invalid).is_err());
        assert_eq!(
            std::fs::read(dir.path().join("credentials.json")).unwrap(),
            before
        );
    }
    let mut duplicate = saved.clone();
    duplicate
        .model_aliases
        .push(duplicate.model_aliases[0].clone());
    assert!(service.save_key(duplicate).is_err());
    let mut invalid_label = saved;
    invalid_label.model_aliases[0].display_name = "label\nsecond line".into();
    assert!(service.save_key(invalid_label).is_err());
    assert_eq!(
        std::fs::read(dir.path().join("credentials.json")).unwrap(),
        before
    );
}

#[test]
fn manual_models_removed_by_explicit_save_do_not_reappear_on_refresh() {
    let dir = tempdir().unwrap();
    let service = KeyService::new(Some(dir.path().into()));
    let mut saved = service.save_key(custom_key()).unwrap();
    saved.model_aliases.clear();
    saved.available_models.clear();
    saved.enabled_models.clear();
    let saved = service.save_key(saved).unwrap();
    let updated = service
        .update_key_health(
            &saved.id,
            HealthStatus::Valid,
            None,
            Some(vec![]),
            None,
            None,
            None,
        )
        .unwrap()
        .unwrap();
    assert!(updated.available_models.is_empty());
    assert!(updated.model_aliases.is_empty());
}

#[test]
fn partial_saves_carry_legacy_aliases_without_revalidating_them() {
    let dir = tempdir().unwrap();
    let service = KeyService::new(Some(dir.path().into()));
    // A record written before alias validation existed: inner whitespace and
    // a duplicated id. Persist it through the raw store so no validator runs.
    let mut legacy = custom_key();
    legacy.model_aliases[0].alias = "legacy model".into();
    legacy
        .model_aliases
        .push(legacy.model_aliases[0].clone());
    service
        .update_store(|store| {
            store.set(legacy.clone());
        })
        .unwrap();
    let stored = service.get_key_by_id(&legacy.id).unwrap();
    assert_eq!(stored.model_aliases.len(), 3);

    // Renaming the account carries the stored aliases along unchanged.
    let mut renamed = stored.clone();
    renamed.name = Some("Renamed".into());
    let renamed = service.save_key(renamed).unwrap();
    assert_eq!(renamed.name.as_deref(), Some("Renamed"));
    assert_eq!(renamed.model_aliases.len(), 3);

    // Writing a *new* invalid alias, or adding another copy of an id beyond
    // what was stored, is still rejected.
    let mut invalid = renamed.clone();
    invalid.model_aliases.push(ModelAlias {
        alias: "another bad id".into(),
        display_name: String::new(),
        icon: None,
    });
    assert!(service.save_key(invalid).is_err());
    let mut extra_duplicate = renamed.clone();
    extra_duplicate
        .model_aliases
        .push(renamed.model_aliases[0].clone());
    assert!(service.save_key(extra_duplicate).is_err());
    let mut new_duplicate = renamed;
    new_duplicate.model_aliases.push(ModelAlias {
        alias: "deployment-high".into(),
        display_name: "Second label".into(),
        icon: None,
    });
    assert!(service.save_key(new_duplicate).is_err());
}

#[test]
fn legacy_placeholder_rows_are_repaired_on_load() {
    let dir = tempdir().unwrap();
    let service = KeyService::new(Some(dir.path().into()));
    let mut legacy = custom_key();
    legacy.model_aliases.push(ModelAlias {
        alias: "new-1a2b3c4d".into(),
        display_name: String::new(),
        icon: None,
    });
    // A labelled or non-hex `new-` id is a real model and must survive.
    legacy.model_aliases.push(ModelAlias {
        alias: "new-provider".into(),
        display_name: String::new(),
        icon: None,
    });
    legacy.available_models = vec![
        "new-1a2b3c4d".into(),
        "new-provider".into(),
        "deployment-high".into(),
    ];
    legacy.enabled_models = vec!["new-1a2b3c4d".into(), "deployment-high".into()];
    service
        .update_store(|store| {
            store.set(legacy.clone());
        })
        .unwrap();

    let reloaded = KeyService::new(Some(dir.path().into()))
        .get_key_by_id(&legacy.id)
        .unwrap();
    assert!(reloaded
        .model_aliases
        .iter()
        .all(|alias| alias.alias != "new-1a2b3c4d"));
    assert!(reloaded
        .model_aliases
        .iter()
        .any(|alias| alias.alias == "new-provider"));
    assert_eq!(
        reloaded.available_models,
        vec!["new-provider", "deployment-high"]
    );
    assert_eq!(reloaded.enabled_models, vec!["deployment-high"]);
}
