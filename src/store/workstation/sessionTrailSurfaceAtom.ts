import { atom } from "jotai";

import { activeChatPanelTabAtom } from "@src/store/chatPanel/chatPanelTabsState";
import { isStationWindow } from "@src/util/platform/tauri/windowIdentity";

export interface SessionTrailSurface {
  kind: "subagents";
  ownerTabId: string;
  sessionId: string;
  title: string;
  childSessionId?: string;
  /** Temporary surface geometry; never changes the active Station mode. */
  fullscreen?: boolean;
}

// A single temporary slot, owned by the originating chat in this window.
const surfaceStateAtom = atom<SessionTrailSurface | null>(null);
export const sessionTrailSurfaceAtom = atom((get) => {
  const surface = get(surfaceStateAtom);
  const owner = get(activeChatPanelTabAtom);
  return !isStationWindow() &&
    owner?.type === "session" &&
    owner.id === surface?.ownerTabId &&
    owner.sessionId === surface.sessionId
    ? surface
    : null;
});

export const openSessionTrailSurfaceAtom = atom(
  null,
  (
    get,
    set,
    request: Omit<SessionTrailSurface, "ownerTabId" | "fullscreen">
  ) => {
    const owner = get(activeChatPanelTabAtom);
    const sessionId = request.sessionId.trim();
    if (
      isStationWindow() ||
      !sessionId ||
      owner?.type !== "session" ||
      owner.sessionId !== sessionId
    )
      return;
    const previous = get(surfaceStateAtom);
    if (
      previous?.ownerTabId === owner.id &&
      previous.sessionId === sessionId &&
      previous.kind === request.kind &&
      previous.title === request.title &&
      previous.childSessionId === request.childSessionId
    )
      return;
    set(surfaceStateAtom, { ...request, sessionId, ownerTabId: owner.id });
  }
);

export const closeSessionTrailSurfaceAtom = atom(null, (_get, set) => {
  set(surfaceStateAtom, null);
});

export const toggleSessionTrailFullscreenAtom = atom(null, (get, set) => {
  const surface = get(sessionTrailSurfaceAtom);
  if (!surface || surface.kind !== "subagents") return;
  set(surfaceStateAtom, { ...surface, fullscreen: !surface.fullscreen });
});
