use crate::server_defs::{servers, servers_for_language_id};

#[test]
fn supported_languages_resolve_to_server_defs() {
    for language in [
        "typescript",
        "javascript",
        "rust",
        "python",
        "go",
        "c",
        "cpp",
    ] {
        assert!(
            !servers_for_language_id(language).is_empty(),
            "expected at least one server for language `{}`",
            language
        );
    }
}

#[test]
fn unknown_language_has_no_servers() {
    assert!(servers_for_language_id("unknown_lang_xyz").is_empty());
}

#[test]
fn static_servers_cover_typescript_and_rust() {
    let language_ids: Vec<&'static str> = servers::STATIC_SERVERS
        .iter()
        .flat_map(|server_def| server_def.language_ids().iter().copied())
        .collect();

    assert!(language_ids.contains(&"typescript"));
    assert!(language_ids.contains(&"rust"));
}

#[tokio::test]
async fn pending_server_budget_rejects_excess_and_releases_on_drop() {
    use super::{LspManager, ServerKey, MAX_SERVER_OWNERS};
    let manager = LspManager::new();
    let keys: Vec<_> = (0..=MAX_SERVER_OWNERS)
        .map(|i| ServerKey::new(format!("/fixture/{i}"), "rust"))
        .collect();
    let mut pending = Vec::new();
    for key in keys.iter().take(MAX_SERVER_OWNERS) {
        let mut start = Box::pin(manager.start_with(key, std::future::pending()));
        assert!(futures::poll!(&mut start).is_pending());
        pending.push(start);
    }
    let error = manager
        .start_with(&keys[MAX_SERVER_OWNERS], std::future::pending())
        .await
        .err()
        .unwrap();
    assert!(error.contains("limit"));
    assert_eq!(manager.spawning.lock().len(), MAX_SERVER_OWNERS);
    drop(pending);
    assert!(manager.spawning.lock().is_empty());
    // Failed starts have a separate bounded TTL cache and shutdown clears it.
    for i in 0..100 {
        let _ = manager
            .start_with(&ServerKey::new(format!("/broken/{i}"), "rust"), async {
                Err("fixture failure".into())
            })
            .await;
    }
    assert!(manager.broken.lock().len() <= MAX_SERVER_OWNERS);
    manager.shutdown().await.unwrap();
    assert!(manager.broken.lock().is_empty());
}
