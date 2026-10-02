use std::sync::{mpsc, Arc, Barrier};

use super::*;
use crate::key_store::{HealthStatus, KeyService};

fn request(id: &str, extra: serde_json::Value) -> SaveKeyRequest {
    let mut value = serde_json::json!({"id": id, "agent_type": "custom_api"});
    value
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    serde_json::from_value(value).unwrap()
}

#[test]
fn concurrent_account_edits_keep_both_independent_fields() {
    let dir = tempfile::tempdir().unwrap();
    let service = Arc::new(KeyService::new(Some(dir.path().to_path_buf())));
    let mut key = ModelKey::new(ModelType::CustomApi);
    key.available_models = vec!["model-a".into()];
    key.enabled_models = vec!["model-a".into()];
    let key = service.save_key(key).unwrap();
    let ready = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let (started_tx, started_rx) = mpsc::channel();

    let writer_service = Arc::clone(&service);
    let writer_id = key.id.clone();
    let writer_ready = Arc::clone(&ready);
    let writer_release = Arc::clone(&release);
    let first = std::thread::spawn(move || {
        writer_service.edit_key(
            Some(&writer_id),
            ModelType::CustomApi,
            move |mut current| {
                writer_ready.wait();
                writer_release.wait();
                current.name = Some("renamed".into());
                Ok(current)
            },
        )
    });
    ready.wait(); // The first editor owns the same lock used by the RPC save.

    let second_service = Arc::clone(&service);
    let second_id = key.id.clone();
    let second = std::thread::spawn(move || {
        started_tx.send(()).unwrap();
        save_key_with_service(
            &second_service,
            request(&second_id, serde_json::json!({"enabled_models": []})),
        )
    });
    started_rx.recv().unwrap();
    release.wait();
    first.join().unwrap().unwrap();
    second.join().unwrap().unwrap();

    let reloaded = KeyService::new(Some(dir.path().to_path_buf()))
        .get_key_by_id(&key.id)
        .unwrap();
    assert_eq!(reloaded.name.as_deref(), Some("renamed"));
    assert!(reloaded.enabled_models.is_empty());
}

#[test]
fn ordinary_edit_keeps_current_discovery_and_health() {
    let dir = tempfile::tempdir().unwrap();
    let service = KeyService::new(Some(dir.path().to_path_buf()));
    let key = service
        .save_key(ModelKey::new(ModelType::CustomApi))
        .unwrap();
    let prepared = request(&key.id, serde_json::json!({"name": "renamed"}));
    service
        .update_key_health(
            &key.id,
            HealthStatus::Valid,
            None,
            Some(vec!["new-model".into()]),
            None,
            None,
            None,
        )
        .unwrap();

    save_key_with_service(&service, prepared).unwrap();
    let reloaded = KeyService::new(Some(dir.path().to_path_buf()))
        .get_key_by_id(&key.id)
        .unwrap();
    assert_eq!(reloaded.name.as_deref(), Some("renamed"));
    assert_eq!(reloaded.health_status, HealthStatus::Valid);
    assert!(reloaded.available_models.contains(&"new-model".into()));
}

#[test]
fn rejected_edit_leaves_file_unchanged_then_retry_succeeds() {
    let dir = tempfile::tempdir().unwrap();
    let service = KeyService::new(Some(dir.path().to_path_buf()));
    let key = service
        .save_key(ModelKey::new(ModelType::CustomApi))
        .unwrap();
    let file = dir.path().join("credentials.json");
    let before = std::fs::read(&file).unwrap();

    assert!(save_key_with_service(
        &service,
        request(&key.id, serde_json::json!({"protocol": "invalid"}))
    )
    .is_err());
    assert_eq!(std::fs::read(&file).unwrap(), before);

    save_key_with_service(
        &service,
        request(&key.id, serde_json::json!({"name": "retry"})),
    )
    .unwrap();
    assert_eq!(
        service.get_key_by_id(&key.id).unwrap().name.as_deref(),
        Some("retry")
    );
}
