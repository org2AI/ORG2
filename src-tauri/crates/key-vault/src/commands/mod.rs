//! Tauri commands for credential validation
//!
//! Exposes validation functions to the frontend via Tauri's invoke system.

mod quota_history;
mod quota_history_identity;
pub use quota_history::*;
mod cli_version;
mod crud;
mod install;
mod prompt_polish;
pub mod registry;
mod validate;

pub use cli_version::*;
pub use crud::*;
pub use install::*;
pub use prompt_polish::*;
pub use registry::*;
pub use validate::*;

#[cfg(test)]
mod tests;
