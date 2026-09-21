import { beforeEach, describe, expect, it, vi } from "vitest";

import { projectNativeConversationItems } from "@src/engines/SessionCore/conversations/nativeConversationMaterializer";
import { QueuedConversationRecoveryPendingError } from "@src/engines/SessionCore/conversations/queuedConversationContract";
import { retryLineageEvent } from "@src/engines/SessionCore/conversations/queuedRetryLineage";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import {
  persistCloudEmptyFailure,
  prepareCloudConversationRetry,
} from "./cloudConversationRetry";

const mocks = vi.hoisted(() => ({
  getEvent: vi.fn(),
  append: vi.fn(),
  native: vi.fn(),
}));
vi.mock("@src/api/tauri/rpc", () => ({
  rpc: { sessionCore: { cache: { getEvent: mocks.getEvent } } },
}));
vi.mock("@src/engines/SessionCore/core/store/EventStoreProxy", () => ({
  eventStoreProxy: { append: mocks.append },
}));
vi.mock("@src/engines/SessionCore/sync/authoritativeSessionEvents", () => ({
  loadAuthoritativeSessionEvents: mocks.native,
}));

const message = {
  id: "queue-one",
  sessionId: "root",
  turnIntentId: "failed",
  content: "hello",
  displayContent: "hello",
  status: "accepted" as const,
};
const user = (turnIntentId: string): SessionEvent => ({
  id: turnIntentId,
  chunk_id: turnIntentId,
  sessionId: "root",
  createdAt: "2026-09-18T00:00:00Z",
  source: "user",
  functionName: "user_message",
  actionType: "raw",
  uiCanonical: "user",
  args: {},
  result: { turnIntentId },
  displayText: "hello",
  displayVariant: "message",
  displayStatus: "completed",
  activityStatus: "agent",
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getEvent.mockResolvedValue(null);
  mocks.append.mockResolvedValue(undefined);
  mocks.native.mockResolvedValue({ events: [user("failed")] });
});

describe("Cloud sender-local empty-failure proof", () => {
  it.each(["read", "save"])(
    "retains a preparing runner's intent if lineage %s fails before its acceptance receipt",
    async (boundary) => {
      if (boundary === "save") {
        const original = await prepareCloudConversationRetry(message);
        await persistCloudEmptyFailure(original, "runner");
        mocks.getEvent.mockResolvedValue(mocks.append.mock.calls[0][0][0]);
        mocks.append.mockRejectedValueOnce(new Error("save failed"));
      } else {
        mocks.getEvent.mockRejectedValueOnce(new Error("read failed"));
      }
      await expect(
        prepareCloudConversationRetry({
          ...message,
          status: "preparing",
          runnerSessionId: "runner",
          turnIntentId: "explicit-retry",
        })
      ).rejects.toBeInstanceOf(QueuedConversationRecoveryPendingError);
    }
  );

  it("durably records failure, preserves audit history and supersedes only the explicit same-message retry", async () => {
    const retry = await prepareCloudConversationRetry(message);
    expect(await persistCloudEmptyFailure(retry, "runner")).toBe(true);
    const marker = mocks.append.mock.calls[0][0][0];
    mocks.getEvent.mockResolvedValue(JSON.parse(JSON.stringify(marker)));
    const resumed = await prepareCloudConversationRetry({
      ...message,
      turnIntentId: "retry",
    });
    expect(resumed.lineage.superseded).toHaveLength(1);
    const nativeAudit = [user("failed"), user("independent"), user("retry")];
    const effective = projectNativeConversationItems([
      ...nativeAudit,
      retryLineageEvent(message.sessionId, resumed.lineage),
    ]);
    expect(effective).toHaveLength(2);
    expect(nativeAudit).toHaveLength(3);
    expect(mocks.append).toHaveBeenCalledTimes(2);
    // Re-entering the same accepted intent after reload does not supersede
    // anything further or write again. No provider request is issued here.
    mocks.getEvent.mockResolvedValue(mocks.append.mock.calls[1][0][0]);
    await prepareCloudConversationRetry({ ...message, turnIntentId: "retry" });
    expect(mocks.append).toHaveBeenCalledTimes(2);
  });

  it.each(["assistant", "tool", "thinking"])(
    "rejects raw %s output even when the portable tail was empty",
    async (source) => {
      mocks.native.mockResolvedValue({
        events: [
          user("failed"),
          {
            ...user("output"),
            source,
            functionName: source,
            actionType: source,
          },
        ],
      });
      expect(
        await persistCloudEmptyFailure(
          await prepareCloudConversationRetry(message),
          "runner"
        )
      ).toBe(false);
      expect(mocks.append).not.toHaveBeenCalled();
    }
  );

  it("rejects a missing native prompt and a later concurrent user turn", async () => {
    mocks.native.mockResolvedValueOnce({ events: [] });
    const retry = await prepareCloudConversationRetry(message);
    expect(await persistCloudEmptyFailure(retry, "runner")).toBe(false);
    mocks.native.mockResolvedValueOnce({
      events: [user("failed"), user("concurrent")],
    });
    expect(await persistCloudEmptyFailure(retry, "runner")).toBe(false);
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it("does not release ownership before the durable proof write completes", async () => {
    let finish: (() => void) | undefined;
    mocks.append.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const retry = await prepareCloudConversationRetry(message);
    let completed = false;
    const writing = persistCloudEmptyFailure(retry, "runner").then((result) => {
      completed = true;
      return result;
    });
    await vi.waitFor(() => expect(finish).toBeDefined());
    expect(completed).toBe(false);
    expect(retry.lineage.failed).toBeUndefined();
    finish!();
    expect(await writing).toBe(true);
  });

  it.each(["read", "save"])(
    "keeps accepted recovery ownership when native %s fails",
    async (boundary) => {
      if (boundary === "read")
        mocks.native.mockRejectedValueOnce(new Error("read failed"));
      else mocks.append.mockRejectedValueOnce(new Error("save failed"));
      const retry = await prepareCloudConversationRetry(message);
      await expect(
        persistCloudEmptyFailure(retry, "runner")
      ).rejects.toBeInstanceOf(QueuedConversationRecoveryPendingError);
      expect(retry.lineage.failed).toBeUndefined();
    }
  );
});
