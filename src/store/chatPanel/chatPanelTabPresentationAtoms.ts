import { atom } from "jotai";

import { sessionByIdAtom } from "@src/store/session/sessionAtom";
import {
  activeSessionIdAtom,
  jumpToSessionAtom,
  releasePipelineSessionAtom,
  workstationActiveSessionIdAtom,
} from "@src/store/session/viewAtom";
import {
  DEFAULT_CHAT_PANEL_CREATE_TARGET,
  WORKSPACE_OVERVIEW_TAB,
  chatPanelCreateProjectContextAtom,
  chatPanelCreateTargetAtom,
  chatPanelCreatorWorkItemContextAtom,
  chatPanelStartPageOpenAtom,
  chatPanelWorkspaceOverviewTabAtom,
} from "@src/store/ui/chatPanel/selectionAtoms";

import { recordChatPanelTabTransitionAtom } from "./chatPanelRecentTabsState";
import { type ChatPanelTab } from "./chatPanelTabsModel";
import { chatPanelTabsAtom } from "./chatPanelTabsState";

/**
 * Make the Launchpad / creator axes match the tab that just became active.
 * Which surface is showing is derived from the tab itself
 * (`activeChatPanelSurfaceAtom`); only the explicit creator state and the
 * session pipeline need resetting here.
 */
const syncChatPanelTabNavigationAtom = atom(
  null,
  (_get, set, tab: ChatPanelTab | null | undefined) => {
    if (!tab) return;
    set(chatPanelCreateProjectContextAtom, null);
    set(chatPanelCreateTargetAtom, DEFAULT_CHAT_PANEL_CREATE_TARGET);
    set(chatPanelCreatorWorkItemContextAtom, null);
    // A workspace tab keeps whichever overview sub-tab it was showing; every
    // other surface starts the next workspace visit on Overview.
    if (tab.type !== "workspace") {
      set(chatPanelWorkspaceOverviewTabAtom, WORKSPACE_OVERVIEW_TAB.OVERVIEW);
    }
    set(chatPanelStartPageOpenAtom, tab.type === "start-page");
    if (tab.type !== "session") set(jumpToSessionAtom, null);
  }
);

/**
 * Reconcile creator / Launchpad state after hydration or layout changes.
 * Pane maximization is independent of tab navigation, so
 * reconciliation never mutates the user's persisted preference.
 */
export const syncActiveChatPanelTabStateAtom = atom(null, (get, set) => {
  const state = get(chatPanelTabsAtom);
  const activeTab =
    state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
  // A start-page tab is also the host for non-session project surfaces.
  // Navigation deliberately closes the Launchpad before selecting one of
  // those surfaces. It also owns its pinned creator navigation. Do not let
  // the React reconciliation pass erase either newer intent after activating
  // Launchpad from another tab.
  const startPageOwnsExplicitNavigation =
    activeTab?.type === "start-page" &&
    (!get(chatPanelStartPageOpenAtom) ||
      get(chatPanelCreateTargetAtom) !== DEFAULT_CHAT_PANEL_CREATE_TARGET);
  if (!startPageOwnsExplicitNavigation) {
    set(syncChatPanelTabNavigationAtom, activeTab);
  }
});
syncActiveChatPanelTabStateAtom.debugLabel = "syncActiveChatPanelTabState";

interface ActivateChatPanelTabOptions {
  tabId: string;
  sessionName?: string;
  repoPath?: string;
}

function getActivateTabOptions(
  optionsOrTabId: ActivateChatPanelTabOptions | string
): ActivateChatPanelTabOptions {
  return typeof optionsOrTabId === "string"
    ? { tabId: optionsOrTabId }
    : optionsOrTabId;
}

/** Switch to a tab by ID and sync session state for linked session tabs. */
export const activateChatPanelTabAtom = atom(
  null,
  (get, set, optionsOrTabId: ActivateChatPanelTabOptions | string) => {
    const { tabId, sessionName, repoPath } =
      getActivateTabOptions(optionsOrTabId);
    const state = get(chatPanelTabsAtom);
    const tab = state.tabs.find((candidate) => candidate.id === tabId);
    if (!tab) return;
    if (state.activeTabId !== tabId) {
      set(recordChatPanelTabTransitionAtom, {
        previousTab: state.tabs.find(
          (candidate) => candidate.id === state.activeTabId
        ),
        nextTab: tab,
      });
      set(chatPanelTabsAtom, { ...state, activeTabId: tabId });
    }

    set(syncChatPanelTabNavigationAtom, tab);

    // The active tab is the visibility authority. Once a non-session surface
    // takes over, release the singleton event pipeline while retaining the
    // WorkStation's remembered session so switching back to an open session
    // tab remains instant and deterministic.
    if (tab.type !== "session") set(releasePipelineSessionAtom);

    // Surface state for every non-session tab is fully driven by
    // `syncChatPanelTabNavigationAtom` above; only a linked session tab has a
    // session to jump to.
    if (tab.type !== "session" || !tab.sessionId) return;

    const sessionId = tab.sessionId;
    if (
      get(workstationActiveSessionIdAtom) !== sessionId ||
      get(activeSessionIdAtom) !== sessionId
    ) {
      const session = get(sessionByIdAtom(sessionId));
      set(jumpToSessionAtom, {
        sessionId,
        sessionName: sessionName ?? session?.name,
        repoPath: repoPath ?? session?.repoPath,
      });
    }
  }
);
activateChatPanelTabAtom.debugLabel = "activateChatPanelTab";

interface AppendAndActivateChatPanelTabOptions {
  tab: ChatPanelTab;
  sessionName?: string;
  repoPath?: string;
}

/**
 * Open a tab and run the shared navigation activation chain.
 *
 * The active Launchpad is a disposable "create new session" placeholder, so
 * any substantive destination consumes it in place. Real session and content
 * tabs are always preserved and the new destination is appended beside them.
 */
export const appendAndActivateChatPanelTabAtom = atom(
  null,
  (
    get,
    set,
    { tab, sessionName, repoPath }: AppendAndActivateChatPanelTabOptions
  ) => {
    const state = get(chatPanelTabsAtom);
    const activeTab = state.tabs.find(
      (candidate) => candidate.id === state.activeTabId
    );
    const tabs =
      tab.type !== "start-page" && activeTab?.type === "start-page"
        ? state.tabs.map((candidate) =>
            candidate.id === activeTab.id ? tab : candidate
          )
        : [...state.tabs, tab];
    set(recordChatPanelTabTransitionAtom, {
      previousTab: activeTab,
      nextTab: tab,
    });
    set(chatPanelTabsAtom, {
      tabs,
      activeTabId: tab.id,
    });
    set(activateChatPanelTabAtom, {
      tabId: tab.id,
      sessionName,
      repoPath,
    });
  }
);
