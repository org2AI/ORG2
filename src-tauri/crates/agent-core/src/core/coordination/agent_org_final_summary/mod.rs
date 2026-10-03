//! Certificate-bound final-report attempts for an Agent Org run.

mod context;
mod schema;
mod store;

#[cfg(test)]
mod tests;

pub(crate) use context::summary_context_for_turn;
pub(crate) use store::{
    active_for_run_with_connection, certificate_for_turn, claim_pending_for_coordinator_turn_in_tx,
    create_initial_for_certificate_in_tx, has_summary_receipt_for_turn_with_connection,
    is_summary_turn, is_summary_turn_with_connection, mark_failed_for_turn,
    mark_persisted_for_turn, mark_persisting_for_turn, reconcile_after_restart, retry_failed,
    settle_terminal_turn_in_tx, stable_event_id_for_turn, status_for_turn,
};
pub use store::{FinalSummaryReceipt, FinalSummaryStatus};

pub const FINALIZING_INPUT_NOT_ACCEPTED: &str = "agent_org_finalizing_input_not_accepted";

pub(crate) fn is_finalizing_with_connection(
    conn: &rusqlite::Connection,
    org_run_id: &str,
) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(
             SELECT 1 FROM agent_org_execution_final_summary_receipts
             WHERE org_run_id=?1 AND status IN ('pending','running','persisting')
         )",
        [org_run_id],
        |row| row.get(0),
    )
    .map_err(|error| error.to_string())
}

pub(crate) fn create_schema(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    schema::create_schema(conn)
}
