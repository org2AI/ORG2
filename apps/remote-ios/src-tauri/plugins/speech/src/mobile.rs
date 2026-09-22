use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_speech);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<Speech<R>> {
    let handle = api.register_ios_plugin(init_plugin_speech)?;
    Ok(Speech(handle))
}

pub struct Speech<R: Runtime>(#[allow(dead_code)] PluginHandle<R>);
