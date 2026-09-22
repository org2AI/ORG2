/**
 * openFileInWorkStation — open a file as a Code Editor tab while keeping the
 * caller on the current route.
 *
 * Unlike {@link openFileInEditor}, which dispatches an `open-file-in-editor`
 * CustomEvent that ultimately fires `action-system-navigate` to
 * `/orgii/workstation/code`, this helper writes directly to the workstation
 * layout atom. That means:
 *
 *   - the file tab is added to the main pane and becomes active (the visible
 *     content host follows the active tab, so this reveals the Code Editor)
 *   - `revealMyStation` brings the WorkStation on screen: My Station mode, the
 *     chat-panel slot un-maximized, and a chat tab the Station may share the
 *     workbench with
 *   - **no navigation occurs** from a workbench route — the current route
 *     (e.g. settings) stays put
 *
 * Use this from the Settings / Integrations surfaces, where the WorkStation
 * is already visible in the right pane and we want to act on a file without
 * yanking the user out of their current view.
 */
import { ROUTES } from "@src/config/routes";
import {
  createFileTab,
  openWorkstationTabAtom,
  presentedWorkstationWorkspaceKeyAtom,
} from "@src/store/workstation/tabs";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";
import { revealMyStation } from "@src/util/ui/revealMyStation";

export interface OpenFileInWorkStationOptions {
  /** 1-based line to reveal once the file is open. */
  line?: number;
  /** Start previewable files in rendered preview mode instead of raw editor mode. */
  defaultPreviewMode?: boolean;
}

/**
 * Open `path` as a Code Editor tab in the WorkStation pane. No-op when
 * `path` is empty. Does NOT navigate the React Router route.
 */
export function openFileInWorkStation(
  path: string,
  options?: OpenFileInWorkStationOptions
): void {
  const trimmed = path.trim();
  if (trimmed.length === 0) return;

  const store = getInstrumentedStore();
  revealMyStation({ path: ROUTES.workStation.code.path });

  const tab = createFileTab(trimmed, {
    targetLine: options?.line,
    defaultPreviewMode: options?.defaultPreviewMode,
  });
  const workspace = store.get(presentedWorkstationWorkspaceKeyAtom);
  store.set(openWorkstationTabAtom, { workspace, tab });
}
