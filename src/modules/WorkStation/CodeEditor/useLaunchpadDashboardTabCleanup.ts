import { useSetAtom } from "jotai";
import { useEffect } from "react";

import {
  type WorkStationTab,
  workstationLayoutAtom,
} from "@src/store/workstation/tabs";

/**
 * Removes persisted `launchpad-dashboard` tabs from the main pane. When the
 * active tab was one of them, the first remaining tab becomes active.
 */
export function useLaunchpadDashboardTabCleanup(
  tabs: readonly WorkStationTab[]
): void {
  const setLayout = useSetAtom(workstationLayoutAtom);

  useEffect(() => {
    if (!tabs.some((tab) => String(tab.type) === "launchpad-dashboard")) return;
    setLayout((previousLayout) => {
      const nextTabs = previousLayout.mainPane.tabs.filter(
        (tab) => String(tab.type) !== "launchpad-dashboard"
      );
      const activeTabStillExists = nextTabs.some(
        (tab) => tab.id === previousLayout.mainPane.activeTabId
      );
      return {
        ...previousLayout,
        mainPane: {
          tabs: nextTabs,
          activeTabId: activeTabStillExists
            ? previousLayout.mainPane.activeTabId
            : (nextTabs[0]?.id ?? null),
        },
      };
    });
  }, [setLayout, tabs]);
}
