import { atom } from "jotai";

import { getStoredValue, setStoredValue } from "./storage";

function getStoredBottomPanelCollapsed(): boolean {
  const stored = getStoredValue("bottom_collapsed");
  // No stored value means first launch — default to collapsed.
  if (stored === null || stored === undefined) return true;
  return stored === "true";
}

/**
 * Collapsed state of a WorkStation host's secondary panel.
 *
 * Shared across both `right` and `bottom` positions — the panel is the
 * same surface, just oriented differently. Persisted to localStorage so
 * the panel restores to its last state across reloads.
 */
export const workStationEditorSecondaryCollapsedAtom = atom<boolean>(
  getStoredBottomPanelCollapsed()
);
workStationEditorSecondaryCollapsedAtom.debugLabel =
  "workStationEditorSecondaryCollapsedAtom";

export const workStationEditorSecondaryCollapsedPersistAtom = atom(
  (get) => get(workStationEditorSecondaryCollapsedAtom),
  (get, set, value: boolean | "toggle") => {
    const next =
      value === "toggle"
        ? !get(workStationEditorSecondaryCollapsedAtom)
        : value;
    set(workStationEditorSecondaryCollapsedAtom, next);
    setStoredValue("bottom_collapsed", String(next));
  }
);
