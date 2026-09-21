/**
 * Search Block — header-only transparent variant for code search.
 *
 * Grep / symbol search results render as a single header row (icon + lifecycle
 * label + pattern). The result body is not
 * surfaced in chat — users inspect matches in the simulator.
 */
import React from "react";

import { getToolIcon } from "@src/config/toolIcons";
import type { ToolUsageMetadata } from "@src/engines/SessionCore/core/types";

import { HeaderOnlyBlock } from "../primitives";

interface SearchBlockProps {
  /** Search pattern/query */
  pattern: string;
  /** Whether currently loading */
  isLoading?: boolean;
  /** Optional event ID for simulator replay */
  eventId?: string;
  /** Optional action name for per-action icon (e.g. "grep", "find_files") */
  action?: string;
  /**
   * Pre-translated header title for the current state. Adapter resolves via
   * `useLifecycleLabels("code_search", action)` and picks running/done/failed.
   */
  title: string;
  toolUsage?: ToolUsageMetadata;
}

const SearchBlock: React.FC<SearchBlockProps> = React.memo(
  ({ pattern, isLoading = false, eventId, action, title, toolUsage }) => (
    <HeaderOnlyBlock
      icon={getToolIcon("code_search", {
        size: 14,
        className: "text-text-2",
        action,
      })}
      title={title}
      subtitle={pattern}
      subtitleTitle={pattern}
      subtitleClassName="text-text-1"
      truncateSubtitle
      isLoading={isLoading}
      eventId={eventId}
      toolUsage={toolUsage}
      collapseParticipation
    />
  )
);

SearchBlock.displayName = "SearchBlock";

export default SearchBlock;
