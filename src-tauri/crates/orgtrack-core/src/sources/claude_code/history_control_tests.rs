use super::types::{ClaudeControlEnvelope, ClaudeJsonlLine};
use super::*;
use serde_json::json;

fn row(value: Value) -> ClaudeJsonlLine {
    serde_json::from_value(value).unwrap()
}

#[test]
fn control_acknowledgement_requires_provider_provenance_not_text() {
    for entrypoint in ["claude-desktop", "cli", "sdk-test", "orgii"] {
        let mut envelope = ClaudeControlEnvelope::default();
        envelope.observe(&row(json!({
            "type":"user", "uuid":"control", "isMeta":true,
            "entrypoint":entrypoint, "message":{"content":"arbitrary control content"}
        })));
        let acknowledgement = json!({
            "type":"assistant", "parentUuid":"control", "entrypoint":entrypoint,
            "message":{"model":"<synthetic>","content":[{"type":"text","text":"arbitrary acknowledgement"}]}
        });
        assert!(envelope.observe(&row(acknowledgement.clone())));
        let mut genuine = acknowledgement.clone();
        genuine["message"]["model"] = json!("claude-sonnet-5");
        assert!(!envelope.observe(&row(genuine)));
        let mut failure = acknowledgement.clone();
        failure["isApiErrorMessage"] = json!(true);
        assert!(!envelope.observe(&row(failure)));
        let mut unrelated = acknowledgement.clone();
        unrelated["parentUuid"] = json!("other-user");
        assert!(!envelope.observe(&row(unrelated)));
        envelope.observe(&row(
            json!({"type":"user","uuid":"human","message":{"content":"No response requested."}}),
        ));
        assert!(!envelope.observe(&row(acknowledgement)));
    }
}

#[test]
fn native_resume_control_pair_does_not_pollute_replay_windows_or_previews() {
    let dir = std::env::temp_dir().join(format!(
        "orgii-claude-control-envelope-{}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("resume.jsonl");
    let content = r#"{"type":"user","uuid":"first","timestamp":"2026-09-17T17:06:00Z","message":{"content":"earlier request https://example.test/real"}}
{"type":"assistant","uuid":"failure","parentUuid":"first","isApiErrorMessage":true,"timestamp":"2026-09-17T17:06:01Z","message":{"model":"<synthetic>","content":[{"type":"text","text":"prior failure"}]}}
{"type":"user","uuid":"resume-control","parentUuid":"failure","isMeta":true,"entrypoint":"claude-desktop","timestamp":"2026-09-17T17:09:00Z","message":{"content":[{"type":"text","text":"provider resume instruction https://example.test/control"}]}}
{"type":"assistant","uuid":"control-ack","parentUuid":"resume-control","timestamp":"2026-09-17T17:09:00Z","message":{"model":"<synthetic>","content":[{"type":"text","text":"No response requested."}]}}
{"type":"user","uuid":"second","parentUuid":"control-ack","promptSource":"sdk","timestamp":"2026-09-17T17:09:01Z","message":{"content":"No response requested."}}
{"type":"assistant","uuid":"real-reply","parentUuid":"second","timestamp":"2026-09-17T17:09:02Z","message":{"model":"claude-sonnet-5","content":[{"type":"text","text":"No response requested."}]}}
"#;
    std::fs::write(&path, content).unwrap();
    let session = "cliagent-control-envelope";
    let full = load_claude_code_history_from_path(session, &path).unwrap();
    assert_eq!(full.len(), 4);
    let indexed = index_claude_user_turns(session, &path).unwrap();
    assert_eq!(indexed.len(), 2);
    assert!(indexed.iter().all(|turn| turn.following_line_count == 1));
    let ids: Vec<_> = indexed
        .iter()
        .map(|turn| turn.user_chunk.chunk_id.clone())
        .collect();
    let windows = load_claude_code_turn_windows_from_path(session, &path, &ids).unwrap();
    assert!(windows.iter().all(|window| window.chunks.len() == 2));
    let initial = load_claude_code_initial_window_from_path(session, &path, 1).unwrap();
    assert_eq!(initial.total_turn_count, 2);
    assert_eq!(initial.loaded_turn_count, 1);
    // A resume acknowledgement must not replace the failed turn's preview.
    let rendered = serde_json::to_string(&initial.chunks).unwrap();
    assert!(rendered.contains("prior failure"));
    let source_users = load_claude_code_user_source_messages_from_path(session, &path).unwrap();
    assert_eq!(source_users.len(), 1);
    assert!(source_users[0].text.contains("https://example.test/real"));
    let cloud = load_claude_code_cloud_turn_windows_from_path(session, &path, &ids, 0).unwrap();
    assert!(cloud.iter().all(|window| window.chunks.len() == 2));
    // Repeated reads neither alter the provider file nor accumulate state.
    assert_eq!(
        serde_json::to_value(&full).unwrap(),
        serde_json::to_value(load_claude_code_history_from_path(session, &path).unwrap()).unwrap()
    );
    assert_eq!(std::fs::read_to_string(&path).unwrap(), content);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn materialized_artifact_provenance_survives_replay_and_window_index() {
    let dir = std::env::temp_dir().join(format!("orgii-claude-artifact-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("resume.jsonl");
    let rows = [
        json!({"type":"user","entrypoint":"orgii","message":{"content":"[file:/repo/input.txt]"}}),
        json!({"type":"assistant","entrypoint":"orgii","message":{"content":[{"type":"text","text":"[result](/repo/result.txt)"},{"type":"tool_use","id":"inherited-write","name":"Write","input":{"file_path":"/repo/result.txt","content":"old"}}]}}),
        // Even if the result is appended by the CLI, the original call owns provenance.
        json!({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"inherited-write","content":"ok"}]}}),
        json!({"type":"user","entrypoint":"cli","message":{"content":"[file:/repo/new.txt]"}}),
        json!({"type":"assistant","message":{"content":[{"type":"text","text":"[new](/repo/new.txt)"},{"type":"tool_use","id":"local-write","name":"Write","input":{"file_path":"/repo/new.txt","content":"new"}}]}}),
        json!({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"local-write","content":"ok"}]}}),
        json!({"type":"assistant","entrypoint":"orgii","message":{"content":[{"type":"tool_use","id":"pending","name":"Write","input":{"file_path":"/repo/pending.txt","content":"old"}}]}}),
    ];
    let content = rows
        .into_iter()
        .enumerate()
        .map(|(i, mut row)| {
            row["uuid"] = json!(format!("row-{i}"));
            row["timestamp"] = json!("2026-09-24T12:00:00Z");
            row.to_string()
        })
        .collect::<Vec<_>>()
        .join("\n");
    std::fs::write(&path, &content).unwrap();
    let session = "cliagent-artifact-origin";
    let full = load_claude_code_history_from_path(session, &path).unwrap();
    assert_eq!(full.len(), 7);
    for (i, chunk) in full.iter().enumerate() {
        assert_eq!(
            chunk.args["__orgiiMaterialized"].as_bool(),
            if i < 3 || i == 6 { Some(true) } else { None }
        );
    }
    let turns = index_claude_user_turns(session, &path).unwrap();
    assert_eq!(turns.len(), 2);
    assert_eq!(turns[0].user_chunk.args["__orgiiMaterialized"], json!(true));
    assert!(turns[1]
        .user_chunk
        .args
        .get("__orgiiMaterialized")
        .is_none());
    let ids = turns
        .iter()
        .map(|turn| turn.user_chunk.chunk_id.clone())
        .collect::<Vec<_>>();
    let windows = load_claude_code_turn_windows_from_path(session, &path, &ids).unwrap();
    assert!(windows[0]
        .chunks
        .iter()
        .all(|chunk| chunk.args["__orgiiMaterialized"] == json!(true)));
    assert_eq!(
        serde_json::to_value(&full).unwrap(),
        serde_json::to_value(load_claude_code_history_from_path(session, &path).unwrap()).unwrap()
    );
    assert_eq!(std::fs::read_to_string(&path).unwrap(), content);
    std::fs::remove_dir_all(&dir).unwrap();
}
