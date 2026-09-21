import React, { memo } from "react";

export interface CompactListHeaderProps {
  children: React.ReactNode;
}

/**
 * Canonical control row above the compact left pane in a split list/detail
 * surface. Dataset adapters provide controls; this shell owns their placement.
 */
const CompactListHeader: React.FC<CompactListHeaderProps> = memo(
  ({ children }) => (
    <div
      className="flex shrink-0 items-center gap-2 bg-chat-pane px-3 py-2"
      data-compact-list-header="true"
    >
      {children}
    </div>
  )
);

CompactListHeader.displayName = "CompactListHeader";

export default CompactListHeader;
