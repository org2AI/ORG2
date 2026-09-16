//! Real local stdio children cover the production process, framing, dispatch,
//! deadline, and manager coordinator. Never uses installed language servers.
use super::LspServer;
use crate::{LspManager, ServerKey};
use std::{
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};

fn child(mode: &str, root: &std::path::Path) -> LspServer {
    let mut server = LspServer::new_with_binary(
        "rust",
        std::path::Path::new("python3"),
        vec![
            format!("{}/src/tests/stdio_fixture.py", env!("CARGO_MANIFEST_DIR")),
            mode.into(),
        ],
        root.to_str().unwrap(),
        Default::default(),
    )
    .unwrap();
    server.start_stdio("rust".into()).unwrap();
    server
}
async fn ready(mode: &str, root: &std::path::Path) -> LspServer {
    let server = child(mode, root);
    server
        .initialize_with_options(
            root.to_str().unwrap(),
            None,
            Some(serde_json::json!({"rust":{"check":true}})),
        )
        .await
        .unwrap();
    server
}
#[tokio::test]
async fn rpc_errors_are_errors_and_configuration_requests_are_answered() {
    let root = tempfile::tempdir().unwrap();
    let init = child("init_error", root.path());
    let error = init
        .initialize_with_options(root.path().to_str().unwrap(), None, None)
        .await
        .unwrap_err();
    assert!(error.contains("-32002") && error.contains("retry"));
    init.shutdown().await;
    let server = ready("hover_error", root.path()).await;
    let error = server.hover("file:///fixture.rs", 0, 0).await.unwrap_err();
    assert!(error.contains("-32801") && error.contains("version"));
    server.shutdown().await;
    let server = ready("configuration", root.path()).await;
    let hover = tokio::time::timeout(
        Duration::from_secs(2),
        server.hover("file:///fixture.rs", 0, 0),
    )
    .await
    .unwrap()
    .unwrap()
    .unwrap();
    assert!(format!("{hover:?}").contains("true, null"));
    server.shutdown().await;
}
#[tokio::test]
async fn dropped_requests_remove_registrations_and_write_deadline_includes_pipe() {
    let root = tempfile::tempdir().unwrap();
    let server = ready("hover_wait", root.path()).await;
    assert!(tokio::time::timeout(
        Duration::from_millis(40),
        server.hover("file:///fixture.rs", 0, 0)
    )
    .await
    .is_err());
    assert!(server.pending_requests.lock().is_empty());
    server.shutdown().await;
    let server = child("no_read", root.path());
    let result = tokio::time::timeout(
        Duration::from_millis(300),
        server.request_with_timeout(
            "fixture/large",
            serde_json::json!({"text":"x".repeat(4*1024*1024)}),
            Duration::from_millis(30),
        ),
    )
    .await
    .expect("internal deadline must finish");
    assert!(result.unwrap_err().contains("timed out"));
    assert!(server.pending_requests.lock().is_empty());
    assert!(
        server.is_closed(),
        "abandoned partial frame must close transport"
    );
    tokio::time::timeout(Duration::from_secs(2), server.shutdown())
        .await
        .unwrap();
}
#[tokio::test]
async fn workspace_leases_isolate_queries_and_stop_invalidates_only_its_owner() {
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    let manager = LspManager::new();
    let ka = ServerKey::new(a.path(), "rust");
    let kb = ServerKey::new(b.path(), "rust");
    let sa = manager
        .start_with(&ka, async { Ok(ready("normal", a.path()).await) })
        .await
        .unwrap();
    let sb = manager
        .start_with(&kb, async { Ok(ready("normal", b.path()).await) })
        .await
        .unwrap();
    assert_eq!(
        manager.running_at(a.path().to_str().unwrap()).await,
        vec!["rust"]
    );
    assert_eq!(sa.key(), &ka);
    assert_eq!(sb.key(), &kb);
    let answer = sb.hover("file:///fixture.rs", 0, 0).await.unwrap().unwrap();
    assert!(format!("{answer:?}").contains(b.path().file_name().unwrap().to_str().unwrap()));
    manager.stop_server(&ka).await.unwrap();
    assert!(sa.hover("file:///fixture.rs", 0, 0).await.is_err());
    assert!(!sb.is_closed());
    let replacement = manager
        .start_with(&ka, async { Ok(ready("normal", a.path()).await) })
        .await
        .unwrap();
    assert!(sa.is_closed());
    assert!(!replacement.is_closed());
    manager.shutdown().await.unwrap();
}
#[tokio::test]
async fn cancelled_primary_settles_waiters_and_retry_spawns_once() {
    let root = tempfile::tempdir().unwrap();
    let manager = LspManager::new();
    let key = ServerKey::new(root.path(), "rust");
    let entered = Arc::new(tokio::sync::Notify::new());
    let child_pid = Arc::new(AtomicUsize::new(0));
    let copies = Arc::new(AtomicUsize::new(0));
    let primary = {
        let manager = manager.clone();
        let key = key.clone();
        let entered = entered.clone();
        let child_pid = child_pid.clone();
        let copies = copies.clone();
        tokio::spawn(async move {
            manager
                .start_with(&key, async {
                    copies.fetch_add(1, Ordering::Relaxed);
                    let server = child("init_wait", &key.root);
                    child_pid.store(server.process_id as usize, Ordering::Relaxed);
                    entered.notify_one();
                    server
                        .initialize_with_options(key.root.to_str().unwrap(), None, None)
                        .await?;
                    Ok(server)
                })
                .await
        })
    };
    entered.notified().await;
    let follower = {
        let manager = manager.clone();
        let key = key.clone();
        let copies = copies.clone();
        tokio::spawn(async move {
            manager
                .start_with(&key, async {
                    copies.fetch_add(1, Ordering::Relaxed);
                    Err("must not spawn".into())
                })
                .await
        })
    };
    tokio::task::yield_now().await;
    primary.abort();
    let _ = primary.await;
    let pid = child_pid.load(Ordering::Relaxed);
    assert_ne!(pid, 0);
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let alive = tokio::process::Command::new("/bin/kill")
                .args(["-0", &pid.to_string()])
                .stderr(std::process::Stdio::null())
                .status()
                .await
                .unwrap()
                .success();
            if !alive {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("cancelled startup must kill and reap its child");

    assert!(tokio::time::timeout(Duration::from_secs(1), follower)
        .await
        .unwrap()
        .unwrap()
        .is_err());
    assert_eq!(copies.load(Ordering::Relaxed), 1);
    let server = manager
        .start_with(&key, async { Ok(ready("normal", root.path()).await) })
        .await
        .unwrap();
    assert!(!server.is_closed());
    manager.shutdown().await.unwrap();
}
#[tokio::test]
async fn sync_state_is_shared_by_consumers_and_resets_with_server_generation() {
    let root = tempfile::tempdir().unwrap();
    let server = ready("normal", root.path()).await;
    for text in ["first", "post-edit", "query-again"] {
        server
            .sync_document("file:///fixture.rs", "rust", text)
            .await
            .unwrap();
    }
    let sent: Vec<_> = server
        .log_snapshot()
        .into_iter()
        .filter(|l| matches!(l.kind, crate::log_buffer::IoKind::StdIn))
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(&l.line).ok())
        .filter(|v| {
            v["method"] == "textDocument/didOpen" || v["method"] == "textDocument/didChange"
        })
        .collect();
    assert_eq!(sent.len(), 3);
    assert_eq!(sent[0]["method"], "textDocument/didOpen");
    assert_eq!(sent[1]["method"], "textDocument/didChange");
    assert_eq!(sent[2]["params"]["textDocument"]["version"], 3);
    server.shutdown().await;
    let server = ready("normal", root.path()).await;
    server
        .sync_document("file:///fixture.rs", "rust", "new generation")
        .await
        .unwrap();
    assert_eq!(
        server.documents.lock().await.get("file:///fixture.rs"),
        Some(&1)
    );
    server.shutdown().await;
}
#[tokio::test]
async fn malformed_header_closes_child_and_unterminated_stderr_does_not_block_init() {
    let root = tempfile::tempdir().unwrap();
    let server = child("bad_header", root.path());
    tokio::time::timeout(Duration::from_secs(2), server.stop.cancelled())
        .await
        .unwrap();
    server.shutdown().await;
    let server = tokio::time::timeout(Duration::from_secs(3), ready("long_stderr", root.path()))
        .await
        .unwrap();
    let lines = server.log_snapshot();
    assert!(lines.len() <= crate::log_buffer::MAX_LOG_LINES);
    assert!(lines.iter().all(|l| l.line.len() < 2200));
    server.shutdown().await;
}

#[tokio::test]
async fn cancelling_a_queued_write_keeps_other_requests_and_stop_interrupts_active_write() {
    let root = tempfile::tempdir().unwrap();
    let server = ready("normal", root.path()).await;
    let guard = server.stdin.lock().await;
    let result = server
        .request_with_timeout(
            "fixture/queued",
            serde_json::json!({}),
            Duration::from_millis(20),
        )
        .await;
    assert!(result.is_err());
    assert!(!server.is_closed());
    assert!(server.pending_requests.lock().is_empty());
    drop(guard);
    assert!(server.hover("file:///fixture.rs", 0, 0).await.is_ok());
    server.shutdown().await;
    let manager = LspManager::new();
    let key = ServerKey::new(root.path(), "rust");
    let lease = manager
        .start_with(&key, async { Ok(ready("stop_reading", root.path()).await) })
        .await
        .unwrap();
    let writer = tokio::spawn(async move {
        lease
            .send_notification(
                "fixture/large",
                Some(serde_json::json!({"text":"x".repeat(4*1024*1024)})),
            )
            .await
    });
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert!(!writer.is_finished());
    tokio::time::timeout(Duration::from_secs(1), manager.stop_server(&key))
        .await
        .unwrap()
        .unwrap();
    assert!(writer.await.unwrap().is_err());
}

#[tokio::test]
async fn request_budget_recovers_and_crashed_generations_can_restart() {
    let root = tempfile::tempdir().unwrap();
    let server = ready("hover_wait", root.path()).await;
    let mut pending = Vec::new();
    for _ in 0..256 {
        pending.push(
            server
                .send_request_with_response("textDocument/hover", Some(serde_json::json!({})))
                .await
                .unwrap(),
        );
    }
    assert!(server
        .send_request_with_response("textDocument/hover", None)
        .await
        .err()
        .unwrap()
        .contains("Too many"));
    let slots = server.cancel_slots.acquire_many(16).await.unwrap();
    drop(pending);
    assert!(server.pending_requests.lock().is_empty());
    drop(slots);
    server.shutdown().await;
    let manager = LspManager::new();
    let key = ServerKey::new(root.path(), "rust");
    let old = manager
        .start_with(&key, async { Ok(ready("normal", root.path()).await) })
        .await
        .unwrap();
    old.send_notification("fixture/crash", None).await.unwrap();
    tokio::time::timeout(Duration::from_secs(1), old.stop.cancelled())
        .await
        .unwrap();
    assert!(!manager.is_server_running(&key).await);
    let new = manager
        .start_with(&key, async { Ok(ready("normal", root.path()).await) })
        .await
        .unwrap();
    assert!(old.is_closed());
    assert!(!new.is_closed());
    manager.shutdown().await.unwrap();
}
