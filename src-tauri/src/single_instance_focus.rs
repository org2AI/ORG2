//! macOS focus hand-off after duplicate-launch forwarding.
use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication};

/// The admitted secondary owns the user's activation intent. Activate the
/// verified IPC peer before returning, without bootstrapping another app.
pub(crate) fn activate_process(pid: libc::pid_t) {
    let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid) else {
        return;
    };
    // `ActivateIgnoringOtherApps` is a no-op on macOS 14+, where holding the
    // user's launch intent is what grants this request, but it is still
    // required for cross-application activation on older systems.
    #[allow(deprecated)]
    let options = NSApplicationActivationOptions::ActivateAllWindows
        | NSApplicationActivationOptions::ActivateIgnoringOtherApps;
    if !app.activateWithOptions(options) {
        tracing::debug!("could not activate the already-running app instance");
    }
}
