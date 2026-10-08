//! Exact native-transfer projection of durable Agent rows. Display history keeps
//! disk refs; this read embeds attachments and restores the producing event's
//! accepted intent by message id, never by prompt text or position.

use std::collections::HashMap;

use database::db::get_connection;
use rusqlite::params;
use serde_json::Value;

use crate::persistence::db_helpers as shared;

pub fn load_messages_for_native_transfer(session_id: &str) -> rusqlite::Result<Vec<Value>> {
    let messages = shared::load_native_message_rows("agent", session_id)?;
    let conn = get_connection()?;
    // One scoped query. Project only identity fields so historical base64 image
    // payloads do not cross this boundary a second time.
    let mut stmt = conn.prepare(
        "SELECT json_extract(result_json, '$.messageId'),
                json_extract(result_json, '$.turnIntentId')
         FROM events WHERE session_id = ?1 AND function_name = 'user_message'
         AND json_valid(result_json)",
    )?;
    let rows = stmt.query_map(params![session_id], |row| {
        Ok((
            row.get::<_, Option<String>>(0)?,
            row.get::<_, Option<String>>(1)?,
        ))
    })?;
    let mut intents = HashMap::new();
    for row in rows {
        let (message_id, intent) = row?;
        if let (Some(message_id), Some(intent)) = (message_id, intent) {
            if intent.is_empty() {
                continue;
            }
            if let Some(previous) = intents.insert(message_id.clone(), intent.clone()) {
                if previous != intent {
                    return Err(rusqlite::Error::ToSqlConversionFailure(Box::new(
                        std::io::Error::other(format!(
                            "conflicting native turn identity for message {message_id}"
                        )),
                    )));
                }
            }
        }
    }
    messages
        .into_iter()
        .map(|message| {
            let intent = (message.role == shared::message_role::USER)
                .then(|| intents.get(&message.id))
                .flatten();
            let mut value = shared::to_json_value(&message)?;
            if let Some(intent) = intent {
                value["turnIntentId"] = Value::String(intent.clone());
            }
            Ok(value)
        })
        .collect()
}

#[cfg(test)]
#[path = "native_transfer_tests.rs"]
mod tests;
