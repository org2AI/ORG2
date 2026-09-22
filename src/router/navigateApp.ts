import { isStationWindow } from "@src/util/platform/tauri/windowIdentity";

export const STATION_WINDOW_NAVIGATE_EVENT = "station-window-navigate";

/** Route intent is consumed by the shell that owns this window. */
export function navigateApp(path: string, replace?: boolean): void {
  window.dispatchEvent(
    new CustomEvent(
      isStationWindow()
        ? STATION_WINDOW_NAVIGATE_EVENT
        : "action-system-navigate",
      {
        detail: { path, ...(replace === undefined ? {} : { replace }) },
      }
    )
  );
}
