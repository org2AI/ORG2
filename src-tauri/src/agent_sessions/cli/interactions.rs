//! Live native interaction ownership. No polling and no persisted response senders.
//! A registration belongs to one process generation; dropping it expires its requests.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use tokio::sync::{mpsc, oneshot};

static PENDING: LazyLock<Mutex<HashMap<String, Pending>>> = LazyLock::new(Default::default);
const MAX_PENDING_PER_RUN: usize = 32;

struct Pending {
    session: String,
    generation: String,
    wire_id: Value,
    tool_call_id: String,
    questions: Option<Vec<Value>>,
    question_chunk: Option<core_types::activity::ActivityChunk>,
    view: Option<Value>,
    sender: mpsc::Sender<Reply>,
}

pub struct Reply {
    pub wire_id: Value,
    pub tool_call_id: String,
    pub answers: Option<Vec<Vec<String>>>,
    pub questions: Option<Vec<Value>>,
    pub approved: bool,
    pub request_id: String,
    pub acknowledgement: oneshot::Sender<Result<(), String>>,
}

pub struct InteractionRun {
    session: String,
    generation: String,
    sender: mpsc::Sender<Reply>,
    pub receiver: mpsc::Receiver<Reply>,
}

impl InteractionRun {
    pub fn new(session: &str) -> Self {
        let (sender, receiver) = mpsc::channel(MAX_PENDING_PER_RUN);
        Self {
            session: session.into(),
            generation: uuid::Uuid::new_v4().to_string(),
            sender,
            receiver,
        }
    }

    pub fn register(
        &self,
        wire_id: Value,
        questions: Option<Vec<Value>>,
    ) -> Result<String, String> {
        let mut pending = PENDING
            .lock()
            .map_err(|_| "Interaction registry unavailable")?;
        if pending
            .values()
            .filter(|p| p.generation == self.generation)
            .count()
            >= MAX_PENDING_PER_RUN
        {
            return Err("Too many pending native interactions".into());
        }
        if pending
            .values()
            .any(|p| p.generation == self.generation && p.wire_id == wire_id)
        {
            return Err("Duplicate native interaction".into());
        }
        let id = format!("native-interaction-{}", uuid::Uuid::new_v4());
        pending.insert(
            id.clone(),
            Pending {
                session: self.session.clone(),
                generation: self.generation.clone(),
                wire_id,
                tool_call_id: id.clone(),
                questions,
                question_chunk: None,
                view: None,
                sender: self.sender.clone(),
            },
        );
        Ok(id)
    }
}

impl InteractionRun {
    pub fn expire(&self, wire_id: &Value) {
        expire_pending(
            &self.generation,
            Some(wire_id),
            "Native request resolved externally",
        );
    }
}

impl Drop for InteractionRun {
    fn drop(&mut self) {
        while let Ok(reply) = self.receiver.try_recv() {
            finalize_reply(&self.session, &reply, false);
            let _ = reply
                .acknowledgement
                .send(Err("Native process ended before accepting response".into()));
        }
        expire_pending(&self.generation, None, "Native process ended");
    }
}

fn expire_pending(generation: &str, wire_id: Option<&Value>, reason: &str) {
    // Remove under the registry lock; publishing/finalization may access other
    // runtime state and must never hold up unrelated interaction responses.
    let expired = if let Ok(mut pending) = PENDING.lock() {
        let ids: Vec<_> = pending
            .iter()
            .filter(|(_, p)| {
                p.generation == generation
                    && wire_id.is_none_or(|id| &p.wire_id == id || p.wire_id.get("id") == Some(id))
            })
            .map(|(id, _)| id.clone())
            .collect();
        ids.into_iter()
            .filter_map(|id| pending.remove(&id).map(|p| (id, p)))
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    for (id, p) in expired {
        publish_resolved(&p.session, &id);
        if p.questions.is_some() {
            agent_core::interaction::finalize::finalize_interaction_event(
                &p.session,
                Some(&p.tool_call_id),
                "ask_user_questions",
                agent_core::interaction::finalize::FinalizedStatus::Cancelled,
                reason,
                json!({}),
            );
        }
    }
}

pub fn publish_permission(session: &str, id: &str, tool: &str, args: Value) {
    let view = json!({
        "type": "permission:request", "session_id": session, "sessionId": session,
        "requestId": id, "toolName": tool, "toolCallId": id, "toolArgs": args, "origin": "native_cli"
    });
    if let Ok(mut pending) = PENDING.lock() {
        if let Some(p) = pending.get_mut(id) {
            p.view = Some(view.clone());
        }
    }
    crate::api::websocket_handler::broadcast(view.to_string());
}

pub fn publish_resolved(session: &str, id: &str) {
    crate::api::websocket_handler::broadcast(
        json!({
            "type": "native_interaction:resolved", "session_id": session, "requestId": id
        })
        .to_string(),
    );
}

pub async fn respond(
    session: &str,
    id: &str,
    answers: Option<Vec<Vec<String>>>,
    approved: bool,
) -> Result<(), String> {
    let (sender, wire_id, answers, questions, tool_call_id, request_id) = {
        let mut pending = PENDING
            .lock()
            .map_err(|_| "Interaction registry unavailable")?;
        // Reopened native history carries the provider tool id, while live
        // events carry our process-scoped request id. Resolve both here and
        // still require a live registration owned by this exact session.
        let resolved_id = if pending.contains_key(id) {
            id.to_string()
        } else {
            pending
                .iter()
                .find(|(_, p)| p.session == session && p.tool_call_id == id)
                .map(|(key, _)| key.clone())
                .ok_or("Native interaction expired")?
        };
        let id = resolved_id.as_str();
        let p = pending.get(id).ok_or("Native interaction expired")?;
        if p.session != session {
            return Err("Native interaction belongs to another session".into());
        }
        if answers.is_some() != p.questions.is_some() && approved {
            return Err("Wrong native interaction response kind".into());
        }
        let answers = match (answers, &p.questions) {
            (Some(answers), Some(questions)) => {
                if answers.len() != questions.len() || answers.iter().any(Vec::is_empty) {
                    return Err("Answer every question".into());
                }
                Some(
                    answers
                        .into_iter()
                        .zip(questions)
                        .map(|(answers, q)| {
                            answers
                                .into_iter()
                                .map(|answer| {
                                    answer
                                        .strip_prefix("opt_")
                                        .and_then(|s| s.parse::<usize>().ok())
                                        .and_then(|i| {
                                            q.get("options")?.get(i)?.get("label")?.as_str()
                                        })
                                        .unwrap_or(&answer)
                                        .to_string()
                                })
                                .collect()
                        })
                        .collect(),
                )
            }
            (answers, _) => answers,
        };
        let p = pending.remove(id).ok_or("Native interaction expired")?;
        (
            p.sender,
            p.wire_id,
            answers,
            p.questions,
            p.tool_call_id,
            resolved_id,
        )
    };
    let (tx, rx) = oneshot::channel();
    sender
        .send(Reply {
            wire_id,
            tool_call_id,
            answers,
            questions,
            approved,
            request_id,
            acknowledgement: tx,
        })
        .await
        .map_err(|_| "Native process ended")?;
    rx.await
        .map_err(|_| "Native process ended before accepting response")?
}

#[tauri::command]
pub async fn cli_native_question_response(
    session_id: String,
    request_id: String,
    answers: Option<Vec<Vec<String>>>,
) -> Result<bool, String> {
    let sid = session_id.clone();
    let supported = tokio::task::spawn_blocking(move || {
        super::persistence::get_session(&sid)
            .map(|session| {
                session.is_some_and(|session| {
                    matches!(
                        session.cli_agent_type.as_deref(),
                        Some("codex" | "claude_code")
                    )
                })
            })
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    // Other CLI adapters retain their existing question transport.
    if !supported {
        return Ok(false);
    }
    let approved = answers.is_some();
    respond(&session_id, &request_id, answers, approved).await?;
    Ok(true)
}

#[tauri::command]
pub fn cli_native_pending_interactions(session_id: String) -> Result<Vec<Value>, String> {
    Ok(PENDING
        .lock()
        .map_err(|_| "Interaction registry unavailable")?
        .iter()
        .filter(|(_, p)| p.session == session_id)
        .map(|(id, p)| {
            p.view
                .clone()
                .unwrap_or_else(|| json!({"requestId":id,"questions":p.questions}))
        })
        .collect())
}

pub fn finalize_reply(session: &str, reply: &Reply, success: bool) {
    publish_resolved(session, &reply.request_id);
    if reply.questions.is_some() {
        use agent_core::interaction::finalize::{finalize_interaction_event, FinalizedStatus};
        let status = if !success {
            FinalizedStatus::Cancelled
        } else if reply.approved {
            FinalizedStatus::Answered
        } else {
            FinalizedStatus::Rejected
        };
        finalize_interaction_event(
            session,
            Some(&reply.tool_call_id),
            "ask_user_questions",
            status,
            if success {
                "Native interaction resolved"
            } else {
                "Native process ended"
            },
            json!({"answers":reply.answers}),
        );
    }
}

pub fn bind_tool_call(id: &str, tool_call_id: &str) {
    if let Ok(mut pending) = PENDING.lock() {
        if let Some(p) = pending.get_mut(id) {
            p.tool_call_id = tool_call_id.to_string();
        }
    }
}

/// A live control request is authoritative while a native file has an unfinished tool call.
/// Replace matching calls only: never inject the active question into an older history page.
pub fn overlay_live_questions(session: &str, chunks: &mut [core_types::activity::ActivityChunk]) {
    let questions: HashMap<_, _> = match PENDING.lock() {
        Ok(pending) => pending
            .values()
            .filter(|p| p.session == session)
            .filter_map(|p| {
                p.question_chunk
                    .as_ref()
                    .map(|chunk| (p.tool_call_id.clone(), chunk.clone()))
            })
            .collect(),
        Err(_) => return,
    };
    if questions.is_empty() {
        return;
    }
    for chunk in chunks {
        if let Some(question) = chunk
            .result
            .get("call_id")
            .and_then(Value::as_str)
            .and_then(|id| questions.get(id))
        {
            *chunk = question.clone();
        }
    }
}

pub fn remember_question(id: &str, chunk: &core_types::activity::ActivityChunk) {
    if let Ok(mut pending) = PENDING.lock() {
        if let Some(request) = pending.get_mut(id) {
            request.question_chunk = Some(chunk.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn native_interaction_is_scoped_single_use_and_waits_for_wire_ack() {
        let session = uuid::Uuid::new_v4().to_string();
        let mut run = InteractionRun::new(&session);
        let id = run
            .register(
                json!(17),
                Some(vec![json!({"id":"q1","options":[{"label":"Blue"}]})]),
            )
            .unwrap();
        assert!(
            respond("other-session", &id, Some(vec![vec!["opt_0".into()]]), true)
                .await
                .is_err()
        );
        let sid = session.clone();
        let rid = id.clone();
        let task = tokio::spawn(async move {
            respond(&sid, &rid, Some(vec![vec!["opt_0".into()]]), true).await
        });
        let reply = run.receiver.recv().await.unwrap();
        assert_eq!(reply.wire_id, json!(17));
        assert_eq!(reply.answers, Some(vec![vec!["Blue".to_string()]]));
        assert!(!task.is_finished());
        assert!(respond(&session, &id, None, false).await.is_err());
        reply.acknowledgement.send(Ok(())).unwrap();
        assert!(task.await.unwrap().is_ok());
    }

    #[tokio::test]
    async fn native_interaction_generation_cleanup_does_not_expire_new_run() {
        let session = uuid::Uuid::new_v4().to_string();
        let old = InteractionRun::new(&session);
        let new = InteractionRun::new(&session);
        let old_id = old.register(json!(1), None).unwrap();
        let new_id = new.register(json!(1), None).unwrap();
        drop(old);
        assert!(respond(&session, &old_id, None, false).await.is_err());
        let snapshot = cli_native_pending_interactions(session).unwrap();
        assert!(snapshot.iter().any(|p| p["requestId"] == new_id));
    }

    #[test]
    fn native_interaction_capacity_and_duplicate_requests_are_bounded() {
        let run = InteractionRun::new(&uuid::Uuid::new_v4().to_string());
        for n in 0..MAX_PENDING_PER_RUN {
            run.register(json!(n), None).unwrap();
        }
        assert!(run.register(json!(0), None).is_err());
        assert!(run.register(json!(MAX_PENDING_PER_RUN), None).is_err());
    }
}
