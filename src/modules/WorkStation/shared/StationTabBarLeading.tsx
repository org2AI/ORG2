import React from "react";

import { NoDragRegion } from "@src/components/WindowChrome";

import { StationModeChip } from "./StationModeChip";
import { TabBarLeadingLayout } from "./TabBarLeadingLayout";

/** Station-mode chip, kept tight to the first tab (no trailing padding). */
export const StationTabBarLeading: React.FC = () => (
  <TabBarLeadingLayout trailingPadding={false}>
    <NoDragRegion>
      <StationModeChip />
    </NoDragRegion>
  </TabBarLeadingLayout>
);

export default StationTabBarLeading;
