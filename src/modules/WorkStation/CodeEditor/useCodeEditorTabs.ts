import { useMemo } from "react";

import { useRetainedTabPool } from "@src/hooks/tabHost/useRetainedTabPool";
import { useWorkStationTabs } from "@src/hooks/tabHost/useWorkStationTabs";

/**
 * The single main pane's tabs plus the Source Control retention pool that
 * the main pane and the sidebar slot share.
 */
export function useCodeEditorTabs() {
  const { activeTab, tabs } = useWorkStationTabs();
  // Tabs the retention policy keeps mounted-but-hidden after you leave
  // them (`tabRetention.ts`). Computed once here so the main pane and the
  // sidebar slot hide/show the same instances in lockstep.
  const retainedTabIds = useRetainedTabPool(
    "source-control",
    tabs,
    activeTab?.id ?? null
  );
  const retainedTabs = useMemo(
    () => tabs.filter((tab) => retainedTabIds.has(tab.id)),
    [retainedTabIds, tabs]
  );
  const sourceControlSurfaceMounted =
    activeTab?.type === "source-control" ||
    retainedTabs.some((tab) => tab.type === "source-control");

  return {
    activeTab,
    tabs,
    retainedTabIds,
    retainedTabs,
    sourceControlSurfaceMounted,
  };
}
