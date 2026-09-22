import React from "react";

import type { OpenPRItem } from "@src/api/tauri/github";
import { Placeholder } from "@src/components/Placeholder";
import {
  type SectionStatus,
  SectionStatusRow,
} from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/components/SectionStatusRow";
import { TreeSectionHeader } from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/components/TreeSectionHeader";
import type { WorkstationOpenPrsLoadState } from "@src/store/workstation/codeEditor/workstationPrAtom";

import { PrRow } from "./PrRow";
import type { PrVirtualRow } from "./types";
import type { usePullRequestVirtualList } from "./usePullRequestVirtualList";

type PullRequestVirtualList = ReturnType<typeof usePullRequestVirtualList>;

interface PullRequestTreeListProps {
  openCollapsed: boolean;
  setOpenCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  closedCollapsed: boolean;
  orderedPrs: OpenPRItem[];
  filteredClosedPrs: OpenPRItem[];
  closedPrsLoadState: WorkstationOpenPrsLoadState;
  handleToggleClosed: () => void;
  selectedPrNumber: number | null;
  handlePrClick: (pr: OpenPRItem) => void;
  openWholePane: boolean;
  openStatus: SectionStatus | null;
  listRef: PullRequestVirtualList["listRef"];
  prListVirtualizer: PullRequestVirtualList["prListVirtualizer"];
  virtualItems: PullRequestVirtualList["virtualItems"];
  virtualRows: PrVirtualRow[];
}

/**
 * The Open / Closed PR tree: a full-pane placeholder while Open is the only
 * expanded section and has no rows, otherwise the virtualized row list.
 */
export function PullRequestTreeList({
  openCollapsed,
  setOpenCollapsed,
  closedCollapsed,
  orderedPrs,
  filteredClosedPrs,
  closedPrsLoadState,
  handleToggleClosed,
  selectedPrNumber,
  handlePrClick,
  openWholePane,
  openStatus,
  listRef,
  prListVirtualizer,
  virtualItems,
  virtualRows,
}: PullRequestTreeListProps): React.ReactNode {
  const renderVirtualRow = (row: PrVirtualRow): React.ReactNode => {
    switch (row.kind) {
      case "header":
        return row.section === "open" ? (
          <TreeSectionHeader
            id="open-prs"
            title="Open"
            collapsed={openCollapsed}
            count={orderedPrs.length}
            onToggle={() => setOpenCollapsed((prev) => !prev)}
          />
        ) : (
          <TreeSectionHeader
            id="closed-prs"
            title="Closed"
            collapsed={closedCollapsed}
            count={
              closedPrsLoadState === "ready" ? filteredClosedPrs.length : null
            }
            onToggle={handleToggleClosed}
          />
        );
      case "status":
        return <SectionStatusRow status={row.status} />;
      case "pr":
        return (
          <PrRow
            pr={row.pr}
            depth={1}
            isSelected={row.pr.number === selectedPrNumber}
            onClick={handlePrClick}
          />
        );
    }
  };

  let listContent: React.ReactNode;
  if (!openCollapsed && openWholePane && openStatus?.kind !== "error") {
    // Open is the only expanded section and has no rows — surface its
    // loading/empty state as a full-pane placeholder, keeping both headers.
    listContent = (
      <div className="flex flex-1 flex-col overflow-hidden">
        <TreeSectionHeader
          id="open-prs"
          title="Open"
          collapsed={openCollapsed}
          count={orderedPrs.length}
          onToggle={() => setOpenCollapsed((prev) => !prev)}
        />
        <Placeholder
          loadingIconOnly
          variant={openStatus?.kind === "loading" ? "loading" : "empty"}
          placement="sidebar"
          title={
            openStatus?.kind === "loading" ? undefined : openStatus?.message
          }
          fillParentHeight
        />
        <TreeSectionHeader
          id="closed-prs"
          title="Closed"
          collapsed={closedCollapsed}
          count={
            closedPrsLoadState === "ready" ? filteredClosedPrs.length : null
          }
          onToggle={handleToggleClosed}
        />
      </div>
    );
  } else {
    listContent = (
      <div ref={listRef} className="flex flex-1 overflow-y-auto">
        <div
          className="relative w-full"
          style={{ height: prListVirtualizer.getTotalSize() }}
        >
          {virtualItems.map((virtualItem) => {
            const row = virtualRows[virtualItem.index];
            return (
              <div
                key={virtualItem.key}
                ref={prListVirtualizer.measureElement}
                data-index={virtualItem.index}
                className="absolute top-0 left-0 w-full"
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                {renderVirtualRow(row)}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return listContent;
}
