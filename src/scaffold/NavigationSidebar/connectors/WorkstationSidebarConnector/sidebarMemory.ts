import { SIDEBAR_MEMORY_KIND, useSidebarMemoryEntry } from "@src/hooks/perf";
import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";

import type { SessionSidebarView } from "./types";

const SESSION_SIDEBAR_MEMORY_LABEL: Record<SessionSidebarView, string> = {
  "work-items": "Work items sidebar",
  sessions: "Session sidebar",
  channels: "Channels sidebar",
};

interface UseWorkstationSidebarMemoryParams {
  activeSessionId: string;
  activeViewKey: SessionSidebarView;
  allSectionIds: readonly string[];
  collapsedSectionIds: ReadonlySet<string>;
  groupByMode: string;
  pinnedMenuItems: readonly NavigationMenuItem[];
  selectedMenuItemId: string;
  sidebarMenuItems: readonly NavigationMenuItem[];
}

export function useWorkstationSidebarMemory({
  activeSessionId,
  activeViewKey,
  allSectionIds,
  collapsedSectionIds,
  groupByMode,
  pinnedMenuItems,
  selectedMenuItemId,
  sidebarMenuItems,
}: UseWorkstationSidebarMemoryParams): void {
  useSidebarMemoryEntry({
    kind: SIDEBAR_MEMORY_KIND.SESSION,
    label: SESSION_SIDEBAR_MEMORY_LABEL[activeViewKey],
    items: pinnedMenuItems.length + sidebarMenuItems.length,
    sections: allSectionIds.length,
    source: {
      activeSessionId,
      collapsedSectionIds: Array.from(collapsedSectionIds),
      groupByMode,
      pinnedMenuItems,
      selectedMenuItemId,
      sidebarMenuItems,
    },
  });
}
