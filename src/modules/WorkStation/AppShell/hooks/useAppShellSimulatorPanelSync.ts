import { useSetAtom } from "jotai";
import { useEffect } from "react";

import { simulatorPrimarySidebarPositionAtom } from "@src/store/ui/simulatorAtom";
import type { LayoutMode } from "@src/store/ui/workStationLayout/splitLayoutAtoms";

export function useAppShellSimulatorPanelSync({
  isAgentStation,
  layoutMode,
}: {
  isAgentStation: boolean;
  layoutMode: LayoutMode;
}): void {
  const setSimSidebarPosition = useSetAtom(simulatorPrimarySidebarPositionAtom);

  // This is intentionally a gated mirror, not an always-live derivation:
  // native browser webviews observe this atom to schedule position updates.
  // My Station layout edits must not invalidate their simulator geometry.
  useEffect(() => {
    if (!isAgentStation) return;
    setSimSidebarPosition(layoutMode);
  }, [isAgentStation, layoutMode, setSimSidebarPosition]);
}
