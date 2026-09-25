/**
 * Detached station windows — the main-window side.
 *
 * `openStationInNewWindowAtom` detaches My Station or Agent Station into its
 * own OS window (`app-window-station-<mode>`) seeded with the remembered
 * session. If the main window was showing that very station, the chat panel
 * takes the whole main window over (`chatPanelMaximizedAtom`) so the
 * station has one visible owner — the same invariant detached session
 * windows keep between the two in-window tab hosts. A floating Workstation
 * instead collapses locally and returns to floating when its window closes.
 * The docked-layout takeover is remembered
 * in `stationWindowChatTakeoverAtom` and undone by
 * `restoreStationAfterWindowClosedAtom` when Rust reports the window gone.
 *
 * Only the main window edits the layout: the layout atoms are persisted and
 * resync across windows through the `storage` event, so a write from inside
 * a station window would land in the main window's layout.
 */
import { atom } from "jotai";

import {
  emitStationWindowSession,
  openStationWindow,
} from "@src/api/tauri/stationWindow";
import { workstationActiveSessionIdAtom } from "@src/store/session/viewAtom";
import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanel/surfaceAtoms";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import type { StationMode } from "@src/types/ui/workstation";
import { isMainAppWindow } from "@src/util/platform/tauri/windowIdentity";

import {
  restoreWorkstationFromStationWindowAtom,
  suspendWorkstationForStationWindowAtom,
  workstationPresentationAtom,
  workstationPresentationGenerationAtom,
} from "./presentationAtoms";

export interface OpenStationInNewWindowOptions {
  stationMode: StationMode;
  /** Native window title (the station's display name). */
  title?: string;
}

/**
 * Which station's detach maximized the main window's chat panel, so closing
 * that window (and only that window) restores the split. In-memory: a
 * relaunched main window has no takeover to undo.
 */
export const stationWindowChatTakeoverAtom = atom<StationMode | null>(null);
stationWindowChatTakeoverAtom.debugLabel = "stationWindowChatTakeover";
const stationWindowChatTakeoverGenerationAtom = atom<number | null>(null);

export const openStationInNewWindowAtom = atom(
  null,
  async (get, set, options: OpenStationInNewWindowOptions): Promise<void> => {
    const { stationMode, title } = options;
    const sessionId = get(workstationActiveSessionIdAtom);
    const presentationGeneration = get(workstationPresentationGenerationAtom);

    await openStationWindow(stationMode, { sessionId, title });
    // Claim local ownership immediately after successful creation. Do not
    // wait for the best-effort retarget event: a close during that await
    // must be able to restore the presentation instead of leaving it hidden.
    if (
      isMainAppWindow() &&
      get(stationModeAtom) === stationMode &&
      get(workstationPresentationGenerationAtom) === presentationGeneration
    ) {
      if (get(workstationPresentationAtom) !== "docked") {
        set(suspendWorkstationForStationWindowAtom, {
          stationMode,
          generation: presentationGeneration,
        });
      } else if (!get(chatPanelMaximizedAtom)) {
        set(chatPanelMaximizedAtom, true);
        set(stationWindowChatTakeoverAtom, stationMode);
        set(stationWindowChatTakeoverGenerationAtom, presentationGeneration);
      }
    }

    // A window that already existed keeps its old session until told
    // otherwise; a fresh one was seeded through its route and ignores the
    // duplicate. Best effort — the window itself is already up.
    await emitStationWindowSession(
      stationMode,
      get(workstationActiveSessionIdAtom),
      { selectStation: true }
    ).catch(() => undefined);
  }
);
openStationInNewWindowAtom.debugLabel = "openStationInNewWindow";

/**
 * Give the surface back to the in-window station once its detached window
 * is gone — only when this station's detach is what maximized the chat, and
 * only if the user has not already restored the split themselves.
 */
export const restoreStationAfterWindowClosedAtom = atom(
  null,
  (get, set, closedStationMode: StationMode): void => {
    const restoreCurrentStation = get(stationModeAtom) === closedStationMode;
    set(restoreWorkstationFromStationWindowAtom, {
      stationMode: closedStationMode,
      restore: restoreCurrentStation,
    });
    if (get(stationWindowChatTakeoverAtom) !== closedStationMode) return;
    const generation = get(stationWindowChatTakeoverGenerationAtom);
    set(stationWindowChatTakeoverAtom, null);
    set(stationWindowChatTakeoverGenerationAtom, null);
    if (
      restoreCurrentStation &&
      generation === get(workstationPresentationGenerationAtom) &&
      get(chatPanelMaximizedAtom)
    )
      set(chatPanelMaximizedAtom, false);
  }
);
restoreStationAfterWindowClosedAtom.debugLabel =
  "restoreStationAfterWindowClosed";
