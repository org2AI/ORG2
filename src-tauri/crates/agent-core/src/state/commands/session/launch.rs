//! Thin adapter for the public session launch command and HTTP test routes.
//!
//! The application service owns the serialized launch snapshot and dispatch.

use crate::definitions::orgs::AgentOrgsStore;
use crate::state::AgentAppState;

// Keep the public command shape stable while its owner lives below this adapter.
pub use crate::session::launch::service::{
    SessionLaunchRequest as SessionLaunchParams, SessionLaunchResult, SESSION_CATEGORY_CLI_AGENT,
    SESSION_CATEGORY_RUST_AGENT,
};

pub async fn session_launch_impl(
    state: &AgentAppState,
    org_store: Option<&AgentOrgsStore>,
    params: SessionLaunchParams,
) -> Result<SessionLaunchResult, String> {
    crate::session::launch::service::launch_session(state, org_store, params).await
}
