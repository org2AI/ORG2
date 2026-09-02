import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_QUEUED_MESSAGE_CHARS,
  messageQueueAtom,
} from "@src/store/ui/messageQueueAtom";

import {
  CanonicalConversationQueueAdmissionError,
  enqueueCanonicalConversation,
} from "./enqueueCanonicalConversation";

const mocks = vi.hoisted(() => ({
  appendProjection: vi.fn(),
  flushQueue: vi.fn(),
  removeProjection: vi.fn(),
}));

vi.mock("@src/engines/SessionCore/services/userIntentDispatch", () => ({
  appendOptimisticQueueUserDelivery: mocks.appendProjection,
  removeOptimisticQueueUserDelivery: mocks.removeProjection,
}));
vi.mock(
  "@src/engines/SessionCore/hooks/session/messageQueuePersistence",
  () => ({ flushMessageQueuePersistence: mocks.flushQueue })
);

describe("enqueueCanonicalConversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendProjection.mockResolvedValue(undefined);
    mocks.flushQueue.mockResolvedValue(undefined);
    mocks.removeProjection.mockResolvedValue(undefined);
  });

  it("durably stages the queue owner before publishing and releasing its pending row", async () => {
    const store = createStore();
    mocks.flushQueue.mockImplementationOnce(async () => {
      expect(store.get(messageQueueAtom)).toMatchObject([
        {
          priority: "next",
          requiresExplicitDispatch: true,
          status: "queued",
        },
      ]);
      expect(mocks.appendProjection).not.toHaveBeenCalled();
    });
    await expect(
      enqueueCanonicalConversation({
        store,
        root: {
          authority: "local-session",
          authorityScope: [],
          conversationId: "source-session",
        },
        sessionId: "source-session",
        input: {
          displayText: "@teammate inspect this",
          agentContent: "inspect this",
          imageDataUrls: ["data:image/png;base64,a"],
        },
        target: {
          cliAgentType: "codex",
          accountId: "openai-1",
          model: "gpt-5.6-sol",
        },
      })
    ).resolves.toBe(true);

    const queued = store.get(messageQueueAtom);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      sessionId: "source-session",
      displayContent: "@teammate inspect this",
      content: "inspect this",
      imageDataUrls: ["data:image/png;base64,a"],
      status: "queued",
    });
    expect(queued[0]?.requiresExplicitDispatch).toBeUndefined();
    expect(mocks.flushQueue).toHaveBeenCalledOnce();
    expect(mocks.appendProjection).toHaveBeenCalledWith({
      sessionId: "source-session",
      visibleText: "@teammate inspect this",
      imageDataUrls: ["data:image/png;base64,a"],
      turnIntentId: queued[0]?.turnIntentId,
      queueMessageId: queued[0]?.id,
      createdAt: queued[0]?.createdAt,
    });
  });

  it("keeps the composer-side pre-submit failure semantics when durable staging fails", async () => {
    const store = createStore();
    mocks.flushQueue
      .mockRejectedValueOnce(new Error("delivery store unavailable"))
      .mockResolvedValueOnce(undefined);

    await expect(
      enqueueCanonicalConversation({
        store,
        root: {
          authority: "local-session",
          authorityScope: [],
          conversationId: "source-session",
        },
        sessionId: "source-session",
        input: { displayText: "keep this draft" },
        target: {
          cliAgentType: "codex",
          accountId: "openai-1",
          model: "gpt-5.6-sol",
        },
      })
    ).rejects.toThrow("delivery store unavailable");

    expect(store.get(messageQueueAtom)).toEqual([]);
    expect(mocks.appendProjection).not.toHaveBeenCalled();
    expect(mocks.removeProjection).not.toHaveBeenCalled();
    expect(mocks.flushQueue).toHaveBeenCalledTimes(2);
  });

  it("rolls back its durable staging owner when pending projection fails", async () => {
    const store = createStore();
    mocks.appendProjection.mockRejectedValueOnce(
      new Error("event store unavailable")
    );

    await expect(
      enqueueCanonicalConversation({
        store,
        root: {
          authority: "local-session",
          authorityScope: [],
          conversationId: "source-session",
        },
        sessionId: "source-session",
        input: { displayText: "keep this draft too" },
        target: {
          cliAgentType: "codex",
          accountId: "openai-1",
          model: "gpt-5.6-sol",
        },
      })
    ).rejects.toThrow("event store unavailable");

    expect(store.get(messageQueueAtom)).toEqual([]);
    expect(mocks.flushQueue).toHaveBeenCalledTimes(2);
    expect(mocks.removeProjection).toHaveBeenCalledOnce();
  });

  it("retains the held recovery owner when EventStore cannot prove rollback", async () => {
    const store = createStore();
    mocks.appendProjection.mockRejectedValueOnce(new Error("append uncertain"));
    mocks.removeProjection.mockRejectedValueOnce(new Error("store offline"));

    await expect(
      enqueueCanonicalConversation({
        store,
        root: {
          authority: "local-session",
          authorityScope: [],
          conversationId: "source-session",
        },
        sessionId: "source-session",
        input: { displayText: "never orphan this" },
        target: {
          cliAgentType: "codex",
          accountId: "openai-1",
          model: "gpt-5.6-sol",
        },
      })
    ).rejects.toThrow("append uncertain");

    expect(store.get(messageQueueAtom)).toMatchObject([
      { requiresExplicitDispatch: true, priority: "next" },
    ]);
    expect(mocks.flushQueue).toHaveBeenCalledOnce();
  });

  it("does not create a transcript row when queue admission rejects the payload", async () => {
    const store = createStore();
    await expect(
      enqueueCanonicalConversation({
        store,
        root: {
          authority: "local-session",
          authorityScope: [],
          conversationId: "source-session",
        },
        sessionId: "source-session",
        input: { displayText: "x".repeat(MAX_QUEUED_MESSAGE_CHARS + 1) },
        target: {
          cliAgentType: "codex",
          accountId: "openai-1",
          model: "gpt-5.6-sol",
        },
      })
    ).rejects.toBeInstanceOf(CanonicalConversationQueueAdmissionError);
    expect(mocks.appendProjection).not.toHaveBeenCalled();
    expect(store.get(messageQueueAtom)).toEqual([]);
  });
});
