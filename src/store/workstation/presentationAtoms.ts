import { atom } from "jotai";

import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanel/surfaceAtoms";
import type { StationMode } from "@src/types/ui/workstation";
import { isStationWindow } from "@src/util/platform/tauri/windowIdentity";

export type WorkstationPresentation = "docked" | "floating" | "collapsed";

// Document-local UI intent. Never synchronize presentation through storage:
// another native window must not move this window's Workstation surface.
const presentationStateAtom = atom<WorkstationPresentation>("docked");
const presentationGenerationAtom = atom(0);
const detachedPresentationAtom = atom<{
  stationMode: StationMode;
  generation: number;
} | null>(null);

export const workstationPresentationAtom = atom((get) =>
  isStationWindow() ? "docked" : get(presentationStateAtom)
);
export const workstationPresentationGenerationAtom = atom((get) =>
  get(presentationGenerationAtom)
);

function presentationAction(presentation: WorkstationPresentation) {
  return atom(null, (get, set) => {
    if (isStationWindow()) return;
    // Even repeated explicit choices supersede an outstanding native-window
    // takeover, so closing that window cannot undo newer user intent.
    set(presentationGenerationAtom, get(presentationGenerationAtom) + 1);
    set(detachedPresentationAtom, null);
    set(presentationStateAtom, presentation);
  });
}

export const floatWorkstationAtom = presentationAction("floating");
const dockPresentationAtom = presentationAction("docked");
/** Explicitly restore the Station split, including a previously maximized chat. */
export const dockWorkstationAtom = atom(null, (_get, set) => {
  if (isStationWindow()) return;
  set(dockPresentationAtom);
  set(chatPanelMaximizedAtom, false);
});
export const collapseWorkstationAtom = presentationAction("collapsed");
export const expandWorkstationAtom = presentationAction("floating");

/** Called only after a native window successfully acquires this station. */
export const suspendWorkstationForStationWindowAtom = atom(
  null,
  (get, set, request: { stationMode: StationMode; generation: number }) => {
    if (
      isStationWindow() ||
      get(presentationGenerationAtom) !== request.generation ||
      get(presentationStateAtom) !== "floating"
    )
      return;
    set(detachedPresentationAtom, request);
    set(presentationStateAtom, "collapsed");
  }
);

export const restoreWorkstationFromStationWindowAtom = atom(
  null,
  (get, set, request: { stationMode: StationMode; restore: boolean }) => {
    const detached = get(detachedPresentationAtom);
    if (!detached || detached.stationMode !== request.stationMode) return;
    set(detachedPresentationAtom, null);
    if (
      request.restore &&
      get(presentationGenerationAtom) === detached.generation &&
      get(presentationStateAtom) === "collapsed"
    )
      set(presentationStateAtom, "floating");
  }
);

/** Layout and lifecycle consumers share this projection instead of treating
 * expanded chat as proof that the Workstation is invisible. */
export function resolveWorkstationPresentation({
  presentation,
  chatMaximized,
  settingsVisible,
}: {
  presentation: WorkstationPresentation;
  chatMaximized: boolean;
  settingsVisible: boolean;
}): { chatExpanded: boolean; workstationVisible: boolean; floating: boolean } {
  const floating = presentation !== "docked";
  return {
    chatExpanded: chatMaximized || floating,
    workstationVisible:
      (presentation === "floating" && !settingsVisible) ||
      (presentation === "docked" && !chatMaximized),
    floating,
  };
}
