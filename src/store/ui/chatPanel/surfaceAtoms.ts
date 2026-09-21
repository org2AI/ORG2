/**
 * Chat-panel surface projection: the surface the active tab presents, the
 * content mode derived from it, the reset that clears creator state before a
 * session takes the slot, and the persisted "maximized" preference.
 */
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { z } from "zod/v4";

import { activeChatPanelTabAtom } from "@src/store/chatPanel/chatPanelTabsState";
import { CHAT_PANEL_SURFACE_KIND } from "@src/types/ui/chatPanel";
import { createZodJsonStorage } from "@src/util/core/storage/zodStorage";
import { isStationWindow } from "@src/util/platform/tauri/windowIdentity";

import {
  CHAT_PANEL_CONTENT_MODE,
  CHAT_PANEL_CREATE_TARGET,
  type ChatPanelContentMode,
  type ChatPanelSelectedCloudOrg,
  type ChatPanelSelectedProject,
  type ChatPanelSelectedProjectOrg,
  type ChatPanelSelectedWorkItem,
  type ChatPanelSelectedWorkspace,
  DEFAULT_CHAT_PANEL_CREATE_TARGET,
  WORKSPACE_OVERVIEW_TAB,
  type WorkspaceOverviewTab,
  chatPanelCreateProjectContextAtom,
  chatPanelCreateTargetAtom,
  chatPanelCreatorWorkItemContextAtom,
  chatPanelStartPageOpenAtom,
  chatPanelWorkspaceOverviewTabAtom,
} from "./selectionAtoms";

export type ChatPanelSurfaceState =
  | { kind: typeof CHAT_PANEL_SURFACE_KIND.SESSION }
  | { kind: typeof CHAT_PANEL_SURFACE_KIND.NEW_PROJECT }
  | { kind: typeof CHAT_PANEL_SURFACE_KIND.NEW_WORK_ITEM }
  | {
      kind: typeof CHAT_PANEL_SURFACE_KIND.PROJECT;
      project: ChatPanelSelectedProject;
    }
  | {
      kind: typeof CHAT_PANEL_SURFACE_KIND.PROJECT_ORG;
      projectOrg: ChatPanelSelectedProjectOrg;
    }
  | {
      kind: typeof CHAT_PANEL_SURFACE_KIND.WORK_ITEM;
      workItem: ChatPanelSelectedWorkItem;
    }
  | { kind: typeof CHAT_PANEL_SURFACE_KIND.WORKSPACE_EXPLORE }
  | {
      kind: typeof CHAT_PANEL_SURFACE_KIND.WORKSPACE_OVERVIEW;
      workspace: ChatPanelSelectedWorkspace;
      tab: WorkspaceOverviewTab;
    }
  | {
      kind: typeof CHAT_PANEL_SURFACE_KIND.CLOUD_ORG;
      cloudOrg: ChatPanelSelectedCloudOrg;
    };

const SESSION_SURFACE: ChatPanelSurfaceState = {
  kind: CHAT_PANEL_SURFACE_KIND.SESSION,
};

/**
 * The surface the active tab presents. A Launchpad tab reports the creator it
 * is showing; a payload-less tab of any other type degrades to the session
 * surface rather than inventing a selection.
 */
export const activeChatPanelSurfaceAtom = atom<ChatPanelSurfaceState>((get) => {
  const tab = get(activeChatPanelTabAtom);
  switch (tab?.type) {
    case "start-page": {
      const target = get(chatPanelCreateTargetAtom);
      if (target === CHAT_PANEL_CREATE_TARGET.PROJECT) {
        return { kind: CHAT_PANEL_SURFACE_KIND.NEW_PROJECT };
      }
      if (target === CHAT_PANEL_CREATE_TARGET.WORK_ITEM) {
        return { kind: CHAT_PANEL_SURFACE_KIND.NEW_WORK_ITEM };
      }
      return SESSION_SURFACE;
    }
    case "project":
      return tab.project
        ? { kind: CHAT_PANEL_SURFACE_KIND.PROJECT, project: tab.project }
        : SESSION_SURFACE;
    case "organization":
      if (!tab.organization) return SESSION_SURFACE;
      return tab.organization.kind === "cloud"
        ? {
            kind: CHAT_PANEL_SURFACE_KIND.CLOUD_ORG,
            cloudOrg: tab.organization.cloudOrg,
          }
        : {
            kind: CHAT_PANEL_SURFACE_KIND.PROJECT_ORG,
            projectOrg: tab.organization.projectOrg,
          };
    case "work-item":
      return tab.workItem
        ? { kind: CHAT_PANEL_SURFACE_KIND.WORK_ITEM, workItem: tab.workItem }
        : SESSION_SURFACE;
    case "workspace":
      return tab.workspace
        ? {
            kind: CHAT_PANEL_SURFACE_KIND.WORKSPACE_OVERVIEW,
            workspace: tab.workspace,
            tab: get(chatPanelWorkspaceOverviewTabAtom),
          }
        : SESSION_SURFACE;
    case "explore":
      return { kind: CHAT_PANEL_SURFACE_KIND.WORKSPACE_EXPLORE };
    default:
      return SESSION_SURFACE;
  }
});
activeChatPanelSurfaceAtom.debugLabel = "activeChatPanelSurfaceAtom";

/** Session vs. any other surface, for consumers that only branch on that. */
export const chatPanelContentModeAtom = atom(
  (get): ChatPanelContentMode =>
    get(activeChatPanelSurfaceAtom).kind === CHAT_PANEL_SURFACE_KIND.SESSION
      ? CHAT_PANEL_CONTENT_MODE.SESSION
      : CHAT_PANEL_CONTENT_MODE.NON_SESSION
);
chatPanelContentModeAtom.debugLabel = "chatPanelContentModeAtom";

/**
 * Clear every creator / Launchpad axis so a session can take the slot: the
 * creator target and its org context, the retained created work item, the
 * workspace overview sub-tab, and the Launchpad flag. Callers run this before
 * opening or clearing a session; tab activation applies the same reset.
 */
export const resetChatPanelSessionSurfaceAtom = atom(null, (_get, set) => {
  set(chatPanelCreateProjectContextAtom, null);
  set(chatPanelCreateTargetAtom, DEFAULT_CHAT_PANEL_CREATE_TARGET);
  set(chatPanelCreatorWorkItemContextAtom, null);
  set(chatPanelWorkspaceOverviewTabAtom, WORKSPACE_OVERVIEW_TAB.OVERVIEW);
  set(chatPanelStartPageOpenAtom, false);
});
resetChatPanelSessionSurfaceAtom.debugLabel =
  "resetChatPanelSessionSurfaceAtom";

/**
 * The user's persisted preference for whether the chat-panel slot covers the
 * entire main content area. Tab navigation never changes this preference or the underlying Station mode.
 */
const persistedChatPanelMaximizedAtom = atomWithStorage<boolean>(
  "orgii:chatPanelMaximized",
  false,
  createZodJsonStorage(z.boolean()),
  { getOnInit: true }
);
// A detached station has no outer chat panel. Enforce ownership here so any
// workstation action using this shared atom cannot resize main through storage.
export const chatPanelMaximizedAtom = atom(
  (get) => (isStationWindow() ? false : get(persistedChatPanelMaximizedAtom)),
  (get, set, update: boolean | ((previous: boolean) => boolean)) => {
    if (isStationWindow()) return;
    set(
      persistedChatPanelMaximizedAtom,
      typeof update === "function"
        ? update(get(persistedChatPanelMaximizedAtom))
        : update
    );
  }
);
chatPanelMaximizedAtom.debugLabel = "chatPanelMaximizedAtom";

/** Write-only toggle for the maximized state. */
export const toggleChatPanelMaximizedAtom = atom(null, (get, set) => {
  set(chatPanelMaximizedAtom, !get(chatPanelMaximizedAtom));
});
toggleChatPanelMaximizedAtom.debugLabel = "toggleChatPanelMaximizedAtom";
