/**
 * useGlobalTabs Hooks
 *
 * Focused hooks for accessing specific categories of global tabs.
 * Each hook subscribes to its category and active tab.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { selectAtom } from "jotai/utils";

import {
  addBrowserTabAtom,
  removeBrowserTabAtom,
  setActiveBrowserTabAtom,
  updateBrowserTabAtom,
} from "@src/store/ui/globalTabsActions";
import {
  activeBrowserTabAtom,
  navigationSidebarTabsAtom,
} from "@src/store/ui/navigationSidebarTabsAtom";

// ============================================
// Selector Atoms (created once, reused)
// ============================================

const browserTabsAtom = selectAtom(
  navigationSidebarTabsAtom,
  (tabs) => tabs.browser
);

// ============================================
// Focused Hooks - Use these for better performance
// ============================================

/**
 * Hook for browser tabs only.
 * Only re-renders when browser tabs change.
 */
export const useGlobalBrowserTabs = () => {
  const browserTabs = useAtomValue(browserTabsAtom);
  const activeBrowser = useAtomValue(activeBrowserTabAtom);
  const addBrowserTab = useSetAtom(addBrowserTabAtom);
  const removeBrowserTab = useSetAtom(removeBrowserTabAtom);
  const setActiveBrowserTab = useSetAtom(setActiveBrowserTabAtom);
  const updateBrowserTab = useSetAtom(updateBrowserTabAtom);

  return {
    browserTabs,
    activeBrowser,
    addBrowserTab,
    removeBrowserTab,
    setActiveBrowserTab,
    updateBrowserTab,
  };
};
