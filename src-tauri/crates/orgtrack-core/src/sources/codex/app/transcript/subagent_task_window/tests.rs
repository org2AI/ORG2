use std::path::PathBuf;

use super::load_subagent_task_window_with_limit;
use crate::sources::codex::app::load_codex_app_initial_window_from_path;

const FIXTURE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/fixtures/codex-subagent-task-window.jsonl"
));

struct Transcript(PathBuf);
impl Transcript {
    fn new(contents: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "codex-task-window-{}-{}.jsonl",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(&path, contents).unwrap();
        Self(path)
    }
}
impl Drop for Transcript {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[test]
fn subagent_task_preview_keeps_real_activity_without_inherited_history_or_fake_user() {
    let file = Transcript::new(FIXTURE);
    let window = load_codex_app_initial_window_from_path("codexapp-child", &file.0, 1).unwrap();
    assert!(!window.chunks.is_empty());
    assert!(window
        .chunks
        .iter()
        .any(|chunk| chunk.action_type == "tool_call"));
    assert!(window
        .chunks
        .iter()
        .any(|chunk| chunk.function == "assistant"));
    assert!(!window
        .chunks
        .iter()
        .any(|chunk| chunk.function == "user_message"));
    let output = serde_json::to_string(&window.chunks).unwrap();
    assert!(output.contains("Child inspection finished"));
    assert!(!output.contains("Inherited"));
    assert!(!output.contains("Provider bootstrap"));
    assert!(
        window.turns.is_empty(),
        "task previews must not invent user turns"
    );
}

#[test]
fn subagent_task_preview_selects_latest_child_task() {
    let followup = r#"{"timestamp":"2026-09-29T11:00:00Z","ordinal":14,"type":"event_msg","payload":{"type":"task_started","turn_id":"child-followup"}}
{"timestamp":"2026-09-29T11:00:01Z","ordinal":15,"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Latest child reply"}]}}
"#;
    let file = Transcript::new(&format!("{FIXTURE}{followup}"));
    let window = load_codex_app_initial_window_from_path("codexapp-child", &file.0, 1).unwrap();
    let output = serde_json::to_string(&window.chunks).unwrap();
    assert!(output.contains("Latest child reply"));
    assert!(!output.contains("Child inspection finished"));
    assert!(!output.contains("Inherited"));
    let two = load_codex_app_initial_window_from_path("codexapp-child", &file.0, 2).unwrap();
    assert!(serde_json::to_string(&two.chunks)
        .unwrap()
        .contains("Child inspection finished"));
}

#[test]
fn subagent_without_child_activity_stays_empty() {
    // Copied parent activity and provider bootstrap never count as child work.
    for lines in [6, 10] {
        let raw = FIXTURE.lines().take(lines).collect::<Vec<_>>().join("\n") + "\n";
        let file = Transcript::new(&raw);
        let window = load_codex_app_initial_window_from_path("codexapp-child", &file.0, 1).unwrap();
        assert!(window.chunks.is_empty());
    }
}

#[test]
fn ordinary_user_history_keeps_existing_turn_projection() {
    let raw = r#"{"type":"session_meta","payload":{"id":"ordinary","source":"vscode"}}
{"timestamp":"2026-09-29T11:00:00Z","type":"event_msg","payload":{"type":"user_message","message":"Real user input"}}
{"timestamp":"2026-09-29T11:00:01Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Ordinary reply"}]}}
"#;
    let file = Transcript::new(raw);
    let window = load_codex_app_initial_window_from_path("codexapp-user", &file.0, 1).unwrap();
    assert_eq!(window.turns.len(), 1);
    assert!(window
        .chunks
        .iter()
        .any(|chunk| chunk.function == "user_message"));
    assert!(serde_json::to_string(&window.chunks)
        .unwrap()
        .contains("Ordinary reply"));
}

#[test]
fn subagent_with_real_user_message_keeps_user_turn_pagination() {
    let raw = format!(
        "{FIXTURE}{}",
        r#"{"timestamp":"2026-09-29T11:00:00Z","ordinal":14,"type":"event_msg","payload":{"type":"user_message","message":"Real child user input"}}
{"timestamp":"2026-09-29T11:00:01Z","ordinal":15,"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"User turn reply"}]}}
"#
    );
    let file = Transcript::new(&raw);
    let window = load_codex_app_initial_window_from_path("codexapp-child", &file.0, 1).unwrap();
    assert_eq!(window.turns.len(), 1);
    assert!(window
        .chunks
        .iter()
        .any(|chunk| chunk.function == "user_message"));
}

#[test]
fn bounded_subagent_preview_accepts_exact_record_boundary() {
    let offset = FIXTURE
        .lines()
        .take(6)
        .map(|line| line.len() + 1)
        .sum::<usize>();
    let file = Transcript::new(FIXTURE);
    let window = load_subagent_task_window_with_limit(
        "codexapp-child",
        &file.0,
        1,
        (FIXTURE.len() - offset) as u64,
    )
    .unwrap()
    .unwrap();
    assert!(!window.chunks.is_empty());
}

#[test]
fn bounded_subagent_preview_rejects_missing_task_boundary() {
    let file = Transcript::new(FIXTURE);
    let error =
        load_subagent_task_window_with_limit("codexapp-child", &file.0, 1, 120).unwrap_err();
    assert!(error.contains("bounded Codex history window"));
}
