//! Native popup without retaining the WebView resource lock during AppKit tracking.
use std::sync::{Arc, MutexGuard};
use tauri::{menu::ContextMenu, Manager, Resource, ResourceId, ResourceTable};

// ResourceTable::get returns an owned Arc. Release the guard before calling
// into a nested native event loop, where unrelated IPC can need this table.
fn with_unlocked_resource<T: Resource, U>(
    resources: MutexGuard<'_, ResourceTable>,
    rid: ResourceId,
    use_resource: impl FnOnce(Arc<T>) -> tauri::Result<U>,
) -> tauri::Result<U> {
    let resource = resources.get::<T>(rid)?;
    drop(resources);
    use_resource(resource)
}

#[tauri::command]
pub async fn popup_native_menu(
    webview: tauri::Webview,
    window: tauri::Window,
    rid: ResourceId,
    at: Option<tauri::Position>,
) -> Result<(), String> {
    with_unlocked_resource::<tauri::menu::Menu<tauri::Wry>, _>(
        webview.resources_table(),
        rid,
        |menu| match at {
            Some(position) => menu.popup_at(window, position),
            None => menu.popup(window),
        },
    )
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct TestResource;
    impl Resource for TestResource {}

    #[test]
    fn popup_callback_can_reenter_resource_table() {
        let table = Mutex::new(ResourceTable::default());
        let rid = table.lock().unwrap().add(TestResource);
        with_unlocked_resource::<TestResource, _>(table.lock().unwrap(), rid, |resource| {
            let mut reentered = table.try_lock().expect("popup must not hold resource lock");
            reentered.close(rid)?;
            // The popup still owns its resource even if another command closes
            // the table entry during the nested event loop.
            assert_eq!(Arc::strong_count(&resource), 1);
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn invalid_resource_releases_lock_without_entering_popup() {
        let table = Mutex::new(ResourceTable::default());
        let result = with_unlocked_resource::<TestResource, ()>(table.lock().unwrap(), 42, |_| {
            panic!("invalid resource must not open a popup")
        });
        assert!(result.is_err());
        assert!(table.try_lock().is_ok());
    }
}
