/**
 * Global Tabs — Write action atoms
 *
 * Used by the browser context sync hook.
 */
import { atom } from "jotai";

import type { BrowserTab } from "./globalTabsTypes";
import { MAX_BROWSER_TABS, evictOldest } from "./globalTabsTypes";
import { navigationSidebarTabsAtom } from "./navigationSidebarTabsAtom";

// ============================================
// Browser Tabs
// ============================================

export const addBrowserTabAtom = atom(
  null,
  (get, set, tab: Omit<BrowserTab, "timestamp">) => {
    const state = get(navigationSidebarTabsAtom);
    const existing = state.browser.find((b) => b.id === tab.id);
    if (existing) {
      set(navigationSidebarTabsAtom, {
        ...state,
        browser: state.browser.map((b) =>
          b.id === tab.id
            ? { ...b, ...tab, isActive: true, timestamp: Date.now() }
            : { ...b, isActive: false }
        ),
      });
      return;
    }
    set(navigationSidebarTabsAtom, {
      ...state,
      browser: evictOldest(
        state.browser
          .map((b) => ({ ...b, isActive: false }))
          .concat({ ...tab, timestamp: Date.now() }),
        MAX_BROWSER_TABS
      ),
    });
  }
);
addBrowserTabAtom.debugLabel = "addBrowserTabAtom";

export const removeBrowserTabAtom = atom(null, (get, set, tabId: string) => {
  const state = get(navigationSidebarTabsAtom);
  set(navigationSidebarTabsAtom, {
    ...state,
    browser: state.browser.filter((b) => b.id !== tabId),
  });
});
removeBrowserTabAtom.debugLabel = "removeBrowserTabAtom";

export const setActiveBrowserTabAtom = atom(null, (get, set, tabId: string) => {
  const state = get(navigationSidebarTabsAtom);
  set(navigationSidebarTabsAtom, {
    ...state,
    browser: state.browser.map((b) => ({
      ...b,
      isActive: b.id === tabId,
    })),
  });
});
setActiveBrowserTabAtom.debugLabel = "setActiveBrowserTabAtom";

export const updateBrowserTabAtom = atom(
  null,
  (get, set, update: { id: string; title?: string; url?: string }) => {
    const state = get(navigationSidebarTabsAtom);
    set(navigationSidebarTabsAtom, {
      ...state,
      browser: state.browser.map((b) =>
        b.id === update.id ? { ...b, ...update, timestamp: Date.now() } : b
      ),
    });
  }
);
updateBrowserTabAtom.debugLabel = "updateBrowserTabAtom";
