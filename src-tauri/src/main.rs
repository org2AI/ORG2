//! ORGII Desktop Application
//!
//! Main entry point for the Tauri application.

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let mut args = std::env::args().skip(1);
    let command = args.next();
    if command.as_deref() == Some("--market-auth") {
        #[cfg(feature = "market-connect")]
        if app_lib::market_connection::auth_helper::run(args).is_ok() {
            return;
        }
        eprintln!("Market connection needs attention. Open ORG2 to reconnect.");
        std::process::exit(1);
    }
    if command.as_deref() == Some("--session-provenance-hook") {
        if let Some(source) = args.next() {
            // Hooks are observational: capture failure must never fail or delay
            // the agent tool invocation that triggered this process.
            let _ = app_lib::orgtrack::session_provenance::capture_hook_stdin(&source);
        }
        return;
    }
    app_lib::run();
}
