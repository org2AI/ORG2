/**
 * activityGroupProjection
 *
 * Shared render half of the collapsible activity groups (edit, terminal,
 * explore). Each group keeps its own domain summary; this module owns the
 * part that was duplicated across all three:
 *
 * - tagging the final item of a group as the live tail,
 * - suppressing a stale `running` state on every item before that tail, and
 * - rendering one event through the lazy registry component inside a
 *   `Suspense` boundary with the shared loading block.
 *
 * Tool-usage aggregation lives in `./toolUsage` and is not re-implemented here.
 */
import React, { Suspense } from "react";

import { ChatLoadingBlock } from "@src/engines/ChatPanel/blocks/primitives";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { getChatLazyComponent } from "@src/engines/SessionCore/rendering/registry/events";
import { getRegistryEventType } from "@src/util/data/activityData/activityNormalizers";

export interface ActivityGroupEventItem {
  event: SessionEvent;
  isLastItem: boolean;
}

/**
 * Marks the final entry of an ordered item list as the group's live tail.
 * Generic so callers that carry extra per-item data (e.g. a category) keep it.
 */
export function markActivityGroupTail<T extends { event: SessionEvent }>(
  items: readonly T[]
): Array<T & { isLastItem: boolean }> {
  return items.map((item, index) => ({
    ...item,
    isLastItem: index === items.length - 1,
  }));
}

/** Wraps a plain event list into tail-tagged group items. */
export function buildActivityGroupItems(
  events: readonly SessionEvent[]
): ActivityGroupEventItem[] {
  return events.map((event, index) => ({
    event,
    isLastItem: index === events.length - 1,
  }));
}

/**
 * Only the live tail of a group may show a loading state. Any earlier item
 * still reporting `running` is a stale snapshot, so it is projected as
 * completed to avoid a stack of spinners.
 */
export function suppressLoadingForNonLastRunningEvent(
  event: SessionEvent,
  isLastItem: boolean
): SessionEvent {
  if (isLastItem || event.displayStatus !== "running") return event;
  return {
    ...event,
    displayStatus: "completed",
    activityStatus: "processed",
    isDelta: false,
  };
}

function ActivityGroupEventBlock({ event }: { event: SessionEvent }) {
  const eventType = getRegistryEventType(
    event as unknown as Record<string, unknown>
  );
  const EventComponent = getChatLazyComponent(eventType);
  return (
    <Suspense fallback={<ChatLoadingBlock />}>
      {React.createElement(EventComponent, { event })}
    </Suspense>
  );
}

/** `StackedBlock` `renderItem` for every event-per-row activity group. */
export function renderActivityGroupEvent({
  event,
  isLastItem,
}: ActivityGroupEventItem): React.ReactNode {
  return (
    <ActivityGroupEventBlock
      event={suppressLoadingForNonLastRunningEvent(event, isLastItem)}
    />
  );
}
