//! LSP command helpers
//!
//! Library helpers used by agent-core (`manage_lsp`) and tests. These
//! functions are not registered as Tauri IPC commands.
//!
//! Organized into submodules by responsibility:
//! - `discovery`: Detect installed LSP servers
//! - `cache`: Persistent cache for LSP server scan results
//! - `package_manager`: Package manager detection and command generation
//! - `install`: Install/uninstall commands for LSP servers

mod cache;
mod install;

// Public modules for reuse in other LSP modules
pub mod discovery;
pub mod package_manager;

use std::sync::Arc;
use tokio::sync::Mutex;

use super::manager::LspManager;

// Re-export state type
pub type LspManagerState = Arc<Mutex<LspManager>>;

pub use discovery::*;
pub use install::*;
