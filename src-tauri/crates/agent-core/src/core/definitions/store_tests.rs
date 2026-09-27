use super::*;
use std::sync::{mpsc, Arc};
use std::time::Duration;

fn custom(id: &str) -> AgentDefinition {
    AgentDefinition {
        id: id.into(),
        name: id.into(),
        ..Default::default()
    }
}

fn isolated_store(root: &Path) -> AgentDefinitionsStore {
    AgentDefinitionsStore::from_paths(root.join("agents.json"), root.join("overrides.json"))
}

/// A directory in place of the destination causes atomic installation to fail
/// portably, including when tests run as root. The old file is kept for readback.
fn block_destination(path: &Path) -> PathBuf {
    let saved = path.with_extension("saved");
    std::fs::rename(path, &saved).unwrap();
    std::fs::create_dir(path).unwrap();
    saved
}

fn restore_destination(path: &Path, saved: &Path) {
    std::fs::remove_dir(path).unwrap();
    std::fs::rename(saved, path).unwrap();
}

#[test]
fn failed_custom_mutations_preserve_committed_state_and_retry() {
    let _sandbox = test_helpers::test_env::sandbox();
    let root = tempfile::tempdir().unwrap();
    let store = isolated_store(root.path());
    store.insert(custom("first")).unwrap();
    store.insert(custom("unrelated")).unwrap();
    let before = serde_json::to_value(store.snapshot()).unwrap();
    let original_bytes = std::fs::read(&store.storage_path).unwrap();
    let saved = block_destination(&store.storage_path);

    assert!(store
        .update("first", |agent| agent.name = "changed".into())
        .is_err());
    assert!(store.insert(custom("new")).is_err());
    assert!(store
        .upsert(AgentDefinition {
            name: "replacement".into(),
            ..custom("first")
        })
        .is_err());
    assert!(store.remove("first").is_err());
    assert_eq!(serde_json::to_value(store.snapshot()).unwrap(), before);
    assert_eq!(std::fs::read(&saved).unwrap(), original_bytes);
    assert!(std::fs::read_dir(root.path()).unwrap().all(|entry| !entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .ends_with(".tmp")));

    restore_destination(&store.storage_path, &saved);
    store
        .update("first", |agent| agent.name = "retry succeeded".into())
        .unwrap();
    let reloaded = isolated_store(root.path());
    assert_eq!(reloaded.get("first").unwrap().name, "retry succeeded");
    assert_eq!(reloaded.get("unrelated").unwrap().name, "unrelated");
}

#[test]
fn failed_overlay_update_and_reset_preserve_committed_memory() {
    let root = tempfile::tempdir().unwrap();
    let store = isolated_store(root.path());
    let id = super::super::OS_AGENT_ID;
    store
        .update_with_overlay(id, |agent| agent.name = "Configured OS".into())
        .unwrap();
    let before = serde_json::to_value(store.get(id).unwrap()).unwrap();
    let saved = block_destination(&store.overrides_path);
    assert!(store
        .update_with_overlay(id, |agent| agent.name = "unsaved".into())
        .is_err());
    assert!(store.reset_builtin(id).is_err());
    assert_eq!(
        serde_json::to_value(store.get(id).unwrap()).unwrap(),
        before
    );
    restore_destination(&store.overrides_path, &saved);
    assert_eq!(
        serde_json::to_value(isolated_store(root.path()).get(id).unwrap()).unwrap(),
        before
    );
    store.reset_builtin(id).unwrap();
    assert_eq!(store.get(id).unwrap().name, "OS Agent");
    assert_eq!(
        isolated_store(root.path()).get(id).unwrap().name,
        "OS Agent"
    );
}

#[test]
fn concurrent_updates_commit_in_order_without_publishing_pending_candidates() {
    let root = tempfile::tempdir().unwrap();
    let store = Arc::new(isolated_store(root.path()));
    store.insert(custom("counter")).unwrap();
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let first_store = store.clone();
    let first = std::thread::spawn(move || {
        first_store.update("counter", |agent| {
            agent.name = "first".into();
            entered_tx.send(()).unwrap();
            release_rx.recv().unwrap();
        })
    });
    entered_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    // Reads keep the previous committed state while a mutation is pending.
    // A timeout also makes a regression to holding the read lock fail instead
    // of leaving the entire test process deadlocked.
    let reader_store = store.clone();
    let (read_tx, read_rx) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        read_tx
            .send(reader_store.get("counter").unwrap().name)
            .unwrap();
    });
    assert_eq!(
        read_rx.recv_timeout(Duration::from_secs(2)).unwrap(),
        "counter"
    );
    reader.join().unwrap();
    let (second_entered_tx, second_entered_rx) = mpsc::channel();
    let second_store = store.clone();
    let second = std::thread::spawn(move || {
        second_store.update("counter", |agent| {
            assert_eq!(agent.name, "first");
            second_entered_tx.send(()).unwrap();
            agent.name = "second".into();
        })
    });
    assert!(matches!(
        second_entered_rx.try_recv(),
        Err(mpsc::TryRecvError::Empty)
    ));
    release_tx.send(()).unwrap();
    first.join().unwrap().unwrap();
    second.join().unwrap().unwrap();
    assert_eq!(store.get("counter").unwrap().name, "second");
    assert_eq!(
        isolated_store(root.path()).get("counter").unwrap().name,
        "second"
    );

    let workers: Vec<_> = (0..4)
        .map(|_| {
            let store = store.clone();
            std::thread::spawn(move || {
                for _ in 0..8 {
                    store
                        .update("counter", |agent| {
                            agent.max_tokens = Some(agent.max_tokens.unwrap_or(0) + 1)
                        })
                        .unwrap();
                }
            })
        })
        .collect();
    for worker in workers {
        worker.join().unwrap();
    }
    assert_eq!(store.get("counter").unwrap().max_tokens, Some(32));
    assert_eq!(
        isolated_store(root.path())
            .get("counter")
            .unwrap()
            .max_tokens,
        Some(32)
    );
}

#[test]
fn invalid_identity_patch_does_not_publish_or_overwrite_disk() {
    let root = tempfile::tempdir().unwrap();
    let store = isolated_store(root.path());
    store.insert(custom("valid")).unwrap();
    assert!(store
        .update("valid", |agent| agent.id = "builtin:os".into())
        .is_err());
    assert!(store.get("valid").is_some());
    assert!(isolated_store(root.path()).get("valid").is_some());
}

#[test]
fn failed_save_does_not_emit_success_and_retry_emits_once() {
    let root = tempfile::tempdir().unwrap();
    let store = isolated_store(root.path());
    let id = format!("notification-test-{}", uuid::Uuid::new_v4());
    let observed_id = id.clone();
    let (tx, rx) = mpsc::channel();
    set_definitions_changed_hook(move |changed| {
        if changed == observed_id {
            let _ = tx.send(changed.to_string());
        }
    });
    store.insert(custom(&id)).unwrap();
    assert_eq!(rx.recv_timeout(Duration::from_secs(1)).unwrap(), id);
    let saved = block_destination(&store.storage_path);
    assert!(store
        .update(&id, |agent| agent.name = "not committed".into())
        .is_err());
    assert!(matches!(rx.try_recv(), Err(mpsc::TryRecvError::Empty)));
    restore_destination(&store.storage_path, &saved);
    store
        .update(&id, |agent| agent.name = "committed".into())
        .unwrap();
    assert_eq!(rx.recv_timeout(Duration::from_secs(1)).unwrap(), id);
    assert!(matches!(rx.try_recv(), Err(mpsc::TryRecvError::Empty)));
}
