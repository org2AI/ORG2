//! Delayed native registration must not turn an empty target into Current.
use super::*;
use std::{fs, path::Path};

struct NativeHome(Option<std::ffi::OsString>);
impl NativeHome {
    fn set(home: &Path) -> Self {
        let previous = std::env::var_os("ORGII_NATIVE_TRANSCRIPT_HOME");
        std::env::set_var("ORGII_NATIVE_TRANSCRIPT_HOME", home);
        Self(previous)
    }
}
impl Drop for NativeHome {
    fn drop(&mut self) {
        if let Some(value) = self.0.take() {
            std::env::set_var("ORGII_NATIVE_TRANSCRIPT_HOME", value);
        } else {
            std::env::remove_var("ORGII_NATIVE_TRANSCRIPT_HOME");
        }
    }
}

#[test]
fn delayed_namespace_imports_real_source_before_reconciliation_can_report_clean() {
    let sandbox = crate::test_utils::test_env::sandbox();
    let _native_home = NativeHome::set(sandbox.path());
    let profile =
        NativeAppProfile::new("claude_desktop", "https://market.example", "delayed").unwrap();
    profile.prepare_launch_directories().unwrap();
    let account = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let org = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    let id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    let primary_home = sandbox.path().join("Library/Application Support/Claude");
    let primary_project = primary_home
        .join("claude-code-sessions")
        .join(account)
        .join(org);
    fs::create_dir_all(&primary_project).unwrap();
    fs::write(
        primary_home.join("config.json"),
        serde_json::json!({"lastKnownAccountUuid":account}).to_string(),
    )
    .unwrap();
    fs::write(primary_project.join(format!("local_{id}.json")), serde_json::json!({
        "cliSessionId":id,"sessionId":format!("local_{id}"),"cwd":"/","title":"Delayed namespace"
    }).to_string()).unwrap();
    let source = sandbox
        .path()
        .join(".claude/projects/-")
        .join(format!("{id}.jsonl"));
    fs::create_dir_all(source.parent().unwrap()).unwrap();
    let bytes = b"{\"type\":\"user\",\"message\":{\"content\":\"retained source\"}}\n";
    fs::write(&source, bytes).unwrap();
    let pending = || {
        registered_handoff(
            &profile,
            || Ok(()),
            || Ok(()),
            || panic!("unregistered namespace reached Clean"),
        )
    };
    for _ in 0..2 {
        assert!(matches!(pending(), Reconciliation::NamespacePending));
    }
    assert!(!profile.home().join("claude-code-sessions").exists());
    let project = profile
        .home()
        .join("claude-code-sessions")
        .join(account)
        .join(org);
    fs::create_dir_all(&project).unwrap();
    fs::write(
        profile.home().join("config.json"),
        serde_json::json!({"lastKnownAccountUuid":account}).to_string(),
    )
    .unwrap();
    assert!(matches!(pending(), Reconciliation::NamespacePending));
    fs::write(
        project
            .parent()
            .unwrap()
            .join(format!("{org}.profile-origin.json")),
        serde_json::json!({"mode":"local","org":org}).to_string(),
    )
    .unwrap();
    let target = profile
        .system_home()
        .join(".claude/projects/-")
        .join(format!("{id}.jsonl"));
    for _ in 0..2 {
        let result = registered_handoff(
            &profile,
            || Ok(()),
            || Ok(()),
            || {
                assert_eq!(fs::read(&target).unwrap(), bytes);
                assert!(project.join(format!("local_{id}.json")).is_file());
                Report {
                    status: Status::Clean,
                    items: Vec::new(),
                }
            },
        );
        assert!(matches!(
            result,
            Reconciliation::Complete(Report {
                status: Status::Clean,
                ..
            })
        ));
    }
    assert_eq!(
        fs::read_dir(project)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
            .count(),
        1
    );
    assert_eq!(fs::read(source).unwrap(), bytes);
    assert!(!profile.home().join("ant-did").exists());
    for blocked in [Status::Busy, Status::WriterUnknown, Status::ScopeChanged] {
        let result = registered_handoff(
            &profile,
            || Ok(()),
            || Err(blocked),
            || panic!("blocked import reached handoff"),
        );
        assert!(
            matches!(result, Reconciliation::Complete(Report { status, .. }) if status == blocked)
        );
    }
}

#[tokio::test]
async fn pending_namespace_retains_dirty_work_without_scheduling_its_own_retry() {
    let (lease, _) = owner::test_lease("namespace-pending-owner");
    let service = Service {
        lease,
        dirty: Mutex::new(Dirty::default()),
        snapshot: Mutex::new(Progress::default()),
        issues: Mutex::new(Issues::default()),
        wake: Notify::new(),
        cancelled: CancellationToken::new(),
        retiring: AtomicBool::new(false),
    };
    for _ in 0..3 {
        service.namespace_pending(None);
        assert!(service.dirty.lock().unwrap().pending());
        assert_eq!(service.view().state, HistorySyncState::Paused);
        assert_eq!(
            service.view().reason.as_deref(),
            Some("claude_history_namespace_pending")
        );
        assert!(
            tokio::time::timeout(
                std::time::Duration::from_millis(10),
                service.wake.notified()
            )
            .await
            .is_err()
        );
    }
    service.wake.notify_one();
    service.wake.notified().await;
}
