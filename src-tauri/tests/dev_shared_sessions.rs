//! Exercise dev/bundled path selection through the real session persistence API
//! in separate processes, without opening the user's database.
#[path = "../src/runtime_instance.rs"]
mod runtime_instance;

use runtime_instance::RuntimeInstanceProfile;
use session_persistence::{load_events, save_events, CachedEvent};
use std::process::Command;

#[test]
fn session_store_child() {
    let Ok(identifier) = std::env::var("ORGII_TEST_APP_IDENTIFIER") else {
        return;
    };
    let sandbox = std::path::PathBuf::from(std::env::var_os("ORGII_TEST_USER_ROOT").unwrap());
    let profile = RuntimeInstanceProfile::from_identifier(&identifier);
    let data_root = profile
        .default_orgii_home(&sandbox)
        .unwrap_or_else(|| sandbox.join(".orgii"));
    std::env::set_var("ORGII_HOME", &data_root);
    assert_eq!(app_paths::sessions_db(), data_root.join("sessions.db"));
    database::db::register_sessions_init(session_persistence::init_session_tables);

    if std::env::var_os("ORGII_TEST_READ_BACK").is_some() {
        let expected = if profile.instance_id == 2 { 0 } else { 12 };
        for owner in ["org2ai.org2", "org2ai.org2.dev"] {
            let events = load_events(owner).expect("read persisted session");
            assert_eq!(events.len(), expected, "{identifier} reading {owner}");
            for event in events {
                assert_eq!(event.content, owner);
            }
        }
        return;
    }

    for index in 0..12 {
        save_events(
            &identifier,
            &[CachedEvent {
                id: format!("{identifier}-{index}"),
                session_id: identifier.clone(),
                event_type: "raw".into(),
                function_name: Some("user_message".into()),
                thread_id: None,
                args_json: "{}".into(),
                result_json: "{}".into(),
                content: identifier.clone(),
                created_at: format!("2026-09-15T00:00:{index:02}.000Z"),
                meta_json: None,
                history_sequence: None,
            }],
        )
        .expect("persist event while another process writes");
    }
}

#[test]
fn dev_and_bundle_share_persisted_sessions_across_processes() {
    let sandbox = tempfile::tempdir().unwrap();
    let child = |identifier: &str, read: bool| {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args(["--exact", "session_store_child", "--nocapture"])
            .env("ORGII_TEST_APP_IDENTIFIER", identifier)
            .env("ORGII_TEST_USER_ROOT", sandbox.path())
            .env_remove("ORGII_TEST_READ_BACK");
        if read {
            command.env("ORGII_TEST_READ_BACK", "1");
        }
        command
    };
    // Initialize a fresh schema before two independent connection pools write.
    // Precreate both paths so the legacy database importer cannot consult
    // any real user data, including during the numbered-isolation check.
    for directory in [".orgii", ".orgii-instance2"] {
        let root = sandbox.path().join(directory);
        std::fs::create_dir(&root).unwrap();
        let conn = rusqlite::Connection::open(root.join("sessions.db")).unwrap();
        database::db::configure_connection(&conn).unwrap();
        session_persistence::init_session_tables(&conn).unwrap();
    }

    let mut bundled = child("org2ai.org2", false).spawn().unwrap();
    let mut dev = child("org2ai.org2.dev", false).spawn().unwrap();
    let bundled_status = bundled.wait().unwrap();
    let dev_status = dev.wait().unwrap();
    assert!(bundled_status.success());
    assert!(dev_status.success());
    for identifier in ["org2ai.org2", "org2ai.org2.dev", "org2ai.org2.instance2"] {
        assert!(child(identifier, true).status().unwrap().success());
    }
    assert!(!sandbox.path().join(".orgii-dev").exists());
}
