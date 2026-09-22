import type { SessionGroupVisibleCount } from "./types";

export type SessionFilterSubmenu = "groupBy" | "visibleCount" | "sort";

export interface SessionFilterButtonProps {
  groupByMode: string;
  groupVisibleCount: SessionGroupVisibleCount;
  includeExternal: boolean;
  onSelect: (mode: string) => void;
  onSelectGroupVisibleCount: (count: SessionGroupVisibleCount) => void;
  onToggleIncludeExternal: (includeExternal: boolean) => void;
  /**
   * Open Runtime → Scanning, where each external source is shown or hidden
   * individually. Refines the all-or-nothing `includeExternal` toggle above it.
   */
  onConfigureExternalSources?: () => void;
  /** Collapse every section in the sidebar. */
  onCollapseAll?: () => void;
  /** Mark all currently-loaded sessions as visited. */
  onMarkAllRead?: () => void;
  /** Refresh the sidebar session list from the backing stores. */
  onRefreshSessions?: () => void;
  /** Open the JSON Session export modal for the active Session. */
  onExportSessionJson?: () => void;
  /** Open the JSON Session import modal. */
  onImportSessionJson?: () => void;
  canExportSessionJson?: boolean;
}
