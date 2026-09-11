import { useAtomValue, useSetAtom } from "jotai";
import { useMemo } from "react";

import { SIMULATOR_PRIMARY_SIDEBAR } from "@src/config/simulatorPrimarySidebar";
import {
  simulatorPrimarySidebarCollapsedAtom,
  simulatorPrimarySidebarPositionAtom,
  simulatorPrimarySidebarWidthAtom,
  simulatorPrimarySidebarWidthPersistAtom,
} from "@src/store/ui/simulatorAtom";

/** Shared replay preferences; live workstation dimensions remain independent. */
export function useSimulatorReplaySidebar() {
  const collapsed = useAtomValue(simulatorPrimarySidebarCollapsedAtom);
  const layoutMode = useAtomValue(simulatorPrimarySidebarPositionAtom);
  const size = useAtomValue(simulatorPrimarySidebarWidthAtom);
  const onSizeChange = useSetAtom(simulatorPrimarySidebarWidthPersistAtom);
  // Stable across cursor/selection renders so each app can memoize its content.
  const sidebar = useMemo(
    () => ({
      collapsed,
      size,
      onSizeChange,
      minSize: SIMULATOR_PRIMARY_SIDEBAR.minWidth,
      maxSize: SIMULATOR_PRIMARY_SIDEBAR.maxWidth,
      resetSize: SIMULATOR_PRIMARY_SIDEBAR.defaultWidth,
    }),
    [collapsed, size, onSizeChange]
  );
  return { layoutMode, sidebar };
}
