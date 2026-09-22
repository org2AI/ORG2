import React, { memo } from "react";

import AnyIcon from "@src/components/AnyIcon";
import { SidebarRow } from "@src/components/SidebarRow";
import { GitCommitIcon, PinIcon } from "@src/icons";
import { formatRelativeTime } from "@src/util/time/formatRelativeTime";

import type { OrgtrackFileTimelineEntry } from "../types";

interface OrgtrackTimelineEntryProps {
  entry: OrgtrackFileTimelineEntry;
  onCommitClick?: (commitSha: string) => void;
}

export const OrgtrackTimelineEntryView: React.FC<OrgtrackTimelineEntryProps> =
  memo(({ entry, onCommitClick }) => {
    const Icon = entry.entryType === "commit_link" ? GitCommitIcon : PinIcon;
    const timestamp = new Date(entry.timestamp * 1000).toISOString();
    const lineLabel =
      entry.startLine && entry.endLine
        ? `L${entry.startLine}-${entry.endLine}`
        : null;
    const sessionName =
      entry.sessionLabel ?? entry.sessionId ?? "Unknown session";
    const people = entry.agentIdentity?.displayName;
    const title = sessionName;
    const meta = [
      formatRelativeTime(timestamp, "compact"),
      people,
      entry.commitSha
        ? `${entry.commitSha.slice(0, 8)} applied`
        : "not committed",
      lineLabel,
      entry.functionName,
    ].filter(Boolean);

    return (
      <SidebarRow
        disabled={!entry.commitSha || !onCommitClick}
        onClick={() => {
          if (entry.commitSha) {
            onCommitClick?.(entry.commitSha);
          }
        }}
        label={title}
        metadata={meta.join(" · ")}
        icon={<AnyIcon icon={Icon} size={12} className="text-text-1" />}
      />
    );
  });

OrgtrackTimelineEntryView.displayName = "OrgtrackTimelineEntryView";
