//! Atomic, replay-safe auxiliary usage receipts. The existing token table stays
//! the sole aggregate source; spans describe these tokens, never add them twice.
use agent_core::foundation::session_bridge::AuxiliaryUsageRow;
use agent_core::providers::usage_key;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Result};

pub(crate) fn record(row: &AuxiliaryUsageRow) -> Result<()> {
    let inserted = super::connection::with_sessions_writer(|| {
        let mut conn = super::get_connection()?;
        insert(&mut conn, row)
    })?;
    if inserted {
        super::token_usage::recompute_usage_projection(&row.session_id);
    }
    Ok(())
}

fn insert(conn: &mut Connection, row: &AuxiliaryUsageRow) -> Result<bool> {
    if row.usage.values().any(|value| *value < 0) {
        return Err(rusqlite::Error::InvalidParameterName(
            "negative provider usage".into(),
        ));
    }
    let transaction = conn.transaction()?;
    if transaction
        .query_row(
            "SELECT 1 FROM session_auxiliary_usage WHERE response_id = ?1",
            [&row.response_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some()
    {
        return Ok(false);
    }
    // A late background completion must not recreate a deleted session's rows.
    if transaction
        .query_row(
            "SELECT 1 FROM agent_sessions WHERE session_id = ?1",
            [&row.session_id],
            |_| Ok(()),
        )
        .optional()?
        .is_none()
    {
        return Ok(false);
    }
    let value = |key| row.usage.get(key).copied().unwrap_or(0);
    let input = value(usage_key::PROMPT_TOKENS);
    let output = value(usage_key::COMPLETION_TOKENS);
    let cache_read = value(usage_key::CACHE_READ_TOKENS);
    let cache_write = value(usage_key::CACHE_WRITE_TOKENS);
    let total = row
        .usage
        .get(usage_key::TOTAL_TOKENS)
        .copied()
        .unwrap_or_else(|| input.saturating_add(output));
    let now = Utc::now().to_rfc3339();
    // Auxiliary requests consume tokens but do not change the foreground
    // conversation's context window. Do not store their context snapshot here.
    transaction.execute(
        "INSERT INTO session_token_usage
         (session_id, session_type, model, account_id, input_tokens, output_tokens,
          cache_read_tokens, cache_write_tokens, total_tokens, context_tokens, created_at)
         VALUES (?1, 'agent', ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9)",
        params![
            row.session_id,
            row.model,
            row.account_id,
            input,
            output,
            cache_read,
            cache_write,
            total,
            now
        ],
    )?;
    let token_id = transaction.last_insert_rowid();
    let turn_id = format!("auxiliary:{}:{}", row.purpose, row.response_id);
    transaction.execute(
        "INSERT INTO session_llm_usage_spans
         (session_id, turn_id, iteration_index, model, account_id, prompt_tokens,
          completion_tokens, cache_read_tokens, cache_write_tokens, total_tokens,
          context_tokens, created_at)
         VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10)",
        params![
            row.session_id,
            turn_id,
            row.model,
            row.account_id,
            input,
            output,
            cache_read,
            cache_write,
            total,
            now
        ],
    )?;
    transaction.execute(
        "INSERT INTO session_auxiliary_usage
         (response_id, session_id, purpose, provider, provider_usage_json, token_usage_id, credential_source)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            row.response_id,
            row.session_id,
            row.purpose,
            row.provider,
            serde_json::to_string(&row.usage)
                .map_err(|err| rusqlite::Error::ToSqlConversionFailure(Box::new(err)))?,
            token_id,
            row.credential_source
        ],
    )?;
    transaction.commit()?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        super::super::schema::init_session_tables(&conn).unwrap();
        conn.execute_batch(
            "CREATE TABLE agent_sessions (session_id TEXT PRIMARY KEY);
            INSERT INTO agent_sessions VALUES ('parent');",
        )
        .unwrap();
        conn
    }

    fn receipt(id: &str) -> AuxiliaryUsageRow {
        AuxiliaryUsageRow {
            response_id: id.into(),
            credential_source: Some("fixture-source".into()),
            session_id: "parent".into(),
            purpose: "workspace_memory".into(),
            model: "claude-sonnet-5".into(),
            account_id: None,
            provider: "anthropic".into(),
            usage: [
                (usage_key::PROMPT_TOKENS.into(), 2),
                (usage_key::COMPLETION_TOKENS.into(), 242),
                (usage_key::CACHE_READ_TOKENS.into(), 7067),
                (usage_key::CACHE_WRITE_TOKENS.into(), 518),
                ("cache_write_1h_tokens".into(), 518),
            ]
            .into(),
        }
    }

    #[test]
    fn auxiliary_receipt_is_atomic_idempotent_and_preserves_cache() {
        let mut conn = fixture();
        let row = receipt("response-1");
        assert!(insert(&mut conn, &row).unwrap());
        assert!(!insert(&mut conn, &row).unwrap());
        let totals: (i64, i64, i64, i64, i64) = conn.query_row(
            "SELECT COUNT(*), SUM(input_tokens), SUM(output_tokens), SUM(cache_read_tokens), SUM(cache_write_tokens) FROM session_token_usage WHERE session_id='parent'",
            [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).unwrap();
        assert_eq!(totals, (1, 2, 242, 7067, 518));
        let (context, snapshot): (i64, Option<String>) = conn
            .query_row(
                "SELECT context_tokens, context_usage_json FROM session_token_usage",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!((context, snapshot), (0, None));
        let raw: String = conn
            .query_row(
                "SELECT provider_usage_json FROM session_auxiliary_usage",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            serde_json::from_str::<std::collections::HashMap<String, i64>>(&raw).unwrap(),
            row.usage
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM session_llm_usage_spans", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        // A different successful response remains distinct even if tokens match.
        assert!(insert(&mut conn, &receipt("response-2")).unwrap());
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM session_token_usage", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            2
        );
    }

    #[test]
    fn failed_receipt_rolls_back_and_late_deleted_session_does_not_resurrect() {
        let mut conn = fixture();
        conn.execute_batch("CREATE TRIGGER reject_aux BEFORE INSERT ON session_auxiliary_usage BEGIN SELECT RAISE(ABORT, 'fixture'); END;").unwrap();
        assert!(insert(&mut conn, &receipt("response-1")).is_err());
        for table in ["session_token_usage", "session_llm_usage_spans"] {
            assert_eq!(
                conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
        conn.execute_batch("DROP TRIGGER reject_aux; DELETE FROM agent_sessions;")
            .unwrap();
        assert!(!insert(&mut conn, &receipt("response-1")).unwrap());
    }

    #[test]
    fn cache_only_response_is_not_dropped_and_negative_usage_is_rejected() {
        let mut conn = fixture();
        let mut row = receipt("cache-only");
        row.usage = [(usage_key::CACHE_READ_TOKENS.into(), 123)].into();
        assert!(insert(&mut conn, &row).unwrap());
        row.response_id = "invalid".into();
        row.usage.insert(usage_key::PROMPT_TOKENS.into(), -1);
        assert!(insert(&mut conn, &row).is_err());
    }
}
