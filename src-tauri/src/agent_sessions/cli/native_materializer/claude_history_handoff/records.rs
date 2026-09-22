//! Offline, single-branch continuation projection. Runtime controls stay local.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashSet;

use super::{Budget, Status};

pub(super) fn rows(bytes: &[u8], budget: &Budget) -> Result<Vec<Value>, Status> {
    if bytes.is_empty() || bytes.last() != Some(&b'\n') {
        return Err(Status::Incomplete);
    }
    bytes
        .split(|b| *b == b'\n')
        .filter(|line| !line.is_empty())
        .map(|line| {
            budget.check()?;
            let value: Value = serde_json::from_slice(line).map_err(|_| Status::Unsupported)?;
            value
                .is_object()
                .then_some(value)
                .ok_or(Status::Unsupported)
        })
        .collect()
}

fn fields(row: &Value, allowed: &[&str]) -> Result<(), Status> {
    if row
        .as_object()
        .is_some_and(|r| r.keys().all(|k| allowed.contains(&k.as_str())))
    {
        Ok(())
    } else {
        Err(Status::Unsupported)
    }
}

const COMMON: &[&str] = &[
    "type",
    "uuid",
    "parentUuid",
    "sessionId",
    "timestamp",
    "cwd",
    "version",
    "gitBranch",
    "entrypoint",
    "userType",
    "isSidechain",
];
fn record_fields(row: &Value, extra: &[&str]) -> Result<(), Status> {
    let mut allowed = COMMON.to_vec();
    allowed.extend(extra);
    fields(row, &allowed)
}

fn attachment(value: &Value, existing: bool) -> Result<(), Status> {
    // Only the separately audited prompt projection crosses runtime scopes.
    // Even known instruction/environment/tool listings can affect a resumed
    // request and require their own native lifecycle fixture before export.
    if !existing && value["type"] != "prompt_snapshot" {
        return Err(Status::Unsupported);
    }
    let extra: &[&str] = match value["type"].as_str() {
        // These runtime-adjacent records may already exist in the common
        // baseline. Validate their ancestry without ever exporting new ones.
        Some("auto_mode") if existing => &[
            "autoModeConsentFlow",
            "bashFirst",
            "bashFirstSteer",
            "bypass",
            "steerOnly",
        ],
        Some("deferred_tools_delta") if existing => &[
            "addedLines",
            "addedNames",
            "failedMcpServers",
            "needsAuthMcpServers",
            "pendingMcpServers",
            "readdedNames",
            "removedNames",
            "surfacedNames",
            "wireHiddenNames",
        ],
        Some("deferred_tools_record") if existing => &["entries"],
        Some("agent_listing_delta") if existing => &[
            "addedLines",
            "addedTypes",
            "isInitial",
            "removedTypes",
            "showConcurrencyNote",
        ],
        Some("sandbox_instructions" | "total_tokens_reminder") => &["content", "text"],
        Some("environment") => &["snapshot", "changes"],
        Some("model") => &["identity", "text"],
        Some("mcp_instructions_delta") => &["addedNames", "addedBlocks", "removedNames"],
        Some("skill_listing") => &["content", "skillCount", "isInitial", "names"],
        Some("instructions") => &["files", "removed", "changed", "reason"],
        Some("session_context") => &["context", "changed", "reason"],
        Some("date") => &["date", "changed"],
        Some("remote_session_change") => &[
            "url",
            "commit",
            "pr",
            "sendUserFileHint",
            "managedCommit",
            "managedPr",
        ],
        Some("prompt_snapshot") => &["systemPrompt", "tools", "cliPrefix"],
        _ => return Err(Status::Unsupported),
    };
    let mut keys = vec!["type"];
    keys.extend(extra);
    fields(value, &keys)
}

#[derive(Default)]
struct Chain {
    ids: HashSet<String>,
    leaf: Option<String>,
    prompt_snapshot: Option<Value>,
    pending_tools: HashSet<String>,
    seen_tools: HashSet<String>,
}
impl Chain {
    // Applies to the baseline as well as the suffix: an old branch, rewind or
    // compaction is not a linear baseline just because the latest turn is simple.
    fn accept(&mut self, row: &Value, session: &str, existing: bool) -> Result<bool, Status> {
        let kind = row["type"].as_str().ok_or(Status::Unsupported)?;
        let local_fields: Option<&[&str]> = match kind {
            "queue-operation" => Some(&["operation", "timestamp", "content"]),
            "mode" => Some(&["mode"]),
            "atis-latch" => Some(&["atis"]),
            "custom-title" => Some(&["customTitle"]),
            "ai-title" => Some(&["aiTitle"]),
            "agent-name" => Some(&["agentName"]),
            "file-history-snapshot" => Some(&["messageId", "snapshot", "isSnapshotUpdate"]),
            _ => None,
        };
        if let Some(extra) = local_fields {
            let mut allowed = vec!["type", "sessionId"];
            allowed.extend(extra);
            fields(row, &allowed)?;
            if row
                .get("sessionId")
                .is_some_and(|v| v.as_str() != Some(session))
            {
                return Err(Status::Conflict);
            }
            return Ok(false); // Never requeue work, import permissions, undo snapshots, or rename the main conversation.
        }
        if row["sessionId"].as_str() != Some(session) {
            return Err(Status::Conflict);
        }
        if kind == "last-prompt" {
            fields(row, &["type", "sessionId", "lastPrompt", "leafUuid"])?;
            if self.leaf.is_none() || row["leafUuid"].as_str() != self.leaf.as_deref() {
                return Err(Status::Unsupported); // A checkpoint selecting an older branch is a rewind.
            }
            return Ok(true);
        }
        if row
            .get("isSidechain")
            .is_some_and(|v| v.as_bool() != Some(false))
        {
            return Err(Status::Unsupported);
        }
        match kind {
            "user" | "assistant" => {
                record_fields(
                    row,
                    &[
                        "message",
                        "permissionMode",
                        "toolUseResult",
                        "promptId",
                        "promptSource",
                        "origin",
                        "isMeta",
                        "apiBlockIndex",
                        "effort",
                        "perTurnEffort",
                        "advisorModel",
                        "error",
                        "isApiErrorMessage",
                        "requestId",
                    ],
                )?;
                // The observed assistant advisorModel is optional string provenance,
                // not a message block or permission/tool instruction.
                if row
                    .get("advisorModel")
                    .is_some_and(|v| kind != "assistant" || !v.is_string())
                {
                    return Err(Status::Unsupported);
                }
                if row["message"]["role"].as_str() != Some(kind) {
                    return Err(Status::Unsupported);
                }
                fields(
                    &row["message"],
                    &[
                        "role",
                        "content",
                        "id",
                        "type",
                        "model",
                        "stop_reason",
                        "stop_sequence",
                        "usage",
                        "container",
                        "context_management",
                        "diagnostics",
                        "stop_details",
                        "input_transformations",
                    ],
                )?;
                for key in ["container", "context_management", "stop_details"] {
                    if row["message"].get(key).is_some_and(|v| !v.is_null()) {
                        return Err(Status::Unsupported);
                    }
                }
                if row["message"]
                    .get("input_transformations")
                    .is_some_and(|v| !v.as_array().is_some_and(Vec::is_empty))
                {
                    return Err(Status::Unsupported);
                }
                let content = &row["message"]["content"];
                if let Some(blocks) = content.as_array() {
                    for block in blocks {
                        match block["type"].as_str() {
                            Some("text" | "thinking" | "redacted_thinking") => {
                                if !existing && block["type"] == "text" {
                                    fields(block, &["type", "text"])?;
                                    if !block["text"].is_string() {
                                        return Err(Status::Unsupported);
                                    }
                                }
                                if !self.pending_tools.is_empty() {
                                    return Err(Status::Unsupported);
                                }
                            }
                            Some("tool_use") if kind == "assistant" => {
                                fields(block, &["type", "id", "name", "input"])?;
                                let id = block["id"]
                                    .as_str()
                                    .filter(|id| !id.is_empty() && id.len() <= 256)
                                    .ok_or(Status::Unsupported)?;
                                if !block["name"]
                                    .as_str()
                                    .is_some_and(|name| !name.is_empty() && name.len() <= 128)
                                    || !block["input"].is_object()
                                {
                                    return Err(Status::Unsupported);
                                }
                                if !existing
                                    && !matches!(
                                        block["name"].as_str(),
                                        Some("Read" | "Bash" | "Edit" | "Write" | "Glob" | "Grep")
                                    )
                                {
                                    return Err(Status::Unsupported); // Agent/MCP/deferred tools need separate lifecycle evidence.
                                }
                                if !self.seen_tools.insert(id.to_owned()) {
                                    return Err(Status::Conflict);
                                }
                                self.pending_tools.insert(id.to_owned());
                            }
                            Some("tool_result") if kind == "user" => {
                                fields(block, &["type", "tool_use_id", "content", "is_error"])?;
                                let id =
                                    block["tool_use_id"].as_str().ok_or(Status::Unsupported)?;
                                if !self.pending_tools.remove(id) {
                                    return Err(Status::Conflict);
                                }
                                if block
                                    .get("is_error")
                                    .is_some_and(|error| !error.is_boolean())
                                {
                                    return Err(Status::Unsupported);
                                }
                                let result = &block["content"];
                                if !result.is_string()
                                    && !result.as_array().is_some_and(|blocks| {
                                        blocks.iter().all(|part| {
                                            part["type"] == "text"
                                                && part["text"].is_string()
                                                && fields(part, &["type", "text"]).is_ok()
                                        })
                                    })
                                {
                                    return Err(Status::Unsupported);
                                }
                            }
                            _ => return Err(Status::Unsupported),
                        }
                    }
                } else if !content.is_string() || !self.pending_tools.is_empty() {
                    return Err(Status::Unsupported);
                }
            }
            "attachment" => {
                record_fields(row, &["attachment", "rendered"])?;
                attachment(&row["attachment"], existing)?;
                if row["attachment"]["type"] == "prompt_snapshot" {
                    let snapshot = &row["attachment"];
                    self.prompt_snapshot = Some(snapshot.clone());
                }
            }
            "system" if row["subtype"] == "stop_hook_summary" => {
                record_fields(
                    row,
                    &[
                        "subtype",
                        "hookCount",
                        "hookInfos",
                        "hookErrors",
                        "hookAdditionalContext",
                        "preventedContinuation",
                        "stopReason",
                        "hasOutput",
                        "level",
                        "toolUseID",
                    ],
                )?;
            }
            _ => return Err(Status::Unsupported),
        }
        let id = row["uuid"]
            .as_str()
            .filter(|id| uuid::Uuid::parse_str(id).is_ok())
            .ok_or(Status::Unsupported)?;
        if !self.ids.insert(id.to_owned()) || row["parentUuid"].as_str() != self.leaf.as_deref() {
            return Err(Status::Conflict);
        }
        self.leaf = Some(id.to_owned());
        Ok(true)
    }
}

pub(super) fn validate(bytes: &[u8], session: &str, budget: &Budget) -> Result<(), Status> {
    let mut chain = Chain::default();
    for row in rows(bytes, budget)? {
        chain.accept(&row, session, true)?;
    }
    if chain.leaf.is_none() || !chain.pending_tools.is_empty() {
        return Err(Status::Unsupported);
    }
    Ok(())
}

#[cfg(test)]
pub(super) fn project(
    prefix: &[u8],
    suffix: &[u8],
    session: &str,
    budget: &Budget,
) -> Result<Vec<u8>, Status> {
    Ok(project_with_snapshot(prefix, suffix, session, budget, None)?.bytes)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Projection {
    pub parent_only: bool,
    pub uuid: String,
    pub source_hash: String,
    pub target_hash: String,
    pub basis_uuid: String,
    pub basis_hash: String,
}

pub(super) fn digest(row: &Value) -> Result<String, Status> {
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(row).map_err(|_| Status::Unsupported)?)
    ))
}

/// The destination's current effective snapshot, captured in a controlled
/// writer-free window. This preserves existing default-resume behavior; it
/// does not claim that the snapshot originally came from this profile.
/// The caller separately verifies destination root/account/session/cwd scope.
#[derive(Clone)]
pub(super) struct TargetSnapshot {
    pub uuid: String,
    pub hash: String,
    baseline_hash: String,
    payload: Value,
}
impl TargetSnapshot {
    pub(super) fn capture(
        destination: &[u8],
        session: &str,
        budget: &Budget,
    ) -> Result<Self, Status> {
        validate(destination, session, budget)?;
        let current = rows(destination, budget)?
            .into_iter()
            .rev()
            .find(|row| {
                row["type"] == "attachment" && row["attachment"]["type"] == "prompt_snapshot"
            })
            .ok_or(Status::Unsupported)?;
        Ok(Self {
            uuid: current["uuid"]
                .as_str()
                .ok_or(Status::Unsupported)?
                .to_owned(),
            hash: digest(&current)?,
            baseline_hash: format!("{:x}", Sha256::digest(destination)),
            payload: current["attachment"].clone(),
        })
    }
    pub(super) fn verify(&self, destination: &[u8], budget: &Budget) -> Result<(), Status> {
        budget.check()?;
        if format!("{:x}", Sha256::digest(destination)) != self.baseline_hash {
            return Err(Status::Changed);
        }
        let current = rows(destination, budget)?
            .into_iter()
            .rev()
            .find(|row| {
                row["type"] == "attachment" && row["attachment"]["type"] == "prompt_snapshot"
            })
            .ok_or(Status::Unsupported)?;
        if current["uuid"] != self.uuid || digest(&current)? != self.hash {
            return Err(Status::Conflict);
        }
        Ok(())
    }
}

pub(super) struct Projected {
    pub bytes: Vec<u8>,
    pub ledger: Vec<Projection>,
}

pub(super) fn project_with_snapshot(
    prefix: &[u8],
    suffix: &[u8],
    session: &str,
    budget: &Budget,
    trusted: Option<&TargetSnapshot>,
) -> Result<Projected, Status> {
    let mut chain = Chain::default();
    for row in rows(prefix, budget)? {
        chain.accept(&row, session, true)?;
    }
    if !chain.pending_tools.is_empty() {
        return Err(Status::Unsupported);
    }
    if suffix.is_empty() {
        return Ok(Projected {
            bytes: Vec::new(),
            ledger: Vec::new(),
        });
    }
    let mut ledger = Vec::new();
    let mut output = Vec::new();
    let baseline_leaf = chain.leaf.clone();
    for mut row in rows(suffix, budget)? {
        let projection =
            if row["type"] == "attachment" && row["attachment"]["type"] == "prompt_snapshot" {
                attachment(&row["attachment"], false)?;
                if let Some(basis) = trusted {
                    let source_hash = digest(&row)?;
                    row["attachment"] = basis.payload.clone();
                    let target_hash = digest(&row)?;
                    (source_hash != target_hash).then(|| Projection {
                        parent_only: false,
                        uuid: row["uuid"].as_str().unwrap_or_default().to_owned(),
                        source_hash,
                        target_hash,
                        basis_uuid: basis.uuid.clone(),
                        basis_hash: basis.hash.clone(),
                    })
                } else {
                    if chain.prompt_snapshot.as_ref() != Some(&row["attachment"]) {
                        return Err(Status::Unsupported);
                    }
                    None
                }
            } else {
                None
            };
        if chain.accept(&row, session, false)? {
            if row["type"] == "last-prompt" && chain.leaf == baseline_leaf {
                continue;
            }
            if let Some(projection) = projection {
                if ledger.len() >= 128 {
                    return Err(Status::Limit);
                }
                ledger.push(projection);
            }
            row.as_object_mut().unwrap().remove("permissionMode");
            row.as_object_mut().unwrap().remove("toolUseResult");
            row.as_object_mut().unwrap().remove("advisorModel");
            let encoded = serde_json::to_vec(&row).map_err(|_| Status::Unsupported)?;
            // A small source record can expand to a large target snapshot.
            // Bound expansion during projection, not after allocating it all.
            if output.len().saturating_add(encoded.len()).saturating_add(1) > 16 * 1024 * 1024 {
                return Err(Status::Limit);
            }
            output.extend_from_slice(&encoded);
            output.push(b'\n');
        }
    }
    if !chain.pending_tools.is_empty() {
        return Err(Status::Unsupported);
    }
    Ok(Projected {
        bytes: output,
        ledger,
    })
}

/// Export compatible conversation payloads only. Source runtime context is
/// deliberately excluded; the existing destination prefix stays byte-for-byte.
pub(super) fn project_conversation(
    prefix: &[u8],
    suffix: &[u8],
    destination: &[u8],
    session: &str,
    budget: &Budget,
) -> Result<Projected, Status> {
    let mut source = Chain::default();
    if !prefix.is_empty() {
        for row in rows(prefix, budget)? {
            source.accept(&row, session, true)?;
        }
    }
    if !source.pending_tools.is_empty() {
        return Err(Status::Incomplete);
    }
    let mut target = Chain::default();
    let mut target_rows = std::collections::HashMap::new();
    if !destination.is_empty() {
        for row in rows(destination, budget)? {
            target.accept(&row, session, true)?;
            if let Some(id) = row["uuid"].as_str() {
                target_rows.insert(id.to_owned(), row);
            }
        }
    }
    if !target.pending_tools.is_empty() {
        return Err(Status::Incomplete);
    }
    if suffix.is_empty() {
        return Ok(Projected {
            bytes: Vec::new(),
            ledger: Vec::new(),
        });
    }
    let mut queued: Option<String> = None;
    let mut dequeued: Option<String> = None;
    let mut output = Vec::new();
    let mut ledger = Vec::new();
    let mut last_prompt = String::new();
    for mut row in rows(suffix, budget)? {
        let kind = row["type"].as_str().ok_or(Status::Unsupported)?.to_owned();
        let message = matches!(kind.as_str(), "user" | "assistant");
        // New tools must pass the audited closed-tool allowlist. Runtime rows
        // are strictly recognized but are never serialized to the destination.
        source.accept(&row, session, !message)?;
        if kind == "queue-operation" {
            match row["operation"].as_str() {
                Some("enqueue") if queued.is_none() && dequeued.is_none() => {
                    queued = Some(
                        row["content"]
                            .as_str()
                            .ok_or(Status::Unsupported)?
                            .to_owned(),
                    );
                }
                Some("dequeue") if dequeued.is_none() && row.get("content").is_none() => {
                    dequeued = Some(queued.take().ok_or(Status::Incomplete)?);
                }
                _ => return Err(Status::Incomplete),
            }
            continue;
        }
        if kind == "attachment" {
            // Audited runtime schemas are omitted, never exported. Agent listing
            // deltas were observed in a normal Desktop-created conversation;
            // their closed fields describe local agent availability, not messages.
            // Unknown families remain unsupported even if old baselines use them.
            if !matches!(
                row["attachment"]["type"].as_str(),
                Some(
                    "sandbox_instructions"
                        | "environment"
                        | "model"
                        | "mcp_instructions_delta"
                        | "skill_listing"
                        | "total_tokens_reminder"
                        | "instructions"
                        | "session_context"
                        | "date"
                        | "remote_session_change"
                        | "prompt_snapshot"
                        | "deferred_tools_delta"
                        | "agent_listing_delta"
                )
            ) {
                return Err(Status::Unsupported);
            }
            continue;
        }
        if kind == "system" {
            if row["subtype"] != "stop_hook_summary"
                || row["hasOutput"] != false
                || row["preventedContinuation"] != false
                || !row["hookAdditionalContext"]
                    .as_array()
                    .is_some_and(Vec::is_empty)
                || !row["hookErrors"].as_array().is_some_and(Vec::is_empty)
            {
                return Err(Status::Unsupported);
            }
            continue;
        }
        if !message {
            continue;
        }
        if row["message"]["content"].as_array().is_some_and(|blocks| {
            blocks.iter().any(|block| {
                matches!(
                    block["type"].as_str(),
                    Some("thinking" | "redacted_thinking")
                )
            })
        }) {
            return Err(Status::Unsupported);
        }
        if kind == "user" {
            if queued.is_some() {
                return Err(Status::Incomplete);
            }
            if let Some(content) = dequeued.take() {
                if row["message"]["content"].as_str() != Some(&content) {
                    return Err(Status::Incomplete);
                }
            }
            if let Some(content) = row["message"]["content"].as_str() {
                last_prompt = content.to_owned();
            }
        }
        let original = row.clone();
        let basis = target.leaf.as_ref().and_then(|id| target_rows.get(id));
        // A new destination has no runtime prefix. Only a user message can
        // root its conversation; the source chain was still fully validated.
        if basis.is_none() && kind != "user" {
            return Err(Status::Conflict);
        }
        row["parentUuid"] = basis.map_or(Value::Null, |row| row["uuid"].clone());
        row.as_object_mut().unwrap().remove("permissionMode");
        row.as_object_mut().unwrap().remove("toolUseResult");
        row.as_object_mut().unwrap().remove("advisorModel");
        if original != row {
            if ledger.len() >= 128 {
                return Err(Status::Limit);
            }
            ledger.push(Projection {
                parent_only: true,
                uuid: row["uuid"].as_str().ok_or(Status::Unsupported)?.to_owned(),
                source_hash: digest(&original)?,
                target_hash: digest(&row)?,
                // A self-basis declares the unique root projection. The
                // ledger verifier requires it to be the first target user.
                basis_uuid: basis.unwrap_or(&row)["uuid"]
                    .as_str()
                    .ok_or(Status::Unsupported)?
                    .to_owned(),
                basis_hash: digest(basis.unwrap_or(&row))?,
            });
        }
        target.accept(&row, session, false)?;
        let id = row["uuid"].as_str().ok_or(Status::Unsupported)?.to_owned();
        encode_bounded(&row, &mut output)?;
        target_rows.insert(id, row);
    }
    if !source.pending_tools.is_empty() || queued.is_some() || dequeued.is_some() {
        return Err(Status::Incomplete);
    }
    if !output.is_empty() {
        encode_bounded(
            &serde_json::json!({"type":"last-prompt", "sessionId":session, "leafUuid":target.leaf, "lastPrompt":last_prompt}),
            &mut output,
        )?;
    }
    Ok(Projected {
        bytes: output,
        ledger,
    })
}
fn encode_bounded(row: &Value, output: &mut Vec<u8>) -> Result<(), Status> {
    let encoded = serde_json::to_vec(row).map_err(|_| Status::Unsupported)?;
    if output.len().saturating_add(encoded.len()).saturating_add(1) > 16 * 1024 * 1024 {
        return Err(Status::Limit);
    }
    output.extend(encoded);
    output.push(b'\n');
    Ok(())
}
