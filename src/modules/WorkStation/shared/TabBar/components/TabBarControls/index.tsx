import React from "react";

import { HeaderActionGroup } from "@src/components/WindowChrome/HeaderActionGroup";
import { TAB_BAR_CONTROLS_ROW_PADDING_FULL } from "@src/config/workstation/tokens";

interface TabBarControlsProps {
  hasTabs: boolean;
  trailingSlot?: React.ReactNode;
}

/**
 * Right-aligned control section for the tab bar: hosts the trailing slot.
 */
export const TabBarControls: React.FC<TabBarControlsProps> = ({
  hasTabs,
  trailingSlot,
}) => {
  if (!hasTabs && !trailingSlot) return null;
  return (
    <HeaderActionGroup className={TAB_BAR_CONTROLS_ROW_PADDING_FULL}>
      {trailingSlot}
    </HeaderActionGroup>
  );
};
