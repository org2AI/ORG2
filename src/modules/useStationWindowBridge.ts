/**
 * useStationWindowBridge — the main window's half of detached station
 * windows (`app-window-station-<mode>`).
 *
 * 1. Session follow. A station window renders the station for the MAIN
 *    window's remembered session (`workstationActiveSessionIdAtom`): Agent
 *    Station replays it, My Station shows its per-session tab workspace.
 *    Every change is pushed to both station labels over a window-targeted
 *    Tauri event; a label with no live window simply has no receivers, so
 *    the bridge never has to know which windows exist. The window's initial
 *    session travels in its route instead (`open_station_window`), because
 *    an event can only reach a listener that is already mounted.
 *
 * 2. Restore on close. Detaching the station on screen hands the main
 *    window over to the chat panel; when Rust reports that window destroyed
 *    (`orgii:station-window-closed`, raised from the `Destroyed` handler so
 *    a crash or programmatic close still reports), the split comes back.
 *
 * Main window only: a station window never drives another station window.
 */
import { useSetAtom, useStore } from "jotai";
import { useEffect } from "react";

import {
  STATION_WINDOW_CLOSED_EVENT,
  STATION_WINDOW_MAIN_NAVIGATE_EVENT,
  STATION_WINDOW_READY_EVENT,
  type StationWindowMainNavigation,
  emitStationWindowSession,
} from "@src/api/tauri/stationWindow";
import { createLogger } from "@src/hooks/logger";
import { useTauriListen } from "@src/hooks/platform/useTauriListen";
import { navigateApp } from "@src/router/navigateApp";
import { WorkStationViewService } from "@src/services/workStation/WorkStationViewService";
import { workstationActiveSessionIdAtom } from "@src/store/session/viewAtom";
import { restoreStationAfterWindowClosedAtom } from "@src/store/workstation/stationWindowAtoms";
import { STATION_MODES } from "@src/types/ui/workstation";
import {
  getCurrentWindowLabel,
  getStationWindowModeFromLabel,
  isMainAppWindow,
} from "@src/util/platform/tauri/windowIdentity";

const log = createLogger("StationWindowBridge");

export function useStationWindowBridge(): void {
  const store = useStore();
  const restoreStation = useSetAtom(restoreStationAfterWindowClosedAtom);
  // Station windows only exist inside Tauri; a browser dev document has no
  // peer windows to mirror to and no event bus to listen on.
  const enabled = isMainAppWindow() && getCurrentWindowLabel() !== null;

  useEffect(() => {
    if (!enabled) return;
    let last = store.get(workstationActiveSessionIdAtom);
    return store.sub(workstationActiveSessionIdAtom, () => {
      const sessionId = store.get(workstationActiveSessionIdAtom);
      if (sessionId === last) return;
      last = sessionId;
      for (const mode of STATION_MODES) {
        // Best effort: the station window is a mirror, not the owner.
        emitStationWindowSession(mode, sessionId).catch(() => undefined);
      }
    });
  }, [enabled, store]);

  useTauriListen<string>(
    STATION_WINDOW_READY_EVENT,
    (label) => {
      const mode = getStationWindowModeFromLabel(label);
      if (mode)
        void emitStationWindowSession(
          mode,
          store.get(workstationActiveSessionIdAtom)
        ).catch(() => undefined);
    },
    { enabled }
  );

  useTauriListen<string>(
    STATION_WINDOW_CLOSED_EVENT,
    (label) => {
      const mode = getStationWindowModeFromLabel(label);
      if (mode) restoreStation(mode);
    },
    { enabled }
  );

  useTauriListen<StationWindowMainNavigation>(
    STATION_WINDOW_MAIN_NAVIGATE_EVENT,
    ({ path, replace, action }) => {
      if (action === "open-kanban") {
        WorkStationViewService.openKanbanTab().catch((error: unknown) => {
          log.warn("Failed to open Kanban from a station window", error);
        });
      } else if (path.startsWith("/orgii/")) {
        navigateApp(path, replace);
      }
    },
    { enabled }
  );
}
