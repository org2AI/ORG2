use super::*;
use serde_json::json;

const SESSION: &str = "e174ae0a-129b-4410-8c88-ae429738d2e9";
const FIRST: &str = "a174ae0a-129b-4410-8c88-ae429738d2e9";
const SECOND: &str = "b174ae0a-129b-4410-8c88-ae429738d2e9";
const THIRD: &str = "c174ae0a-129b-4410-8c88-ae429738d2e9";
fn line(value: Value) -> Vec<u8> {
    let mut bytes = serde_json::to_vec(&value).unwrap();
    bytes.push(b'\n');
    bytes
}
fn message(id: &str, parent: Option<&str>) -> Vec<u8> {
    line(
        json!({"type":"user", "uuid":id, "parentUuid":parent, "sessionId":SESSION, "message":{"role":"user", "content":"fixture"}}),
    )
}
fn append(mut base: Vec<u8>, suffix: Vec<u8>) -> Vec<u8> {
    base.extend(suffix);
    base
}
struct Pair {
    _temp: tempfile::TempDir,
    primary: PathBuf,
    package: PathBuf,
    state: PathBuf,
}
impl Pair {
    fn new(a: &[u8], b: &[u8]) -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        let primary = root.join("primary.jsonl");
        let package = root.join("package.jsonl");
        let state = root.join("state");
        fs::write(&primary, a).unwrap();
        fs::write(&package, b).unwrap();
        Self {
            _temp: temp,
            primary,
            package,
            state,
        }
    }
    fn run(&self) -> Result<Status, Status> {
        self.guarded(|| Ok(()), &Budget::new())
    }
    fn guarded(
        &self,
        guard: impl Fn() -> Result<(), Status>,
        budget: &Budget,
    ) -> Result<Status, Status> {
        storage::reconcile(
            self.primary.parent().unwrap(),
            &self.primary,
            self.package.parent().unwrap(),
            &self.package,
            &self.state,
            SESSION,
            budget,
            &guard,
        )
    }
}
#[test]
fn bidirectional_handoff_uses_independent_baselines_and_is_idempotent() {
    let base = message(FIRST, None);
    let continuation = message(SECOND, Some(FIRST));
    let pair = Pair::new(&base, &append(base.clone(), continuation));
    assert_eq!(pair.run(), Ok(Status::SyncedToPrimary));
    assert_eq!(pair.run(), Ok(Status::Clean));
    let next = append(
        fs::read(&pair.primary).unwrap(),
        message(THIRD, Some(SECOND)),
    );
    fs::write(&pair.primary, &next).unwrap();
    assert_eq!(pair.run(), Ok(Status::SyncedToPackage));
    assert_eq!(fs::read(&pair.package).unwrap(), next);
    assert_eq!(pair.run(), Ok(Status::Clean));
}
#[test]
fn concurrent_branches_are_preserved() {
    let base = message(FIRST, None);
    let pair = Pair::new(&base, &base);
    assert_eq!(pair.run(), Ok(Status::Clean));
    let a = append(base.clone(), message(SECOND, Some(FIRST)));
    let b = append(base, message(THIRD, Some(FIRST)));
    fs::write(&pair.primary, &a).unwrap();
    fs::write(&pair.package, &b).unwrap();
    assert_eq!(pair.run(), Err(Status::Conflict));
    assert_eq!(fs::read(&pair.primary).unwrap(), a);
    assert_eq!(fs::read(&pair.package).unwrap(), b);
}
#[test]
fn local_controls_are_not_replayed_or_mistaken_for_new_branches() {
    let base = message(FIRST, None);
    let pair = Pair::new(&base, &base);
    pair.run().unwrap();
    let controls = line(
        json!({"type":"queue-operation","sessionId":SESSION,"operation":"enqueue","content":"never replay this work"}),
    );
    fs::write(&pair.primary, append(base.clone(), controls)).unwrap();
    let mut row: Value = serde_json::from_slice(&message(SECOND, Some(FIRST))).unwrap();
    row["permissionMode"] = json!("bypassPermissions");
    fs::write(&pair.package, append(base, line(row))).unwrap();
    assert_eq!(pair.run(), Ok(Status::SyncedToPrimary));
    let output = fs::read(&pair.primary).unwrap();
    assert!(
        !String::from_utf8(output.clone())
            .unwrap()
            .contains("bypassPermissions")
    );
    assert_eq!(output.iter().filter(|b| **b == b'\n').count(), 3);
    assert_eq!(pair.run(), Ok(Status::Clean));
}
#[test]
fn refuses_partial_unknown_branches_and_rewound_checkpoint() {
    let base = message(FIRST, None);
    assert_eq!(
        records::validate(&base[..base.len() - 1], SESSION, &Budget::new()),
        Err(Status::Incomplete)
    );
    assert_eq!(
        records::validate(
            &append(base.clone(), message(SECOND, None)),
            SESSION,
            &Budget::new()
        ),
        Err(Status::Conflict)
    );
    assert_eq!(
        records::validate(
            &append(
                base.clone(),
                line(json!({"type":"last-prompt","sessionId":SESSION,"leafUuid":SECOND}))
            ),
            SESSION,
            &Budget::new()
        ),
        Err(Status::Unsupported)
    );
    let mut unknown: Value = serde_json::from_slice(&base).unwrap();
    unknown["grants"] = json!(["all"]);
    assert_eq!(
        records::validate(&line(unknown), SESSION, &Budget::new()),
        Err(Status::Unsupported)
    );
}
#[test]
fn failed_guard_and_limits_never_mutate_history() {
    let base = message(FIRST, None);
    let b = append(base.clone(), message(SECOND, Some(FIRST)));
    let pair = Pair::new(&base, &b);
    assert_eq!(
        pair.guarded(|| Err(Status::Busy), &Budget::new()),
        Err(Status::Busy)
    );
    assert_eq!(
        pair.guarded(|| Err(Status::WriterUnknown), &Budget::new()),
        Err(Status::WriterUnknown)
    );
    let budget = Budget::new();
    budget.remaining.set(1);
    assert_eq!(pair.guarded(|| Ok(()), &budget), Err(Status::Limit));
    assert_eq!(fs::read(&pair.primary).unwrap(), base);
    assert_eq!(fs::read(&pair.package).unwrap(), b);
}
/// Explicit opt-in, read-only audit of real provider files. Writes go only to a
/// fresh temporary fixture after both complete snapshots have been validated.
#[test]
#[ignore = "requires explicit read-only real transcript paths"]
fn real_transcript_projection_on_temporary_copies() {
    let a =
        fs::read(std::env::var_os("ORG2_AUDIT_PRIMARY_TRANSCRIPT").expect("primary path")).unwrap();
    let b =
        fs::read(std::env::var_os("ORG2_AUDIT_PACKAGE_TRANSCRIPT").expect("package path")).unwrap();
    let first: Value = b
        .split(|v| *v == b'\n')
        .filter_map(|l| serde_json::from_slice::<Value>(l).ok())
        .find(|r| r["uuid"].is_string())
        .unwrap();
    let session = first["sessionId"].as_str().unwrap();
    records::validate(&a, session, &Budget::new()).expect("primary parser");
    records::validate(&b, session, &Budget::new()).expect("package parser");
    let pair = Pair::new(&a, &b);
    let run = || {
        storage::reconcile(
            pair.primary.parent().unwrap(),
            &pair.primary,
            pair.package.parent().unwrap(),
            &pair.package,
            &pair.state,
            session,
            &Budget::new(),
            &|| Ok(()),
        )
    };
    // A changed provider prompt/tool snapshot is a deliberate refusal, not a
    // reason to weaken projection until an arbitrary real fixture passes.
    let result = run();
    eprintln!("real-copy handoff outcome: {result:?}");
    if result == Err(Status::Unsupported) {
        assert_eq!(fs::read(&pair.primary).unwrap(), a);
        assert_eq!(fs::read(&pair.package).unwrap(), b);
        return;
    }
    assert_eq!(result, Ok(Status::SyncedToPrimary));
    assert_eq!(run(), Ok(Status::Clean));
    let addition = records::project(&a, &b[a.len()..], session, &Budget::new()).unwrap();
    assert_eq!(fs::read(&pair.primary).unwrap(), append(a, addition));
}

#[test]
fn both_local_only_suffixes_advance_without_copying_or_conflict() {
    let base = message(FIRST, None);
    let pair = Pair::new(&base, &base);
    pair.run().unwrap();
    let a = append(
        base.clone(),
        line(json!({"type":"mode","sessionId":SESSION,"mode":"normal"})),
    );
    let b = append(
        base,
        line(
            json!({"type":"last-prompt","sessionId":SESSION,"leafUuid":FIRST,"lastPrompt":"same checkpoint"}),
        ),
    );
    fs::write(&pair.primary, &a).unwrap();
    fs::write(&pair.package, &b).unwrap();
    assert_eq!(pair.run(), Ok(Status::Clean));
    assert_eq!(pair.run(), Ok(Status::Clean));
    assert_eq!(fs::read(&pair.primary).unwrap(), a);
    assert_eq!(fs::read(&pair.package).unwrap(), b);
}

#[test]
fn detects_owner_loss_and_external_change_before_publish() {
    let base = message(FIRST, None);
    let pair = Pair::new(&base, &append(base.clone(), message(SECOND, Some(FIRST))));
    let calls = std::cell::Cell::new(0);
    assert_eq!(
        pair.guarded(
            || {
                calls.set(calls.get() + 1);
                if calls.get() > 1 {
                    Err(Status::ScopeChanged)
                } else {
                    Ok(())
                }
            },
            &Budget::new()
        ),
        Err(Status::ScopeChanged)
    );
    assert_eq!(fs::read(&pair.primary).unwrap(), base);
    let calls = std::cell::Cell::new(0);
    let changed = append(base.clone(), message(THIRD, Some(FIRST)));
    assert_eq!(
        pair.guarded(
            || {
                calls.set(calls.get() + 1);
                if calls.get() == 2 {
                    fs::write(&pair.primary, &changed).unwrap();
                }
                Ok(())
            },
            &Budget::new()
        ),
        Err(Status::Changed)
    );
    assert_eq!(fs::read(&pair.primary).unwrap(), changed);
}

fn interrupt_after_journal(pair: &Pair) {
    assert_eq!(
        pair.guarded(
            || {
                if fs::read_dir(&pair.state).is_ok_and(|rows| {
                    rows.filter_map(Result::ok)
                        .any(|row| row.file_name().to_string_lossy().ends_with(".pending.json"))
                }) {
                    Err(Status::ScopeChanged)
                } else {
                    Ok(())
                }
            },
            &Budget::new()
        ),
        Err(Status::ScopeChanged)
    );
    assert_eq!(
        fs::read_dir(&pair.state)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().ends_with(".pending.json"))
            .count(),
        1
    );
}
#[test]
fn interrupted_before_publish_can_retry_once() {
    let base = message(FIRST, None);
    let pair = Pair::new(&base, &append(base.clone(), message(SECOND, Some(FIRST))));
    interrupt_after_journal(&pair);
    assert_eq!(fs::read(&pair.primary).unwrap(), base);
    assert_eq!(pair.run(), Ok(Status::SyncedToPrimary));
    assert_eq!(pair.run(), Ok(Status::Clean));
    assert_eq!(
        fs::read(&pair.primary)
            .unwrap()
            .iter()
            .filter(|c| **c == b'\n')
            .count(),
        2
    );
}
#[test]
fn interrupted_after_publish_adopts_journal_without_replaying() {
    let base = message(FIRST, None);
    let package = append(base.clone(), message(SECOND, Some(FIRST)));
    let pair = Pair::new(&base, &package);
    interrupt_after_journal(&pair);
    // Simulate atomic replacement having completed but its state commit not yet persisted.
    let projected =
        records::project(&base, &package[base.len()..], SESSION, &Budget::new()).unwrap();
    let published = append(base, projected);
    fs::write(&pair.primary, &published).unwrap();
    assert_eq!(pair.run(), Ok(Status::Clean));
    assert_eq!(pair.run(), Ok(Status::Clean));
    assert_eq!(fs::read(&pair.primary).unwrap(), published);
}
#[test]
fn uncertain_journal_never_overwrites_external_edits() {
    let base = message(FIRST, None);
    let pair = Pair::new(&base, &append(base.clone(), message(SECOND, Some(FIRST))));
    interrupt_after_journal(&pair);
    let external = append(base, message(THIRD, Some(FIRST)));
    fs::write(&pair.primary, &external).unwrap();
    assert_eq!(pair.run(), Err(Status::Conflict));
    assert_eq!(fs::read(&pair.primary).unwrap(), external);
}
#[test]
fn held_lock_is_nonblocking_and_deadline_is_checked() {
    let base = message(FIRST, None);
    let pair = Pair::new(&base, &base);
    let path = pair.primary.with_file_name(".primary.jsonl.orgii.lock");
    let file = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(path)
        .unwrap();
    file.lock().unwrap();
    let before = std::time::Instant::now();
    assert_eq!(pair.run(), Err(Status::Busy));
    assert!(before.elapsed() < std::time::Duration::from_secs(1));
    drop(file);
    let budget = Budget {
        remaining: std::cell::Cell::new(MAX_PASS_BYTES),
        deadline: std::time::Instant::now(),
    };
    assert_eq!(pair.guarded(|| Ok(()), &budget), Err(Status::Limit));
}
#[test]
fn runtime_attachment_can_exist_in_baseline_but_cannot_be_exported() {
    let base = message(FIRST, None);
    let control = line(
        json!({"type":"attachment","uuid":SECOND,"parentUuid":FIRST,"sessionId":SESSION,"attachment":{"type":"auto_mode","bypass":true}}),
    );
    let existing = append(base.clone(), control.clone());
    assert_eq!(
        records::validate(&existing, SESSION, &Budget::new()),
        Ok(())
    );
    assert_eq!(
        records::project(&base, &control, SESSION, &Budget::new()),
        Err(Status::Unsupported)
    );
    assert!(
        records::project(
            &existing,
            &message(THIRD, Some(SECOND)),
            SESSION,
            &Budget::new()
        )
        .is_ok()
    );
}

#[test]
fn changed_prompt_or_tool_snapshots_are_not_treated_as_plain_history() {
    let base = message(FIRST, None);
    let snapshot = line(
        json!({"type":"attachment","uuid":SECOND,"parentUuid":FIRST,"sessionId":SESSION,"attachment":{"type":"prompt_snapshot","systemPrompt":["original"],"tools":[]}}),
    );
    let prefix = append(base, snapshot);
    for payload in [
        json!({"type":"prompt_snapshot","systemPrompt":["replacement"],"tools":[]}),
        json!({"type":"prompt_snapshot","systemPrompt":["original"],"tools":[{"name":"different"}]}),
    ] {
        let suffix = line(
            json!({"type":"attachment","uuid":THIRD,"parentUuid":SECOND,"sessionId":SESSION,"attachment":payload}),
        );
        assert_eq!(
            records::project(&prefix, &suffix, SESSION, &Budget::new()),
            Err(Status::Unsupported)
        );
        let pair = Pair::new(&prefix, &append(prefix.clone(), suffix));
        assert_eq!(pair.run(), Err(Status::Unsupported));
        assert_eq!(fs::read(&pair.primary).unwrap(), prefix);
    }
}

fn snapshot(id: &str, parent: &str, prompt: &str) -> Value {
    json!({"type":"attachment","uuid":id,"parentUuid":parent,"sessionId":SESSION,
        "attachment":{"type":"prompt_snapshot","systemPrompt":[prompt],"tools":[]}})
}
fn trusted_run(
    pair: &Pair,
    primary: Option<&records::TargetSnapshot>,
    package: Option<&records::TargetSnapshot>,
) -> Result<Status, Status> {
    // Each controlled handoff captures the destination's current behavior.
    let primary = primary
        .map(|_| {
            records::TargetSnapshot::capture(
                &fs::read(&pair.primary).unwrap(),
                SESSION,
                &Budget::new(),
            )
        })
        .transpose()?;
    let package = package
        .map(|_| {
            records::TargetSnapshot::capture(
                &fs::read(&pair.package).unwrap(),
                SESSION,
                &Budget::new(),
            )
        })
        .transpose()?;
    storage::reconcile_with_snapshots(
        pair.primary.parent().unwrap(),
        &pair.primary,
        pair.package.parent().unwrap(),
        &pair.package,
        &pair.state,
        SESSION,
        &Budget::new(),
        &|| Ok(()),
        primary.as_ref(),
        package.as_ref(),
    )
}
#[test]
fn explicit_snapshot_projection_is_bidirectional_without_false_payload_conflicts() {
    let original = snapshot(SECOND, FIRST, "primary system");
    let base = append(message(FIRST, None), line(original.clone()));
    let source = snapshot(THIRD, SECOND, "package system");
    let package = append(base.clone(), line(source.clone()));
    let pair = Pair::new(&base, &package);
    let primary_trust = records::TargetSnapshot::capture(&base, SESSION, &Budget::new()).unwrap();
    let package_trust = records::TargetSnapshot::capture(
        &fs::read(&pair.package).unwrap(),
        SESSION,
        &Budget::new(),
    )
    .unwrap();
    assert_eq!(
        trusted_run(&pair, Some(&primary_trust), None),
        Ok(Status::SyncedToPrimary)
    );
    assert_eq!(
        trusted_run(&pair, Some(&primary_trust), None),
        Ok(Status::Clean)
    );
    let primary = fs::read(&pair.primary).unwrap();
    let imported = records::rows(&primary, &Budget::new())
        .unwrap()
        .pop()
        .unwrap();
    assert_eq!(imported["uuid"], source["uuid"]);
    assert_eq!(imported["parentUuid"], source["parentUuid"]);
    assert_eq!(imported["attachment"], original["attachment"]);
    assert_eq!(fs::read(&pair.package).unwrap(), package);
    let fourth = "d174ae0a-129b-4410-8c88-ae429738d2e9";
    fs::write(
        &pair.primary,
        append(primary, line(snapshot(fourth, THIRD, "new primary system"))),
    )
    .unwrap();
    assert_eq!(
        trusted_run(&pair, None, Some(&package_trust)),
        Ok(Status::SyncedToPackage)
    );
    assert_eq!(
        trusted_run(&pair, None, Some(&package_trust)),
        Ok(Status::Clean)
    );
    let output = records::rows(&fs::read(&pair.package).unwrap(), &Budget::new()).unwrap();
    assert_eq!(output.last().unwrap()["attachment"], source["attachment"]);
    // Removing the declared exception cannot turn differing payloads into clean.
    let state = fs::read_dir(&pair.state)
        .unwrap()
        .filter_map(Result::ok)
        .find(|e| e.file_name().to_string_lossy().ends_with(".json"))
        .unwrap()
        .path();
    let mut manifest: Value = serde_json::from_slice(&fs::read(&state).unwrap()).unwrap();
    assert_eq!(manifest["ledger"].as_array().unwrap().len(), 2);
    assert_eq!(manifest["generation"], 2);
    manifest["ledger"] = json!([]);
    fs::write(&state, serde_json::to_vec(&manifest).unwrap()).unwrap();
    assert_eq!(trusted_run(&pair, None, None), Err(Status::Conflict));
}
#[test]
fn snapshot_projection_requires_existing_trusted_destination_and_rejects_third_payload() {
    let base = message(FIRST, None);
    let source = snapshot(SECOND, FIRST, "package system");
    let pair = Pair::new(&base, &append(base.clone(), line(source.clone())));
    let wrong_trust = records::TargetSnapshot::capture(
        &fs::read(&pair.package).unwrap(),
        SESSION,
        &Budget::new(),
    )
    .unwrap();
    assert_eq!(trusted_run(&pair, None, None), Err(Status::Unsupported));
    assert_eq!(
        trusted_run(&pair, Some(&wrong_trust), None),
        Err(Status::Unsupported)
    );
    assert_eq!(fs::read(&pair.primary).unwrap(), base);
    let original = snapshot(SECOND, FIRST, "primary system");
    let base = append(base, line(original.clone()));
    let pair = Pair::new(
        &base,
        &append(
            base.clone(),
            line(snapshot(THIRD, SECOND, "package system")),
        ),
    );
    let trust = records::TargetSnapshot::capture(&base, SESSION, &Budget::new()).unwrap();
    assert_eq!(
        trusted_run(&pair, Some(&trust), None),
        Ok(Status::SyncedToPrimary)
    );
    let mut changed = records::rows(&fs::read(&pair.primary).unwrap(), &Budget::new()).unwrap();
    changed.last_mut().unwrap()["attachment"]["systemPrompt"] = json!(["third payload"]);
    let changed: Vec<u8> = changed.into_iter().flat_map(line).collect();
    fs::write(&pair.primary, &changed).unwrap();
    assert_eq!(
        trusted_run(&pair, Some(&trust), None),
        Err(Status::Conflict)
    );
    assert_eq!(fs::read(&pair.primary).unwrap(), changed);
}
#[test]
fn explicit_projection_still_refuses_new_runtime_permissions() {
    let original = snapshot(SECOND, FIRST, "primary system");
    let base = append(message(FIRST, None), line(original.clone()));
    let control = line(
        json!({"type":"attachment","uuid":THIRD,"parentUuid":SECOND,"sessionId":SESSION,
        "attachment":{"type":"auto_mode","bypass":true}}),
    );
    let pair = Pair::new(&base, &append(base.clone(), control));
    let trust = records::TargetSnapshot::capture(&base, SESSION, &Budget::new()).unwrap();
    assert_eq!(
        trusted_run(&pair, Some(&trust), None),
        Err(Status::Unsupported)
    );
    assert_eq!(fs::read(&pair.primary).unwrap(), base);
}

/// Native CLI consumes this module's actual projected bytes, with temporary
/// profiles and a localhost fake provider under an outbound network sandbox.
#[test]
#[ignore = "requires installed Claude CLI and macOS sandbox-exec; no upstream calls"]
fn native_offline_resume_uses_target_snapshot_and_preserves_source_messages() {
    fn native_row(mut row: Value) -> Value {
        row["cwd"] = json!("/tmp/offline-fixture-cwd");
        row["timestamp"] = json!("2026-09-21T00:00:00.000Z");
        row["version"] = json!("2.1.275");
        row["isSidechain"] = json!(false);
        row
    }
    let original = json!({"type":"attachment","uuid":SECOND,"parentUuid":FIRST,"sessionId":SESSION,
        "attachment":{"type":"prompt_snapshot","systemPrompt":["OLD_SNAPSHOT_MARKER"],
        "tools":[{"name":"Read","description":"OLD_TOOL_MARKER","schema":{"type":"object","properties":{}}}]}});
    let original = native_row(original);
    let first = native_row(serde_json::from_slice(&message(FIRST, None)).unwrap());
    let base = append(line(first), line(original.clone()));
    let user = json!({"type":"user","uuid":THIRD,"parentUuid":SECOND,"sessionId":SESSION,
        "message":{"role":"user","content":"PACKAGE_USER_CONTEXT_MARKER"}});
    let fourth = "d174ae0a-129b-4410-8c88-ae429738d2e9";
    let fifth = "f174ae0a-129b-4410-8c88-ae429738d2e9";
    let mut changed = snapshot(fourth, THIRD, "SOURCE_PACKAGE_PROMPT_MARKER");
    changed["attachment"]["tools"] = json!([{"name":"Read","description":"SOURCE_PACKAGE_TOOL_MARKER","schema":{"type":"object","properties":{}}}]);
    let deferred_id = "0174ae0a-129b-4410-8c88-ae429738d2e9";
    let deferred = json!({"type":"attachment","uuid":deferred_id,"parentUuid":fourth,"sessionId":SESSION,"attachment":{"type":"deferred_tools_delta","addedNames":["SOURCE_DEFERRED_RUNTIME_MARKER"],"addedLines":["SOURCE_DEFERRED_RUNTIME_MARKER"],"removedNames":[],"wireHiddenNames":[],"readdedNames":[],"pendingMcpServers":[],"needsAuthMcpServers":[],"failedMcpServers":[],"surfacedNames":[]}});
    let assistant = json!({"type":"assistant","uuid":fifth,"parentUuid":deferred_id,"sessionId":SESSION,
        "message":{"role":"assistant","type":"message","id":"msg_package","model":"claude-sonnet-4-6",
        "content":[{"type":"text","text":"PACKAGE_ASSISTANT_CONTEXT_MARKER"}],"stop_reason":"end_turn",
        "usage":{"input_tokens":1,"output_tokens":1}}});
    let checkpoint = json!({"type":"last-prompt","sessionId":SESSION,"leafUuid":fifth,"lastPrompt":"PACKAGE_USER_CONTEXT_MARKER"});
    let user = native_row(user);
    let assistant = native_row(assistant);
    let suffix: Vec<u8> = [
        user.clone(),
        native_row(changed),
        native_row(deferred),
        assistant.clone(),
        checkpoint,
    ]
    .into_iter()
    .flat_map(line)
    .collect();
    let projected =
        records::project_conversation(&base, &suffix, &base, SESSION, &Budget::new()).unwrap();
    assert_eq!(projected.ledger.len(), 1);
    let parsed = records::rows(&projected.bytes, &Budget::new()).unwrap();
    assert_eq!(parsed[0], user);
    assert_eq!(parsed[1]["message"], assistant["message"]);
    assert_eq!(parsed[1]["uuid"], assistant["uuid"]);
    assert_eq!(parsed[1]["parentUuid"], user["uuid"]);
    let temp = tempfile::tempdir().unwrap();
    let fixture = temp.path().join("projected.jsonl");
    fs::write(&fixture, append(base, projected.bytes)).unwrap();
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/agent_sessions/cli/native_materializer/claude_history_handoff/offline_resume_fixture.py");
    let output = std::process::Command::new("python3")
        .arg(script)
        .env("ORG2_PROJECTED_FIXTURE", fixture)
        .output()
        .unwrap();
    eprintln!("{}", String::from_utf8_lossy(&output.stdout));
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn identical_source_snapshot_never_overrides_different_target_without_witness() {
    let original = snapshot(SECOND, FIRST, "primary system");
    let base = append(message(FIRST, None), line(original.clone()));
    let source = snapshot(THIRD, SECOND, "package system");
    let pair = Pair::new(&base, &append(base.clone(), line(source)));
    let trust = records::TargetSnapshot::capture(&base, SESSION, &Budget::new()).unwrap();
    assert_eq!(
        trusted_run(&pair, Some(&trust), None),
        Ok(Status::SyncedToPrimary)
    );
    let primary_before = fs::read(&pair.primary).unwrap();
    let suffix = line(snapshot(
        "d174ae0a-129b-4410-8c88-ae429738d2e9",
        THIRD,
        "package system",
    ));
    fs::write(
        &pair.package,
        append(fs::read(&pair.package).unwrap(), suffix),
    )
    .unwrap();
    assert_eq!(pair.run(), Err(Status::Unsupported));
    assert_eq!(fs::read(&pair.primary).unwrap(), primary_before);
    assert_eq!(
        trusted_run(&pair, Some(&trust), None),
        Ok(Status::SyncedToPrimary)
    );
}

#[test]
fn repeated_snapshot_projection_has_a_finite_expansion_budget() {
    let mut original = snapshot(SECOND, FIRST, "primary");
    original["attachment"]["systemPrompt"] = json!(["x".repeat(1024 * 1024)]);
    let base = append(message(FIRST, None), line(original.clone()));
    let trust = records::TargetSnapshot::capture(&base, SESSION, &Budget::new()).unwrap();
    let mut suffix = Vec::new();
    let mut parent = SECOND.to_owned();
    for _ in 0..17 {
        let id = Uuid::new_v4().to_string();
        suffix.extend(line(snapshot(&id, &parent, "small source")));
        parent = id;
    }
    assert!(matches!(
        records::project_with_snapshot(&base, &suffix, SESSION, &Budget::new(), Some(&trust)),
        Err(Status::Limit)
    ));
}

fn tool_pair(error: bool, ids: &[&str]) -> (Value, Value) {
    let call = json!({"type":"assistant","uuid":SECOND,"parentUuid":FIRST,"sessionId":SESSION,
        "message":{"role":"assistant","type":"message","id":"msg_tools","model":"claude-sonnet-4-6",
        "content":ids.iter().map(|id| json!({"type":"tool_use","id":id,"name":"Read","input":{"file_path":"/tmp/never-replay-history"}})).collect::<Vec<_>>(),
        "stop_reason":"tool_use","usage":{"input_tokens":1,"output_tokens":1}}});
    let result = json!({"type":"user","uuid":THIRD,"parentUuid":SECOND,"sessionId":SESSION,"toolUseResult":"local derived metadata",
        "message":{"role":"user","content":ids.iter().map(|id| json!({"type":"tool_result","tool_use_id":id,"content":"HISTORICAL_RESULT_MARKER","is_error":error})).collect::<Vec<_>>()}});
    (call, result)
}
#[test]
fn completed_tool_pairs_preserve_messages_without_replaying_local_metadata() {
    for error in [false, true] {
        let base = message(FIRST, None);
        let (call, result) = tool_pair(error, &["one", "two"]);
        let suffix = append(line(call.clone()), line(result.clone()));
        let pair = Pair::new(&base, &append(base.clone(), suffix));
        assert_eq!(pair.run(), Ok(Status::SyncedToPrimary));
        assert_eq!(pair.run(), Ok(Status::Clean));
        let rows = records::rows(&fs::read(&pair.primary).unwrap(), &Budget::new()).unwrap();
        assert_eq!(rows[1], call);
        assert_eq!(rows[2]["message"], result["message"]);
        assert!(rows[2].get("toolUseResult").is_none());
        let fourth = "d174ae0a-129b-4410-8c88-ae429738d2e9";
        fs::write(
            &pair.primary,
            append(
                fs::read(&pair.primary).unwrap(),
                message(fourth, Some(THIRD)),
            ),
        )
        .unwrap();
        assert_eq!(pair.run(), Ok(Status::SyncedToPackage));
        assert_eq!(pair.run(), Ok(Status::Clean));
    }
}
#[test]
fn pending_unknown_duplicate_and_wrong_role_tool_records_are_refused() {
    let base = message(FIRST, None);
    let (call, result) = tool_pair(false, &["one"]);
    assert_eq!(
        records::validate(
            &append(base.clone(), line(call.clone())),
            SESSION,
            &Budget::new()
        ),
        Err(Status::Unsupported)
    );
    for invalid in ["unknown", "duplicate", "wrong_role", "new_image_result"] {
        let mut result = result.clone();
        match invalid {
            "unknown" => result["message"]["content"][0]["tool_use_id"] = json!("other"),
            "duplicate" => {
                let duplicate = result["message"]["content"][0].clone();
                result["message"]["content"]
                    .as_array_mut()
                    .unwrap()
                    .push(duplicate);
            }
            "wrong_role" => {
                result["type"] = json!("assistant");
                result["message"]["role"] = json!("assistant");
            }
            _ => result["message"]["content"][0]["content"] = json!([{"type":"image","source":{}}]),
        }
        let bytes = append(append(base.clone(), line(call.clone())), line(result));
        assert!(
            records::validate(&bytes, SESSION, &Budget::new()).is_err(),
            "{invalid}"
        );
    }
    let (mut duplicate, result) = tool_pair(false, &["one", "one"]);
    assert_eq!(
        records::validate(
            &append(append(base.clone(), line(duplicate.clone())), line(result)),
            SESSION,
            &Budget::new()
        ),
        Err(Status::Conflict)
    );
    duplicate["message"]["content"] =
        json!([{"type":"tool_use","id":"one","name":"Read","input":{}}]);
    let pending = append(base.clone(), line(duplicate));
    assert!(
        records::project(
            &pending,
            &message(THIRD, Some(SECOND)),
            SESSION,
            &Budget::new()
        )
        .is_err()
    );
}
#[test]
fn target_snapshot_witness_binds_entire_current_file_and_session() {
    let base = append(
        message(FIRST, None),
        line(snapshot(
            SECOND,
            FIRST,
            "existing imported or native prompt",
        )),
    );
    let witness = records::TargetSnapshot::capture(&base, SESSION, &Budget::new()).unwrap();
    assert_eq!(witness.verify(&base, &Budget::new()), Ok(()));
    let changed = append(
        base.clone(),
        line(json!({"type":"mode","sessionId":SESSION,"mode":"normal"})),
    );
    assert_eq!(
        witness.verify(&changed, &Budget::new()),
        Err(Status::Changed)
    );
    assert!(records::TargetSnapshot::capture(&base, FIRST, &Budget::new()).is_err());
}

#[test]
fn paths_cannot_escape_scope_via_parent_components_or_links() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    assert_eq!(
        storage::safe(&root, &root.join("child/../outside")),
        Err(Status::Changed)
    );
    assert_eq!(
        storage::safe(&root.join("child/.."), &root.join("child/../file")),
        Err(Status::Changed)
    );
    assert_eq!(
        storage::safe(Path::new("relative"), Path::new("relative/file")),
        Err(Status::Changed)
    );
    #[cfg(unix)]
    {
        let base = message(FIRST, None);
        let pair = Pair::new(&base, &base);
        let original = pair.primary.with_file_name("original.jsonl");
        fs::rename(&pair.primary, &original).unwrap();
        std::os::unix::fs::symlink(&original, &pair.primary).unwrap();
        assert_eq!(pair.run(), Err(Status::Changed));
        fs::remove_file(&pair.primary).unwrap();
        fs::hard_link(&original, &pair.primary).unwrap();
        assert_eq!(pair.run(), Err(Status::Changed));
        fs::remove_file(&pair.primary).unwrap();
        fs::rename(&original, &pair.primary).unwrap();
        let lock = pair.primary.with_file_name(".primary.jsonl.orgii.lock");
        if lock.exists() {
            fs::remove_file(&lock).unwrap();
        }
        std::os::unix::fs::symlink(&pair.package, &lock).unwrap();
        assert_eq!(pair.run(), Err(Status::Changed));
    }
}

#[test]
#[ignore = "requires installed Claude CLI and macOS sandbox-exec; no upstream calls"]
fn native_offline_completed_tools_do_not_execute_when_resumed() {
    fn native_row(mut row: Value) -> Value {
        row["cwd"] = json!("/tmp/offline-fixture-cwd");
        row["timestamp"] = json!("2026-09-21T00:00:00.000Z");
        row["version"] = json!("2.1.275");
        row["isSidechain"] = json!(false);
        row
    }
    let base = line(native_row(
        serde_json::from_slice(&message(FIRST, None)).unwrap(),
    ));
    let (call, result) = tool_pair(false, &["tool_historical_one"]);
    let fourth = "d174ae0a-129b-4410-8c88-ae429738d2e9";
    let done = native_row(
        json!({"type":"assistant","uuid":fourth,"parentUuid":THIRD,"sessionId":SESSION,
        "message":{"role":"assistant","type":"message","id":"msg_old_done","model":"claude-sonnet-4-6",
        "content":[{"type":"text","text":"HISTORICAL_ASSISTANT_CONTEXT"}],"stop_reason":"end_turn",
        "usage":{"input_tokens":1,"output_tokens":1}}}),
    );
    let suffix = [
        native_row(call),
        native_row(result),
        done,
        json!({"type":"last-prompt","sessionId":SESSION,"leafUuid":fourth,"lastPrompt":"fixture"}),
    ]
    .into_iter()
    .flat_map(line)
    .collect::<Vec<_>>();
    let projected = records::project(&base, &suffix, SESSION, &Budget::new()).unwrap();
    let temp = tempfile::tempdir().unwrap();
    let fixture = temp.path().join("projected-tools.jsonl");
    fs::write(&fixture, append(base, projected)).unwrap();
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/agent_sessions/cli/native_materializer/claude_history_handoff/offline_completed_tools_fixture.py");
    let output = std::process::Command::new("python3")
        .arg(script)
        .env("ORG2_PROJECTED_TOOL_FIXTURE", fixture)
        .output()
        .unwrap();
    eprintln!("{}", String::from_utf8_lossy(&output.stdout));
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

struct CatalogFixture {
    _temp: tempfile::TempDir,
    profile: NativeAppProfile,
    roots: Roots,
    cwd: PathBuf,
}
impl CatalogFixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().canonicalize().unwrap();
        let roots = Roots {
            official: home.join("official/sessions"),
            isolated: home.join("package/sessions"),
            primary: home.join("primary-history"),
            package: home.join("package-history"),
            state: home.join("state"),
        };
        let cwd = home.join("project");
        for root in [&roots.official, &roots.isolated] {
            let account = root.join(FIRST);
            fs::create_dir_all(account.join(SECOND)).unwrap();
            fs::write(
                root.parent().unwrap().join("config.json"),
                serde_json::to_vec(&json!({"lastKnownAccountUuid": FIRST})).unwrap(),
            )
            .unwrap();
            if root == &roots.isolated {
                fs::write(
                    account.join(format!("{SECOND}.profile-origin.json")),
                    serde_json::to_vec(&json!({"mode":"local", "org":SECOND})).unwrap(),
                )
                .unwrap();
            }
            for id in [SESSION, THIRD] {
                fs::write(account.join(SECOND).join(format!("{id}.json")), serde_json::to_vec(&json!({"cliSessionId":id,"sessionId":format!("local_{id}"),"cwd":cwd,"title":"Existing history"})).unwrap()).unwrap();
            }
        }
        for root in [&roots.primary, &roots.package] {
            let project = root
                .join("projects")
                .join(sanitize_claude_project_name(&cwd));
            fs::create_dir_all(&project).unwrap();
            for id in [SESSION, THIRD] {
                let first = json!({"type":"user","uuid":FIRST,"parentUuid":null,"sessionId":id,"cwd":cwd,"message":{"role":"user","content":"context"}});
                let second = json!({"type":"user","uuid":SECOND,"parentUuid":FIRST,"sessionId":id,"cwd":cwd,"message":{"role":"user","content":"continuation"}});
                let data = if root == &roots.package {
                    append(line(first), line(second))
                } else {
                    line(first)
                };
                fs::write(project.join(format!("{id}.jsonl")), data).unwrap();
            }
        }
        Self {
            _temp: temp,
            profile: NativeAppProfile::new(
                "claude_desktop",
                "https://example.invalid",
                "history-test",
            )
            .unwrap(),
            roots,
            cwd,
        }
    }
    fn transcript(&self, root: &Path, id: &str) -> PathBuf {
        root.join("projects")
            .join(sanitize_claude_project_name(&self.cwd))
            .join(format!("{id}.jsonl"))
    }
    fn run(
        &self,
        selected: Option<&str>,
        owner: impl Fn() -> Result<(), Status>,
        writers: impl Fn() -> Result<(), Status>,
    ) -> Report {
        run_at(
            &self.profile,
            "test-owner",
            selected,
            if selected.is_some() {
                Mode::Sync
            } else {
                Mode::Inspect
            },
            owner,
            writers,
            &self.roots,
        )
    }
}
#[test]
fn preview_parses_without_any_file_mutation_then_syncs_only_selected_uuid() {
    let fixture = CatalogFixture::new();
    fn snapshot(root: &Path) -> std::collections::BTreeMap<PathBuf, Vec<u8>> {
        let mut files = std::collections::BTreeMap::new();
        for entry in fs::read_dir(root).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                files.extend(snapshot(&path));
            } else {
                files.insert(path.clone(), fs::read(path).unwrap());
            }
        }
        files
    }
    let before = snapshot(fixture._temp.path());
    let report = fixture.run(
        None,
        || Ok(()),
        || panic!("read-only preview does not inspect writers"),
    );
    assert_eq!(report.items.len(), 2);
    assert!(report.items.iter().all(|item| item.status == Status::Ready));
    assert_eq!(snapshot(fixture._temp.path()), before);
    assert!(!fixture.roots.state.exists());
    let untouched = fixture.transcript(&fixture.roots.primary, THIRD);
    let prior = fs::read(&untouched).unwrap();
    let report = fixture.run(Some(SESSION), || Ok(()), || Ok(()));
    assert_eq!(report.items.len(), 1);
    assert_eq!(report.items[0].status, Status::SyncedToPrimary);
    assert_eq!(fs::read(untouched).unwrap(), prior);
    assert_eq!(
        fixture
            .run(None, || Ok(()), || Ok(()))
            .items
            .iter()
            .find(|item| item.session_id == SESSION)
            .unwrap()
            .status,
        Status::Clean
    );
}
#[test]
fn owner_or_account_change_before_commit_preserves_transcripts_and_clears_titles() {
    let fixture = CatalogFixture::new();
    let primary = fixture.transcript(&fixture.roots.primary, SESSION);
    let before = fs::read(&primary).unwrap();
    let calls = std::cell::Cell::new(0);
    let report = fixture.run(
        Some(SESSION),
        || {
            calls.set(calls.get() + 1);
            if calls.get() == 2 {
                Err(Status::ScopeChanged)
            } else {
                Ok(())
            }
        },
        || Ok(()),
    );
    assert_eq!(report.status, Status::ScopeChanged);
    assert!(report.items.is_empty());
    assert_eq!(fs::read(&primary).unwrap(), before);
    let report = fixture.run(
        Some(SESSION),
        || Ok(()),
        || {
            fs::write(
                fixture.roots.official.parent().unwrap().join("config.json"),
                serde_json::to_vec(&json!({"lastKnownAccountUuid":THIRD})).unwrap(),
            )
            .unwrap();
            Ok(())
        },
    );
    assert_eq!(report.status, Status::ScopeChanged);
    assert!(report.items.is_empty());
    assert_eq!(fs::read(primary).unwrap(), before);
}

#[test]
fn conversation_projection_closes_queues_and_never_exports_runtime_records() {
    let base = message(FIRST, None);
    let runtime = json!({"type":"attachment","uuid":SECOND,"parentUuid":FIRST,"sessionId":SESSION,"attachment":{"type":"sandbox_instructions","content":"source-only rules"}});
    let mut user: Value = serde_json::from_slice(&message(THIRD, Some(SECOND))).unwrap();
    user["permissionMode"] = json!("bypassPermissions");
    let enqueued = json!({"type":"queue-operation","sessionId":SESSION,"operation":"enqueue","content":"fixture"});
    let dequeued = json!({"type":"queue-operation","sessionId":SESSION,"operation":"dequeue"});
    let suffix: Vec<u8> = [
        enqueued.clone(),
        dequeued.clone(),
        runtime.clone(),
        user.clone(),
    ]
    .into_iter()
    .flat_map(line)
    .collect();
    let output =
        records::project_conversation(&base, &suffix, &base, SESSION, &Budget::new()).unwrap();
    let rows = records::rows(&output.bytes, &Budget::new()).unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["uuid"], user["uuid"]);
    assert_eq!(rows[0]["message"], user["message"]);
    assert_eq!(rows[0]["parentUuid"], FIRST);
    assert!(rows[0].get("permissionMode").is_none());
    assert_eq!(output.ledger.len(), 1);
    for suffix in [
        line(enqueued.clone()),
        append(line(enqueued), line(dequeued)),
        append(
            line(runtime.clone()),
            line({
                let mut x = user.clone();
                x["message"]["content"] = json!([{"type":"thinking","thinking":"unverified"}]);
                x
            }),
        ),
    ] {
        assert!(
            records::project_conversation(&base, &suffix, &base, SESSION, &Budget::new()).is_err()
        );
    }
    let mut unknown = runtime;
    unknown["attachment"]["newPrivilege"] = json!(true);
    assert_eq!(
        records::project_conversation(
            &base,
            &append(line(unknown), line(user)),
            &base,
            SESSION,
            &Budget::new()
        )
        .err(),
        Some(Status::Unsupported)
    );
}

#[test]
#[ignore = "requires explicit read-only real transcript paths"]
fn real_conversation_projection_uses_production_scope_and_repeats_without_writes() {
    let primary_path = std::env::var_os("ORG2_AUDIT_PRIMARY_TRANSCRIPT").expect("primary path");
    let package_path = std::env::var_os("ORG2_AUDIT_PACKAGE_TRANSCRIPT").expect("package path");
    let a = fs::read(&primary_path).unwrap();
    let b = fs::read(&package_path).unwrap();
    let rows = records::rows(&a, &Budget::new()).unwrap();
    let first = rows.iter().find(|row| row["uuid"].is_string()).unwrap();
    let session = first["sessionId"].as_str().unwrap();
    let cwd = Path::new(first["cwd"].as_str().unwrap());
    let pair = Pair::new(&a, &b);
    let run = |preview| {
        storage::reconcile_scoped(
            pair.primary.parent().unwrap(),
            &pair.primary,
            pair.package.parent().unwrap(),
            &pair.package,
            &pair.state,
            session,
            &Budget::new(),
            &|| Ok(()),
            storage::Scope {
                binding: "offline-real-fixture",
                cwd,
            },
            preview,
        )
    };
    assert_eq!(run(true), Ok(Status::Ready));
    assert!(!pair.state.exists());
    assert_eq!(run(false), Ok(Status::SyncedToPrimary));
    assert_eq!(run(false), Ok(Status::Clean));
    let updated = fs::read(&pair.primary).unwrap();
    assert!(updated.starts_with(&a));
    let messages = |bytes: &[u8]| {
        records::rows(bytes, &Budget::new())
            .unwrap()
            .into_iter()
            .filter(|row| matches!(row["type"].as_str(), Some("user" | "assistant")))
            .map(|row| (row["uuid"].clone(), row["message"].clone()))
            .collect::<Vec<_>>()
    };
    assert_eq!(messages(&updated), messages(&b));
    assert_eq!(fs::read(primary_path).unwrap(), a);
    assert_eq!(fs::read(package_path).unwrap(), b);
    eprintln!(
        "production scoped real-copy projection: ready, synced, clean; all message UUIDs/payloads retained"
    );
}

#[test]
fn catalog_pairing_ignores_unmatched_ids_but_rejects_two_matching_rows() {
    let fixture = CatalogFixture::new();
    let official = fixture.roots.official.join(FIRST).join(SECOND);
    let local = fixture.roots.isolated.join(FIRST).join(SECOND);
    let mut row: Value =
        serde_json::from_slice(&fs::read(official.join(format!("{SESSION}.json"))).unwrap())
            .unwrap();
    row["sessionId"] = json!(format!("local_{FIRST}"));
    fs::write(
        official.join("000-unmatched.json"),
        serde_json::to_vec(&row).unwrap(),
    )
    .unwrap();
    let report = fixture.run(None, || Ok(()), || Ok(()));
    assert_eq!(report.items.len(), 2);
    assert_eq!(
        report
            .items
            .iter()
            .find(|item| item.session_id == SESSION)
            .unwrap()
            .status,
        Status::Ready
    );
    fs::write(
        local.join("duplicate.json"),
        serde_json::to_vec(&row).unwrap(),
    )
    .unwrap();
    let report = fixture.run(None, || Ok(()), || Ok(()));
    assert_eq!(report.status, Status::Conflict);
    assert!(!fixture.roots.state.exists());
    let primary = fixture.transcript(&fixture.roots.primary, SESSION);
    let before = fs::read(&primary).unwrap();
    let selected = fixture.run(Some(SESSION), || Ok(()), || Ok(()));
    assert_eq!(selected.status, Status::Conflict);
    assert_eq!(fs::read(&primary).unwrap(), before);
    assert!(!fixture.roots.state.exists());
}

#[test]
fn preview_exposes_safe_recovery_without_recovering_or_writing_anything() {
    for published in [false, true] {
        let fixture = CatalogFixture::new();
        let primary = fixture.transcript(&fixture.roots.primary, SESSION);
        let package = fixture.transcript(&fixture.roots.package, SESSION);
        let before = fs::read(&primary).unwrap();
        let source = fs::read(&package).unwrap();
        let report = fixture.run(
            Some(SESSION),
            || {
                if fs::read_dir(&fixture.roots.state).is_ok_and(|rows| {
                    rows.filter_map(Result::ok)
                        .any(|row| row.file_name().to_string_lossy().ends_with(".pending.json"))
                }) {
                    Err(Status::ScopeChanged)
                } else {
                    Ok(())
                }
            },
            || Ok(()),
        );
        assert_eq!(report.status, Status::ScopeChanged);
        if published {
            let projected = records::project_conversation(
                &before,
                &source[before.len()..],
                &before,
                SESSION,
                &Budget::new(),
            )
            .unwrap();
            fs::write(&primary, append(before.clone(), projected.bytes)).unwrap();
        }
        let current = fs::read(&primary).unwrap();
        let journal = fs::read_dir(&fixture.roots.state)
            .unwrap()
            .filter_map(Result::ok)
            .find(|row| row.file_name().to_string_lossy().ends_with(".pending.json"))
            .unwrap()
            .path();
        let journal_before = fs::read(&journal).unwrap();
        let report = fixture.run(None, || Ok(()), || panic!("preview writer guard"));
        assert_eq!(
            report
                .items
                .iter()
                .find(|item| item.session_id == SESSION)
                .unwrap()
                .status,
            Status::RecoveryReady
        );
        assert_eq!(fs::read(&journal).unwrap(), journal_before);
        assert_eq!(fs::read(&primary).unwrap(), current);
        let report = fixture.run(Some(SESSION), || Ok(()), || Ok(()));
        assert_eq!(
            report.items[0].status,
            if published {
                Status::Clean
            } else {
                Status::SyncedToPrimary
            }
        );
        assert!(!journal.exists());
        assert_eq!(
            fixture.run(Some(SESSION), || Ok(()), || Ok(())).items[0].status,
            Status::Clean
        );
    }
}

#[test]
fn production_body_projection_is_bidirectional_with_independent_parent_ledgers() {
    let fixture = CatalogFixture::new();
    let primary = fixture.transcript(&fixture.roots.primary, SESSION);
    let package = fixture.transcript(&fixture.roots.package, SESSION);
    let base = fs::read(&primary).unwrap();
    let runtime_id = "d174ae0a-129b-4410-8c88-ae429738d2e9";
    let runtime = |id: &str, parent: &str| json!({"type":"attachment","uuid":id,"parentUuid":parent,"sessionId":SESSION,"cwd":fixture.cwd,"attachment":{"type":"sandbox_instructions","content":"local runtime only"}});
    let mut user = records::rows(&fs::read(&package).unwrap(), &Budget::new()).unwrap()[1].clone();
    user["parentUuid"] = json!(runtime_id);
    fs::write(
        &package,
        append(append(base, line(runtime(runtime_id, FIRST))), line(user)),
    )
    .unwrap();
    assert_eq!(
        fixture.run(Some(SESSION), || Ok(()), || Ok(())).items[0].status,
        Status::SyncedToPrimary
    );
    assert_eq!(
        fixture.run(Some(SESSION), || Ok(()), || Ok(())).items[0].status,
        Status::Clean
    );
    let next_runtime = "f174ae0a-129b-4410-8c88-ae429738d2e9";
    let mut next: Value = serde_json::from_slice(&message(THIRD, Some(next_runtime))).unwrap();
    next["cwd"] = json!(fixture.cwd);
    fs::write(
        &primary,
        append(
            append(
                fs::read(&primary).unwrap(),
                line(runtime(next_runtime, SECOND)),
            ),
            line(next),
        ),
    )
    .unwrap();
    assert_eq!(
        fixture.run(Some(SESSION), || Ok(()), || Ok(())).items[0].status,
        Status::SyncedToPackage
    );
    assert_eq!(
        fixture.run(Some(SESSION), || Ok(()), || Ok(())).items[0].status,
        Status::Clean
    );
    let rows = records::rows(&fs::read(package).unwrap(), &Budget::new()).unwrap();
    assert_eq!(
        rows.iter().find(|row| row["uuid"] == THIRD).unwrap()["parentUuid"],
        SECOND
    );
    assert!(!rows.iter().any(|row| row["uuid"] == next_runtime));
}

#[test]
#[ignore = "explicit opt-in read-only current Desktop roster audit"]
fn real_roster_preview_reaches_selected_continuation_within_budget() {
    let scope = std::env::var("ORG2_AUDIT_PROFILE_SCOPE").expect("profile scope");
    let expected = std::env::var("ORG2_AUDIT_SESSION").expect("selected session");
    let profile: NativeAppProfile =
        serde_json::from_value(json!({"version":1,"agent":"claude_desktop","scope":scope}))
            .unwrap();
    let report = run(
        &profile,
        "read-only-roster-audit",
        None,
        Mode::List,
        || Ok(()),
        || panic!("preview must not inspect writers"),
    );
    let mut counts = std::collections::BTreeMap::new();
    for item in &report.items {
        *counts.entry(format!("{:?}", item.status)).or_insert(0usize) += 1;
    }
    eprintln!(
        "bounded real roster preview: {:?}; {} items; status counts {:?}",
        report.status,
        report.items.len(),
        counts
    );
    assert_eq!(
        report
            .items
            .iter()
            .find(|item| item.session_id == expected)
            .map(|item| item.status),
        Some(Status::Unchecked)
    );
    let inspected = run(
        &profile,
        "read-only-roster-audit",
        Some(&expected),
        Mode::Inspect,
        || Ok(()),
        || panic!("inspect must not inspect writers"),
    );
    eprintln!(
        "selected inspect: {:?}; {} items",
        inspected.status,
        inspected.items.len()
    );
    assert_eq!(inspected.items.len(), 1);
    assert_eq!(inspected.items[0].status, Status::Ready);
}

impl CatalogFixture {
    fn new_package_session(&self) -> PathBuf {
        let catalog = self
            .roots
            .official
            .join(FIRST)
            .join(SECOND)
            .join(format!("{SESSION}.json"));
        fs::remove_file(catalog).unwrap();
        let primary = self.transcript(&self.roots.primary, SESSION);
        fs::remove_file(primary).unwrap();
        self.roots
            .official
            .join(FIRST)
            .join(SECOND)
            .join(format!("local_{SESSION}.json"))
    }
    fn automatic(
        &self,
        dirty: Option<&HashSet<String>>,
        guard: impl Fn() -> Result<(), Status>,
    ) -> Report {
        automatic::run_at_automatic(
            &self.profile,
            "test-owner",
            dirty,
            guard,
            || Ok(()),
            &self.roots,
        )
    }
}

#[test]
fn automatic_registers_new_conversation_last_and_is_idempotent() {
    let fixture = CatalogFixture::new();
    let catalog = fixture.new_package_session();
    let dirty = HashSet::from([SESSION.to_owned()]);
    let local = fixture
        .roots
        .isolated
        .join(FIRST)
        .join(SECOND)
        .join(format!("{SESSION}.json"));
    let mut row: Value = serde_json::from_slice(&fs::read(&local).unwrap()).unwrap();
    row["permissionMode"] = json!("bypassPermissions");
    row["cuAllowedApps"] = json!(["Finder"]);
    fs::write(&local, serde_json::to_vec(&row).unwrap()).unwrap();
    let first = fixture.automatic(Some(&dirty), || Ok(()));
    assert_eq!(first.status, Status::Clean);
    assert_eq!(first.items[0].status, Status::SyncedToPrimary);
    let published: Value = serde_json::from_slice(&fs::read(&catalog).unwrap()).unwrap();
    assert_eq!(published["permissionMode"], "default");
    assert!(published.get("cuAllowedApps").is_none());
    assert_eq!(published["alwaysAllowedReasons"], json!([]));
    let bytes = fs::read(fixture.transcript(&fixture.roots.primary, SESSION)).unwrap();
    assert_eq!(
        fixture.automatic(Some(&dirty), || Ok(())).status,
        Status::Clean
    );
    assert_eq!(
        fs::read(fixture.transcript(&fixture.roots.primary, SESSION)).unwrap(),
        bytes
    );
}

#[test]
fn automatic_rejects_ambiguous_org_archived_duplicate_unknown_and_existing_transcript() {
    for scenario in ["org", "archived", "duplicate", "unknown", "transcript"] {
        let fixture = CatalogFixture::new();
        let catalog = fixture.new_package_session();
        let local = fixture
            .roots
            .isolated
            .join(FIRST)
            .join(SECOND)
            .join(format!("{SESSION}.json"));
        let source = fs::read(&local).unwrap();
        match scenario {
            "org" => fs::create_dir(fixture.roots.official.join(FIRST).join(THIRD)).unwrap(),
            "archived" => {
                let mut row: Value = serde_json::from_slice(&source).unwrap();
                row["isArchived"] = json!(true);
                fs::write(&catalog, serde_json::to_vec(&row).unwrap()).unwrap();
            }
            "duplicate" => {
                fs::write(local.with_file_name("duplicate.json"), &source).unwrap();
            }
            "unknown" => {
                let mut row: Value = serde_json::from_slice(&source).unwrap();
                row["unknownAuthority"] = json!(true);
                fs::write(&local, serde_json::to_vec(&row).unwrap()).unwrap();
            }
            "transcript" => fs::write(
                fixture.transcript(&fixture.roots.primary, SESSION),
                b"do not replace",
            )
            .unwrap(),
            _ => unreachable!(),
        }
        let report = fixture.automatic(Some(&HashSet::from([SESSION.to_owned()])), || Ok(()));
        assert!(
            matches!(report.status, Status::Conflict | Status::Unsupported),
            "{scenario}: {:?}",
            report.status
        );
        if scenario != "archived" {
            assert!(!catalog.exists(), "{scenario}");
        }
    }
}

#[test]
fn automatic_dirty_filter_never_parses_unrelated_transcript_and_empty_is_idle() {
    let fixture = CatalogFixture::new();
    fixture.new_package_session();
    fs::write(
        fixture.transcript(&fixture.roots.package, THIRD),
        b"unknown or unfinished",
    )
    .unwrap();
    assert_eq!(
        fixture.automatic(Some(&HashSet::new()), || Ok(())).status,
        Status::Clean
    );
    assert_eq!(
        fixture
            .automatic(Some(&HashSet::from([SESSION.to_owned()])), || Ok(()))
            .status,
        Status::Clean
    );
}

#[test]
fn automatic_owner_change_after_transcript_publish_recovers_before_catalog() {
    let fixture = CatalogFixture::new();
    let catalog = fixture.new_package_session();
    let primary = fixture.transcript(&fixture.roots.primary, SESSION);
    let dirty = HashSet::from([SESSION.to_owned()]);
    let failed = fixture.automatic(Some(&dirty), || {
        if primary.exists() {
            Err(Status::ScopeChanged)
        } else {
            Ok(())
        }
    });
    assert_eq!(failed.status, Status::ScopeChanged);
    assert!(primary.exists());
    assert!(!catalog.exists());
    assert_eq!(
        fixture.automatic(Some(&dirty), || Ok(())).status,
        Status::Clean
    );
    assert!(catalog.exists());
}

#[test]
fn new_conversation_projection_strips_runtime_and_keeps_audited_root() {
    let fixture = CatalogFixture::new();
    fixture.new_package_session();
    let runtime = json!({"type":"attachment", "uuid":THIRD, "parentUuid":null, "sessionId":SESSION,"cwd":fixture.cwd,
        "attachment":{"type":"prompt_snapshot","systemPrompt":"local instructions", "tools":[], "cliPrefix":[]}});
    let user = json!({"type":"user", "uuid":FIRST, "parentUuid":THIRD, "sessionId":SESSION,"cwd":fixture.cwd,
        "permissionMode":"bypassPermissions", "message":{"role":"user","content":"hello"}});
    fs::write(
        fixture.transcript(&fixture.roots.package, SESSION),
        append(line(runtime), line(user)),
    )
    .unwrap();
    let report = fixture.automatic(Some(&HashSet::from([SESSION.to_owned()])), || Ok(()));
    assert_eq!(report.status, Status::Clean);
    let bytes = fs::read(fixture.transcript(&fixture.roots.primary, SESSION)).unwrap();
    let text = String::from_utf8(bytes).unwrap();
    assert!(!text.contains("local instructions"));
    assert!(!text.contains("bypassPermissions"));
    assert_eq!(
        fixture
            .automatic(Some(&HashSet::from([SESSION.to_owned()])), || Ok(()))
            .status,
        Status::Clean
    );
}

#[test]
fn automatic_registration_never_overwrites_an_interrupted_result_that_changed() {
    let fixture = CatalogFixture::new();
    let catalog = fixture.new_package_session();
    let primary = fixture.transcript(&fixture.roots.primary, SESSION);
    let dirty = HashSet::from([SESSION.to_owned()]);
    assert_eq!(
        fixture
            .automatic(Some(&dirty), || if primary.exists() {
                Err(Status::ScopeChanged)
            } else {
                Ok(())
            })
            .status,
        Status::ScopeChanged
    );
    fs::write(&primary, b"external edit must survive").unwrap();
    assert_eq!(
        fixture.automatic(Some(&dirty), || Ok(())).status,
        Status::Conflict
    );
    assert_eq!(fs::read(&primary).unwrap(), b"external edit must survive");
    assert!(!catalog.exists());
}

#[test]
fn automatic_rejects_archived_uuid_in_inactive_account_and_busy_writer() {
    let fixture = CatalogFixture::new();
    let catalog = fixture.new_package_session();
    let inactive = fixture.roots.official.join(THIRD).join(SECOND);
    fs::create_dir_all(&inactive).unwrap();
    let local = fixture
        .roots
        .isolated
        .join(FIRST)
        .join(SECOND)
        .join(format!("{SESSION}.json"));
    let mut row: Value = serde_json::from_slice(&fs::read(local).unwrap()).unwrap();
    row["isArchived"] = json!(true);
    fs::write(
        inactive.join("archived.json"),
        serde_json::to_vec(&row).unwrap(),
    )
    .unwrap();
    assert_eq!(
        fixture
            .automatic(Some(&HashSet::from([SESSION.to_owned()])), || Ok(()))
            .status,
        Status::Conflict
    );
    assert!(!catalog.exists());
    let blocked = automatic::run_at_automatic(
        &fixture.profile,
        "test-owner",
        None,
        || Ok(()),
        || Err(Status::Busy),
        &fixture.roots,
    );
    assert_eq!(blocked.status, Status::Busy);
    assert!(!fixture.transcript(&fixture.roots.primary, SESSION).exists());
}

#[test]
fn automatic_account_switch_after_publication_keeps_catalog_unpublished() {
    let fixture = CatalogFixture::new();
    let catalog = fixture.new_package_session();
    let primary = fixture.transcript(&fixture.roots.primary, SESSION);
    let report = fixture.automatic(Some(&HashSet::from([SESSION.to_owned()])), || {
        if primary.exists() {
            fs::write(
                fixture.roots.official.parent().unwrap().join("config.json"),
                json!({"lastKnownAccountUuid":THIRD}).to_string(),
            )
            .unwrap();
        }
        Ok(())
    });
    assert_eq!(report.status, Status::ScopeChanged);
    assert!(!catalog.exists());
}

#[test]
fn automatic_new_conversation_reuses_same_baseline_for_both_continuations() {
    let fixture = CatalogFixture::new();
    fixture.new_package_session();
    let dirty = HashSet::from([SESSION.to_owned()]);
    assert_eq!(
        fixture.automatic(Some(&dirty), || Ok(())).status,
        Status::Clean
    );
    let primary = fixture.transcript(&fixture.roots.primary, SESSION);
    let package = fixture.transcript(&fixture.roots.package, SESSION);
    let continuation = json!({"type":"user","uuid":THIRD,"parentUuid":SECOND,"sessionId":SESSION,"cwd":fixture.cwd,"message":{"role":"user","content":"forward"}});
    fs::write(
        &package,
        append(fs::read(&package).unwrap(), line(continuation)),
    )
    .unwrap();
    let forward = fixture.automatic(Some(&dirty), || Ok(()));
    assert_eq!(forward.status, Status::Clean);
    assert_eq!(forward.items[0].status, Status::SyncedToPrimary);
    let next = json!({"type":"user","uuid":SESSION,"parentUuid":THIRD,"sessionId":SESSION,"cwd":fixture.cwd,"message":{"role":"user","content":"back"}});
    fs::write(&primary, append(fs::read(&primary).unwrap(), line(next))).unwrap();
    let backward = fixture.automatic(Some(&dirty), || Ok(()));
    assert_eq!(backward.status, Status::Clean);
    assert_eq!(backward.items[0].status, Status::SyncedToPackage);
    assert_eq!(
        fixture.automatic(Some(&dirty), || Ok(())).status,
        Status::Clean
    );
    let baselines = fs::read_dir(&fixture.roots.state)
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            name.ends_with(".json")
                && !name.ends_with(".register.json")
                && !name.ends_with(".pending.json")
        })
        .count();
    assert_eq!(baselines, 1);
}

#[test]
fn unknown_new_session_does_not_block_paired_continuation_or_vendor_manifests() {
    let fixture = CatalogFixture::new();
    let target = fixture.new_package_session();
    let local = fixture
        .roots
        .isolated
        .join(FIRST)
        .join(SECOND)
        .join(format!("{SESSION}.json"));
    let mut source: Value = serde_json::from_slice(&fs::read(&local).unwrap()).unwrap();
    source["unknownFutureControl"] = json!(true);
    fs::write(local, serde_json::to_vec(&source).unwrap()).unwrap();
    for root in [&fixture.roots.official, &fixture.roots.isolated] {
        fs::write(
            root.join(FIRST).join(SECOND).join("scheduled-tasks.json"),
            b"[]",
        )
        .unwrap();
        fs::create_dir(root.join(FIRST).join(SECOND).join("backlog")).unwrap();
    }
    let report = fixture.automatic(None, || Ok(()));
    assert_eq!(report.status, Status::Unsupported);
    assert!(
        report
            .items
            .iter()
            .any(|item| item.session_id == SESSION && item.status == Status::Unsupported)
    );
    assert!(
        report
            .items
            .iter()
            .any(|item| item.session_id == THIRD && item.status == Status::SyncedToPrimary)
    );
    assert!(!target.exists());
}

#[test]
fn observed_3p_runtime_metadata_keys_are_recognized_but_never_registered() {
    let fixture = CatalogFixture::new();
    let catalog = fixture.new_package_session();
    let local = fixture
        .roots
        .isolated
        .join(FIRST)
        .join(SECOND)
        .join(format!("{SESSION}.json"));
    let mut row: Value = serde_json::from_slice(&fs::read(&local).unwrap()).unwrap();
    // Keys observed in the real 3P catalog; fixture values are synthetic.
    let discarded = [
        "cliBinaryPin",
        "enabledMcpTools",
        "lastSpawnRootDetected",
        "latestUserFrameAt",
        "promptAppendSnapshot",
        "remoteControlAutoEligible",
        "reportFindingsCard",
        "spawnSeed",
        "titleTurn",
        "toolSurfaceSnapshot",
    ];
    for key in discarded {
        row[key] = json!({"fixture":"must stay local"});
    }
    fs::write(local, serde_json::to_vec(&row).unwrap()).unwrap();
    assert_eq!(
        fixture
            .automatic(Some(&HashSet::from([SESSION.to_owned()])), || Ok(()))
            .status,
        Status::Clean
    );
    let output: Value = serde_json::from_slice(&fs::read(catalog).unwrap()).unwrap();
    for key in discarded {
        assert!(output.get(key).is_none(), "{key}");
    }
}

#[test]
fn new_conversation_discards_audited_agent_listing_without_exporting_agent_context() {
    let fixture = CatalogFixture::new();
    fixture.new_package_session();
    let user = json!({"type":"user","uuid":FIRST,"parentUuid":null,"sessionId":SESSION,"cwd":fixture.cwd,
        "message":{"role":"user","content":"hello"}});
    let listing = json!({"type":"attachment","uuid":THIRD,"parentUuid":FIRST,"sessionId":SESSION,"cwd":fixture.cwd,
        "attachment":{"type":"agent_listing_delta","addedTypes":["local-agent"],"addedLines":["private-agent-instructions"],
        "removedTypes":[],"isInitial":true,"showConcurrencyNote":false}});
    let assistant = json!({"type":"assistant","uuid":SECOND,"parentUuid":THIRD,"sessionId":SESSION,"cwd":fixture.cwd,
        "message":{"role":"assistant","content":[{"type":"text","text":"hello back"}]}});
    let bytes = append(
        append(line(user.clone()), line(listing.clone())),
        line(assistant.clone()),
    );
    fs::write(fixture.transcript(&fixture.roots.package, SESSION), &bytes).unwrap();
    let report = fixture.automatic(None, || Ok(()));
    assert_eq!(report.status, Status::Clean);
    let output = fs::read(fixture.transcript(&fixture.roots.primary, SESSION)).unwrap();
    let projected = records::rows(&output, &Budget::new()).unwrap();
    assert!(!String::from_utf8_lossy(&output).contains("private-agent-instructions"));
    assert!(!projected.iter().any(|r| r["type"] == "attachment"));
    assert_eq!(
        projected.iter().find(|r| r["uuid"] == SECOND).unwrap()["parentUuid"],
        FIRST
    );
    assert_eq!(fixture.automatic(None, || Ok(())).status, Status::Clean);
    let mut unknown = listing;
    unknown["attachment"]["permissionOverride"] = json!(true);
    let bad = append(append(line(user), line(unknown)), line(assistant));
    assert!(matches!(
        records::project_conversation(&[], &bad, &[], SESSION, &Budget::new()),
        Err(Status::Unsupported)
    ));
}

#[test]
fn automatic_registration_preserves_deliberate_title_provenance() {
    for (source, expected) in [
        ("user", "user"),
        ("tool", "tool"),
        ("auto", "auto"),
        ("future-source", "auto"),
    ] {
        let fixture = CatalogFixture::new();
        let target = fixture.new_package_session();
        let local = fixture
            .roots
            .isolated
            .join(FIRST)
            .join(SECOND)
            .join(format!("{SESSION}.json"));
        let mut row: Value = serde_json::from_slice(&fs::read(&local).unwrap()).unwrap();
        row["titleSource"] = json!(source);
        fs::write(&local, serde_json::to_vec(&row).unwrap()).unwrap();
        assert_eq!(fixture.automatic(None, || Ok(())).status, Status::Clean);
        let registered: Value = serde_json::from_slice(&fs::read(target).unwrap()).unwrap();
        assert_eq!(registered["titleSource"], expected);
        // Official updateSession protects user/tool titles from auto generation.
        assert_eq!(
            matches!(registered["titleSource"].as_str(), Some("user" | "tool")),
            matches!(source, "user" | "tool")
        );
    }
}

#[test]
fn automatic_return_discards_advisor_metadata_and_accepts_only_empty_transformations() {
    let fixture = CatalogFixture::new();
    fixture.new_package_session();
    assert_eq!(fixture.automatic(None, || Ok(())).status, Status::Clean);
    let primary = fixture.transcript(&fixture.roots.primary, SESSION);
    let original = fs::read(&primary).unwrap();
    let rows = records::rows(&original, &Budget::new()).unwrap();
    let parent = rows.iter().rev().find(|r| r["uuid"].is_string()).unwrap()["uuid"].clone();
    let user = json!({"type":"user","uuid":THIRD,"parentUuid":parent,"sessionId":SESSION,"cwd":fixture.cwd,
        "message":{"role":"user","content":"return question"}});
    let assistant = json!({"type":"assistant","uuid":"55555555-5555-4555-8555-555555555555","parentUuid":THIRD,"sessionId":SESSION,"cwd":fixture.cwd,
        "advisorModel":"local-advisor","message":{"role":"assistant","content":[{"type":"text","text":"return answer"}],"input_transformations":[]}});
    fs::write(
        &primary,
        append(
            append(original, line(user.clone())),
            line(assistant.clone()),
        ),
    )
    .unwrap();
    assert_eq!(fixture.automatic(None, || Ok(())).status, Status::Clean);
    let target = fs::read(fixture.transcript(&fixture.roots.package, SESSION)).unwrap();
    let records = records::rows(&target, &Budget::new()).unwrap();
    let result = records
        .iter()
        .find(|r| r["uuid"] == assistant["uuid"])
        .unwrap();
    assert_eq!(result["message"], assistant["message"]);
    assert!(result.get("advisorModel").is_none());
    assert_eq!(fixture.automatic(None, || Ok(())).status, Status::Clean);
    let mut root = user;
    root["parentUuid"] = Value::Null;
    for invalid in [json!(null), json!(12), json!({"model":"local"})] {
        let mut bad = assistant.clone();
        bad["advisorModel"] = invalid;
        assert!(matches!(
            records::project_conversation(
                &[],
                &append(line(root.clone()), line(bad)),
                &[],
                SESSION,
                &Budget::new()
            ),
            Err(Status::Unsupported)
        ));
    }
    let mut bad = assistant;
    bad["message"]["input_transformations"] = json!([{"type":"unknown"}]);
    assert!(matches!(
        records::project_conversation(
            &[],
            &append(line(root), line(bad)),
            &[],
            SESSION,
            &Budget::new()
        ),
        Err(Status::Unsupported)
    ));
}
