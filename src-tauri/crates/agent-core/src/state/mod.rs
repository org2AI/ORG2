//! Agent application state — single Tauri state for all agent types.
//!
//! This module provides a centralized state that manages all agent instances.
//!
//! # Architecture
//!
//! ```text
//! AgentAppState (Tauri managed state)
//!     ├── Shared resources (browser, PTY, memory, gateway)
//!     └── Per-session resources (AgentSession instances)
//! ```

pub mod commands;
pub mod control_flow;
pub mod integrations_store;
mod session_identity;
mod session_runtime;
mod unified;

// `IntegrationsStore` and its `UpdateError` are reached through the
// deeper `state::integrations_store::*` path; the module is public so
// background subsystems and the main crate can call the process-wide
// `integrations_store()` accessor.
pub use session_identity::session_identity_lock;
pub use session_runtime::{AgentSession, SessionIdentityMutationGuard, SessionRuntime};
pub use unified::AgentAppState;
