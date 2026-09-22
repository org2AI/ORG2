/**
 * Reconciliation of native transcripts against canonical projections: drop
 * provider echoes of an already known prefix and extend an interrupted native
 * prefix with the durable portable suffix EventStore still holds.
 */
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { projectNativeConversationItems } from "./nativeConversationProjection";
import {
  nativeConversationItemsArePrefix,
  semanticItem,
} from "./nativeConversationSemantics";
import {
  nativeSourceEventId,
  scopedNativeSourceEventIdOf,
  sourceEventIdOfNativeItem,
} from "./nativeSourceEventIdentity";

/**
 * Remove provider-native echoes of a canonical prefix from a streamed suffix.
 *
 * A freshly materialized CLI session can expose its copied prefix after the
 * newly accepted user row while its live EventStore projection settles. Native
 * source ids survive that copy, so compare portable item identity instead of
 * relying on provider event order or a raw array index.
 */
export function removeKnownNativeConversationEchoes(
  knownEvents: readonly SessionEvent[],
  candidates: readonly SessionEvent[]
): SessionEvent[] {
  const knownItems = projectNativeConversationItems(knownEvents);
  // Only an explicit globally scoped identity proves two rows are the same
  // message. A provider-positional id (`codex-asst-97`) is reused by every
  // native rollout of one execution child, so its session-scoped hash can
  // collide with a different, genuinely new row from a later rollout.
  const seen = new Set(
    knownEvents
      .map(scopedNativeSourceEventIdOf)
      .filter((id): id is string => id !== null)
  );
  const semanticCounts = new Map<string, number>();
  let semanticPrefixOpen = true;
  for (const item of knownItems) {
    const key = JSON.stringify(semanticItem(item));
    semanticCounts.set(key, (semanticCounts.get(key) ?? 0) + 1);
  }
  return candidates.filter((event) => {
    const items = projectNativeConversationItems([event]);
    if (items.length === 0) return true;
    const scopedId = scopedNativeSourceEventIdOf(event);
    const hasKnownIds = scopedId !== null && seen.has(scopedId);
    const keys = items.map((item) => JSON.stringify(semanticItem(item)));
    const remaining = new Map(semanticCounts);
    const hasKnownSemantics = keys.every((key) => {
      const count = remaining.get(key) ?? 0;
      if (count <= 0) return false;
      remaining.set(key, count - 1);
      return true;
    });
    // Provider-local ids can change when a copied prefix crosses runtimes, so
    // semantic matching is necessary while that prefix is being replayed.
    // Once the first genuinely new portable row arrives, however, an equal
    // later answer/tool result is a legitimate repetition and must survive.
    // Globally scoped identity remains safe to collapse anywhere.
    const isKnown = hasKnownIds || (semanticPrefixOpen && hasKnownSemantics);
    if (!isKnown) semanticPrefixOpen = false;
    if (isKnown) {
      for (const key of keys) {
        const count = semanticCounts.get(key) ?? 0;
        if (count > 0) semanticCounts.set(key, count - 1);
      }
    }
    if (scopedId) seen.add(scopedId);
    return !isKnown;
  });
}

/**
 * Native CLIs can be killed before their newest fork is flushed. In that
 * case the native reader deliberately falls back to the previous readable
 * fork, while EventStore still holds the accepted user row and any durable
 * partial output already streamed by the interrupted turn. Extend the native
 * semantic prefix with exactly that portable suffix instead of blanking it
 * during reconcile. Divergent histories fail closed and keep native truth.
 */
export function mergeInterruptedConversationProjection(
  nativeEvents: readonly SessionEvent[],
  projectedEvents: readonly SessionEvent[]
): SessionEvent[] {
  const nativeItems = projectNativeConversationItems(nativeEvents);
  const projectedItems = projectNativeConversationItems(projectedEvents);
  if (
    nativeItems.length >= projectedItems.length ||
    !nativeConversationItemsArePrefix(nativeItems, projectedItems)
  ) {
    return [...nativeEvents];
  }

  const suffixSourceIds = new Set(
    projectedItems.slice(nativeItems.length).map(sourceEventIdOfNativeItem)
  );
  const nativeEventIds = new Set(nativeEvents.map((event) => event.id));
  const suffix = projectedEvents.filter(
    (event) =>
      suffixSourceIds.has(nativeSourceEventId(event)) &&
      !nativeEventIds.has(event.id)
  );
  return suffix.length > 0 ? [...nativeEvents, ...suffix] : [...nativeEvents];
}
