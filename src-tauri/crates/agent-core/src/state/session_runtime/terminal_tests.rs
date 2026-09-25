use super::*;
use crate::definitions::AgentDefinition;

#[tokio::test]
async fn delayed_end_preserves_replacement_turn_and_cancellation_flag() {
    let session = AgentSession::new("exact-turn-end".into(), AgentDefinition::default());
    let old = session
        .begin_turn_with_intent("old".into(), Some("old-intent".into()))
        .await;
    let replacement = session
        .begin_turn_with_intent("new".into(), Some("new-intent".into()))
        .await;
    session.cancel_flag.store(true, Ordering::SeqCst);
    assert!(
        !session
            .end_turn_if_current(&old, None, DialogTurnState::Failed, TurnStats::default())
            .await
    );
    assert_eq!(
        session.active_turn_generation.read().as_deref(),
        Some(replacement.as_str())
    );
    assert!(session.cancel_flag.load(Ordering::SeqCst));
    assert!(
        session
            .end_turn_if_current(
                &replacement,
                None,
                DialogTurnState::Cancelled,
                TurnStats::default()
            )
            .await
    );
    assert!(
        !session
            .end_turn_if_current(
                &replacement,
                None,
                DialogTurnState::Completed,
                TurnStats::default()
            )
            .await
    );
}
