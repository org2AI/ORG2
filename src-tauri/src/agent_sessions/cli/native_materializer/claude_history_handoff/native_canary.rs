//! Invoke isolated vendor CLI fixtures, then validate its actual persisted output
//! after real production raw handoffs into alternating disposable native homes.
use super::*;

pub(super) fn run(name: &str, script: &str, fixture: Option<&Path>) {
    let temp = tempfile::tempdir().unwrap();
    let captures = std::env::var_os("ORG2_CLAUDE_CANARY_OUTPUT")
        .map(PathBuf::from)
        .unwrap_or_else(|| temp.path().to_path_buf())
        .join(name);
    fs::create_dir_all(&captures).unwrap();
    let script = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src/agent_sessions/cli/native_materializer/claude_history_handoff")
        .join(script);
    let output = std::process::Command::new("python3")
        .arg(script)
        .envs(fixture.map(|path| ("ORG2_PROJECTED_FIXTURE", path)))
        .env(
            "ORG2_CLAUDE_STORAGE_BRIDGE_EXE",
            std::env::current_exe().unwrap(),
        )
        .env(
            "ORG2_CLAUDE_STORAGE_BRIDGE_TEST",
            format!(
                "{}::native_storage_bridge",
                module_path!()
                    .split_once("::")
                    .unwrap()
                    .1
                    .rsplit_once("::")
                    .unwrap()
                    .0
            ),
        )
        .env("ORG2_NATIVE_TRANSCRIPT_OUTPUT", &captures)
        .output();
    let (status, detail, snapshots) = match output {
        Err(error) => (
            "infrastructure_error",
            format!("Cannot start fixture: {error}"),
            0,
        ),
        Ok(output) => {
            eprintln!("{}", String::from_utf8_lossy(&output.stdout));
            if !output.status.success() && !output.stderr.is_empty() {
                // These fixtures contain only synthetic homes and loopback data.
                let tail = &output.stderr[output.stderr.len().saturating_sub(4096)..];
                eprintln!(
                    "native fixture diagnostics: {}",
                    String::from_utf8_lossy(tail)
                );
            }
            let report = fs::read(captures.join("fixture-result.json"))
                .ok()
                .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
            match report {
                None => ("infrastructure_error", "Fixture did not produce its result manifest".into(), 0),
                Some(report) if !output.status.success() => (
                    if report["status"] == "incompatible" { "incompatible" } else { "infrastructure_error" },
                    report["detail"].as_str().unwrap_or("Native fixture failed").to_owned(), 0,
                ),
                Some(report) => match validate_capture(&captures, name, &report) {
                    Ok(count) => ("pass", "Raw production handoffs were consumed by independent native homes; native resumes and target configuration checks passed".into(), count),
                    Err(error) => ("incompatible", error, 0),
                },
            }
        }
    };
    let native_report = fs::read(captures.join("fixture-result.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .unwrap_or(Value::Null);
    let report = json!({"fixture":name,"status":status,"detail":detail,"validatedNativeSnapshots":snapshots,
        "rawBytesPreserved":native_report["rawBytesPreserved"],"nativeHandoffs":native_report["nativeHandoffs"],
        "nativeResumes":native_report["nativeResumes"],"targetConfigurationPreserved":native_report["targetConfigurationPreserved"],
        "scope":"production_raw_storage_native_roundtrip","nativeGuiTested":false,"productConfigureTested":false});
    fs::write(
        captures.join("adapter-result.json"),
        serde_json::to_vec_pretty(&report).unwrap(),
    )
    .unwrap();
    eprintln!("ORG2_CLAUDE_NATIVE_ADAPTER_RESULT={report}");
    assert_eq!(status, "pass", "{detail}");
}

fn read_capture(root: &Path, value: &Value) -> Result<Vec<u8>, String> {
    let name = value.as_str().ok_or("Missing native capture filename")?;
    if name.is_empty() || name.contains(['/', '\\']) || !name.ends_with(".jsonl") {
        return Err("Invalid native capture filename".into());
    }
    let path = root.join(name);
    let metadata = fs::symlink_metadata(&path).map_err(|_| "Native writeback was not captured")?;
    if !metadata.is_file() || metadata.len() > 16 * 1024 * 1024 {
        return Err("Native writeback is not a bounded regular transcript".into());
    }
    fs::read(path).map_err(|_| "Cannot read native writeback".into())
}

fn validate_capture(root: &Path, fixture: &str, report: &Value) -> Result<usize, String> {
    let cases = report["cases"].as_array().ok_or("Missing native cases")?;
    let expected: &[&str] = if fixture == "resume" {
        &["resume"]
    } else {
        &[
            "calibration",
            "success",
            "error",
            "parallel",
            "text_blocks",
            "bash",
            "edit",
            "write",
            "glob",
            "grep",
        ]
    };
    if report["status"] != "pass"
        || cases.len() != expected.len()
        || cases
            .iter()
            .zip(expected)
            .any(|(case, name)| case["name"] != *name)
    {
        return Err("Native fixture did not run the complete case matrix".into());
    }
    if report["rawBytesPreserved"] != true
        || report["targetConfigurationPreserved"] != true
        || report["nativeHandoffs"].as_u64().unwrap_or(0) < 2
        || report["nativeResumes"].as_u64().unwrap_or(0) < 2
    {
        return Err(
            "Missing executed raw handoff, native resume, or target configuration evidence".into(),
        );
    }
    let handoffs = report["handoffs"]
        .as_array()
        .ok_or("Missing handoff receipts")?;
    if handoffs.len() as u64 != report["nativeHandoffs"].as_u64().unwrap_or(0)
        || handoffs.iter().any(|handoff| {
            handoff["rawBytesPreserved"] != true
                || handoff["targetConfigurationPreserved"] != true
                || handoff["source"] != handoff["target"]
                || !matches!(
                    handoff["status"].as_str(),
                    Some("synced_to_primary" | "synced_to_package")
                )
        })
    {
        return Err("Native handoff receipt matrix is incomplete".into());
    }
    let mut validated = 0;
    for case in cases {
        let name = case["name"].as_str().ok_or("Missing case name")?;
        let session = case["session"]
            .as_str()
            .ok_or("Missing native session identity")?;
        let before = read_capture(root, &case["baseline"])?;
        records::validate(&before, session, &Budget::new())
            .map_err(|status| format!("{name}: invalid initial native session: {status:?}"))?;
        let snapshots = case["snapshots"]
            .as_array()
            .ok_or("Missing native writebacks")?;
        let expected = if name == "calibration" { 1 } else { 2 };
        if snapshots.len() != expected
            || handoffs
                .iter()
                .filter(|handoff| handoff["case"] == name)
                .count()
                != expected
        {
            return Err(format!(
                "{name}: incomplete production handoff/native resume matrix"
            ));
        }
        for snapshot in snapshots {
            let after = read_capture(root, snapshot)?;
            records::validate(&after, session, &Budget::new())
                .map_err(|status| format!("{name}: invalid native writeback: {status:?}"))?;
            validated += 1;
        }
    }
    if report["nativeResumes"].as_u64() != Some(validated as u64) {
        return Err("Native resume count does not match captures".into());
    }
    Ok(validated)
}
