//! Codex CLI credential validation.
//!
//! Validates Codex credentials supporting:
//! - OAuth authentication (ChatGPT Plus/Pro subscription via chatgpt.com)
//! - API key authentication (OpenAI API key via api.openai.com)
//! - Quota fetching from ChatGPT usage API

pub(super) mod app_server;
mod id_token;
mod json_rpc;
mod model_discovery;
mod process_tree;
mod quota;
mod validator;

pub(crate) use id_token::extract_account_id_from_id_token;
#[cfg(test)]
pub(super) use validator::is_oauth_auth_error;
pub use validator::CodexValidator;

#[cfg(test)]
#[path = "../tests/codex_tests.rs"]
mod tests;
