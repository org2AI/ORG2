import { useAtomValue } from "jotai";
import { type ReactNode } from "react";

import ProjectManagerWorkItemsTabBarTrailing from "@src/modules/ProjectManager/ProjectManagerLayout/components/ProjectManagerWorkItemsTabBarTrailing";
import { workstationProjectTabBarAtom } from "@src/store/workstation";
import type { WorkstationTabHost } from "@src/store/workstation/tabHost";

import { StationHeaderControls } from "./StationHeaderControls";
import { TabBarPlusMenu } from "./TabBarPlusMenu";
import type { UseWorkstationTabListReturn } from "./useWorkstationTabList";

export interface UseWorkstationTrailingSlotOptions {
  host: WorkstationTabHost;
  visible: UseWorkstationTabListReturn["visible"];
}

/** Content actions precede the pane controls, which never depend on tab type. */
export function useWorkstationTrailingSlot({
  host,
  visible,
}: UseWorkstationTrailingSlotOptions): { trailingSlot: ReactNode } {
  const projectTabBar = useAtomValue(workstationProjectTabBarAtom);
  const projectActions =
    host === "project" && projectTabBar ? (
      <ProjectManagerWorkItemsTabBarTrailing
        activeTabId={
          visible.find((entry) => entry.isActive)?.tab.id ??
          visible[0]?.tab.id ??
          null
        }
        onAddProject={projectTabBar.onAddProject}
      />
    ) : null;
  return {
    trailingSlot: (
      <>
        {projectActions}
        <TabBarPlusMenu />
        <StationHeaderControls stationMode="my-station" />
      </>
    ),
  };
}
