import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { createSyntheticUserEvent } from "@src/engines/SessionCore/sync/adapters/shared/eventFactories";

import { hydrateSynchronizedConversationProjection } from "./localConversationSettledTail";
import { retryLineageEvent } from "./queuedRetryLineage";

const store = vi.hoisted(() => ({
  getEvents: vi.fn(),
  set: vi.fn(),
  mergeEvents: vi.fn(),
}));
vi.mock("@src/engines/SessionCore/core/store/EventStoreProxy", () => ({
  eventStoreProxy: store,
}));

const sessionId = "cliagent-hydration";
function message(
  id: string,
  source: "user" | "assistant",
  text: string
): SessionEvent {
  return {
    id,
    chunk_id: id,
    sessionId,
    source,
    createdAt: "2026-09-24T00:00:00Z",
    functionName: source === "user" ? "user_message" : "assistant",
    uiCanonical: source === "user" ? "user_message" : "agent_message",
    actionType: source === "user" ? "raw" : "assistant",
    args: {},
    result: { content: text, observation: text },
    displayText: text,
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "agent",
    isDelta: false,
  };
}
const before = [message("codex-user-old", "user", "Write a story")];
const prepared = createSyntheticUserEvent(sessionId, "Continue", {
  turnIntentId: "current-intent",
  deliveryStatus: "pending",
});

beforeEach(() => {
  vi.clearAllMocks();
  store.set.mockResolvedValue(undefined);
});

describe("pre-dispatch native projection hydration", () => {
  it("replaces the recovered partial with its verified native copy before the pending turn", async () => {
    // Real Stop/resume shape: Rust finalized a partial outside the native
    // rollout. Synchronization writes it into that rollout under a native id.
    const partial = message(
      "stream-msg-finalized-old",
      "assistant",
      "Old partial"
    );
    partial.result.turnIntentId = "previous-intent";
    const nativeCopy = message("codex-asst-30", "assistant", "Old partial");
    const resident = [...before, partial, prepared];
    store.getEvents.mockResolvedValue(resident);
    await hydrateSynchronizedConversationProjection(
      sessionId,
      before,
      [...before, nativeCopy],
      prepared
    );
    expect(store.set).toHaveBeenCalledWith(
      [...before, nativeCopy, prepared],
      sessionId
    );
    expect(store.mergeEvents).not.toHaveBeenCalled();
    expect(resident).toEqual([...before, partial, prepared]);
  });

  it("retains local failed delivery sidecars while keeping the prepared user last", async () => {
    const failure = createSyntheticUserEvent(
      sessionId,
      "Failed before acceptance",
      {
        turnIntentId: "failed-intent",
        deliveryStatus: "failed",
      }
    );
    const answer = message("codex-asst-30", "assistant", "Native answer");
    const lineage = retryLineageEvent(sessionId, {
      version: 1,
      queueMessageId: "failed-queue",
      superseded: [],
    });
    store.getEvents.mockResolvedValue([...before, failure, lineage, prepared]);
    await hydrateSynchronizedConversationProjection(
      sessionId,
      before,
      [...before, answer],
      prepared
    );
    expect(store.set).toHaveBeenCalledWith(
      [...before, answer, failure, lineage, prepared],
      sessionId
    );
  });

  it("preserves distinct equal native replies and the prepared row when native ids change", async () => {
    const native = [
      message("new-user", "user", "Write a story"),
      message("a1", "assistant", "Repeated"),
      message("a2", "assistant", "Repeated"),
    ];
    store.getEvents.mockResolvedValue([...before, prepared]);
    await hydrateSynchronizedConversationProjection(
      sessionId,
      before,
      native,
      prepared
    );
    expect(store.set).toHaveBeenCalledWith([...native, prepared], sessionId);
  });

  it("does no read or write when synchronization did not change the native prefix", async () => {
    await hydrateSynchronizedConversationProjection(
      sessionId,
      before,
      [...before],
      prepared
    );
    expect(store.getEvents).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
    expect(store.mergeEvents).not.toHaveBeenCalled();
  });
});
