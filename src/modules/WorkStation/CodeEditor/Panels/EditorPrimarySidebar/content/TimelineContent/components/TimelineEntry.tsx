import React, { memo } from "react";

import { SidebarRow } from "@src/components/SidebarRow";
import { formatRelativeTime } from "@src/util/time/formatRelativeTime";

interface TimelineEntryProps {
  commitSha: string;
  shortSha: string;
  message: string;
  author: string;
  timestamp: string;
  isSelected?: boolean;
  onClick: () => void;
}

export const TimelineEntry: React.FC<TimelineEntryProps> = memo(
  ({
    shortSha,
    message,
    author,
    timestamp,
    isSelected = false,
    onClick,
    commitSha: _commitSha,
  }) => {
    return (
      <SidebarRow
        selected={isSelected}
        onClick={onClick}
        label={message}
        metadata={`${formatRelativeTime(timestamp, "compact")} · ${author} · ${shortSha}`}
      />
    );
  }
);

TimelineEntry.displayName = "TimelineEntry";
