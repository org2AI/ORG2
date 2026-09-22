use tauri::{plugin::TauriPlugin, Runtime};
#[cfg(target_os = "ios")]
use tauri::Manager;

mod error;
#[cfg(target_os = "ios")]
mod mobile;

pub use error::{Error, Result};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("speech")
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            _app.manage(mobile::init(_app, _api)?);
            Ok(())
        })
        .build()
}
