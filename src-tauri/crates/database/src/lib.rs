//! Database Infrastructure
//!
//! Shared SQLite connection plumbing: pool, PRAGMA configuration, DB-file
//! path resolution, and a registration-based schema-init dispatcher.
//!
//! This is a leaf workspace crate — it depends only on `app_paths` for
//! filesystem path resolution and never imports from the `app` crate.
//!
//! # Schema-init dispatcher
//!
//! Two physical SQLite files share this module:
//!
//! - `~/.orgii/sessions.db`           — sessions, CLI agents, inbox, dev
//!   records, lineage, orchestrator, plan approvals, agent-core unified
//!   session persistence. Entry point: [`db::get_connection`].
//! - `~/.orgii/projects/projects.db`  — projects, work items, labels,
//!   milestones, members. Entry point: [`db::get_projects_connection`].
//!
//! The actual `CREATE TABLE` DDL still lives in the `app` crate (each
//! domain module owns its own schema). At app startup, `app::run()` calls
//! [`register_sessions_init`] and [`register_projects_init`] once with
//! function pointers that walk every domain module's `init_*_tables`. The
//! database crate never depends on those modules — the dispatcher is just a
//! `OnceLock<fn(&Connection) -> SqliteResult<()>>` per physical DB.
//!
//! Tests that open a connection without registering an initializer get a
//! no-op pass: PRAGMAs run, but no schema is created. Production code must
//! call the registration helpers before any consumer hits `get_connection`.

pub mod db;

pub use db::{
    begin_connection_pool_shutdown, begin_immediate, checkpoint_database,
    checkpoint_projects_for_shutdown, checkpoint_sessions_for_shutdown,
    checkpoint_sessions_if_wal_exceeds, configure_connection, connection_pool_metrics, get_db_path,
    init_shell_replay_tables, register_projects_init, register_sessions_init,
    sessions_writer_guard, try_with_sessions_writer, wal_bytes, wal_path, with_sessions_writer,
    ConnectionPoolDrainReport, ConnectionPoolMetrics, ConnectionPoolPathMetrics,
    SessionsWriterGuard, WalCheckpointMode, WalCheckpointReport, WalMaintenanceOutcome,
};
