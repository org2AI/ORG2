import { createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";

import type { QueuedConversationExecutionMessage } from "@src/engines/SessionCore/conversations/queuedConversationContract";
import { QueuedConversationRecoveryPendingError } from "@src/engines/SessionCore/conversations/queuedConversationContract";

import { dispatchQueuedCanonicalConversation } from "./canonicalConversationDispatcher";

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  loadTimeline: vi.fn(),
  continueLocal: vi.fn(),
  recoverLocal: vi.fn(),
}));

vi.mock("@src/api/tauri/externalHistory", () => ({
  getImportedHistorySourceBySessionId: vi.fn(() => undefined),
}));
vi.mock(
  "@src/engines/SessionCore/conversations/localConversationExecutionTail",
  () => ({ loadLocalCanonicalConversationTimeline: mocks.loadTimeline })
);
vi.mock(
  "@src/engines/SessionCore/conversations/localConversationContinuation",
  () => ({
    continueLocalConversationAfterTimelineLoad: mocks.continueLocal,
    recoverLocalConversationTurn: mocks.recoverLocal,
  })
);
vi.mock(
  "@src/features/Org2Cloud/SessionConversation/cloudConversationQueueAdapter",
  () => ({
    dispatchQueuedCloudConversation: vi.fn(),
  })
);
vi.mock("@src/store/session", async () => {
  const { atom } = await import("jotai");
  return {
    sessionsAtom: atom([{ session_id: "source-session", name: "Source" }]),
  };
});
vi.mock("./externalHistoryContinuation", () => ({
  resolveExternalHistoryContinuation: vi.fn(),
}));

function message(): QueuedConversationExecutionMessage {
  return {
    id: "queue-1",
    turnIntentId: "turn-1",
    sessionId: "source-session",
    content: "continue",
    displayContent: "continue",
    status: "preparing",
    conversationDispatch: {
      kind: "canonical_conversation",
      root: {
        authority: "local-session",
        authorityScope: [],
        conversationId: "source-session",
      },
      target: {
        cliAgentType: "codex",
        accountId: "openai-1",
        model: "gpt-5.6-sol",
      },
    },
  };
}

describe("queued local conversation runner recovery", () => {
  it("loads the verified root plus execution-child timeline at queue head", async () => {
    const canonicalTimeline = [{ id: "root" }, { id: "claude-tail" }];
    mocks.loadTimeline.mockResolvedValueOnce(canonicalTimeline);
    mocks.continueLocal.mockImplementationOnce(async (params) => {
      expect(await params.loadTimeline()).toBe(canonicalTimeline);
    });

    await dispatchQueuedCanonicalConversation(createStore(), message(), {
      onAccepted: vi.fn(),
    });

    expect(mocks.loadTimeline).toHaveBeenCalledWith(
      message().conversationDispatch?.root
    );
  });

  it("keeps recovery pending when a native child's durable runner receipt fails", async () => {
    mocks.order.length = 0;
    mocks.continueLocal.mockImplementation(async (params) => {
      await params.onSessionReady?.("cliagent-child", 7);
    });
    const receiptFailure = new Error("disk temporarily unavailable");
    const onRunnerReady = vi.fn(async () => {
      mocks.order.push("persist");
      throw receiptFailure;
    });

    await expect(
      dispatchQueuedCanonicalConversation(createStore(), message(), {
        onAccepted: vi.fn(),
        onRunnerReady,
      })
    ).rejects.toBeInstanceOf(QueuedConversationRecoveryPendingError);

    expect(mocks.order).toEqual(["persist"]);
    expect(onRunnerReady).toHaveBeenCalledWith("cliagent-child", 7);
  });
});
