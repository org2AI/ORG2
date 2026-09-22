import { atom } from "jotai";

import { WORK_MANAGEMENT_SECTION } from "@src/store/workstation/workstationTabBarAtoms";

import { buildInitialChatPanelTabsState } from "./chatPanelTabFactories";
import { type ChatPanelTabsState } from "./chatPanelTabsModel";

/**
 * Chat-pane tabs live in memory only: every app launch starts from a single
 * fresh Launchpad tab and nothing is persisted or rehydrated.
 */
export const chatPanelTabsAtom = atom<ChatPanelTabsState>(
  buildInitialChatPanelTabsState()
);
chatPanelTabsAtom.debugLabel = "chatPanelTabs";

export const activeChatPanelTabAtom = atom((get) => {
  const state = get(chatPanelTabsAtom);
  return (
    state.tabs.find((tab) => tab.id === state.activeTabId) ??
    state.tabs[0] ??
    null
  );
});
activeChatPanelTabAtom.debugLabel = "activeChatPanelTab";

/**
 * Session identity owned by the selected Chat Panel tab.
 *
 * This deliberately follows tab selection rather than the singleton session
 * pipeline, which can be claimed temporarily by nested/secondary chat views.
 */
export const activeChatPanelSessionIdAtom = atom((get) => {
  const tab = get(activeChatPanelTabAtom);
  return tab?.type === "session" ? (tab.sessionId ?? null) : null;
});
activeChatPanelSessionIdAtom.debugLabel = "activeChatPanelSessionId";

/**
 * Kanban content and sidebar selection are projections of the active
 * ChatPanel tab. Keeping this derived prevents tab chrome, content, and
 * sidebar state from drifting independently.
 */
export const activeWorkManagementSectionAtom = atom((get) => {
  return (
    get(activeChatPanelTabAtom)?.managementSection ??
    WORK_MANAGEMENT_SECTION.KANBAN
  );
});
activeWorkManagementSectionAtom.debugLabel = "activeWorkManagementSection";

export const chatPanelTabCountAtom = atom(
  (get) => get(chatPanelTabsAtom).tabs.length
);

/**
 * Active tab's type only. Primitive-valued so consumers that merely branch on
 * which kind of surface is showing (e.g. the floating side-chat launcher)
 * re-render on a real tab switch instead of on every title or payload patch
 * that rebuilds the tab objects.
 */
export const activeChatPanelTabTypeAtom = atom(
  (get) => get(activeChatPanelTabAtom)?.type ?? null
);
activeChatPanelTabTypeAtom.debugLabel = "activeChatPanelTabType";
