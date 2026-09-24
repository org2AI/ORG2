import { expect, it } from "vitest";

import type { SessionEvent } from "../../types";
import type { DerivedSnapshot, SnapshotDelta } from "../EventStoreProxyTypes";
import {
  applyDeltaToCache,
  buildNormalizedCache,
} from "../snapshotMaterialization";

function event(id: string, historySequence: number): SessionEvent {
  return {
    id,
    chunk_id: null,
    sessionId: "history-order",
    createdAt: "2026-09-23T20:00:00Z",
    functionName: "agent_org_execution",
    uiCanonical: "agent_org_execution",
    actionType: "agent_org_execution",
    args: { historySequence },
    result: {},
    source: "system",
    displayText: "Execution",
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "agent",
  };
}

it("repositions an existing streaming event when hydration supplies its persistent order", () => {
  const earlier = event("z-earlier", 1);
  const later = event("a-later", 18);
  const snapshot: DerivedSnapshot = {
    version: 1,
    eventCount: 2,
    events: [earlier, later],
    chatEvents: [earlier, later],
    messagesEvents: [],
    sortedSimulatorEvents: [],
    lastEvent: later,
    eventIndex: {},
    chatEventCount: 2,
    hasRunningEvent: false,
  };
  const cache = buildNormalizedCache(snapshot)!;
  const delta: SnapshotDelta = {
    version: 2,
    baseVersion: 1,
    eventCount: 2,
    upserts: [event("a-later", 0)],
    removedIds: [],
    eventIds: [],
    chatEventIds: [],
    messagesEventIds: [],
    sortedSimulatorEventIds: [],
    lastEventId: later.id,
    chatEventCount: 2,
    hasRunningEvent: false,
    snapshotDelta: true,
    incrementalOrders: true,
    memberships: [
      {
        id: later.id,
        eventIndex: 1,
        chat: true,
        messages: false,
        simulator: false,
      },
    ],
    streaming: true,
  };
  const pending = applyDeltaToCache(delta, cache, null);
  expect(cache.chatEventIds).toEqual([later.id, earlier.id]);
  expect(pending.chatOrderChanged).toBe(true);
  expect(cache.eventIds).toEqual([earlier.id, later.id]);
  const repeated = applyDeltaToCache(
    { ...delta, version: 3, baseVersion: 2 },
    cache,
    null
  );
  expect(cache.chatEventIds).toEqual([later.id, earlier.id]);
  expect(repeated.chatOrderChanged).toBe(false);
});
