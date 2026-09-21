import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import type { OptimizedChatItem } from "./types";

function getEventCallId(event: SessionEvent): string | undefined {
  return (
    event.callId ||
    (event as { call_id?: string }).call_id ||
    (event.result?.call_id as string | undefined)
  );
}

export function getStableActivityItemId(event: SessionEvent): string {
  const callId = getEventCallId(event);
  if (
    callId &&
    (event.actionType === "tool_call" || event.actionType === "tool_result")
  ) {
    return event.sessionId
      ? `tool:${event.sessionId}:${callId}`
      : `tool:${callId}`;
  }
  return event.id;
}

/**
 * `chunk_id` is the React key for every rendered chat row, so it has to be
 * unique across the returned list.
 *
 * `getStableActivityItemId` deliberately collapses a `tool_call` and its
 * `tool_result` onto one `tool:<sessionId>:<callId>` id, on the assumption that
 * the backend merged the pair into a single event. When that merge doesn't
 * happen both events reach here and claim the same id — React then warns and
 * may drop one of the two rows outright.
 *
 * Disambiguate rather than drop: both events carry real content, and silently
 * discarding one would hide the upstream merge failure instead of surfacing it.
 * The fast path allocates nothing when ids are already unique, which is the
 * normal case.
 */
export function ensureUniqueChunkIds(
  items: OptimizedChatItem[]
): OptimizedChatItem[] {
  const seen = new Set<string>();
  let hasCollision = false;
  for (const item of items) {
    if (seen.has(item.chunk_id)) {
      hasCollision = true;
      break;
    }
    seen.add(item.chunk_id);
  }
  if (!hasCollision) return items;

  seen.clear();
  return items.map((item) => {
    if (!seen.has(item.chunk_id)) {
      seen.add(item.chunk_id);
      return item;
    }
    let occurrence = 2;
    let candidate = `${item.chunk_id}#${occurrence}`;
    while (seen.has(candidate)) {
      occurrence++;
      candidate = `${item.chunk_id}#${occurrence}`;
    }
    seen.add(candidate);
    return { ...item, chunk_id: candidate };
  });
}
