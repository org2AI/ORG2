use super::*;

#[test]
fn isolated_ambient_claude_launch_overrides_inherited_config() {
    let temp = tempfile::tempdir().unwrap();
    let directory = temp.path().join("external-history/.claude");
    let mut env = HashMap::from([("CLAUDE_CONFIG_DIR".into(), "inherited-profile".into())]);
    configure_claude_profile(
        KeySource::OwnKey,
        None,
        "session",
        Some(directory.clone()),
        &mut env,
    )
    .unwrap();
    assert!(directory.is_dir());
    assert_eq!(
        std::path::PathBuf::from(&env["CLAUDE_CONFIG_DIR"]),
        directory
    );
}

#[test]
fn ambient_claude_without_isolation_keeps_existing_config() {
    let mut env = HashMap::from([("CLAUDE_CONFIG_DIR".into(), "inherited-profile".into())]);
    let original = env.clone();
    configure_claude_profile(KeySource::OwnKey, None, "session", None, &mut env).unwrap();
    assert_eq!(env, original);
    let mut empty = HashMap::new();
    configure_claude_profile(KeySource::OwnKey, None, "session", None, &mut empty).unwrap();
    assert!(empty.is_empty());
}

#[test]
fn unavailable_claude_profile_fails_before_child_can_spawn() {
    let temp = tempfile::tempdir().unwrap();
    let blocker = temp.path().join("file");
    std::fs::write(&blocker, "not a directory").unwrap();
    let mut env = HashMap::new();
    let error = configure_claude_profile(
        KeySource::OwnKey,
        None,
        "session",
        Some(blocker.join(".claude")),
        &mut env,
    )
    .unwrap_err();
    assert!(error.contains("Failed to create Claude Code config directory"));
    assert!(!env.contains_key("CLAUDE_CONFIG_DIR"));
}
