use super::*;

#[test]
fn unstarted_wakes_refund_exact_reservations_without_reviving_older_tokens() {
    use crate::coordination::agent_org_watchdog::{
        commit_member_rewake_reservation, refund_member_rewake_reservation,
        reserve_member_rewake_dispatch, MemberRewakeReservationOutcome,
    };
    let _sandbox = test_helpers::test_env::sandbox();
    let conn = database::db::get_connection().unwrap();
    crate::coordination::agent_org_watchdog::init_schema(&conn).unwrap();
    let reserve =
        |fingerprint| match reserve_member_rewake_dispatch("unstarted-run", "worker", fingerprint)
            .unwrap()
        {
            MemberRewakeReservationOutcome::Reserved(value) => value,
            MemberRewakeReservationOutcome::Deferred => panic!("unexpected backoff"),
        };
    let count = || {
        conn.query_row(
        "SELECT COUNT(*) FROM agent_org_runtime_recovery_attempts WHERE org_run_id='unstarted-run'",
        [], |row| row.get::<_, i64>(0),
    ).unwrap()
    };

    drop(reserve("discarded-before-start"));
    assert_eq!(count(), 0, "discarded scheduler closure refunds its wake");
    let first = reserve("old-input");
    let second = reserve("new-input");
    assert!(!refund_member_rewake_reservation(&first).unwrap());
    assert_eq!(
        count(),
        1,
        "old callback cannot delete new input's reservation"
    );
    drop(first);
    assert!(refund_member_rewake_reservation(&second).unwrap());
    drop(second);
    assert_eq!(
        count(),
        0,
        "refund cannot revive a dropped older reservation"
    );

    let committed = reserve("actual-provider-work");
    commit_member_rewake_reservation(&committed).unwrap();
    drop(committed);
    let next = reserve("new-empty-input");
    drop(next);
    let (fingerprint, token): (String, Option<String>) = conn.query_row(
        "SELECT reason_fingerprint,reservation_token FROM agent_org_runtime_recovery_attempts WHERE org_run_id='unstarted-run'",
        [], |row| Ok((row.get(0)?,row.get(1)?)),
    ).unwrap();
    assert_eq!(fingerprint, "actual-provider-work");
    assert!(
        token.is_none(),
        "committed budget survives a later empty wake"
    );
}

#[test]
fn reservation_storage_failure_remains_retryable_error() {
    use crate::coordination::agent_org_watchdog::{
        refund_member_rewake_reservation, reserve_member_rewake_dispatch,
        MemberRewakeReservationOutcome,
    };
    let _sandbox = test_helpers::test_env::sandbox();
    let conn = database::db::get_connection().unwrap();
    crate::coordination::agent_org_watchdog::init_schema(&conn).unwrap();
    let MemberRewakeReservationOutcome::Reserved(reservation) =
        reserve_member_rewake_dispatch("refund-error", "worker", "input").unwrap()
    else {
        panic!("reservation deferred");
    };
    conn.execute_batch("CREATE TRIGGER reject_refund BEFORE DELETE ON agent_org_runtime_recovery_attempts BEGIN SELECT RAISE(ABORT,'controlled storage failure'); END;").unwrap();
    assert!(refund_member_rewake_reservation(&reservation).is_err());
    assert!(conn.query_row("SELECT reservation_token IS NOT NULL FROM agent_org_runtime_recovery_attempts WHERE org_run_id='refund-error'",[],|row|row.get::<_,bool>(0)).unwrap());
    conn.execute_batch("DROP TRIGGER reject_refund;").unwrap();
    assert!(refund_member_rewake_reservation(&reservation).unwrap());
}

#[test]
fn formal_receipt_fingerprint_is_order_stable_and_deduplicated() {
    let first = vec!["receipt-b".to_string(), "receipt-a".to_string()];
    let reordered = vec![
        "receipt-a".to_string(),
        "receipt-b".to_string(),
        "receipt-a".to_string(),
    ];

    assert_eq!(
        formal_receipt_rewake_fingerprint(Some(&first)),
        formal_receipt_rewake_fingerprint(Some(&reordered))
    );
    assert_eq!(formal_receipt_rewake_fingerprint(Some(&[])), None);
}

#[test]
fn a_new_formal_receipt_starts_a_fresh_rewake_episode() {
    use crate::coordination::agent_org_watchdog::{
        commit_member_rewake_reservation, reserve_member_rewake_dispatch,
        MemberRewakeReservationOutcome,
    };

    let _sandbox = test_helpers::test_env::sandbox();
    let conn = database::db::get_connection().expect("test database");
    crate::coordination::agent_org_watchdog::init_schema(&conn).expect("rewake schema");
    let run_id = "formal-receipt-rewake-run";
    let member_id = crate::coordination::agent_org_runs::COORDINATOR_MEMBER_ID;
    let first = formal_receipt_rewake_fingerprint(Some(&["receipt-1".to_string()]))
        .expect("first fingerprint");
    let second = formal_receipt_rewake_fingerprint(Some(&["receipt-2".to_string()]))
        .expect("second fingerprint");

    let first_reservation = match reserve_member_rewake_dispatch(run_id, member_id, &first)
        .expect("reserve first receipt")
    {
        MemberRewakeReservationOutcome::Reserved(reservation) => reservation,
        MemberRewakeReservationOutcome::Deferred => panic!("first receipt unexpectedly deferred"),
    };
    commit_member_rewake_reservation(&first_reservation).expect("commit first reservation");
    assert!(matches!(
        reserve_member_rewake_dispatch(run_id, member_id, &first).expect("repeat first receipt"),
        MemberRewakeReservationOutcome::Deferred
    ));

    let second_reservation = match reserve_member_rewake_dispatch(run_id, member_id, &second)
        .expect("reserve newly committed receipt")
    {
        MemberRewakeReservationOutcome::Reserved(reservation) => reservation,
        MemberRewakeReservationOutcome::Deferred => panic!("new receipt inherited stale backoff"),
    };
    commit_member_rewake_reservation(&second_reservation).expect("commit second reservation");
}

#[tokio::test]
async fn late_formal_batch_queues_one_trailing_turn_while_exact_retries_coalesce() {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    use crate::session::{DialogScheduler, ScheduledKind, ScheduledMessage};
    use crate::state::commands::session::message::agent_org_wake_client_message_id;

    let scheduler = DialogScheduler::new("coordinator-late-formal-batch", 8);
    let initial_batch = formal_receipt_rewake_fingerprint(Some(&["task-output".to_string()]))
        .expect("initial formal batch");
    let late_batch = formal_receipt_rewake_fingerprint(Some(&["member-idle".to_string()]))
        .expect("late formal batch");
    let initial_key = agent_org_wake_client_message_id(
        "run-late-formal-batch",
        crate::coordination::agent_org_runs::COORDINATOR_MEMBER_ID,
        Some(&initial_batch),
    );
    let late_key = agent_org_wake_client_message_id(
        "run-late-formal-batch",
        crate::coordination::agent_org_runs::COORDINATOR_MEMBER_ID,
        Some(&late_batch),
    );
    assert_ne!(initial_key, late_key);

    let initial_started = Arc::new(tokio::sync::Notify::new());
    let release_initial = Arc::new(tokio::sync::Notify::new());
    let trailing_finished = Arc::new(tokio::sync::Notify::new());
    let executed = Arc::new(AtomicUsize::new(0));

    let initial_started_for_turn = Arc::clone(&initial_started);
    let release_initial_for_turn = Arc::clone(&release_initial);
    let executed_initial = Arc::clone(&executed);
    let initial = scheduler
        .enqueue(ScheduledMessage {
            kind: ScheduledKind::Turn,
            message_id: "initial-formal-turn".to_string(),
            generation: 0,
            client_message_id: Some(initial_key),
            turn_intent_id: String::new(),
            org_run_id: None,
            content: String::new(),
            execute: Box::new(move || {
                Box::pin(async move {
                    executed_initial.fetch_add(1, Ordering::SeqCst);
                    initial_started_for_turn.notify_one();
                    release_initial_for_turn.notified().await;
                    Ok(crate::session::scheduler::ExecutionCompletion::Finished)
                })
            }),
        })
        .await
        .expect("initial formal wake");
    assert!(!initial.duplicate);
    initial_started.notified().await;

    let trailing_finished_for_turn = Arc::clone(&trailing_finished);
    let executed_trailing = Arc::clone(&executed);
    let trailing = scheduler
        .enqueue(ScheduledMessage {
            kind: ScheduledKind::Turn,
            message_id: "late-member-idle-turn".to_string(),
            generation: 0,
            client_message_id: Some(late_key.clone()),
            turn_intent_id: String::new(),
            org_run_id: None,
            content: String::new(),
            execute: Box::new(move || {
                Box::pin(async move {
                    executed_trailing.fetch_add(1, Ordering::SeqCst);
                    trailing_finished_for_turn.notify_one();
                    Ok(crate::session::scheduler::ExecutionCompletion::Finished)
                })
            }),
        })
        .await
        .expect("late formal wake");
    let exact_retry = scheduler
        .enqueue(ScheduledMessage {
            kind: ScheduledKind::Turn,
            message_id: "late-member-idle-retry".to_string(),
            generation: 0,
            client_message_id: Some(late_key),
            turn_intent_id: String::new(),
            org_run_id: None,
            content: String::new(),
            execute: Box::new(|| {
                Box::pin(async { Ok(crate::session::scheduler::ExecutionCompletion::Finished) })
            }),
        })
        .await
        .expect("exact late wake retry");

    assert!(!trailing.duplicate);
    assert!(exact_retry.duplicate);
    assert_eq!(scheduler.pending_count(), 1);

    release_initial.notify_one();
    tokio::time::timeout(
        std::time::Duration::from_secs(1),
        trailing_finished.notified(),
    )
    .await
    .expect("one trailing formal Turn runs");
    tokio::time::timeout(std::time::Duration::from_secs(1), async {
        while scheduler.is_processing() || scheduler.pending_count() > 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("scheduler becomes silent");
    assert_eq!(executed.load(Ordering::SeqCst), 2);
}
