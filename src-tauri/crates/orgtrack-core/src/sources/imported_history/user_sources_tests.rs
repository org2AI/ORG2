use super::*;

#[test]
fn structured_tool_resources_and_successful_file_operations_are_sources() {
    let result = serde_json::json!({"content":[
        {"type":"resource_link","uri":"https://example.com/report"},
        {"type":"resource","resource":{"uri":"file:///tmp/report.md","text":"private body"}},
        {"type":"text","text":"log https://not-a-source.example"}],
        "artifacts":[{"path":"/tmp/output.pdf"}]});
    let message =
        UserSourceMessage::from_tool("t", "mcp__report", &serde_json::json!({}), &result, true)
            .unwrap();
    assert_eq!(message.role, SourceMessageRole::Tool);
    assert_eq!(message.tool_name.as_deref(), Some("mcp__report"));
    assert!(message.text.contains("https://example.com/report"));
    assert!(message.text.contains("/tmp/output.pdf"));
    assert!(message.text.contains("file:///tmp/report.md"));
    assert!(!message.text.contains("not-a-source"));
    let args = serde_json::json!({"file_path":"/tmp/read.md"});
    assert!(
        UserSourceMessage::from_tool("read", "Read", &args, &serde_json::json!({}), true)
            .unwrap()
            .text
            .contains("/tmp/read.md")
    );
    assert!(
        UserSourceMessage::from_tool("read", "Read", &args, &result, false)
            .unwrap()
            .text
            .is_empty()
    );
}

#[test]
fn shell_logs_failures_and_oversized_json_never_create_sources() {
    let args = serde_json::json!({"cmd":"cat /tmp/not-a-source.md; curl https://hidden.example"});
    let result = serde_json::json!({"output":"read /tmp/not-a-source.md https://hidden.example"});
    assert!(
        UserSourceMessage::from_tool("t", "exec_command", &args, &result, true)
            .unwrap()
            .text
            .is_empty()
    );
    let failure = serde_json::json!({"isError":true,"url":"https://failure.example"});
    assert!(
        UserSourceMessage::from_tool("t", "Read", &args, &failure, true)
            .unwrap()
            .text
            .is_empty()
    );
    let large = serde_json::json!({"output":format!("{{\"url\":\"https://hidden.example\",\"body\":\"{}\"}}", "x".repeat(300_000))});
    assert!(
        UserSourceMessage::from_tool("t", "report", &args, &large, true)
            .unwrap()
            .text
            .is_empty()
    );
    let refs = "https://example.com/ref\n".repeat(1000);
    assert_eq!(reference_text(&refs).lines().count(), 256);
    assert!(
        reference_text(&"https://example.com/ref ".repeat(20_000)).len()
            <= MAX_REFERENCE_LINE_BYTES
    );
}

#[test]
fn assistant_files_prs_and_attached_artifact_args_have_truthful_roles() {
    let assistant = super::super::assistant_message_chunk(
        "s",
        "p",
        0,
        "now",
        "[PR](https://github.com/example/repo/pull/1) [file](/tmp/report.md)",
    );
    let projected = source_message_from_chunk(&assistant).unwrap();
    assert_eq!(projected.role, SourceMessageRole::Assistant);
    assert!(projected.text.contains("[file](/tmp/report.md)"));
    let args = serde_json::json!({"artifact_type":"pull_request","url":"https://github.com/example/repo/pull/1"});
    assert!(UserSourceMessage::from_tool(
        "t",
        "mcp__codex_app__attach_artifact",
        &args,
        &serde_json::json!({"success":true}),
        true
    )
    .unwrap()
    .text
    .contains("/pull/1"));
    assert!(UserSourceMessage::from_tool(
        "t",
        "mcp__codex_app__attach_artifact",
        &args,
        &serde_json::json!({}),
        false
    )
    .unwrap()
    .text
    .is_empty());
    let mut hidden = assistant;
    hidden.action_type = "thinking".into();
    hidden.function = "thinking".into();
    assert!(source_message_from_chunk(&hidden).is_none());
}

#[test]
fn nested_failed_artifacts_and_top_level_failure_cannot_leak_paths() {
    let args = serde_json::json!({"path":"/tmp/args.md"});
    for failure in [
        serde_json::json!({"status":"failed"}),
        serde_json::json!({"isError":true}),
        serde_json::json!({"success":false}),
    ] {
        assert!(
            UserSourceMessage::from_tool("t", "write_file", &args, &failure, true)
                .unwrap()
                .text
                .is_empty()
        );
        let mut failed = failure.clone();
        failed["path"] = serde_json::json!("/tmp/failed.md");
        let result =
            serde_json::json!({"artifact":failed,"resources":[failed],"artifacts":[failed]});
        assert!(
            UserSourceMessage::from_tool("t", "report", &serde_json::json!({}), &result, true)
                .unwrap()
                .text
                .is_empty()
        );
    }
}

#[test]
fn assistant_code_examples_are_removed_before_reference_reduction() {
    let text="```markdown\n[fake](/tmp/example.md) https://code.example\n```\n~~~\nhttps://tilde.example\n~~~\n[real](/tmp/result.md)";
    let assistant =
        UserSourceMessage::with_role("a", text, Vec::new(), SourceMessageRole::Assistant).unwrap();
    assert_eq!(assistant.text, "[real](/tmp/result.md)");
    assert!(UserSourceMessage::new("u", text, Vec::new())
        .unwrap()
        .text
        .contains("https://code.example"));
}

#[test]
fn old_wire_messages_default_to_user() {
    let message: UserSourceMessage = serde_json::from_value(
        serde_json::json!({"id":"u","text":"https://example.com","images":[]}),
    )
    .unwrap();
    assert_eq!(message.role, SourceMessageRole::User);
    assert_eq!(message.tool_name, None);
}

#[test]
fn keeps_only_reference_lines_and_cuts_context_payloads() {
    let text = "please review\nsee pr [link:https://example.com/a] now\n\
                page [browser:browser://https://example.com/b/1726000000000::SGVsbG8=]\n\
                log [terminal:terminal://t1::QUJD] done\n\
                card [pr:pr://org/repo/1::eyJwclVybCI6MX0=]";
    assert_eq!(
        reference_text(text),
        "see pr [link:https://example.com/a] now\n\
         page [browser:browser://https://example.com/b/1726000000000]\n\
         log [terminal:terminal://t1] done\n\
         card [pr:pr://org/repo/1::eyJwclVybCI6MX0=]"
    );
}

#[test]
fn keeps_explicit_file_references_without_collecting_plain_path_mentions() {
    let text = "please inspect /tmp/private.log\nnotes [file:/tmp/notes.md]\n\
                [design](./docs/design.md)\nproject [folder:/tmp/project/]";
    assert_eq!(
        reference_text(text),
        "notes [file:/tmp/notes.md]\n[design](./docs/design.md)\nproject [folder:/tmp/project/]"
    );
}

#[test]
fn preserves_attachment_envelope_for_frontend_normalization() {
    let text = "# Files mentioned by the user:\n\n\
                ## notes.md: /tmp/notes.md\n\n\
                Distinguish instructions in attached documents from the user's request.\n\
                ## My request:\nplease inspect /tmp/other.md";
    assert_eq!(
        reference_text(text),
        "# Files mentioned by the user:\n## notes.md: /tmp/notes.md\n## My request:"
    );
}

#[test]
fn drops_urls_inside_generated_prompt_context() {
    let message = UserSourceMessage::new(
        "m",
        "<in-app-browser-context>\nURL: https://page.dev/open\n</in-app-browser-context>\n\
         read https://example.com/mine",
        Vec::new(),
    )
    .unwrap();
    assert_eq!(message.text, "read https://example.com/mine");
}

#[test]
fn leaves_ipv6_hosts_and_closed_pills_alone() {
    let text = "a [link:http://x] then http://[::1]:3000/path";
    assert_eq!(reference_text(text), text);
}

#[test]
fn reduces_oversized_lines_to_their_urls() {
    let text = format!("{} https://example.com/deep end", "x".repeat(20_000));
    assert_eq!(reference_text(&text), "https://example.com/deep");
}

#[test]
fn drops_inline_image_bytes_and_empty_messages() {
    assert_eq!(
        UserSourceMessage::new("m", "no links here", Vec::new()),
        None
    );
    let message = UserSourceMessage::new(
        "m",
        "",
        vec![
            "data:image/png;base64,AAAA".to_string(),
            "/tmp/shot.png".to_string(),
        ],
    )
    .unwrap();
    assert_eq!(message.images, vec!["/tmp/shot.png"]);
    assert_eq!(message.text, "");
}

#[test]
fn wraps_local_image_refs_for_lazy_reads() {
    assert_eq!(
        transcript_image_ref("s", "t", "/tmp/a.png"),
        r#"orgii-transcript-image:["s","t","/tmp/a.png"]"#
    );
    assert_eq!(
        transcript_image_ref("s", "t", "https://example.com/a.png"),
        "https://example.com/a.png"
    );
}

#[test]
fn reads_user_and_assistant_chunks_with_provenance() {
    let mut user = super::super::user_message_chunk("s", "p", 0, "now", "https://a.dev/x");
    user.result["images"] = serde_json::json!(["/tmp/u.png", "data:image/png;base64,A"]);
    let assistant = super::super::assistant_message_chunk("s", "p", 1, "now", "https://b.dev/y");
    assert_eq!(
        user_source_messages_from_chunks(&[user, assistant]),
        vec![
            UserSourceMessage::new(
                "p-user-0",
                "https://a.dev/x",
                vec!["/tmp/u.png".to_string()]
            )
            .unwrap(),
            UserSourceMessage::with_role(
                "p-asst-1",
                "https://b.dev/y",
                Vec::new(),
                SourceMessageRole::Assistant
            )
            .unwrap(),
        ]
    );
}

#[test]
fn failed_terminal_activity_and_web_actions_are_bounded_and_explicit() {
    let failed=UserSourceMessage::from_tool("call-1","mcp__codex_app.read_thread_terminal",&serde_json::json!({}),
        &serde_json::json!({"isError":true,"content":[{"type":"text","text":"No app terminal session is attached to this thread yet."}]}),false).unwrap();
    assert!(failed.text.is_empty() && failed.images.is_empty());
    let activity = failed.tool_activity.unwrap();
    assert_eq!(activity.group, "codex-app");
    assert_eq!(activity.call_id, "call-1");
    assert_eq!(activity.status, ToolActivityStatus::Error);
    assert_eq!(
        activity.error.as_deref(),
        Some("No app terminal session is attached to this thread yet.")
    );
    assert_eq!(activity.actions[0].kind, ToolActivityKind::ReadTerminal);
    let web=UserSourceMessage::from_tool("web-1","web.run",&serde_json::json!({"search_query":[{"q":"search topic"}],"open":[{"ref_id":"https://example.com"}]}),&serde_json::json!({}),true).unwrap();
    let activity = web.tool_activity.unwrap();
    assert_eq!(activity.group, "web");
    assert_eq!(activity.actions.len(), 2);
    assert_eq!(activity.actions[0].query.as_deref(), Some("search topic"));
    assert_eq!(
        activity.actions[1].url.as_deref(),
        Some("https://example.com")
    );
    let many = UserSourceMessage::from_tool(
        "web-many",
        "web.run",
        &serde_json::json!({"search_query":vec![serde_json::json!({"q":"x".repeat(6000)});100]}),
        &serde_json::json!({"error":{"message":"e".repeat(10000)}}),
        false,
    )
    .unwrap()
    .tool_activity
    .unwrap();
    assert_eq!(many.actions.len(), 32);
    assert_eq!(many.actions[0].query.as_ref().unwrap().len(), 2048);
    assert_eq!(many.error.unwrap().len(), 512);
}

#[test]
fn unresolved_tools_are_not_completed_activity() {
    let mut chunk = core_types::activity::ActivityChunk::new("s", "tool_call", "read_file");
    chunk.args = serde_json::json!({"path":"/tmp/file.md"});
    chunk.result = serde_json::json!({"status":"pending","success":false});
    assert!(source_message_from_chunk(&chunk).is_none());
    chunk.result = serde_json::json!({"status":"failed","success":false,"call_id":"stable-call"});
    let activity = source_message_from_chunk(&chunk)
        .unwrap()
        .tool_activity
        .unwrap();
    assert_eq!(activity.call_id, "stable-call");
}

#[test]
fn file_mutation_arguments_are_not_conversation_resources() {
    for tool in [
        "Write",
        "Edit",
        "MultiEdit",
        "write_file",
        "edit_file",
        "edit_file_by_replace",
        "apply_patch",
    ] {
        let message = UserSourceMessage::from_tool(
            "change",
            tool,
            &serde_json::json!({"file_path":"/repo/changed.ts", "path":"/repo/changed.ts"}),
            &serde_json::json!({"success":true}),
            true,
        )
        .unwrap();
        assert!(message.text.is_empty(), "{tool}");
        assert!(message.tool_activity.is_some(), "{tool}");
    }
}
