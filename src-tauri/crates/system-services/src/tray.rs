//! System tray menu management
//!
//! Handles creation and event handling for the system tray icon and menu

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};

/// Load tray icon - embedded at compile time from icons folder.
///
/// `tray-icon.png` is a 32×32 monochrome PNG with transparent background — the
/// shape is encoded in the alpha channel, RGB is solid black. macOS treats it
/// as a template image (see `icon_as_template(true)` below) and tints it for
/// light/dark menu bar automatically. Windows/Linux render it as-is.
fn load_tray_icon() -> Image<'static> {
    Image::from_bytes(include_bytes!("../../../icons/tray-icon.png"))
        .expect("Failed to load embedded tray icon")
}

const TRAY_ID: &str = "orgii-tray";
const SESSION_PREFIX: &str = "tray-session:";

#[derive(serde::Deserialize)]
pub struct TraySession {
    id: String,
    title: String,
}

#[derive(serde::Deserialize)]
pub struct TraySection {
    title: String,
    #[serde(rename = "markAllReadLabel")]
    mark_all_read_label: Option<String>,
    #[serde(default)]
    expanded: bool,
    sessions: Vec<TraySession>,
}

#[derive(Debug, PartialEq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TrayAction {
    Kanban,
    Runtime,
    MarkAllRead,
    Session { id: String },
}

fn action_for_menu_id(id: &str) -> Option<TrayAction> {
    match id {
        "show_kanban" => Some(TrayAction::Kanban),
        "show_runtime" => Some(TrayAction::Runtime),
        "mark_all_read" => Some(TrayAction::MarkAllRead),
        _ => id
            .strip_prefix(SESSION_PREFIX)
            .map(|id| TrayAction::Session { id: id.to_owned() }),
    }
}

#[derive(Default)]
pub struct PendingAction(std::sync::Mutex<Option<TrayAction>>);

impl PendingAction {
    fn select(&self, action: TrayAction) {
        if let Ok(mut pending) = self.0.lock() {
            *pending = Some(action);
        }
    }

    fn take(&self) -> Result<Option<TrayAction>, String> {
        Ok(self.0.lock().map_err(|error| error.to_string())?.take())
    }
}

/// The frontend projects the same session metadata used by the sidebar.
/// Native resources are bounded to four sections of five sessions each.
#[tauri::command]
pub fn tray_update_sessions(
    app: AppHandle,
    window: tauri::WebviewWindow,
    sections: Vec<TraySection>,
    empty_label: String,
    quit_label: String,
    kanban_label: String,
    runtime_label: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the main window owns the tray".into());
    }
    let menu = session_menu(
        &app,
        &sections,
        &empty_label,
        &quit_label,
        &kanban_label,
        &runtime_label,
    )
    .map_err(|error| error.to_string())?;
    app.tray_by_id(TRAY_ID)
        .ok_or("Tray is unavailable")?
        .set_menu(Some(menu))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn tray_take_pending_action(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, PendingAction>,
) -> Result<Option<TrayAction>, String> {
    if window.label() != "main" {
        return Err("Only the main window owns the tray".into());
    }
    state.take()
}

fn session_menu(
    app: &AppHandle,
    sections: &[TraySection],
    empty_label: &str,
    quit_label: &str,
    kanban_label: &str,
    runtime_label: &str,
) -> Result<Menu<tauri::Wry>, tauri::Error> {
    let menu = Menu::new(app)?;
    menu.append(&MenuItem::with_id(
        app,
        "show_kanban",
        kanban_label,
        true,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        "show_runtime",
        runtime_label,
        true,
        None::<&str>,
    )?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    let mut has_sessions = false;
    let mut previous_expanded = false;
    for (index, section) in sections.iter().take(4).enumerate() {
        if section.sessions.is_empty() {
            continue;
        }
        if has_sessions && (section.expanded || previous_expanded) {
            menu.append(&PredefinedMenuItem::separator(app)?)?;
        }
        let submenu = if section.expanded {
            menu.append(&MenuItem::with_id(
                app,
                format!("tray-heading:{index}"),
                &section.title,
                false,
                None::<&str>,
            )?)?;
            None
        } else {
            Some(Submenu::with_id(
                app,
                format!("tray-heading:{index}"),
                &section.title,
                true,
            )?)
        };
        if let (Some(submenu), Some(label)) = (&submenu, &section.mark_all_read_label) {
            submenu.append(&MenuItem::with_id(
                app,
                "mark_all_read",
                label,
                true,
                None::<&str>,
            )?)?;
            submenu.append(&PredefinedMenuItem::separator(app)?)?;
        }
        for session in section.sessions.iter().take(5) {
            let item = MenuItem::with_id(
                app,
                format!("{SESSION_PREFIX}{}", session.id),
                &session.title,
                true,
                None::<&str>,
            )?;
            if let Some(submenu) = &submenu {
                submenu.append(&item)?;
            } else {
                menu.append(&item)?;
            }
        }
        if let Some(submenu) = submenu {
            menu.append(&submenu)?;
        }
        has_sessions = true;
        previous_expanded = section.expanded;
    }
    if !has_sessions {
        menu.append(&MenuItem::with_id(
            app,
            "open_app",
            empty_label,
            true,
            None::<&str>,
        )?)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(
        app,
        "quit",
        quit_label,
        true,
        None::<&str>,
    )?)?;
    Ok(menu)
}

/// Setup the system tray with icon and menu
pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(PendingAction::default());
    let menu = session_menu(
        app,
        &[],
        "Open App",
        "Quit ORG2",
        "Show Kanban",
        "Show Runtime",
    )?;
    let icon = load_tray_icon();

    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open_app" => {
                let _ = app_window::recreate_main_window(app);
            }
            "quit" => {
                app.exit(0);
            }
            id => {
                let Some(action) = action_for_menu_id(id) else {
                    return;
                };
                let restore_window =
                    action != TrayAction::MarkAllRead || app.get_webview_window("main").is_none();
                app.state::<PendingAction>().select(action);
                if !restore_window || app_window::recreate_main_window(app).is_ok() {
                    if let Some(window) = app.get_webview_window("main") {
                        // Persist until consumed: a recreated webview may not have
                        // installed its listener yet. Startup drains the same slot.
                        let _ = window.emit("tray-open-action", ());
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_selection_survives_until_frontend_is_ready_and_is_consumed_once() {
        let pending = PendingAction::default();
        assert_eq!(pending.take().unwrap(), None);
        pending.select(TrayAction::Session {
            id: "claude-code:session/one".into(),
        });
        assert_eq!(
            pending.take().unwrap(),
            Some(TrayAction::Session {
                id: "claude-code:session/one".into()
            })
        );
        assert_eq!(pending.take().unwrap(), None);
    }

    #[test]
    fn repeated_clicks_keep_only_the_latest_selection() {
        let pending = PendingAction::default();
        pending.select(TrayAction::Kanban);
        pending.select(TrayAction::Runtime);
        assert_eq!(pending.take().unwrap(), Some(TrayAction::Runtime));
    }

    #[test]
    fn routes_top_actions_and_session_submenus_with_typed_wire_payloads() {
        assert_eq!(action_for_menu_id("show_kanban"), Some(TrayAction::Kanban));
        assert_eq!(
            action_for_menu_id("show_runtime"),
            Some(TrayAction::Runtime)
        );
        assert_eq!(
            action_for_menu_id("mark_all_read"),
            Some(TrayAction::MarkAllRead)
        );
        assert_eq!(
            serde_json::to_value(TrayAction::MarkAllRead).unwrap(),
            serde_json::json!({"kind":"markAllRead"})
        );
        assert_eq!(action_for_menu_id("tray-heading:0"), None);
        assert_eq!(
            action_for_menu_id("tray-session:one"),
            Some(TrayAction::Session { id: "one".into() })
        );
        assert_eq!(
            serde_json::to_value(TrayAction::Runtime).unwrap(),
            serde_json::json!({"kind":"runtime"})
        );
        assert_eq!(
            serde_json::to_value(TrayAction::Session { id: "one".into() }).unwrap(),
            serde_json::json!({"kind":"session", "id":"one"})
        );
    }

    #[test]
    fn accepts_frontend_section_wire_payload() {
        let section: TraySection = serde_json::from_value(serde_json::json!({
            "title": "Unread",
            "markAllReadLabel": "Mark all as read",
            "sessions": [{ "id": "session-one", "title": "Fix tray menu" }]
        }))
        .unwrap();
        assert_eq!(section.title, "Unread");
        assert!(!section.expanded);
        let running: TraySection = serde_json::from_value(serde_json::json!({
            "title": "Running (1)", "expanded": true,
            "sessions": [{ "id": "running-one", "title": "Working" }]
        }))
        .unwrap();
        assert!(running.expanded);
        assert_eq!(
            section.mark_all_read_label.as_deref(),
            Some("Mark all as read")
        );
        assert_eq!(section.sessions[0].id, "session-one");
        assert_eq!(section.sessions[0].title, "Fix tray menu");
    }
}
