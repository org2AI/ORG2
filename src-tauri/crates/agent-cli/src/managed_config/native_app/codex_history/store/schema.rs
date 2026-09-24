//! Operation-level native SQLite structure and dependency checks.
use super::db_error;
use rusqlite::Connection;

// Baseline fixtures and legacy recovery layout; production discovers columns.
// name, declared type, NOT NULL, primary-key position.
pub(super) type Column = (&'static str, &'static str, i64, i64);
pub(super) const THREAD_COLUMNS: &[Column] = &[
    ("id", "TEXT", 0, 1),
    ("rollout_path", "TEXT", 1, 0),
    ("created_at", "INTEGER", 1, 0),
    ("updated_at", "INTEGER", 1, 0),
    ("source", "TEXT", 1, 0),
    ("model_provider", "TEXT", 1, 0),
    ("cwd", "TEXT", 1, 0),
    ("title", "TEXT", 1, 0),
    ("sandbox_policy", "TEXT", 1, 0),
    ("approval_mode", "TEXT", 1, 0),
    ("tokens_used", "INTEGER", 1, 0),
    ("has_user_event", "INTEGER", 1, 0),
    ("archived", "INTEGER", 1, 0),
    ("archived_at", "INTEGER", 0, 0),
    ("git_sha", "TEXT", 0, 0),
    ("git_branch", "TEXT", 0, 0),
    ("git_origin_url", "TEXT", 0, 0),
    ("cli_version", "TEXT", 1, 0),
    ("first_user_message", "TEXT", 1, 0),
    ("agent_nickname", "TEXT", 0, 0),
    ("agent_role", "TEXT", 0, 0),
    ("memory_mode", "TEXT", 1, 0),
    ("model", "TEXT", 0, 0),
    ("reasoning_effort", "TEXT", 0, 0),
    ("agent_path", "TEXT", 0, 0),
    ("created_at_ms", "INTEGER", 0, 0),
    ("updated_at_ms", "INTEGER", 0, 0),
    ("thread_source", "TEXT", 0, 0),
    ("preview", "TEXT", 1, 0),
    ("recency_at", "INTEGER", 1, 0),
    ("recency_at_ms", "INTEGER", 1, 0),
    ("history_mode", "TEXT", 1, 0),
    ("name", "TEXT", 0, 0),
    ("is_pinned", "INTEGER", 1, 0),
    ("thread_section_id", "TEXT", 0, 0),
    ("section_position", "INTEGER", 0, 0),
    ("section_entered_at_ms", "INTEGER", 0, 0),
    ("project_id", "TEXT", 0, 0),
    ("originator", "TEXT", 0, 0),
    ("daybreak_enabled", "BOOLEAN", 0, 0),
];
pub(super) const TURN_COLUMNS: &[Column] = &[
    ("thread_id", "TEXT", 1, 1),
    ("turn_id", "TEXT", 1, 2),
    ("rollout_ordinal", "INTEGER", 1, 0),
    ("status", "TEXT", 1, 0),
    ("error_json", "TEXT", 0, 0),
    ("started_at", "INTEGER", 0, 0),
    ("completed_at", "INTEGER", 0, 0),
    ("duration_ms", "INTEGER", 0, 0),
    ("first_user_item_id", "TEXT", 0, 0),
    ("final_agent_item_id", "TEXT", 0, 0),
    ("rollout_byte_offset", "INTEGER", 0, 0),
    ("rollout_end_ordinal", "INTEGER", 0, 0),
    ("rollout_end_byte_offset", "INTEGER", 0, 0),
];
pub(super) const ITEM_COLUMNS: &[Column] = &[
    ("thread_id", "TEXT", 1, 1),
    ("turn_id", "TEXT", 1, 2),
    ("item_id", "TEXT", 1, 3),
    ("rollout_ordinal", "INTEGER", 1, 0),
    ("created_at_ms", "INTEGER", 1, 0),
    ("item_json", "TEXT", 1, 0),
    ("item_type", "TEXT", 1, 0),
    ("updated_at_ordinal", "INTEGER", 1, 0),
];
pub(super) const REALTIME_COLUMNS: &[Column] = &[
    ("thread_id", "TEXT", 1, 1),
    ("item_id", "TEXT", 1, 2),
    ("rollout_ordinal", "INTEGER", 1, 0),
    ("created_at_ms", "INTEGER", 1, 0),
    ("item_type", "TEXT", 1, 0),
    ("item_json", "TEXT", 1, 0),
];
pub(super) const CHECKPOINT_COLUMNS: &[Column] = &[
    ("thread_id", "TEXT", 0, 1),
    ("next_rollout_byte_offset", "INTEGER", 1, 0),
    ("next_rollout_ordinal", "INTEGER", 1, 0),
];
pub(super) const HISTORY_TABLES: &[(&str, &[Column])] = &[
    ("thread_turns", TURN_COLUMNS),
    ("thread_items", ITEM_COLUMNS),
    ("thread_realtime_items", REALTIME_COLUMNS),
    ("thread_history_projection_state", CHECKPOINT_COLUMNS),
];
#[cfg(test)]
pub(super) const STATE_TABLES: &[&str] = &[
    "_sqlx_migrations",
    "backfill_state",
    "external_agent_config_imports",
    "project_idempotency_keys",
    "project_roots",
    "projects",
    "remote_control_enrollments",
    "rollout_migration_skipped_rollouts",
    "rollout_migration_state",
    "sqlite_sequence",
    "thread_attachments",
    "thread_dynamic_tools",
    "thread_sections",
    "thread_spawn_edges",
    "threads",
];
pub(super) const LOCAL_COLUMNS: &[&str] = &[
    "model_provider",
    "model",
    "reasoning_effort",
    "sandbox_policy",
    "approval_mode",
    "memory_mode",
    "is_pinned",
    "thread_section_id",
    "section_position",
    "section_entered_at_ms",
    "project_id",
    "daybreak_enabled",
];

#[cfg(test)]
pub(super) fn columns_sql(columns: &[Column]) -> String {
    columns
        .iter()
        .map(|column| column.0)
        .collect::<Vec<_>>()
        .join(",")
}

/// Names and SQL values come from native SQLite, never executable DDL.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct NativeColumn {
    pub name: String,
    pub data_type: String,
    pub not_null: i64,
    pub primary_key: i64,
    pub default: Option<String>,
}

pub(super) fn quote(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

pub(super) fn names_sql(columns: &[NativeColumn]) -> String {
    columns
        .iter()
        .map(|column| quote(&column.name))
        .collect::<Vec<_>>()
        .join(",")
}

pub(super) fn read_columns(
    connection: &Connection,
    schema: &str,
    table: &str,
) -> Result<Vec<NativeColumn>, String> {
    let mut statement = connection
        .prepare(&format!(
            "PRAGMA {}.table_xinfo({})",
            quote(schema),
            quote(table)
        ))
        .map_err(db_error)?;
    let mut rows = statement.query([]).map_err(db_error)?;
    let mut columns = Vec::new();
    while let Some(row) = rows.next().map_err(db_error)? {
        if columns.len() == 256 || row.get::<_, i64>(6).map_err(db_error)? != 0 {
            return Err("Codex history columns exceed the supported writable structure".into());
        }
        let column = NativeColumn {
            name: row.get(1).map_err(db_error)?,
            data_type: row
                .get::<_, String>(2)
                .map_err(db_error)?
                .trim()
                .to_ascii_uppercase(),
            not_null: row.get(3).map_err(db_error)?,
            primary_key: row.get(5).map_err(db_error)?,
            default: row.get(4).map_err(db_error)?,
        };
        if column.name.is_empty()
            || column.name.len() > 256
            || column.name.contains('\0')
            || column.data_type.len() > 128
            || column.default.as_ref().is_some_and(|v| v.len() > 4096)
            || !matches!(column.not_null, 0 | 1)
            || !(0..=256).contains(&column.primary_key)
        {
            return Err("Invalid native Codex column contract".into());
        }
        columns.push(column);
    }
    columns.sort_by(|a, b| a.name.cmp(&b.name));
    if columns.is_empty() || columns.windows(2).any(|v| v[0].name == v[1].name) {
        return Err("Missing or ambiguous native Codex table".into());
    }
    Ok(columns)
}

/// Keep the complete contract between the two native stores, but require only
/// fields this operation reads or keys. Ordinary added columns remain opaque.
pub(super) fn validate_columns(table: &str, columns: &[NativeColumn]) -> Result<(), String> {
    let (required, key): (&[(&str, &str)], &[&str]) = match table {
        "threads" | "thread_record" => (
            &[
                ("id", "TEXT"),
                ("rollout_path", "TEXT"),
                ("cwd", "TEXT"),
                ("model_provider", "TEXT"),
                ("model", "TEXT"),
                ("sandbox_policy", "TEXT"),
                ("approval_mode", "TEXT"),
                ("updated_at", "INTEGER"),
                ("archived", "INTEGER"),
                ("history_mode", "TEXT"),
            ],
            &["id"],
        ),
        "thread_turns" => (
            &[
                ("thread_id", "TEXT"),
                ("turn_id", "TEXT"),
                ("status", "TEXT"),
            ],
            &["thread_id", "turn_id"],
        ),
        "thread_items" => (
            &[
                ("thread_id", "TEXT"),
                ("turn_id", "TEXT"),
                ("item_id", "TEXT"),
            ],
            &["thread_id", "turn_id", "item_id"],
        ),
        "thread_realtime_items" => (
            &[("thread_id", "TEXT"), ("item_id", "TEXT")],
            &["thread_id", "item_id"],
        ),
        "thread_history_projection_state" => (
            &[
                ("thread_id", "TEXT"),
                ("next_rollout_byte_offset", "INTEGER"),
                ("next_rollout_ordinal", "INTEGER"),
            ],
            &["thread_id"],
        ),
        _ => return Err("Unknown Codex history operation table".into()),
    };
    for (name, data_type) in required {
        if !columns
            .iter()
            .any(|c| c.name == *name && c.data_type == *data_type)
        {
            return Err(format!(
                "Codex history requires {table}.{name} with its native type"
            ));
        }
    }
    let mut actual: Vec<_> = columns.iter().filter(|c| c.primary_key > 0).collect();
    actual.sort_by_key(|c| c.primary_key);
    if actual.len() != key.len()
        || actual
            .iter()
            .zip(key)
            .enumerate()
            .any(|(i, (c, k))| c.name != *k || c.primary_key != i as i64 + 1)
    {
        return Err(format!("Codex history identity key changed for {table}"));
    }
    Ok(())
}

pub(super) const STATE_TRIGGERS: &[(&str, &str)] = &[
    ("threads_created_at_ms_after_insert", "CREATE TRIGGER threads_created_at_ms_after_insert AFTER INSERT ON threads WHEN NEW.created_at_ms IS NULL BEGIN UPDATE threads SET created_at_ms = NEW.created_at * 1000 WHERE id = NEW.id; END"),
    ("threads_updated_at_ms_after_insert", "CREATE TRIGGER threads_updated_at_ms_after_insert AFTER INSERT ON threads WHEN NEW.updated_at_ms IS NULL BEGIN UPDATE threads SET updated_at_ms = NEW.updated_at * 1000 WHERE id = NEW.id; END"),
    ("threads_created_at_ms_after_update", "CREATE TRIGGER threads_created_at_ms_after_update AFTER UPDATE OF created_at ON threads WHEN NEW.created_at != OLD.created_at AND NEW.created_at_ms IS OLD.created_at_ms BEGIN UPDATE threads SET created_at_ms = NEW.created_at * 1000 WHERE id = NEW.id; END"),
    ("threads_updated_at_ms_after_update", "CREATE TRIGGER threads_updated_at_ms_after_update AFTER UPDATE OF updated_at ON threads WHEN NEW.updated_at != OLD.updated_at AND NEW.updated_at_ms IS OLD.updated_at_ms BEGIN UPDATE threads SET updated_at_ms = NEW.updated_at * 1000 WHERE id = NEW.id; END"),
    ("threads_recency_at_after_insert", "CREATE TRIGGER threads_recency_at_after_insert AFTER INSERT ON threads WHEN NEW.recency_at_ms = 0 BEGIN UPDATE threads SET recency_at = NEW.updated_at, recency_at_ms = COALESCE(NEW.updated_at_ms, NEW.updated_at * 1000) WHERE id = NEW.id; END"),
];
pub(super) const HISTORY_TRIGGERS: &[(&str, &str)] = &[
    ("thread_realtime_items_projection_cleanup", "CREATE TRIGGER thread_realtime_items_projection_cleanup AFTER DELETE ON thread_history_projection_state BEGIN DELETE FROM thread_realtime_items WHERE thread_id = OLD.thread_id; END"),
];

pub(super) fn normalized_sql(sql: &str) -> String {
    sql.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_end_matches(';')
        .to_ascii_lowercase()
}

pub(super) fn validate_schema(connection: &Connection, schema: &str) -> Result<(), String> {
    let history = schema == "history";
    let touched: Vec<&str> = if history {
        HISTORY_TABLES.iter().map(|entry| entry.0).collect()
    } else {
        vec!["threads"]
    };
    let relevant = |name: &str| touched.iter().any(|table| table.eq_ignore_ascii_case(name));
    let mut statement = connection
        .prepare(&format!(
            "SELECT name FROM {}.sqlite_master WHERE type='table' ORDER BY name LIMIT 513",
            quote(schema)
        ))
        .map_err(db_error)?;
    let tables: Vec<String> = statement
        .query_map([], |r| r.get(0))
        .map_err(db_error)?
        .collect::<Result<_, _>>()
        .map_err(db_error)?;
    if tables.len() > 512 || tables.iter().any(|name| name.len() > 256) {
        return Err("Codex history schema inspection exceeds its limit".into());
    }
    for table in &touched {
        validate_columns(table, &read_columns(connection, schema, table)?)?;
    }
    // Unknown unrelated tables are preserved. Declared dependencies on rows we
    // delete cannot be guessed or cascaded into an unexamined native table.
    for table in &tables {
        let mut statement = connection
            .prepare(&format!(
                "PRAGMA {}.foreign_key_list({})",
                quote(schema),
                quote(table)
            ))
            .map_err(db_error)?;
        let mut rows = statement.query([]).map_err(db_error)?;
        let mut count = 0;
        while let Some(row) = rows.next().map_err(db_error)? {
            count += 1;
            if count > 256 {
                return Err("Codex foreign-key inspection exceeds its limit".into());
            }
            let parent: String = row.get(2).map_err(db_error)?;
            let from: String = row.get(3).map_err(db_error)?;
            let to: Option<String> = row.get(4).map_err(db_error)?;
            let update: String = row.get(5).map_err(db_error)?;
            let delete: String = row.get(6).map_err(db_error)?;
            if history && (relevant(table) || relevant(&parent)) {
                return Err(
                    "Codex projection has an unhandled native foreign-key dependency".into(),
                );
            }
            if !history
                && table.eq_ignore_ascii_case("threads")
                && !matches!(
                    (
                        parent.as_str(),
                        from.as_str(),
                        to.as_deref(),
                        update.as_str(),
                        delete.as_str()
                    ),
                    (
                        "projects",
                        "project_id",
                        Some("id"),
                        "NO ACTION",
                        "SET NULL"
                    ) | (
                        "thread_sections",
                        "thread_section_id",
                        Some("id"),
                        "NO ACTION",
                        "SET NULL"
                    )
                )
            {
                return Err("Codex thread has an unhandled native foreign-key dependency".into());
            }
            // The thread identity is never updated or replaced. Incoming keys
            // targeting another mutable column need their own native adapter.
            if !history
                && parent.eq_ignore_ascii_case("threads")
                && to.as_deref().is_some_and(|name| name != "id")
            {
                return Err(
                    "Codex metadata has an unhandled incoming foreign-key dependency".into(),
                );
            }
        }
    }
    let expected = if history {
        HISTORY_TRIGGERS
    } else {
        STATE_TRIGGERS
    };
    let mut statement = connection.prepare(&format!("SELECT name,tbl_name,sql FROM {}.sqlite_master WHERE type='trigger' ORDER BY name LIMIT 513", quote(schema))).map_err(db_error)?;
    let triggers = statement
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error)?;
    if triggers.len() > 512 {
        return Err("Codex trigger inspection exceeds its limit".into());
    }
    for (name, table, sql) in triggers {
        if relevant(&table)
            && !expected
                .iter()
                .any(|(n, s)| name == *n && normalized_sql(&sql) == normalized_sql(s))
        {
            return Err("Codex history write has an unhandled native trigger".into());
        }
    }
    Ok(())
}
