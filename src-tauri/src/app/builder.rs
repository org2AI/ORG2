//! Wires the bootstrap, plugin, setup, and lifecycle pieces into a single
//! Tauri application and runs it.
//!
//! Builder call order is behavior — keep the chain below in its current order.

use crate::app::{bootstrap, lifecycle, plugins, setup_hook};

// Paths inside `commands/handler_list.inc` are resolved from this module, so
// every crate module the generated `tauri::generate_handler!` list names has to
// be in scope here.
use crate::{
    agent_sessions, api, cli_managed_proxy, harness_connections, infrastructure, orgtrack,
    usage_diagnostics,
};

pub(crate) fn run() {
    // Resolve the embedded Tauri identity before ANY app-path consumer runs.
    // Secondary development binaries are commonly launched directly, so a
    // launcher-provided ORGII_HOME cannot be required for isolation. Preserve
    // an explicit override for tests/portable installs; otherwise derive the
    // secondary data root from the same identity that owns its WebView profile
    // and service ports.
    let context = tauri::generate_context!();
    #[cfg(target_os = "macos")]
    if let Err(error) =
        super::dev_process_name::reexec_dev_with_display_name(&context.config().identifier)
    {
        eprintln!("Could not apply the dev Dock name: {error}");
    }
    #[cfg(all(debug_assertions, feature = "webdriver", target_os = "macos"))]
    let context = {
        let mut context = context;
        // Tauri 2.10 does not forward WindowConfig.data_store_identifier.
        // Build the isolated test WebView explicitly in the setup hook.
        if std::env::var_os("ORGII_HOME").is_some() {
            for window in &mut context.config_mut().app.windows {
                if window.label == "main" {
                    window.create = false;
                }
            }
        }
        context
    };

    // Keep this FD alive through application.run; duplicates must leave before
    // bootstrap opens databases or reconciles persisted work.
    #[cfg(target_os = "macos")]
    let _instance_guard = match crate::single_instance_gate::prepare(&context.config().identifier) {
        Ok(crate::single_instance_gate::Admission::Primary(guard)) => guard,
        Ok(crate::single_instance_gate::Admission::Forwarded(pid)) => {
            crate::single_instance_focus::activate_process(pid);
            return;
        }
        Err(error) => {
            eprintln!("Could not enter the application instance: {error}");
            std::process::exit(1);
        }
    };

    bootstrap::bootstrap(&context.config().identifier);

    let builder = plugins::configure();

    let initial_webview_observation = perf_utils::begin_webview_ownership_observation("main");
    let application = builder
        .on_window_event(lifecycle::sync_traffic_lights_on_window_event)
        .invoke_handler(include!(concat!(
            env!("OUT_DIR"),
            "/tauri_invoke_handler_expr.rs"
        )))
        .setup(setup_hook::initialize)
        .on_window_event(lifecycle::handle_window_close_and_destroy)
        .on_page_load(lifecycle::handle_page_load)
        .build(context)
        .unwrap_or_else(|err| {
            tracing::error!(error = %err, "error while building tauri application");
            std::process::exit(1);
        });
    initial_webview_observation.commit();
    application.run(lifecycle::handle_run_event);
}
