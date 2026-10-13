//! ORGII Desktop Application
//!
//! Main entry point for the Tauri application.

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let cli_args: Vec<String> = std::env::args().skip(1).collect();
    if cli_args
        .first()
        .is_some_and(|arg| matches!(arg.as_str(), "ui" | "rulebook"))
    {
        std::process::exit(org2_ui_cli::run(cli_args));
    }
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() == Some("--session-provenance-hook") {
        if let Some(source) = args.next() {
            // Hooks are observational: capture failure must never fail or delay
            // the agent tool invocation that triggered this process.
            let _ = app_lib::orgtrack::session_provenance::capture_hook_stdin(&source);
        }
        return;
    }
    app_lib::run();
}
