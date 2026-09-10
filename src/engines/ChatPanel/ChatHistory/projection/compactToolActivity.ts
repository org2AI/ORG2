import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { resolveToolUiCanonical } from "@src/engines/SessionCore/rendering/registry/toolClassifierRegistry";

import {
  getActionSummaryCategory,
  isBrowserEvent,
  isFileModificationEvent,
  isMcpToolEvent,
  isTerminalActivityEvent,
} from "../chatItemPipeline/classifiers";
import { getStableActivityItemId } from "../chatItemPipeline/pipeline";
import type { OptimizedChatItem } from "../chatItemPipeline/types";

const SEPARATE_EVENT_TYPES = new Set([
  "agent_message",
  "org_send_message",
  "org_read_messages",
  "assistant",
  "assistant_message",
  "message",
  "message_delta",
  "agent_response",
  "thinking",
  "llm_thinking",
  "thinking_delta",
  "ask_user",
  "ask_user_questions",
  "ask_user_permissions",
  "approval_request",
  "plan_approval",
  "user",
  "user_message",
]);

export function toolActivityCanonical(event: SessionEvent): string {
  return (
    event.uiCanonical ||
    resolveToolUiCanonical(event.functionName || event.actionType)
  );
}

function isCompactableTool(event: SessionEvent): boolean {
  if (event.source === "user" || event.id === "loading") return false;
  if (
    SEPARATE_EVENT_TYPES.has(event.actionType.toLowerCase()) ||
    SEPARATE_EVENT_TYPES.has(toolActivityCanonical(event))
  )
    return false;
  return (
    event.actionType === "tool_call" ||
    event.actionType === "tool_result" ||
    event.actionType.startsWith("tool_call_")
  );
}

/** Preserve the existing group families for homogeneous-row icons. */
export function toolActivityGroup(event: SessionEvent): string {
  if (getActionSummaryCategory(event)) return "explore";
  if (isFileModificationEvent(event)) return "edit";
  if (isTerminalActivityEvent(event) || isMcpToolEvent(event))
    return "terminal";
  if (isBrowserEvent(event)) return "browser";
  return `tool:${toolActivityCanonical(event)}`;
}

function itemEvents(item: OptimizedChatItem): SessionEvent[] | undefined {
  if (item.type === "activity" && item.event) return [item.event];
  if (item.type === "readFileGroup") return item.readFileEvents;
  if (item.type === "actionSummaryGroup")
    return item.actionSummaryItems?.map(({ event }) => event);
  if (item.type === "activityStackGroup")
    return item.activityStackGroup?.events;
  return undefined;
}

/** Display-only pass after deduplication and thread selection, shared by Worker and main thread. */
export function compactToolActivity(
  items: OptimizedChatItem[]
): OptimizedChatItem[] {
  const result: OptimizedChatItem[] = [];
  const groupOccurrences = new Map<string, number>();
  let events: SessionEvent[] = [];
  let firstChunkId = "";
  const flush = (closedByBoundary = true) => {
    if (!events.length) return;
    const occurrence = (groupOccurrences.get(firstChunkId) ?? 0) + 1;
    groupOccurrences.set(firstChunkId, occurrence);
    result.push({
      type: "activityStackGroup",
      chunk_id: `work:${firstChunkId}${occurrence > 1 ? `#${occurrence}` : ""}`,
      activityStackGroup: { category: "work", events, closedByBoundary },
    });
    events = [];
  };
  for (const item of items) {
    const candidates = itemEvents(item);
    if (
      item.structuralOnly ||
      !candidates?.length ||
      !candidates.every(isCompactableTool)
    ) {
      flush();
      result.push(item);
      continue;
    }
    for (const event of candidates) {
      const previous = events[events.length - 1];
      if (
        previous &&
        (previous.sessionId !== event.sessionId ||
          previous.threadId !== event.threadId)
      )
        flush();
      if (!events.length) firstChunkId = getStableActivityItemId(event);
      events.push(event);
    }
  }
  flush(false);
  return result;
}
