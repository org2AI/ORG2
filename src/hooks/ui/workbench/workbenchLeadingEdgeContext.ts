import { createContext, useContext } from "react";

/**
 * Whether the workbench pane touches the window's left edge, as `AppLayout`
 * actually lays it out: not when the chat slot (session or Settings) sits to
 * its left, and not when the slot is maximized over it. `AppLayout` owns the
 * effective slot position / width / maximize, so it publishes the answer
 * instead of letting each top bar re-derive it from the raw preference atoms.
 *
 * Defaults to `false` outside `AppLayout`: nothing else hosts a workbench
 * against the main window's leading chrome.
 */
export const WorkbenchLeadingEdgeContext = createContext(false);

export interface WorkbenchLeadingEdgeInput {
  /** Effective maximize (tab policy applied), not the saved preference. */
  chatSlotMaximized: boolean;
  /** The slot renders at all — Settings always does, a 0-width chat does not. */
  chatSlotVisible: boolean;
  /** Effective side — Settings pins the slot left whatever the preference. */
  chatSlotOnLeft: boolean;
}

export function resolveWorkbenchTouchesLeadingEdge({
  chatSlotMaximized,
  chatSlotVisible,
  chatSlotOnLeft,
}: WorkbenchLeadingEdgeInput): boolean {
  return !chatSlotMaximized && !(chatSlotVisible && chatSlotOnLeft);
}

export function useWorkbenchTouchesLeadingEdge(): boolean {
  return useContext(WorkbenchLeadingEdgeContext);
}
