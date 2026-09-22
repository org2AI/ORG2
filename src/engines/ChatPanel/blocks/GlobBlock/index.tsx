/**
 * Glob Block — header-only transparent variant for file pattern search.
 *
 * `find_files` / `glob_file_search` render as one header row. The matched file
 * list is visible in the simulator; chat shows the lifecycle title plus the
 * searched file pattern.
 */
import React from "react";

import FileTypeIcon from "@src/components/FileTypeIcon";
import { getToolIcon } from "@src/config/toolIcons";
import type { ToolUsageMetadata } from "@src/engines/SessionCore/core/types";

import { HeaderOnlyBlock } from "../primitives";

interface GlobBlockProps {
  /** Glob pattern */
  pattern: string;
  /** Whether currently loading */
  isLoading?: boolean;
  /** Optional event ID for simulator replay */
  eventId?: string;
  /**
   * Pre-translated header title for the current state. Adapter resolves via
   * `useLifecycleLabels("code_search", "find_files")` (or `"glob_file_search"`).
   */
  title: string;
  toolUsage?: ToolUsageMetadata;
}

const GlobBlock: React.FC<GlobBlockProps> = React.memo(
  ({ pattern, isLoading = false, eventId, title, toolUsage }) => (
    <HeaderOnlyBlock
      icon={getToolIcon("glob_file_search", {
        size: 14,
        className: "text-text-2",
      })}
      title={title}
      subtitle={pattern}
      subtitleTitle={pattern}
      subtitleClassName="text-text-1"
      subtitlePrefix={
        <FileTypeIcon
          fileName={pattern}
          size="small"
          className="mr-1.5 shrink-0"
        />
      }
      truncateSubtitle
      isLoading={isLoading}
      eventId={eventId}
      toolUsage={toolUsage}
      collapseParticipation
    />
  )
);

GlobBlock.displayName = "GlobBlock";

export default GlobBlock;
