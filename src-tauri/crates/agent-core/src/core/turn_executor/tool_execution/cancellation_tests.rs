use super::*;
use crate::session::turn::event_handler::{EventHandlerConfig, UnifiedEventHandler};
use crate::specialization::hooks::{config::HooksConfig, HookExecutor};
use crate::tools::traits::{CallContext, Tool, ToolError, ToolExecuteResult};
use async_trait::async_trait;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use tokio::sync::Notify;

#[derive(Clone, Copy, PartialEq, Eq)]
enum CancelPoint {
    AfterExecution,
    DuringPostHook,
    AfterFirstResult,
    Never,
}

struct FixtureTool {
    flag: Arc<AtomicBool>,
    cancel_point: CancelPoint,
    parallel: bool,
    count: usize,
}

#[async_trait]
impl Tool for FixtureTool {
    fn name(&self) -> &str {
        "read_cancel_fixture"
    }
    fn description(&self) -> &str {
        "Return an already-executed result"
    }
    fn parameters(&self) -> Value {
        serde_json::json!({"type":"object"})
    }
    fn is_concurrency_safe(&self) -> bool {
        self.parallel
    }
    async fn execute(&self, args: Value, _: &CallContext) -> Result<ToolExecuteResult, ToolError> {
        let index = args["index"].as_u64().unwrap() as usize;
        if self.cancel_point == CancelPoint::AfterExecution && index + 1 == self.count {
            self.flag.store(true, Ordering::SeqCst);
        }
        Ok(ToolExecuteResult::text(format!("actual result {index}")))
    }
}

/// Record optional callback admission while retaining real production writes
/// and real configured user-hook dispatch. Cancellation is deterministic.
struct ProbeHandler {
    inner: UnifiedEventHandler,
    flag: Arc<AtomicBool>,
    cancel_point: CancelPoint,
    post_calls: AtomicUsize,
    after_calls: AtomicUsize,
    entered: Arc<Notify>,
    release: Arc<Notify>,
}

#[async_trait]
impl TurnEventHandler for ProbeHandler {
    fn on_message_delta(&self, _: &str, _: &str) {}
    fn on_tool_call(&self, sid: &str, id: &str, name: &str, display: &str, args: &Value) {
        self.inner.on_tool_call(sid, id, name, display, args);
    }
    fn on_tool_result(&self, sid: &str, id: &str, name: &str, display: &str, result: &str) {
        self.inner.on_tool_result(sid, id, name, display, result);
        if self.cancel_point == CancelPoint::AfterFirstResult {
            self.flag.store(true, Ordering::SeqCst);
        }
    }
    async fn post_tool_hook(&self, _: &str, _: &Value, _: &str) -> Option<String> {
        let index = self.post_calls.fetch_add(1, Ordering::SeqCst);
        if self.cancel_point == CancelPoint::DuringPostHook {
            if index == 0 {
                self.entered.notify_one();
                self.release.notified().await;
            } else {
                // A regression that admits another slow hook must hit the
                // test deadline, rather than silently paying N hook delays.
                std::future::pending::<()>().await;
            }
        }
        None
    }
    async fn after_tool_execute(
        &self,
        sid: &str,
        id: &str,
        name: &str,
        args: &Value,
        result: &str,
        error: Option<&str>,
        duration: u64,
    ) {
        self.after_calls.fetch_add(1, Ordering::SeqCst);
        self.inner
            .after_tool_execute(sid, id, name, args, result, error, duration)
            .await;
    }
}

fn seed(sid: &str) {
    let conn = database::db::get_connection().unwrap();
    crate::persistence::test_schema::ensure_agent_sessions_schema(&conn);
    crate::persistence::session_snapshots::ensure_tables().unwrap();
    conn.execute(
        "INSERT INTO agent_sessions (session_id,name,session_type,status,created_at,updated_at)
         VALUES (?1,'Cancellation regression','agent','running',datetime('now'),datetime('now'))",
        [sid],
    )
    .unwrap();
}

async fn exercise(parallel: bool, cancel_point: CancelPoint, hooks: Option<HookExecutor>) {
    let sid = if parallel {
        "cancel-parallel"
    } else {
        "cancel-sequential"
    };
    seed(sid);
    let count = if parallel { 4 } else { 1 };
    let flag = Arc::new(AtomicBool::new(false));
    let entered = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let handler = ProbeHandler {
        inner: UnifiedEventHandler::new(EventHandlerConfig {
            hook_executor: hooks.map(Arc::new),
            cancel_flag: Some(Arc::clone(&flag)),
            ..Default::default()
        }),
        flag: Arc::clone(&flag),
        cancel_point,
        post_calls: AtomicUsize::new(0),
        after_calls: AtomicUsize::new(0),
        entered: Arc::clone(&entered),
        release: Arc::clone(&release),
    };
    let mut tools = ToolRegistry::new();
    tools.register(Box::new(FixtureTool {
        flag: Arc::clone(&flag),
        cancel_point,
        parallel,
        count,
    }));
    let mut calls: Vec<_> = (0..count)
        .map(|index| ToolCallRequest {
            id: format!("call-{index}"),
            name: "read_cancel_fixture".into(),
            arguments: serde_json::json!({"index":index}),
            thought_signature: None,
        })
        .collect();
    if cancel_point != CancelPoint::Never {
        calls.push(ToolCallRequest {
            id: "must-not-start".into(),
            name: "write_fixture".into(),
            arguments: serde_json::json!({}),
            thought_signature: None,
        });
    }
    let mut messages = Vec::new();
    let run = async {
        execute_tool_calls(
            &mut messages,
            &calls,
            &tools,
            &ResolvedToolPolicy::permissive(),
            sid,
            "turn",
            &[],
            None,
            &handler,
            None,
            Some(&flag),
            &mut FileTimeTracker::new(),
            &mut 0,
            None,
            4,
        )
        .await
    };
    let cancel = async {
        if cancel_point == CancelPoint::DuringPostHook {
            entered.notified().await;
            flag.store(true, Ordering::SeqCst);
            // An already-started callback retains its existing ownership and
            // finishes normally. No subsequent callback should be admitted.
            tokio::time::sleep(Duration::from_millis(30)).await;
            release.notify_one();
        }
    };
    let ((_, _, outcome), ()) =
        tokio::time::timeout(Duration::from_secs(2), async { tokio::join!(run, cancel) })
            .await
            .expect("cancelled result drain must not start another slow hook");
    assert_eq!(
        matches!(outcome, ToolBatchOutcome::Cancelled),
        cancel_point != CancelPoint::Never
    );
    let expected_post = match cancel_point {
        CancelPoint::AfterExecution => 0,
        CancelPoint::DuringPostHook | CancelPoint::AfterFirstResult => 1,
        CancelPoint::Never => count,
    };
    let expected_after = match cancel_point {
        CancelPoint::AfterExecution | CancelPoint::DuringPostHook => 0,
        CancelPoint::AfterFirstResult => 1,
        CancelPoint::Never => count,
    };
    assert_eq!(handler.post_calls.load(Ordering::SeqCst), expected_post);
    assert_eq!(handler.after_calls.load(Ordering::SeqCst), expected_after);
    let rows = crate::session::persistence::load_messages(sid).unwrap();
    assert_eq!(rows.len(), count * 2);
    assert_eq!(messages.len(), count);
    for index in 0..count {
        let id = format!("call-{index}");
        let row = rows
            .iter()
            .find(|row| row.role == "tool_result" && row.tool_call_id.as_deref() == Some(&id))
            .unwrap();
        assert_eq!(
            row.tool_output.as_deref(),
            Some(format!("actual result {index}").as_str())
        );
    }
    assert!(rows
        .iter()
        .all(|row| row.tool_call_id.as_deref() != Some("must-not-start")));
}

#[tokio::test]
async fn cancellation_after_execution_preserves_results_without_post_hooks() {
    let _sandbox = test_helpers::test_env::sandbox();
    for parallel in [false, true] {
        exercise(parallel, CancelPoint::AfterExecution, None).await;
    }
}

#[tokio::test]
async fn cancellation_during_slow_post_hook_drains_without_more_hooks() {
    let _sandbox = test_helpers::test_env::sandbox();
    for parallel in [false, true] {
        exercise(parallel, CancelPoint::DuringPostHook, None).await;
    }
}

#[tokio::test]
async fn uncancelled_results_keep_all_post_hooks() {
    let _sandbox = test_helpers::test_env::sandbox();
    for parallel in [false, true] {
        exercise(parallel, CancelPoint::Never, None).await;
    }
}

#[tokio::test]
async fn cancellation_drain_does_not_dispatch_more_slow_user_hooks() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let _sandbox = test_helpers::test_env::sandbox();
    crate::test_support::install_crypto_provider_for_tests();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/post-tool", listener.local_addr().unwrap());
    let (started_tx, started_rx) = tokio::sync::oneshot::channel();
    let release = Arc::new(Notify::new());
    let server_release = Arc::clone(&release);
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut bytes = [0; 4096];
        let n = socket.read(&mut bytes).await.unwrap();
        assert!(String::from_utf8_lossy(&bytes[..n]).starts_with("POST /post-tool "));
        started_tx.send(()).unwrap();
        server_release.notified().await;
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}")
            .await
            .unwrap();
    });
    let config: HooksConfig = serde_json::from_value(serde_json::json!({"hooks": {
        "post_tool_use": [{"type":"http", "url":url, "timeout_ms":30000}]
    }}))
    .unwrap();
    let hooks = HookExecutor::with_config(config, std::env::temp_dir());
    // The real handler dispatches user hooks in the background. Result drain
    // must finish while this first HTTP hook still awaits its response.
    exercise(true, CancelPoint::AfterFirstResult, Some(hooks)).await;
    tokio::time::timeout(Duration::from_secs(2), started_rx)
        .await
        .unwrap()
        .unwrap();
    assert!(!server.is_finished());
    release.notify_one();
    server.await.unwrap();
}
