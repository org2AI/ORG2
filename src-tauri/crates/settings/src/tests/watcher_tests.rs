use super::*;
use notify::event::{AccessKind, CreateKind, ModifyKind, RemoveKind};

#[test]
fn only_writes_to_the_watched_file_schedule_a_reload() {
    let path = PathBuf::from("/settings-test/settings.jsonc");
    let watched = vec![path.clone()];
    for kind in [
        EventKind::Create(CreateKind::File),
        EventKind::Modify(ModifyKind::Any),
        EventKind::Remove(RemoveKind::File),
    ] {
        assert!(affects_settings(
            &Event::new(kind).add_path(path.clone()),
            &watched
        ));
    }
    assert!(!affects_settings(
        &Event::new(EventKind::Access(AccessKind::Read)).add_path(path.clone()),
        &watched
    ));
    assert!(!affects_settings(
        &Event::new(EventKind::Modify(ModifyKind::Any))
            .add_path(PathBuf::from("/other/settings.jsonc")),
        &watched
    ));
}

#[test]
fn symlinked_settings_home_matches_the_canonical_event_path() {
    let root = std::env::temp_dir().join(format!(
        "org2-settings-symlink-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let real_dir = root.join("real");
    let link_dir = root.join("link");
    std::fs::create_dir_all(&real_dir).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(&real_dir, &link_dir).unwrap();
    #[cfg(windows)]
    std::os::windows::fs::symlink_dir(&real_dir, &link_dir).unwrap();

    let configured = link_dir.join("settings.jsonc");
    let watched = watched_path_candidates(&link_dir, &configured);
    let canonical = real_dir.canonicalize().unwrap().join("settings.jsonc");
    assert!(watched.contains(&configured));
    assert!(watched.contains(&canonical));
    assert!(affects_settings(
        &Event::new(EventKind::Modify(ModifyKind::Any)).add_path(canonical),
        &watched
    ));
    assert!(!affects_settings(
        &Event::new(EventKind::Modify(ModifyKind::Any))
            .add_path(real_dir.canonicalize().unwrap().join("other.jsonc")),
        &watched
    ));
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn burst_publishes_final_settings_and_recovers_on_next_change() {
    let path = std::env::temp_dir().join(format!(
        "org2-settings-watcher-{}-{}.json",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::write(
        &path,
        r#"{"mobileRemote.enabled":false,"mobileRemote.relayEnabled":false}"#,
    )
    .unwrap();
    let (tx, rx) = mpsc::sync_channel(1);
    let (published_tx, published_rx) = mpsc::channel();
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = stop.clone();
    let read_path = path.clone();
    let worker = std::thread::spawn(move || {
        consume_changes(&rx, &thread_stop, Duration::from_millis(100), || {
            let value: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(&read_path).unwrap()).unwrap();
            published_tx.send(value).unwrap();
        });
    });
    assert!(published_rx
        .recv_timeout(Duration::from_millis(20))
        .is_err());
    tx.send(()).unwrap();
    // Reproduce enabling several settings within the former 500ms discard window.
    std::fs::write(
        &path,
        r#"{"mobileRemote.enabled":true,"mobileRemote.relayEnabled":true}"#,
    )
    .unwrap();
    let _ = tx.try_send(());
    let value = published_rx.recv_timeout(Duration::from_secs(3)).unwrap();
    assert_eq!(value["mobileRemote.enabled"], true);
    assert_eq!(value["mobileRemote.relayEnabled"], true);
    assert!(published_rx
        .recv_timeout(Duration::from_millis(150))
        .is_err());
    std::fs::write(&path, r#"{"mobileRemote.enabled":false}"#).unwrap();
    tx.send(()).unwrap();
    assert_eq!(
        published_rx.recv_timeout(Duration::from_secs(3)).unwrap()["mobileRemote.enabled"],
        false
    );
    stop.store(true, Ordering::Relaxed);
    drop(tx);
    worker.join().unwrap();
    std::fs::remove_file(path).unwrap();
}

#[test]
fn shutdown_discards_pending_notifications() {
    let (tx, rx) = mpsc::sync_channel(1);
    tx.send(()).unwrap();
    consume_changes(&rx, &AtomicBool::new(true), Duration::ZERO, || {
        panic!("published after shutdown")
    });
}
