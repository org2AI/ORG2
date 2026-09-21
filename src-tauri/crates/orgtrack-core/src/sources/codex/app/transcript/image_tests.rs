use super::load_codex_app_cloud_turn_from_path;

#[test]
fn windowed_images_preserve_header_refs_and_recover_portable_bytes() {
    use super::{load_codex_app_initial_window_from_path, load_codex_app_window_turn_from_path};
    let dir = std::env::temp_dir().join(format!("orgii-window-images-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("rollout.jsonl");
    let image = format!("data:image/png;base64,{}", "A".repeat(128 * 1024));
    let mut rows = Vec::new();
    for n in 0..3 {
        rows.push(serde_json::json!({"type":"event_msg","payload":{"type":"task_started","turn_id":format!("turn-{n}")}}));
        rows.push(serde_json::json!({"type":"turn_context","payload":{}}));
        rows.push(serde_json::json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":format!("inspect {n}")},{"type":"input_image","image_url":image}]}}));
        rows.push(serde_json::json!({"type":"event_msg","payload":{"type":"item_completed","item":{"type":"UserMessage","id":format!("user-{n}"),"content":[{"type":"text","text":format!("inspect {n}")},{"type":"local_image","path":format!("/missing/shot-{n}.png")}]}}}));
        rows.push(serde_json::json!({"type":"event_msg","payload":{"type":"agent_message","message":"done"}}));
    }
    let content = rows
        .iter()
        .map(|r| serde_json::to_string(r).unwrap())
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    std::fs::write(&path, content).unwrap();
    for _ in 0..2 {
        let window = load_codex_app_initial_window_from_path("codexapp-images", &path, 1).unwrap();
        let users = window
            .chunks
            .iter()
            .filter(|c| c.function == "user_message")
            .collect::<Vec<_>>();
        assert_eq!(users.len(), 3);
        let reference = users[0].result["images"][0].as_str().unwrap();
        let descriptor: Vec<String> =
            serde_json::from_str(reference.strip_prefix("orgii-transcript-image:").unwrap())
                .unwrap();
        assert_eq!(
            descriptor,
            vec![
                "codexapp-images".to_string(),
                users[0].chunk_id.clone(),
                "/missing/shot-0.png".to_string()
            ]
        );
        assert_eq!(
            super::load_codex_image_from_path(&path, &descriptor[1], &descriptor[2]).unwrap(),
            Some(image.clone())
        );
        assert!(super::load_codex_image_from_path(&path, &descriptor[1], "/wrong.png").is_err());
        assert!(users[1].result["images"][0]
            .as_str()
            .unwrap()
            .contains("/missing/shot-1.png"));
        assert_eq!(users[2].result["images"][0], image);
        assert!(
            serde_json::to_vec(&window).unwrap().len() < image.len() + 16_384,
            "initial replay must not embed all historical screenshots"
        );
        let id = users[0].chunk_id.clone();
        let expanded = load_codex_app_window_turn_from_path("codexapp-images", &path, &id).unwrap();
        let user = expanded.chunks.iter().find(|c| c.chunk_id == id).unwrap();
        assert_eq!(user.result["images"][0], image);
        let cloud = load_codex_app_cloud_turn_from_path("codexapp-images", &path, &id, 0).unwrap();
        assert_eq!(
            cloud
                .iter()
                .find(|c| c.function == "user_message")
                .unwrap()
                .result["images"][0],
            image
        );
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
#[ignore = "explicit screenshot-heavy replay memory acceptance"]
fn screenshot_history_resource_acceptance() {
    use super::load_codex_app_initial_window_from_path;
    use std::io::Write;
    let turns: usize = std::env::var("ORGII_IMAGE_TEST_TURNS")
        .unwrap_or_else(|_| "256".into())
        .parse()
        .unwrap();
    let dir = std::env::temp_dir().join(format!("orgii-image-memory-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("rollout.jsonl");
    let mut file = std::fs::File::create(&path).unwrap();
    let image = format!("data:image/png;base64,{}", "A".repeat(256 * 1024));
    for n in 0..turns {
        writeln!(file, "{}", serde_json::json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_image","image_url":image}]}})).unwrap();
        writeln!(file, "{}", serde_json::json!({"type":"event_msg","payload":{"type":"user_message","message":format!("inspect {n}"),"local_images":[format!("/missing/{n}.png")]}})).unwrap();
    }
    drop(file);
    let mut largest_wire = 0;
    for _ in 0..10 {
        let window = load_codex_app_initial_window_from_path("codexapp-memory", &path, 1).unwrap();
        let bytes = serde_json::to_vec(&window).unwrap().len();
        largest_wire = largest_wire.max(bytes);
        assert!(bytes < image.len() + turns * 2048);
    }
    eprintln!(
        "turns={turns} source_bytes={} max_wire_bytes={largest_wire} loads=10",
        std::fs::metadata(&path).unwrap().len()
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
#[ignore = "requires a local rollout and expected screenshot prompt"]
fn real_screenshot_replay_acceptance() {
    use super::{load_codex_app_initial_window_from_path, load_codex_app_window_turn_from_path};
    let path = std::path::PathBuf::from(
        std::env::var("ORGII_CODEX_ROLLOUT_FIXTURE").expect("fixture path"),
    );
    let prompt = std::env::var("ORGII_CODEX_IMAGE_PROMPT").expect("expected prompt");
    let window =
        load_codex_app_initial_window_from_path("codexapp-image-fixture", &path, 1).unwrap();
    let user = window
        .chunks
        .iter()
        .find(|chunk| {
            chunk.function == "user_message"
                && chunk.result["message"]["content"]
                    .as_str()
                    .is_some_and(|text| text.contains(&prompt))
        })
        .expect("screenshot user row");
    let refs = user.result["images"]
        .as_array()
        .expect("header attachments");
    assert!(!refs.is_empty());
    let descriptor: Vec<String> = serde_json::from_str(
        refs[0]
            .as_str()
            .unwrap()
            .strip_prefix("orgii-transcript-image:")
            .unwrap(),
    )
    .unwrap();
    let lazy_image = super::load_codex_image_from_path(&path, &descriptor[1], &descriptor[2])
        .unwrap()
        .expect("lazy embedded image");
    assert!(lazy_image.starts_with("data:image/png;base64,"));
    let expanded =
        load_codex_app_window_turn_from_path("codexapp-image-fixture", &path, &user.chunk_id)
            .unwrap();
    let expanded_user = expanded
        .chunks
        .iter()
        .find(|chunk| chunk.chunk_id == user.chunk_id)
        .unwrap();
    let image = expanded_user.result["images"][0]
        .as_str()
        .expect("expanded image");
    assert!(image.starts_with("data:image/png;base64,"));
    eprintln!(
        "header_images={} expanded_embedded_bytes={}",
        refs.len(),
        image.len()
    );
}

#[test]
fn codex_embedded_only_header_remains_reachable_without_retaining_bytes() {
    use super::load_codex_app_initial_window_from_path;
    let dir = std::env::temp_dir().join(format!("orgii-codex-image-only-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("rollout.jsonl");
    std::fs::write(&path, r#"{"type":"event_msg","payload":{"type":"user_message","message":"","images":["data:image/png;base64,QUJD"]}}
{"type":"event_msg","payload":{"type":"user_message","message":"continue"}}
"#).unwrap();
    let window = load_codex_app_initial_window_from_path("codexapp-image-only", &path, 1).unwrap();
    let users = window
        .chunks
        .iter()
        .filter(|c| c.function == "user_message")
        .collect::<Vec<_>>();
    assert_eq!(users.len(), 2);
    assert_eq!(users[0].result["message"]["content"], "(image)");
    assert!(users[0].result.get("images").is_none());
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn generated_output_images_survive_replay_without_embedding_bytes() {
    use serde_json::json;
    let dir = std::env::temp_dir().join(format!("orgii-generated-replay-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("rollout.jsonl");
    let rows = [
        json!({"type":"event_msg","payload":{"type":"user_message","message":"draw an avatar"}}),
        json!({"type":"response_item","payload":{"type":"custom_tool_call","call_id":"draw","name":"exec","input":"const result = await tools.image_gen__imagegen({prompt: 'avatar'}); generatedImage(result);"}}),
        json!({"type":"response_item","payload":{"type":"custom_tool_call_output","call_id":"draw","output":[{"type":"input_text","text":"Script completed"},{"type":"input_image","image_url":"data:image/png;base64,AVATAR"}]}}),
        json!({"type":"response_item","payload":{"type":"image_generation_call","id":"native-image","status":"completed","result":"NATIVE"}}),
    ];
    std::fs::write(
        &path,
        rows.iter()
            .map(serde_json::Value::to_string)
            .collect::<Vec<_>>()
            .join("\n")
            + "\n",
    )
    .unwrap();
    for _ in 0..2 {
        let chunks = super::load_codex_app_from_path("codexapp-generated", &path).unwrap();
        let images = chunks
            .iter()
            .filter_map(|chunk| chunk.result.get("images"))
            .collect::<Vec<_>>();
        assert_eq!(images.len(), 2);
        let reference = images[0][0].as_str().unwrap();
        let native_descriptor: Vec<String> = serde_json::from_str(
            images[1][0]
                .as_str()
                .unwrap()
                .strip_prefix("orgii-transcript-image:")
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            super::load_codex_image_from_path(&path, &native_descriptor[1], &native_descriptor[2])
                .unwrap()
                .as_deref(),
            Some("data:image/png;base64,NATIVE")
        );
        assert!(!serde_json::to_string(&chunks)
            .unwrap()
            .contains("base64,AVATAR"));
        let descriptor: Vec<String> =
            serde_json::from_str(reference.strip_prefix("orgii-transcript-image:").unwrap())
                .unwrap();
        assert_eq!(
            super::load_codex_image_from_path(&path, &descriptor[1], &descriptor[2])
                .unwrap()
                .as_deref(),
            Some("data:image/png;base64,AVATAR")
        );
    }
    // A later user turn forces generated output into the collapsed catalog path.
    use std::io::Write;
    writeln!(
        std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap(),
        "{}",
        json!({"type":"event_msg","payload":{"type":"user_message","message":"continue"}})
    )
    .unwrap();
    for _ in 0..2 {
        let window =
            super::load_codex_app_initial_window_from_path("codexapp-generated", &path, 1).unwrap();
        let preview = window
            .chunks
            .iter()
            .find(|c| c.result.get("unloadedTurn").is_some())
            .unwrap();
        let images = preview.result["images"].as_array().unwrap();
        assert_eq!(images.len(), 2);
        assert!(!serde_json::to_string(&window.chunks)
            .unwrap()
            .contains("base64,AVATAR"));
        for (image, expected) in images.iter().zip([
            "data:image/png;base64,AVATAR",
            "data:image/png;base64,NATIVE",
        ]) {
            let parts: Vec<String> = serde_json::from_str(
                image
                    .as_str()
                    .unwrap()
                    .strip_prefix("orgii-transcript-image:")
                    .unwrap(),
            )
            .unwrap();
            assert_eq!(
                super::load_codex_image_from_path(&path, &parts[1], &parts[2])
                    .unwrap()
                    .as_deref(),
                Some(expected)
            );
        }
    }
    let cloud =
        super::load_codex_app_cloud_turn_from_path("codexapp-generated", &path, "codex-user-0", 0)
            .unwrap();
    assert!(cloud
        .iter()
        .any(|chunk| chunk.result["images"][0] == "data:image/png;base64,AVATAR"));
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
#[ignore = "requires local generated-image rollout"]
fn real_generated_images_in_collapsed_preview() {
    let path = std::path::PathBuf::from(std::env::var("ORGII_CODEX_ROLLOUT_FIXTURE").unwrap());
    let window =
        super::load_codex_app_initial_window_from_path("codexapp-generated", &path, 1).unwrap();
    let images: Vec<_> = window
        .chunks
        .iter()
        .filter(|c| c.function != "user_message")
        .filter_map(|c| c.result["images"].as_array())
        .flatten()
        .collect();
    assert_eq!(images.len(), 4);
    for image in images {
        let parts: Vec<String> = serde_json::from_str(
            image
                .as_str()
                .unwrap()
                .strip_prefix("orgii-transcript-image:")
                .unwrap(),
        )
        .unwrap();
        assert!(
            super::load_codex_image_from_path(&path, &parts[1], &parts[2])
                .unwrap()
                .unwrap()
                .starts_with("data:image/")
        );
    }
}
