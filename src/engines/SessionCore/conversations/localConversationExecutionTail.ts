import { loadCanonicalConversationEvents } from "@src/engines/SessionCore/conversations/canonicalConversationEvents";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { isOptimisticQueueUserEventId } from "@src/engines/SessionCore/services/userIntentDispatch";
import { turnIntentIdOf } from "@src/engines/SessionCore/sync/utils/activityIds";
import { invokeTauri } from "@src/util/platform/tauri/init";

import type { ConversationRootLocator } from "./conversationTypes";
import { conversationExecutionParentId } from "./localConversationContinuation";
import {
  NATIVE_SOURCE_EVENT_ID_ARG,
  nativeConversationEventSemanticKey,
  nativeConversationItemsArePrefix,
  projectNativeConversationItems,
  sourceEventIdOfNativeItem,
} from "./nativeConversationMaterializer";

export const LOCAL_EXECUTION_TAIL_EVENT_PREFIX = "runlanded-";

export interface LocalExecutionChild {
  session_id: string;
  created_at: string;
}

export interface LocalExecutionSegment {
  child: LocalExecutionChild;
  events: readonly SessionEvent[];
}

export function resolveLocalExecutionChildren(
  children: readonly { sessionId: string }[],
  createdAtBySessionId: ReadonlyMap<string, string | undefined>
): LocalExecutionChild[] {
  const resolved: LocalExecutionChild[] = [];
  const seen = new Set<string>();
  for (const child of children) {
    const createdAt = createdAtBySessionId.get(child.sessionId);
    if (!child.sessionId || !createdAt || seen.has(child.sessionId)) continue;
    seen.add(child.sessionId);
    resolved.push({ session_id: child.sessionId, created_at: createdAt });
  }
  return resolved.sort((left, right) =>
    left.created_at.localeCompare(right.created_at)
  );
}

export async function loadLocalExecutionChildren(
  root: ConversationRootLocator
): Promise<LocalExecutionChild[]> {
  // The child-session command already joins Agent, CLI, and imported episode
  // catalogs into one authoritative row shape. Use its creation timestamp
  // directly; probing every provider adapter here both duplicated that owner
  // and could silently drop a valid child while an adapter was still waking.
  const children = await invokeTauri<
    { sessionId: string; createdAt?: string }[]
  >("es_get_child_sessions", {
    parentSessionId: conversationExecutionParentId(root),
  });
  return resolveLocalExecutionChildren(
    children,
    new Map(children.map((child) => [child.sessionId, child.createdAt]))
  );
}

function nativeSourceEventId(event: SessionEvent): string {
  const sourceId = event.args?.[NATIVE_SOURCE_EVENT_ID_ARG];
  return typeof sourceId === "string" && sourceId.length > 0
    ? sourceId
    : event.id;
}

function nativeItemSuffixEvents(
  canonicalEvents: readonly SessionEvent[],
  childEvents: readonly SessionEvent[]
): SessionEvent[] | null {
  const canonicalItems = projectNativeConversationItems(canonicalEvents);
  const childItems = projectNativeConversationItems(childEvents);
  if (!nativeConversationItemsArePrefix(canonicalItems, childItems)) {
    return null;
  }
  const suffixSourceIds = new Set(
    childItems.slice(canonicalItems.length).map(sourceEventIdOfNativeItem)
  );
  if (suffixSourceIds.size === 0) return [];
  return childEvents.filter((event) =>
    suffixSourceIds.has(nativeSourceEventId(event))
  );
}

function isContextCompactEvent(event: SessionEvent): boolean {
  return (
    event.actionType === "context_compacted" ||
    event.functionName === "context_compacted"
  );
}

function nativeCompactedSuffixEvents(
  canonicalEvents: readonly SessionEvent[],
  childEvents: readonly SessionEvent[]
): SessionEvent[] | null {
  const canonicalItems = projectNativeConversationItems(canonicalEvents);
  for (
    let compactIndex = 0;
    compactIndex < childEvents.length;
    compactIndex += 1
  ) {
    if (!isContextCompactEvent(childEvents[compactIndex])) continue;
    const beforeCompactItems = projectNativeConversationItems(
      childEvents.slice(0, compactIndex)
    );
    if (!nativeConversationItemsArePrefix(canonicalItems, beforeCompactItems)) {
      continue;
    }
    const preCompactSuffixIds = new Set(
      beforeCompactItems
        .slice(canonicalItems.length)
        .map(sourceEventIdOfNativeItem)
    );
    return childEvents.filter(
      (event, eventIndex) =>
        (eventIndex < compactIndex &&
          preCompactSuffixIds.has(nativeSourceEventId(event))) ||
        (eventIndex >= compactIndex &&
          nativeConversationEventSemanticKey(event) !== null)
    );
  }
  return null;
}

/**
 * Fold local execution episodes into one provider-portable conversation.
 *
 * Every child is a native materialization of the prefix accumulated before it.
 * Prefer the provider's effective native-item prefix (which understands an
 * existing compact marker). When a child performs another native compact,
 * verify the effective message list immediately before that marker, then append
 * the completed pre-compact turn, compact marker, and structured suffix.
 * Divergent/branched children never enter the canonical timeline.
 */
export function mergeVerifiedLocalExecutionTimeline(
  rootEvents: readonly SessionEvent[],
  segments: readonly LocalExecutionSegment[]
): SessionEvent[] {
  let canonical = [...rootEvents];
  for (const { events } of segments) {
    const suffix =
      nativeItemSuffixEvents(canonical, events) ??
      nativeCompactedSuffixEvents(canonical, events);
    if (!suffix || suffix.length === 0) continue;
    canonical = [...canonical, ...suffix];
  }
  return canonical;
}

/** One durable loader shared by local/imported execution and the visible UI. */
export async function loadLocalCanonicalConversationTimeline(
  root: ConversationRootLocator
): Promise<SessionEvent[]> {
  const [{ events: rootEvents }, children] = await Promise.all([
    loadCanonicalConversationEvents(root.conversationId),
    loadLocalExecutionChildren(root),
  ]);
  const segments = await Promise.all(
    children.map(async (child) => ({
      child,
      events: await loadLocalExecutionChildEvents(child.session_id),
    }))
  );
  return mergeVerifiedLocalExecutionTimeline(rootEvents, segments);
}

/** Namespace only the verified child suffix for rendering on the root stream. */
export function projectVerifiedLocalExecutionTail(
  rootEvents: readonly SessionEvent[],
  segments: readonly LocalExecutionSegment[],
  canonicalSessionId: string
): SessionEvent[] {
  return mergeVerifiedLocalExecutionTimeline(rootEvents, segments)
    .slice(rootEvents.length)
    .map((event) => ({
      ...event,
      id: `${LOCAL_EXECUTION_TAIL_EVENT_PREFIX}${event.id}`,
      chunk_id: `${LOCAL_EXECUTION_TAIL_EVENT_PREFIX}${event.id}`,
      sessionId: canonicalSessionId,
    }));
}

export function suppressLandedQueuedUserRows(
  anchorEvents: readonly SessionEvent[],
  tails: readonly SessionEvent[]
): SessionEvent[] {
  if (tails.length === 0) return [...anchorEvents];
  const optimistic = anchorEvents.filter(
    (event) => event.source === "user" && isOptimisticQueueUserEventId(event.id)
  );
  if (optimistic.length === 0) return [...anchorEvents];

  const suppressedIds = new Set<string>();
  for (const landed of tails) {
    if (landed.source !== "user") continue;
    const turnIntentId = turnIntentIdOf(landed);
    let matched = turnIntentId
      ? optimistic.find(
          (candidate) =>
            !suppressedIds.has(candidate.id) &&
            turnIntentIdOf(candidate) === turnIntentId
        )
      : undefined;
    if (!matched) {
      const landedText = (landed.displayText ?? "").trim();
      if (!landedText) continue;
      const landedAt = Date.parse(landed.createdAt ?? "");
      const candidates = optimistic.filter(
        (candidate) =>
          !suppressedIds.has(candidate.id) &&
          (candidate.displayText ?? "").trim() === landedText
      );
      matched = candidates
        .filter((candidate) => {
          const candidateAt = Date.parse(candidate.createdAt ?? "");
          return (
            !Number.isFinite(landedAt) ||
            !Number.isFinite(candidateAt) ||
            candidateAt <= landedAt
          );
        })
        .at(-1);
    }
    if (matched) suppressedIds.add(matched.id);
  }
  return anchorEvents.filter((event) => !suppressedIds.has(event.id));
}

export async function loadLocalExecutionChildEvents(
  sessionId: string
): Promise<SessionEvent[]> {
  const { events } = await loadCanonicalConversationEvents(sessionId);
  return [...events];
}
