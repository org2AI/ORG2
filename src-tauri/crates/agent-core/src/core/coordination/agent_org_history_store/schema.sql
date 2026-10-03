CREATE TABLE IF NOT EXISTS org_history_state (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    cutover_complete INTEGER NOT NULL CHECK(cutover_complete=1)
);
CREATE TABLE IF NOT EXISTS org_history_archives (
    id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS org_history_schema_objects (
    archive_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    object_type TEXT NOT NULL,
    table_name TEXT NOT NULL,
    original_sql TEXT,
    raw_table TEXT,
    PRIMARY KEY(archive_id, name)
);
CREATE TABLE IF NOT EXISTS org_history_sessions (
    session_id TEXT PRIMARY KEY,
    root_session_id TEXT,
    run_id TEXT,
    member_id TEXT,
    member_name TEXT,
    title TEXT,
    source_table TEXT NOT NULL,
    original_status TEXT
);
CREATE INDEX IF NOT EXISTS idx_org_history_sessions_root
    ON org_history_sessions(root_session_id, session_id);
CREATE INDEX IF NOT EXISTS idx_org_history_sessions_run
    ON org_history_sessions(run_id, session_id);
CREATE TABLE IF NOT EXISTS org_history_items (
    id TEXT PRIMARY KEY,
    root_session_id TEXT NOT NULL,
    source_session_id TEXT,
    kind TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    source_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_org_history_items_page
    ON org_history_items(root_session_id, created_at, id);
CREATE TABLE IF NOT EXISTS org_history_copies (
    source_session_id TEXT PRIMARY KEY,
    copy_session_id TEXT NOT NULL UNIQUE
);
-- Transcript provenance only: no wake, delivery or acknowledgement state.
CREATE TABLE IF NOT EXISTS org_history_inbox_messages (
    session_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    PRIMARY KEY(session_id,message_id)
);
