import { ROUTES } from "@src/config/routes";
import { navigateApp } from "@src/router/navigateApp";
import {
  jumpToSessionAtom,
  sessionMapAtom,
  workstationActiveSessionIdAtom,
} from "@src/store/session";
import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanel/surfaceAtoms";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import { adeManagerEnabledAtom } from "@src/store/ui/uiAtom";
import { activeWorkspaceRootPathAtom } from "@src/store/workspace";
import {
  createExplorerTab,
  createFileTab,
  createSourceControlTab,
  focusWorkstationTabAtom,
  openWorkstationTabAtom,
  selectWorkstationPanel,
  workstationTabsStateAtom,
} from "@src/store/workstation/tabs";
import { getWorkstationTabOwnership } from "@src/store/workstation/tabs/types";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";
import { invokeTauri } from "@src/util/platform/tauri/init";

import type { UiDependencies } from "./execute";
import type { UiRequest } from "./protocol";
import { createTerminalOperations } from "./terminals";

export function createUiDependencies(
  generation: string,
  request: UiRequest,
  openWeb: UiDependencies["openWeb"]
): UiDependencies {
  const store = getInstrumentedStore();
  const tabs: UiDependencies["tabs"] = (workspace) =>
    selectWorkstationPanel(store.get(workstationTabsStateAtom), workspace).tabs;
  return {
    terminal: createTerminalOperations(generation, request),
    permitted: () => store.get(adeManagerEnabledAtom),
    active: () =>
      invokeTauri<boolean>("ui_command_active", { generation, request }),
    resolveWorkspace: (workspace) => {
      if (workspace.kind === "global")
        return {
          repoPath: store.get(activeWorkspaceRootPathAtom) || undefined,
        };
      // `WorkstationWorkspaceKey` also has a `directory` variant, but the wire
      // protocol does not: both app_ui::Workspace and workspaceSchema admit
      // only global and session, and useUiCommandRuntime parses the envelope
      // before dispatch. A directory target cannot reach this function, so
      // there is deliberately no branch for one.
      const session = store.get(sessionMapAtom).get(workspace.sessionId);
      if (!session)
        throw new Error(
          "TARGET_NOT_FOUND: Target session does not exist or is not loaded"
        );
      return { repoPath: session.repoPath };
    },
    context: () => ({
      windowId: "main",
      station: store.get(stationModeAtom),
      workspace: store.get(workstationActiveSessionIdAtom)
        ? {
            kind: "session",
            sessionId: store.get(workstationActiveSessionIdAtom),
          }
        : { kind: "global" },
      presentationAllowed: store.get(adeManagerEnabledAtom),
    }),
    tabs,
    partition: (tab) =>
      getWorkstationTabOwnership(tab.type) === "shared-resource"
        ? "shared"
        : "workspace",
    prepareFile: (path, repoPath) =>
      invokeTauri<string>("ui_prepare_file", { path, repoPath }),
    openFile: (path, line, workspace) => {
      const existing = tabs(workspace).find(
        (tab) => tab.type === "file" && tab.data.filePath === path
      );
      const tab = existing
        ? {
            ...existing,
            data: {
              ...existing.data,
              ...(line === undefined ? {} : { targetLine: line }),
            },
          }
        : createFileTab(path, line);
      store.set(openWorkstationTabAtom, { workspace, tab });
      return tab;
    },
    openBuiltin: (kind, workspace) => {
      const existing = tabs(workspace).find((tab) => tab.type === kind);
      const tab =
        existing ??
        (kind === "explorer"
          ? createExplorerTab()
          : createSourceControlTab(0, { mode: "all-changes" }));
      if (existing)
        store.set(focusWorkstationTabAtom, { workspace, tabId: tab.id });
      else store.set(openWorkstationTabAtom, { workspace, tab });
      return tab;
    },
    openWeb,
    focus: (tab, workspace) => {
      store.set(focusWorkstationTabAtom, { workspace, tabId: tab.id });
    },
    reveal: (tab, workspace) => {
      const id = workspace.kind === "session" ? workspace.sessionId : null;
      if (store.get(workstationActiveSessionIdAtom) !== id)
        store.set(jumpToSessionAtom, id);
      store.set(stationModeAtom, "my-station");
      store.set(chatPanelMaximizedAtom, false);
      store.set(focusWorkstationTabAtom, { workspace, tabId: tab.id });
      navigateApp(
        tab.type === "browser-session"
          ? ROUTES.workStation.browser.path
          : ROUTES.workStation.code.path
      );
      // Route rendering is asynchronous; do not claim a rendered acknowledgement.
      return false;
    },
  };
}
