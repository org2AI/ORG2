use super::*;

#[test]
fn native_watcher_delivers_burst_replacement_and_deletion() {
    let dir = std::env::temp_dir().join(format!(
        "org2-native-settings-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir(&dir).unwrap();
    // Deliberately not canonicalized: on macOS `temp_dir()` lives under the
    // `/var -> /private/var` symlink, and `notify` reports canonical paths,
    // so this reproduces a symlinked `~/.orgii` / `ORGII_HOME`.
    let path = dir.join("settings.jsonc");
    std::fs::write(&path, "false").unwrap();
    let (watcher, rx) = watch_changes(&dir, &path).unwrap();
    let stop = Arc::new(AtomicBool::new(false));
    let worker_stop = stop.clone();
    let read_path = path.clone();
    let (tx, observed) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        consume_changes(&rx, &worker_stop, Duration::from_millis(100), || {
            let _ = tx.send(std::fs::read_to_string(&read_path).ok());
        });
    });
    std::fs::write(&path, "intermediate").unwrap();
    std::fs::write(&path, "true").unwrap();
    assert_eq!(
        observed
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .as_deref(),
        Some("true")
    );
    let replacement = dir.join("replacement.jsonc");
    std::fs::write(&replacement, "replacement").unwrap();
    std::fs::rename(&replacement, &path).unwrap();
    assert_eq!(
        observed
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .as_deref(),
        Some("replacement")
    );
    std::fs::remove_file(&path).unwrap();
    assert_eq!(observed.recv_timeout(Duration::from_secs(5)).unwrap(), None);
    stop.store(true, Ordering::Relaxed);
    drop(watcher);
    worker.join().unwrap();
    std::fs::remove_dir(&dir).unwrap();
}
