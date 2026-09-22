/**
 * InternalHeader Component
 *
 * Shared tab header for detail panels (settings pages, integrations
 * categories, agent detail views). Renders a large simple `TabPill` inside
 * the detail-panel header width, with optional right-side actions.
 */
import React, { memo } from "react";

import TabPill from "@src/components/TabPill";
import type { TabPillProps } from "@src/components/TabPill/types";
import { DETAIL_PANEL_TOKENS } from "@src/config/detailPanelTokens";

interface InternalHeaderProps {
  /** Tab items rendered as a large simple TabPill. */
  tabs: TabPillProps["tabs"];

  /** Key of the active tab. */
  activeTab: string;

  /** Called with the clicked tab key. */
  onTabChange: (tab: string) => void;

  /** Right-side actions (buttons, etc.) aligned after the tabs. */
  actions?: React.ReactNode;

  /** Add top padding when no PanelHeader sits above this header. */
  noPanelHeader?: boolean;
}

const InternalHeader: React.FC<InternalHeaderProps> = memo(
  ({ tabs, activeTab, onTabChange, actions, noPanelHeader = false }) => {
    const topPadding = noPanelHeader ? "pt-4" : "";

    return (
      <div
        className={`relative z-50 flex shrink-0 flex-col ${topPadding} px-4 ${DETAIL_PANEL_TOKENS.headerWidth}`}
        style={
          {
            WebkitAppRegion: "no-drag",
            pointerEvents: "auto",
          } as React.CSSProperties
        }
      >
        <div className="relative z-10 flex items-center pb-3">
          <TabPill
            tabs={tabs}
            activeTab={activeTab}
            onChange={onTabChange}
            variant="simple"
            fillWidth={false}
            size="large"
          />
          {actions && (
            <>
              <div className="min-w-0 flex-1" />
              <div className="flex shrink-0 items-center gap-2">{actions}</div>
            </>
          )}
        </div>
      </div>
    );
  }
);

InternalHeader.displayName = "InternalHeader";

export default InternalHeader;
