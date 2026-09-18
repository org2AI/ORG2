import React, { memo } from "react";

import { DROPDOWN_CLASSES } from "@src/components/Dropdown/tokens";
import { CHAT_PANEL_WIDTH_TOKENS } from "@src/config/detailPanelTokens";

interface AgentOrgOverviewTrayProps {
  children: React.ReactNode;
  surfaceBgClass: string;
}

const AgentOrgOverviewTray: React.FC<AgentOrgOverviewTrayProps> = memo(
  ({ children, surfaceBgClass }) => (
    <div
      className={`scrollbar-hide max-h-[45%] shrink-0 overflow-y-auto ${surfaceBgClass}`}
      data-testid="agent-org-overview-tray"
    >
      <div
        className={`mx-auto w-full px-2 pb-2 ${CHAT_PANEL_WIDTH_TOKENS.contentMaxWidth}`}
      >
        <div
          data-agent-org-overview-panel="true"
          className={`${DROPDOWN_CLASSES.panel} p-1`}
        >
          {children}
        </div>
      </div>
    </div>
  )
);

AgentOrgOverviewTray.displayName = "AgentOrgOverviewTray";

export default AgentOrgOverviewTray;
