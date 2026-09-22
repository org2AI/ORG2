import type { ReactNode } from "react";

import { DETAIL_PANEL_TOKENS } from "@src/config/detailPanelTokens";

export interface DetailHeaderTabsProps {
  title: ReactNode;
  tabs?: ReactNode;
}

/** Compact title + tabs composition for a shared detail header. */
export default function DetailHeaderTabs({
  title,
  tabs,
}: DetailHeaderTabsProps) {
  return (
    <div
      className={`flex min-w-0 flex-1 ${DETAIL_PANEL_TOKENS.headerHeight} items-center gap-2`}
    >
      <div
        className={`flex min-w-0 items-center ${
          tabs ? "max-w-xs shrink" : "flex-1"
        }`}
        data-testid="detail-header-title"
      >
        {title}
      </div>
      {tabs ? (
        <div className="h-full min-w-0 flex-1" data-testid="detail-header-tabs">
          {tabs}
        </div>
      ) : null}
    </div>
  );
}
