//! Provider wire conversion for live interactions; UI only receives canonical events.
use super::interactions::{publish_permission, InteractionRun, Reply};
use core_types::activity::ActivityChunk;
use serde_json::{json, Value};

pub fn question_chunk(session: &str, id: &str, questions: &[Value]) -> ActivityChunk {
    let mut chunk = ActivityChunk::new(session, "ask_user_questions", "ask_user_questions");
    chunk.chunk_id = id.into();
    chunk.args = json!({"questions": questions, "call_id": id});
    chunk.result = json!({"status": "waiting_for_answer", "call_id": id, "native_request_id":id});
    chunk
}

pub fn codex_request(
    run: &InteractionRun,
    session: &str,
    msg: &Value,
) -> Result<Option<ActivityChunk>, String> {
    let params = &msg["params"];
    let method = msg["method"].as_str().unwrap_or_default();
    let questions = if method == "item/tool/requestUserInput" {
        Some(
            params["questions"]
                .as_array()
                .ok_or("Missing Codex questions")?
                .clone(),
        )
    } else {
        None
    };
    if questions
        .as_ref()
        .is_some_and(|qs| qs.iter().any(|q| q["isSecret"] == true))
    {
        return Err("Secret questions require a dedicated secure input surface".into());
    }
    let wire_id = if method == "item/permissions/requestApproval" {
        json!({"id":msg["id"], "permissions":params["permissions"]})
    } else {
        msg["id"].clone()
    };
    let id = run.register(wire_id, questions.clone())?;
    if let Some(questions) = questions {
        let mut chunk = question_chunk(session, &id, &questions);
        if let Some(item_id) = params["itemId"].as_str() {
            super::interactions::bind_tool_call(&id, item_id);
            chunk.args["call_id"] = json!(item_id);
            chunk.result["call_id"] = json!(item_id);
        }
        chunk.result["blocking"] = params["isBlocking"].clone();
        return Ok(Some(chunk));
    }
    let tool = match method {
        "item/commandExecution/requestApproval" => "Bash",
        "item/fileChange/requestApproval" => "ApplyPatch",
        "item/permissions/requestApproval" => "RequestPermissions",
        _ => method,
    };
    publish_permission(session, &id, tool, params.clone());
    Ok(None)
}

pub fn codex_response(reply: &Reply) -> Value {
    if let Some(permissions) = reply.wire_id.get("permissions") {
        return json!({"permissions": if reply.approved { permissions.clone() } else { json!({}) }, "scope":"turn"});
    }
    if let Some(questions) = &reply.questions {
        let answers: serde_json::Map<String, Value> = questions.iter().enumerate().map(|(i, q)| (
            q["id"].as_str().unwrap_or_default().to_string(),
            json!({"answers": reply.answers.as_ref().and_then(|a| a.get(i)).cloned().unwrap_or_default()})
        )).collect();
        json!({"answers": answers})
    } else {
        json!({"decision": if reply.approved { "accept" } else { "decline" }})
    }
}

pub fn claude_request(
    run: &InteractionRun,
    session: &str,
    msg: &Value,
) -> Result<Option<ActivityChunk>, String> {
    let request = &msg["request"];
    if request["subtype"] != "can_use_tool" {
        return Err("Unsupported Claude control request".into());
    }
    let tool = request["tool_name"]
        .as_str()
        .ok_or("Missing Claude tool name")?;
    let questions = if tool == "AskUserQuestion" {
        Some(
            request["input"]["questions"]
                .as_array()
                .ok_or("Missing Claude questions")?
                .clone(),
        )
    } else {
        None
    };
    // Store the original input alongside request identity for lossless updatedInput.
    let wire = json!({"id": msg["request_id"], "input": request["input"]});
    let id = run.register(wire, questions.clone())?;
    if let Some(questions) = questions {
        let mut chunk = question_chunk(session, &id, &questions);
        if let Some(call_id) = request["tool_use_id"].as_str() {
            super::interactions::bind_tool_call(&id, call_id);
            chunk.chunk_id = format!("tool-call-{call_id}");
            chunk.args["call_id"] = json!(call_id);
            chunk.result["call_id"] = json!(call_id);
        }
        return Ok(Some(chunk));
    }
    publish_permission(session, &id, tool, request["input"].clone());
    Ok(None)
}

pub fn claude_response(reply: &Reply) -> Value {
    let mut input = reply.wire_id["input"].clone();
    if let Some(questions) = &reply.questions {
        let answers: serde_json::Map<String, Value> = questions
            .iter()
            .enumerate()
            .map(|(i, q)| {
                (
                    q["question"].as_str().unwrap_or_default().to_string(),
                    json!(reply
                        .answers
                        .as_ref()
                        .and_then(|a| a.get(i))
                        .map(|a| a.join(", "))
                        .unwrap_or_default()),
                )
            })
            .collect();
        input["answers"] = json!(answers);
    }
    let response = if reply.approved {
        json!({"behavior":"allow", "updatedInput":input})
    } else {
        json!({"behavior":"deny", "message":"The user declined this request. Do not retry the operation."})
    };
    json!({"type":"control_response", "response":{"subtype":"success", "request_id":reply.wire_id["id"], "response":response}})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn native_interaction_claude_answers_preserve_input_and_request_id() {
        let session = uuid::Uuid::new_v4().to_string();
        let mut run = InteractionRun::new(&session);
        let chunk = claude_request(&run, &session, &json!({"request_id":"req-c", "request":{"subtype":"can_use_tool", "tool_name":"AskUserQuestion", "tool_use_id":"tool-c", "input":{"extra":"keep", "questions":[{"question":"Color?", "options":[{"label":"Blue"}]}]}}})).unwrap().unwrap();
        assert_eq!(chunk.chunk_id, "tool-call-tool-c");
        assert_eq!(chunk.result["call_id"], "tool-c");
        let sid = session.clone();
        // Native history rehydration supplies the provider id, not the
        // transient UI request id. The live registry must resolve it.
        let id = "tool-c".to_string();
        let task = tokio::spawn(async move {
            super::super::interactions::respond(&sid, &id, Some(vec![vec!["opt_0".into()]]), true)
                .await
        });
        let reply = run.receiver.recv().await.unwrap();
        let response = claude_response(&reply);
        assert_eq!(response["response"]["request_id"], "req-c");
        assert_eq!(
            response["response"]["response"]["updatedInput"]["answers"]["Color?"],
            "Blue"
        );
        assert_eq!(
            response["response"]["response"]["updatedInput"]["extra"],
            "keep"
        );
        reply.acknowledgement.send(Ok(())).unwrap();
        task.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn native_interaction_codex_permission_grants_are_exact_and_turn_scoped() {
        for approved in [true, false] {
            let session = uuid::Uuid::new_v4().to_string();
            let mut run = InteractionRun::new(&session);
            let permissions = json!({"network":{"enabled":true}});
            let id = run
                .register(json!({"id":17,"permissions":permissions}), None)
                .unwrap();
            let sid = session.clone();
            let task = tokio::spawn(async move {
                super::super::interactions::respond(&sid, &id, None, approved).await
            });
            let reply = run.receiver.recv().await.unwrap();
            assert_eq!(
                codex_response(&reply),
                json!({
                    "permissions": if approved { permissions.clone() } else { json!({}) },
                    "scope":"turn"
                })
            );
            reply.acknowledgement.send(Ok(())).unwrap();
            task.await.unwrap().unwrap();
        }
    }

    #[tokio::test]
    async fn native_interaction_codex_uses_question_ids_and_label_answers() {
        let session = uuid::Uuid::new_v4().to_string();
        let mut run = InteractionRun::new(&session);
        let chunk = codex_request(&run, &session, &json!({"id":42,"method":"item/tool/requestUserInput","params":{"questions":[{"id":"color","question":"Color?","options":[{"label":"Blue"}]}]}})).unwrap().unwrap();
        let sid = session.clone();
        let id = chunk.chunk_id;
        let task = tokio::spawn(async move {
            super::super::interactions::respond(&sid, &id, Some(vec![vec!["opt_0".into()]]), true)
                .await
        });
        let reply = run.receiver.recv().await.unwrap();
        assert_eq!(
            codex_response(&reply),
            json!({"answers":{"color":{"answers":["Blue"]}}})
        );
        reply.acknowledgement.send(Ok(())).unwrap();
        task.await.unwrap().unwrap();
    }
}
