use super::*;
use crate::lifecycle::TurnTerminalStatus;

#[tokio::test(flavor = "multi_thread")]
async fn accepted_execution_error_keeps_identity_even_without_processing_result() {
    let session = Arc::new(AgentSession::new(
        "failed-entry".into(),
        crate::definitions::AgentDefinition::default(),
    ));
    let dialog = session
        .begin_turn_with_intent("work".into(), Some("failed-intent".into()))
        .await;
    let input = TurnInput {
        content: "work".into(),
        display_text: None,
        agent_mode: None,
        images: None,
        ide_context: None,
        is_resume: false,
        channel: None,
        chat_id: None,
        turn_id: Some(dialog.clone()),
        turn_intent_id: "failed-intent".into(),
    };
    let (response, terminal) = process_message_with_terminal(session, input, None).await;
    assert!(response.unwrap_err().contains("runtime not initialized"));
    assert_eq!(terminal.turn_id, dialog);
    assert_eq!(terminal.turn_intent_id.as_deref(), Some("failed-intent"));
    assert_eq!(terminal.status, TurnTerminalStatus::Failed);
}
