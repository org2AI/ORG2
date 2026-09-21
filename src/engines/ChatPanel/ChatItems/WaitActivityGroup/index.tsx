/**
 * WaitActivityGroup
 *
 * Collapses a run of standalone background-job waits (for example repeated
 * Codex polls) into one stack. The header reports how many waits ran and how
 * long they waited in total; each wait still renders through the registry.
 */
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { getEventIcon } from "@src/config/toolIcons";
import ToolUsageBadge from "@src/engines/ChatPanel/blocks/ToolCallBlock/ToolUsageBadge";
import {
  SESSION_UI_TOKENS,
  StackedBlock,
} from "@src/engines/ChatPanel/blocks/primitives";
import {
  formatDurationShort,
  resolveAwaitWaitedMs,
} from "@src/engines/ChatPanel/rendering/adapters/awaitMeta";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import {
  inferStatusFromResult,
  mapStatus,
} from "@src/engines/SessionCore/rendering/props/propsNormalizer";

import {
  type ActivityGroupEventItem,
  buildActivityGroupItems,
  renderActivityGroupEvent,
  suppressLoadingForNonLastRunningEvent,
} from "../activityGroupProjection";
import { readToolUsage, sumToolUsage } from "../toolUsage";

interface WaitActivityGroupProps {
  events: SessionEvent[];
  closedByBoundary?: boolean;
}

/**
 * Total wait time across the group. A row shows its duration only once the
 * wait is done, so only done waits count — judged after the same stale
 * `running` projection the rows receive.
 */
export function sumWaitedMs(items: readonly ActivityGroupEventItem[]): number {
  return items.reduce((total, { event, isLastItem }) => {
    const projected = suppressLoadingForNonLastRunningEvent(event, isLastItem);
    const status = mapStatus(
      projected.displayStatus || inferStatusFromResult(projected.result ?? {})
    );
    if (status !== "success") return total;
    return (
      total + (resolveAwaitWaitedMs(projected.args, projected.result) ?? 0)
    );
  }, 0);
}

/** "6 times · 1m 12s"; the duration is omitted when none was recorded. */
export function buildWaitGroupSummary(
  items: readonly ActivityGroupEventItem[],
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  return [
    t("tools.waitSummary.count", { count: items.length }),
    formatDurationShort(sumWaitedMs(items)),
  ]
    .filter(Boolean)
    .join(" · ");
}

const WaitActivityGroup: React.FC<WaitActivityGroupProps> = ({
  events,
  closedByBoundary = true,
}) => {
  const { t } = useTranslation("sessions");
  const items = useMemo(() => buildActivityGroupItems(events), [events]);
  const groupSummary = useMemo(
    () => buildWaitGroupSummary(items, t),
    [items, t]
  );

  if (items.length === 0) return null;

  const firstEvent = items[0].event;
  const groupToolUsage = sumToolUsage(
    items.map((item) => readToolUsage(item.event))
  );

  return (
    <div
      data-tool-call-event-id={firstEvent.id}
      data-tool-call-name={
        firstEvent.functionName ||
        firstEvent.uiCanonical ||
        firstEvent.actionType
      }
    >
      <StackedBlock
        items={items}
        icon={getEventIcon("await_output", {
          action: "wait_for",
          size: SESSION_UI_TOKENS.ICON.SIZE_SM,
          className: "text-text-2",
        })}
        label={t("tools.waitBackgroundTasks")}
        groupSummary={groupSummary}
        defaultCollapsed={closedByBoundary}
        collapseWhen={closedByBoundary}
        eventId={firstEvent.id}
        rightContent={
          groupToolUsage ? <ToolUsageBadge usage={groupToolUsage} /> : undefined
        }
        renderItem={renderActivityGroupEvent}
      />
    </div>
  );
};

WaitActivityGroup.displayName = "WaitActivityGroup";

export default WaitActivityGroup;
