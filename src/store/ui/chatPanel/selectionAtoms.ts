import { atom } from "jotai";

import { getChatPanelWorkItemTabKey } from "@src/store/chatPanel/chatPanelTabFactories";
import {
  activeChatPanelTabAtom,
  chatPanelTabsAtom,
} from "@src/store/chatPanel/chatPanelTabsState";

import {
  type ChatPanelCreateProjectContext,
  type ChatPanelCreateTarget,
  type ChatPanelSelectedCloudOrg,
  type ChatPanelSelectedProject,
  type ChatPanelSelectedProjectOrg,
  type ChatPanelSelectedWorkItem,
  DEFAULT_CHAT_PANEL_CREATE_TARGET,
  WORKSPACE_OVERVIEW_TAB,
  type WorkspaceOverviewTab,
} from "./selectionTypes";

// Preserve public import paths; tab models/factories import the types directly.
export * from "./selectionTypes";

// ---------------------------------------------------------------------------
// Launchpad / creator axes — explicit state that is orthogonal to which tab
// is active. Tab activation resets them (see `syncChatPanelTabNavigationAtom`).
// ---------------------------------------------------------------------------

export const chatPanelCreateTargetAtom = atom<ChatPanelCreateTarget>(
  DEFAULT_CHAT_PANEL_CREATE_TARGET
);
export const chatPanelStartPageOpenAtom = atom(true);
export const chatPanelCreateProjectContextAtom =
  atom<ChatPanelCreateProjectContext | null>(null);
export const chatPanelWorkspaceOverviewTabAtom = atom<WorkspaceOverviewTab>(
  WORKSPACE_OVERVIEW_TAB.OVERVIEW
);
chatPanelCreateTargetAtom.debugLabel = "chatPanelCreateTargetAtom";
chatPanelStartPageOpenAtom.debugLabel = "chatPanelStartPageOpenAtom";
chatPanelCreateProjectContextAtom.debugLabel =
  "chatPanelCreateProjectContextAtom";
chatPanelWorkspaceOverviewTabAtom.debugLabel =
  "chatPanelWorkspaceOverviewTabAtom";

/**
 * Work item the Launchpad creator retains after "Create another": the creator
 * stays open, so no work-item tab exists yet, but the session creator embedded
 * beside it still needs the just-created item as its launch context. Cleared
 * whenever a tab is activated or the session surface is reset.
 */
export const chatPanelCreatorWorkItemContextAtom =
  atom<ChatPanelSelectedWorkItem | null>(null);
chatPanelCreatorWorkItemContextAtom.debugLabel =
  "chatPanelCreatorWorkItemContextAtom";

// ---------------------------------------------------------------------------
// Selections — read-only projections of the active tab's payload. The tab is
// the durable owner of every non-session surface; nothing else selects one.
// ---------------------------------------------------------------------------

/** Project shown by the active project tab, else null. */
export const chatPanelSelectedProjectAtom = atom(
  (get): ChatPanelSelectedProject | null => {
    const tab = get(activeChatPanelTabAtom);
    return tab?.type === "project" ? (tab.project ?? null) : null;
  }
);
/** Local organization shown by the active organization tab, else null. */
export const chatPanelSelectedProjectOrgAtom = atom(
  (get): ChatPanelSelectedProjectOrg | null => {
    const tab = get(activeChatPanelTabAtom);
    return tab?.type === "organization" && tab.organization?.kind === "local"
      ? tab.organization.projectOrg
      : null;
  }
);
/** Cloud organization shown by the active organization tab, else null. */
export const chatPanelSelectedCloudOrgAtom = atom(
  (get): ChatPanelSelectedCloudOrg | null => {
    const tab = get(activeChatPanelTabAtom);
    return tab?.type === "organization" && tab.organization?.kind === "cloud"
      ? tab.organization.cloudOrg
      : null;
  }
);
/** Work item of the active work-item tab, else the creator's retained item. */
export const chatPanelSelectedWorkItemAtom = atom(
  (get): ChatPanelSelectedWorkItem | null => {
    const tab = get(activeChatPanelTabAtom);
    if (tab?.type === "work-item" && tab.workItem) return tab.workItem;
    return get(chatPanelCreatorWorkItemContextAtom);
  }
);
chatPanelSelectedProjectAtom.debugLabel = "chatPanelSelectedProjectAtom";
chatPanelSelectedProjectOrgAtom.debugLabel = "chatPanelSelectedProjectOrgAtom";
chatPanelSelectedCloudOrgAtom.debugLabel = "chatPanelSelectedCloudOrgAtom";
chatPanelSelectedWorkItemAtom.debugLabel = "chatPanelSelectedWorkItemAtom";

type Update<T> = T | ((previous: T) => T);

/**
 * Write an edited work-item payload back onto the tab that owns it. The tab is
 * matched by org / project / short-id key, so a refresh that resolves after
 * the user switched tabs still lands on the right pill. Functional updates
 * receive the active work-item tab's payload; a null result or a key with no
 * open tab is a no-op.
 */
export const updateChatPanelWorkItemTabAtom = atom(
  null,
  (get, set, update: Update<ChatPanelSelectedWorkItem | null>) => {
    const activeTab = get(activeChatPanelTabAtom);
    const previous =
      activeTab?.type === "work-item" ? (activeTab.workItem ?? null) : null;
    const value = typeof update === "function" ? update(previous) : update;
    if (!value || value === previous) return;
    const key = getChatPanelWorkItemTabKey(value);
    const state = get(chatPanelTabsAtom);
    const target = state.tabs.find(
      (tab) =>
        tab.type === "work-item" &&
        tab.workItem !== undefined &&
        getChatPanelWorkItemTabKey(tab.workItem) === key
    );
    if (!target || target.workItem === value) return;
    set(chatPanelTabsAtom, {
      ...state,
      tabs: state.tabs.map((tab) =>
        tab.id === target.id
          ? { ...tab, workItem: value, title: value.workItem.name || tab.title }
          : tab
      ),
    });
  }
);
updateChatPanelWorkItemTabAtom.debugLabel = "updateChatPanelWorkItemTabAtom";
