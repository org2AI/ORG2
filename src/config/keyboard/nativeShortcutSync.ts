import { isTauriDesktop } from "@src/util/platform/tauri";

import {
  type KeyBinding,
  bindingAccelerator,
  getOverride,
  isRecordingShortcut,
  resolvedBindings,
} from "./shortcutBindings";

const MENU_SHORTCUT_IDS = [
  "quit_app",
  "new_session",
  "window_open_folder",
  "window_close",
  "open_workspace_selector",
  "open_branch_selector",
  "open_location_selector",
  "open_model_selector",
  "open_settings",
  "maximize_work_station",
];
interface NativeShortcutSnapshot {
  overrides: Record<string, string>;
  recording: boolean;
  forwarded: Record<string, KeyBinding[]>;
}
// One in-flight update and one replacement snapshot, even during rapid edits.
let pending: Promise<void> | undefined;
let latest: NativeShortcutSnapshot | undefined;
export function syncNativeShortcuts(): Promise<void> {
  if (!isTauriDesktop()) return Promise.resolve();
  const overrides: Record<string, string> = {};
  for (const id of MENU_SHORTCUT_IDS) {
    const binding = getOverride(id);
    if (binding) overrides[id] = bindingAccelerator(binding);
  }
  const forwarded: Record<string, KeyBinding[]> = {};
  for (const [name, id] of Object.entries({
    zoomIn: "zoom_in",
    zoomOut: "zoom_out",
    zoomReset: "zoom_reset",
    toggleSpotlight: "toggle_spotlight",
    openFilePalette: "quick_open",
  })) {
    forwarded[name] = resolvedBindings(id);
    if (id === "zoom_in" && !getOverride(id)) {
      forwarded[name] = [false, true].map((shift) => ({
        ...forwarded[name][0],
        key: "=",
        shift,
      }));
    }
  }
  latest = { overrides, recording: isRecordingShortcut(), forwarded };
  if (!pending) {
    pending = (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      while (latest) {
        const snapshot = latest;
        latest = undefined;
        await invoke("menu_set_shortcut_overrides", { ...snapshot });
      }
    })().finally(() => {
      pending = undefined;
    });
  }
  return pending;
}
