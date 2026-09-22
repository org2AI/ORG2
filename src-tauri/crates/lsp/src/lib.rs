//! LSP (Language Server Protocol) Module
//!
//! Provides LSP server process management and JSON-RPC communication
//! for TypeScript, JavaScript, Python, Rust, Go, C/C++, and other languages.

pub mod codec;
mod command_detection;
pub mod commands;
pub mod config;
pub mod install_pipeline;
pub mod log_buffer;
pub mod manager;
pub mod protocol;
pub mod root_detection;
pub mod server;
pub mod server_defs;
pub mod types;
pub mod workspace_config;

pub use commands::LspManagerState;
pub use config::{
    global_config, is_auto_install_enabled, load_config, reload_config, save_config, update_config,
    ConfigError, CustomServerDef, LspConfig, ServerOverride,
};
pub use install_pipeline::{
    ensure_binary, find_binary, is_install_enabled_sync, InstallError, InstallMethod,
};
pub use manager::{server_key_for_language, LspManager, ServerKey};
pub use root_detection::{find_nearest_root, find_workspace_root, RootPattern};
pub use server_defs::{
    builtin_servers, server_by_id, servers_for_file, servers_for_language_id, supported_extensions,
    supported_language_ids, ServerDef,
};
pub use types::*;
pub use workspace_config::{
    lsp_get_workspace_config, lsp_is_server_enabled, lsp_set_server_enabled,
};
