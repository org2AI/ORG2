//! Local MiniCPM/vLLM "housekeeper" Tauri commands (prompt polish, session step
//! explain, health check, token benchmark, UI intent, rolling context summary).
//!
//! The implementation is split into focused submodules; this file wires them
//! together and re-exports the public command surface unchanged.

mod client;
mod explain;
mod housekeeper;
mod polish;
mod text;

/// Shared HTTP timeout for the polish/step-explain/context-summary requests.
const POLISH_REQUEST_TIMEOUT_SECONDS: u64 = 60;

pub use explain::{session_step_explain, SessionStepExplainRequest, SessionStepExplainResponse};
pub use housekeeper::{
    housekeeper_health_check, housekeeper_token_benchmark, housekeeper_ui_intent,
    summarize_housekeeper_context, HousekeeperContextSummaryRequest,
    HousekeeperContextSummaryResponse, HousekeeperHealthCheckRequest,
    HousekeeperHealthCheckResponse, HousekeeperTokenBenchmarkRequest,
    HousekeeperTokenBenchmarkResponse, HousekeeperUiContext, HousekeeperUiIntentRequest,
    HousekeeperUiIntentResponse,
};
pub use polish::{prompt_polish, PromptPolishRequest, PromptPolishResponse};
