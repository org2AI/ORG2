/**
 * Detached station windows.
 *
 * `open_station_window` builds (or focuses) a native OS window whose label is
 * `app-window-station-<mode>` — inside the `app-window-*` capability glob, so
 * the window gets the full default permission set — and loads the standalone
 * `/orgii/app/station/<mode>` route: My Station or Agent Station on its own,
 * with no chat panel or sidebar. One window per station mode. Window chrome
 * (macOS traffic lights, Win11 corners) is applied on the Rust side; a plain
 * `new WebviewWindow()` from JS cannot reach those post-build native calls.
 *
 * The station in that window follows the MAIN window's remembered session:
 * the route is seeded with `sessionId` at open time, and every later change
 * is delivered over the `orgii:station-window:session` window-targeted event
 * (`emitStationWindowSession`). The main window learns the window went away
 * through `orgii:station-window-closed`, raised by the Rust `Destroyed`
 * handler so a crash or programmatic close still reports.
 */
import { emitTo } from "@tauri-apps/api/event";
import { Window } from "@tauri-apps/api/window";

import type { StationMode } from "@src/types/ui/workstation";
import { invokeTauri } from "@src/util/platform/tauri/init";
import { STATION_WINDOW_LABEL_PREFIX } from "@src/util/platform/tauri/windowIdentity";

/** Window-targeted event carrying the session a station window must show.
 *  Payload: `{ sessionId: string | null }`. */
export const STATION_WINDOW_SESSION_EVENT = "orgii:station-window:session";

/** Main-window event raised by Rust when a station window is destroyed.
 *  Payload: the window label. Must match `STATION_WINDOW_CLOSED_EVENT` in
 *  the Rust `app-window` crate. */
export const STATION_WINDOW_CLOSED_EVENT = "orgii:station-window-closed";
export const STATION_WINDOW_READY_EVENT = "orgii:station-window:ready";
export const STATION_WINDOW_MAIN_NAVIGATE_EVENT =
  "orgii:station-window:main-navigate";

export interface StationWindowMainNavigation {
  path: string;
  replace?: boolean;
  action?: "open-kanban";
}

/** Chat/settings surfaces belong to main; never mount its shell in a station. */
export async function navigateInMainWindow(
  payload: StationWindowMainNavigation
): Promise<void> {
  await emitTo("main", STATION_WINDOW_MAIN_NAVIGATE_EVENT, payload);
  const main = await Window.getByLabel("main");
  if (main) {
    await main.show();
    await main.setFocus();
  }
}

export interface StationWindowSessionPayload {
  sessionId: string | null;
  /** Only explicit detach/open requests reset the selected station. */
  stationMode?: StationMode;
}

export interface OpenStationWindowOptions {
  /** Session the station should converge on; the main window's remembered
   *  selection at open time. Seeds the route so a cold window needs no
   *  listener to be up before the first follow event. */
  sessionId?: string | null;
  /** Native window title; defaults to "ORG2" on the Rust side. */
  title?: string;
}

export function getStationWindowLabel(stationMode: StationMode): string {
  return `${STATION_WINDOW_LABEL_PREFIX}${stationMode}`;
}

/** Create or focus the detached window for one station. Resolves to the
 *  window label. Rejects when the mode is unknown, the seed session id is
 *  unsafe for a route, or the platform window build fails — callers leave
 *  their in-window layout untouched in that case. */
export async function openStationWindow(
  stationMode: StationMode,
  options: OpenStationWindowOptions = {}
): Promise<string> {
  return invokeTauri<string>("open_station_window", {
    stationMode,
    sessionId: options.sessionId ?? null,
    title: options.title,
  });
}

/**
 * Tell one station window which session to show. Targets the window by
 * label; a label with no live window has no receivers and the emit is a
 * no-op, so callers need not track which station windows exist.
 */
export async function emitStationWindowSession(
  stationMode: StationMode,
  sessionId: string | null,
  options?: { selectStation?: boolean }
): Promise<void> {
  const payload: StationWindowSessionPayload = {
    sessionId,
    ...(options?.selectStation ? { stationMode } : {}),
  };
  await emitTo(
    getStationWindowLabel(stationMode),
    STATION_WINDOW_SESSION_EVENT,
    payload
  );
}

export async function requestStationWindowSession(
  stationMode: StationMode
): Promise<void> {
  await emitTo(
    "main",
    STATION_WINDOW_READY_EVENT,
    getStationWindowLabel(stationMode)
  );
}
