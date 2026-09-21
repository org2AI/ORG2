/**
 * ActionSummaryGroup Component
 *
 * Displays a collapsible group of consecutive exploration tool calls
 * (read, search, glob, list) using StackedBlock.
 *
 * Each event renders via the same registry event component used by
 * ActivityRouter — no manual data extraction or per-category block
 * construction. Loading / failed / completed states are handled by
 * each event component natively.
 */
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { getToolIcon } from "@src/config/toolIcons";
import ToolUsageBadge from "@src/engines/ChatPanel/blocks/ToolCallBlock/ToolUsageBadge";
import { StackedBlock } from "@src/engines/ChatPanel/blocks/primitives";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import type { ActionSummaryCategory } from "../../ChatHistory/chatItemPipeline/classifiers";
import type { ActionSummaryEntry } from "../../ChatHistory/chatItemPipeline/types";
import {
  type ActivityGroupEventItem,
  markActivityGroupTail,
  renderActivityGroupEvent,
} from "../activityGroupProjection";
import { readToolUsage, sumToolUsage } from "../toolUsage";

// ============================================
// Types
// ============================================

interface ActionSummaryGroupProps {
  entries: ActionSummaryEntry[];
  items?: { category: ActionSummaryCategory; event: SessionEvent }[];
  closedByBoundary?: boolean;
}

interface CategorizedEvent extends ActivityGroupEventItem {
  category: ActionSummaryCategory;
}

// ============================================
// Header Label Builder
// ============================================

function buildGroupSummary(
  entries: ActionSummaryEntry[],
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  const parts: string[] = [];
  for (const entry of entries) {
    const count = entry.events.length;
    switch (entry.category) {
      case "read":
        parts.push(t("tools.exploreSummary.read", { count }));
        break;
      case "search":
        parts.push(t("tools.exploreSummary.search", { count }));
        break;
      case "glob":
        parts.push(t("tools.exploreSummary.glob", { count }));
        break;
      case "list":
        parts.push(t("tools.exploreSummary.ls", { count }));
        break;
      case "lsp":
        parts.push(t("tools.exploreSummary.lsp", { count }));
        break;
    }
  }
  return parts.join(t("tools.exploreSummary.separator"));
}

// ============================================
// Component
// ============================================

const ActionSummaryGroup: React.FC<ActionSummaryGroupProps> = ({
  entries,
  items,
  closedByBoundary = true,
}) => {
  const { t } = useTranslation("sessions");

  const totalCount = useMemo(
    () => entries.reduce((sum, entry) => sum + entry.events.length, 0),
    [entries]
  );

  const groupSummary = useMemo(
    () => buildGroupSummary(entries, t),
    [entries, t]
  );

  const orderedItems: CategorizedEvent[] = useMemo(() => {
    const baseItems =
      items && items.length > 0
        ? items
        : entries.flatMap((entry) =>
            entry.events.map((event) => ({
              category: entry.category,
              event,
            }))
          );

    return markActivityGroupTail(baseItems);
  }, [items, entries]);

  if (totalCount === 0) return null;

  const firstEvent = orderedItems[0]?.event;
  const toolName =
    firstEvent?.functionName ||
    firstEvent?.uiCanonical ||
    firstEvent?.actionType;
  const groupToolUsage = sumToolUsage(
    orderedItems.map((item) => readToolUsage(item.event))
  );

  return (
    <div
      data-tool-call-event-id={firstEvent?.id}
      data-tool-call-name={toolName}
    >
      <StackedBlock
        items={orderedItems}
        icon={getToolIcon("read_file")}
        label={t("tools.explore")}
        groupSummary={groupSummary}
        defaultCollapsed={closedByBoundary}
        collapseWhen={closedByBoundary}
        eventId={firstEvent?.id}
        rightContent={
          groupToolUsage ? <ToolUsageBadge usage={groupToolUsage} /> : undefined
        }
        renderItem={renderActivityGroupEvent}
      />
    </div>
  );
};

export default ActionSummaryGroup;
