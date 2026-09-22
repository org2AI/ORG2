/**
 * Shared focus-or-create step for keyed and singleton chat-pane tabs.
 */
import type { Getter, Setter } from "jotai";

import {
  activateChatPanelTabAtom,
  appendAndActivateChatPanelTabAtom,
} from "../chatPanelTabPresentationAtoms";
import type { ChatPanelTab } from "../chatPanelTabsModel";
import { chatPanelTabsAtom } from "../chatPanelTabsState";

interface OpenOrFocusChatPanelTabOptions {
  /** Identifies an already-open tab for this destination. */
  isMatch: (tab: ChatPanelTab) => boolean;
  /**
   * Re-stamp the matched tab's stored payload / title before focusing it:
   * payloads drift (renames, status changes, a channel flipping visibility)
   * and the pill must not go stale. Return the same tab to leave it as is.
   */
  refresh?: (tab: ChatPanelTab) => ChatPanelTab;
  /** Mint the tab when none is open. */
  create: () => ChatPanelTab;
}

/**
 * Focus the tab that already owns a destination, refreshing its payload, or
 * mint and activate a new one. Identity stays with the caller's `isMatch`;
 * this only owns the focus-or-append transition every keyed and singleton
 * opener used to spell out by hand. Returns the id of the tab shown.
 */
export function openOrFocusChatPanelTab(
  get: Getter,
  set: Setter,
  { isMatch, refresh, create }: OpenOrFocusChatPanelTabOptions
): string {
  const state = get(chatPanelTabsAtom);
  const existingTab = state.tabs.find(isMatch);
  if (existingTab) {
    const refreshedTab = refresh ? refresh(existingTab) : existingTab;
    if (refreshedTab !== existingTab) {
      set(chatPanelTabsAtom, {
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.id === existingTab.id ? refreshedTab : tab
        ),
      });
    }
    set(activateChatPanelTabAtom, existingTab.id);
    return existingTab.id;
  }
  const tab = create();
  set(appendAndActivateChatPanelTabAtom, { tab });
  return tab.id;
}
