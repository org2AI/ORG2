/**
 * ListDirBlock — header-only transparent variant for `list_dir`.
 *
 * Renders as a single header row (icon + lifecycle title + directory
 * subtitle), matching the visual shape of `SearchBlock` and `GlobBlock`.
 * The expanded directory listing is reachable in the simulator's Files
 * tab, so chat stays compact for what is usually a high-volume,
 * low-information event.
 */
import React from "react";

import { getToolIcon } from "@src/config/toolIcons";
import type { ToolUsageMetadata } from "@src/engines/SessionCore/core/types";

import { HeaderOnlyBlock } from "../primitives";

interface ListDirBlockProps {
  /** Directory path being listed (raw value from the event). */
  dirPath?: string;
  /** Whether the call is still running. */
  isLoading?: boolean;
  /** Optional event ID for simulator replay locate. */
  eventId?: string;
  /**
   * Pre-translated header title for the current state. Adapter resolves via
   * `useLifecycleLabels("list_dir", action)` and picks running / done /
   * failed.
   */
  title: string;
  /** Optional repo-relative target path label for multi-root workspaces. */
  targetPath?: string;
  toolUsage?: ToolUsageMetadata;
}

const ListDirBlock: React.FC<ListDirBlockProps> = React.memo(
  ({ dirPath, isLoading = false, eventId, title, targetPath, toolUsage }) => {
    // Prefer the formatted repo-relative label; fall back to the raw event
    // path. Hide the subtitle entirely for cwd-only events (`"."`) so the
    // header reads cleanly as "Listed contents".
    const subtitle =
      targetPath || (dirPath && dirPath !== "." ? dirPath : undefined);

    return (
      <HeaderOnlyBlock
        icon={getToolIcon("list_dir", { size: 14, className: "text-text-2" })}
        title={title}
        subtitle={subtitle}
        subtitleTitle={subtitle || undefined}
        subtitleClassName="text-text-1"
        truncateSubtitle
        isLoading={isLoading}
        eventId={eventId}
        toolUsage={toolUsage}
        collapseParticipation
      />
    );
  }
);

ListDirBlock.displayName = "ListDirBlock";

export default ListDirBlock;
