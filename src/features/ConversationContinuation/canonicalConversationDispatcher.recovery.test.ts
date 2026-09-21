import { createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";

import { loadSettledTail } from "@src/engines/SessionCore/conversations/localConversationSettledTail";
import type { QueuedConversationExecutionMessage } from "@src/engines/SessionCore/conversations/queuedConversationContract";
import {
  QueuedConversationRecoveryPendingError,
  QueuedConversationTurnFailedError,
} from "@src/engines/SessionCore/conversations/queuedConversationContract";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import terminalErrorFixture from "../../../src-tauri/crates/orgtrack-core/src/sources/fixtures/codex_terminal_error.json";
import { dispatchQueuedCanonicalConversation } from "./canonicalConversationDispatcher";

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  getRetryLineage: vi.fn(async () => null),
  append: vi.fn(async () => undefined),
  loadNative: vi.fn(async () => ({ events: [] })),
  loadTimeline: vi.fn(),
  continueLocal: vi.fn(),
  recoverLocal: vi.fn(),
  dispatchCloud: vi.fn(),
  authorityLive: vi.fn(() => true),
  reconcile: vi.fn(),
  cliStatus: vi.fn(
    async (): Promise<{ errorMessage?: string | null } | null> => null
  ),
}));

vi.mock("@src/engines/SessionCore/sync/nativeTranscriptReconcile", () => ({
  reconcileNativeTranscript: mocks.reconcile,
  recoverNativeTranscriptAfterMismatch: mocks.reconcile,
}));

vi.mock("@src/api/tauri/rpc", () => ({
  rpc: {
    cli: { status: mocks.cliStatus },
    sessionCore: { cache: { getEvent: mocks.getRetryLineage } },
  },
}));
vi.mock("@src/engines/SessionCore/core/store/EventStoreProxy", () => ({
  eventStoreProxy: { append: mocks.append },
}));
vi.mock("@src/engines/SessionCore/sync/authoritativeSessionEvents", () => ({
  loadAuthoritativeSessionEvents: mocks.loadNative,
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
    localConversationRootForSession: (sessionId: string) => ({
      authority: "local-session",
      authorityScope: [],
      conversationId: sessionId,
    }),
    recoverLocalConversationTurn: mocks.recoverLocal,
  })
);
vi.mock(
  "@src/features/Org2Cloud/SessionConversation/cloudConversationQueueAdapter",
  () => ({
    dispatchQueuedCloudConversation: mocks.dispatchCloud,
  })
);
vi.mock("@src/features/Org2Cloud/org2CloudRemoteSessionsAtom", async () => {
  const { atom } = await import("jotai");
  return { org2CloudRemoteSessionsAtom: atom({}) };
});
vi.mock(
  "@src/features/Org2Cloud/SessionConversation/cloudConversationAuthority",
  () => ({ cloudConversationAuthorityIsLive: mocks.authorityLive })
);
vi.mock("@src/store/session", async () => {
  const { atom } = await import("jotai");
  return {
    sessionsAtom: atom([
      { session_id: "source-session", name: "Source" },
      { session_id: "sdeagent-expired", name: "Expired share" },
      {
        session_id: "runner-rejected",
        name: "Runner",
        error_message:
          '{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The requested model is not available"}}',
      },
    ]),
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
      expect(params.queueMessageId).toBe(message().id);
    });

    await dispatchQueuedCanonicalConversation(createStore(), message(), {
      onAccepted: vi.fn(),
    });

    expect(mocks.loadTimeline).toHaveBeenCalledWith(
      message().conversationDispatch?.root
    );
  });

  it("forwards the queued Plan selection into native continuation", async () => {
    mocks.continueLocal.mockResolvedValueOnce(undefined);
    await dispatchQueuedCanonicalConversation(
      createStore(),
      {
        ...message(),
        agentExecMode: "plan",
      },
      { onAccepted: vi.fn() }
    );
    expect(mocks.continueLocal).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: "plan" })
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

  it("runs a Cloud-rooted turn locally once the owner's Cloud root row is gone", async () => {
    mocks.dispatchCloud.mockReset();
    mocks.continueLocal.mockReset();
    mocks.loadTimeline.mockResolvedValue({
      sourceSession: undefined,
      sessions: [],
      timeline: [],
    });
    mocks.continueLocal.mockResolvedValue(undefined);
    mocks.authorityLive.mockReturnValue(false);
    const store = createStore();
    const cloudMessage: QueuedConversationExecutionMessage = {
      ...message(),
      sessionId: "sdeagent-expired",
      conversationDispatch: {
        kind: "canonical_conversation",
        root: {
          authority: "org2-cloud",
          authorityScope: ["https://cloud.example", "org-1"],
          conversationId: "sdeagent-expired",
        },
        target: {
          cliAgentType: "codex",
          accountId: "openai-1",
          model: "gpt-5.6-sol",
        },
        dispatchIdentityKey: "https://cloud.example|user-1",
      },
    };

    await dispatchQueuedCanonicalConversation(store, cloudMessage, {
      onAccepted: vi.fn(),
    });

    expect(mocks.authorityLive).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({ session_id: "sdeagent-expired" }),
        target: { orgId: "org-1", sessionId: "sdeagent-expired" },
      })
    );
    expect(mocks.dispatchCloud).not.toHaveBeenCalled();
    expect(mocks.continueLocal).toHaveBeenCalledWith(
      expect.objectContaining({
        root: {
          authority: "local-session",
          authorityScope: [],
          conversationId: "sdeagent-expired",
        },
      })
    );
  });

  it("keeps the Cloud authority while the owner's root row is still listed", async () => {
    mocks.dispatchCloud.mockReset();
    mocks.dispatchCloud.mockResolvedValue(undefined);
    mocks.authorityLive.mockReturnValue(true);
    const store = createStore();
    const cloudMessage: QueuedConversationExecutionMessage = {
      ...message(),
      sessionId: "sdeagent-expired",
      conversationDispatch: {
        kind: "canonical_conversation",
        root: {
          authority: "org2-cloud",
          authorityScope: ["https://cloud.example", "org-1"],
          conversationId: "sdeagent-expired",
        },
        target: {
          cliAgentType: "codex",
          accountId: "openai-1",
          model: "gpt-5.6-sol",
        },
        dispatchIdentityKey: "https://cloud.example|user-1",
      },
    };

    await dispatchQueuedCanonicalConversation(store, cloudMessage, {
      onAccepted: vi.fn(),
    });

    expect(mocks.dispatchCloud).toHaveBeenCalledTimes(1);
  });

  it("holds a definitively failed local turn with the provider's reason", async () => {
    mocks.continueLocal.mockReset();
    mocks.continueLocal.mockResolvedValue({
      sessionId: "runner-rejected",
      terminalStatus: "failed",
      agentTail: [],
    });

    await expect(
      dispatchQueuedCanonicalConversation(createStore(), message(), {
        onAccepted: vi.fn(),
      })
    ).rejects.toMatchObject({
      name: "QueuedConversationTurnFailedError",
      message: "The requested model is not available",
    });
  });

  it("reads the provider's reason from the runner row when the store has none", async () => {
    mocks.continueLocal.mockReset();
    mocks.continueLocal.mockResolvedValue({
      sessionId: "runner-cold",
      terminalStatus: "failed",
      agentTail: [],
    });
    mocks.cliStatus.mockResolvedValueOnce({
      errorMessage:
        '{"type":"error","status":400,"error":{"message":"The model is not supported"}}',
    });

    await expect(
      dispatchQueuedCanonicalConversation(createStore(), message(), {
        onAccepted: vi.fn(),
      })
    ).rejects.toMatchObject({ message: "The model is not supported" });
    expect(mocks.cliStatus).toHaveBeenCalledWith({ sessionId: "runner-cold" });
  });

  it("does not fail a turn that produced a tail before its terminal", async () => {
    mocks.continueLocal.mockReset();
    mocks.continueLocal.mockResolvedValue({
      sessionId: "runner-rejected",
      terminalStatus: "failed",
      agentTail: [{ id: "partial" } as never],
    });

    await expect(
      dispatchQueuedCanonicalConversation(createStore(), message(), {
        onAccepted: vi.fn(),
      })
    ).resolves.toBeUndefined();
    expect(QueuedConversationTurnFailedError).toBeDefined();
  });
  it("persists a proved empty failure before allowing a fresh retry, then reuses it after restart", async () => {
    mocks.append.mockClear();
    mocks.continueLocal.mockResolvedValue({
      sessionId: "runner-rejected",
      terminalStatus: "failed",
      agentTail: [],
    });
    const nativeUser = {
      id: "native-user",
      sessionId: "runner-rejected",
      source: "user",
      actionType: "raw",
      functionName: "user_message",
      result: { turnIntentId: "turn-1" },
      args: {},
    };
    mocks.loadNative.mockResolvedValueOnce({ events: [nativeUser] } as never);
    await expect(
      dispatchQueuedCanonicalConversation(createStore(), message(), {
        onAccepted: vi.fn(),
      })
    ).rejects.toBeInstanceOf(QueuedConversationTurnFailedError);
    const marker = (
      mocks.append.mock.calls.at(-1) as unknown as [
        Array<{
          result: { retryLineage: { failed: { turnIntentId: string } } };
        }>,
      ]
    )[0][0];
    expect(marker.result.retryLineage.failed.turnIntentId).toBe("turn-1");
    mocks.getRetryLineage.mockResolvedValueOnce(
      JSON.parse(JSON.stringify(marker))
    );
    mocks.continueLocal.mockImplementationOnce(async () => {
      const latest = (
        mocks.append.mock.calls.at(-1) as unknown as [
          Array<{
            result: {
              retryLineage: { superseded: Array<{ turnIntentId: string }> };
            };
          }>,
        ]
      )[0][0];
      expect(latest.result.retryLineage.superseded[0].turnIntentId).toBe(
        "turn-1"
      );
      return {
        sessionId: "runner-new",
        terminalStatus: "completed",
        agentTail: [{ id: "answer" }],
      };
    });
    await dispatchQueuedCanonicalConversation(
      createStore(),
      { ...message(), turnIntentId: "retry-2" },
      { onAccepted: vi.fn() }
    );
  });

  it.each(["failed", "cancelled", "completed"] as const)(
    "settles an accepted native %s execution receipt without sending the provider again",
    async (status) => {
      mocks.append.mockClear();
      mocks.continueLocal.mockClear();
      mocks.recoverLocal.mockClear();
      const prompt = {
        id: "native-user",
        chunk_id: "native-user",
        sessionId: "runner-rejected",
        source: "user",
        actionType: "raw",
        functionName: "user_message",
        result: { turnIntentId: "turn-1" },
        args: {},
        displayText: "continue",
        displayStatus: "completed",
        uiCanonical: "user_message",
        displayVariant: "message",
        activityStatus: "agent",
        createdAt: "2026-09-18T15:15:55Z",
      } as SessionEvent;
      const lifecycle = {
        ...prompt,
        id: "native-complete",
        chunk_id: "native-complete",
        source: "system",
        actionType: "task_completed",
        functionName: "task_completed",
        displayText: "",
        result: {},
        ...(status === "failed" ? terminalErrorFixture.failedLifecycle : {}),
      } as SessionEvent;
      const diagnostic = {
        ...prompt,
        ...terminalErrorFixture.diagnostic,
        source: "assistant",
        displayText: terminalErrorFixture.diagnostic.result.observation,
      } as SessionEvent;
      const events = [
        prompt,
        ...(status === "failed" ? [diagnostic] : []),
        lifecycle,
      ];
      mocks.reconcile.mockResolvedValueOnce(events);
      mocks.loadNative.mockResolvedValueOnce({ events } as never);
      mocks.recoverLocal.mockImplementationOnce(async () => ({
        sessionId: "runner-rejected",
        terminalStatus: status,
        ...(await loadSettledTail(
          "runner-rejected",
          [],
          "turn-1",
          { text: "continue", images: [] },
          status
        )),
      }));
      const dispatch = dispatchQueuedCanonicalConversation(
        createStore(),
        {
          ...message(),
          status: "accepted",
          runnerSessionId: "runner-rejected",
        },
        { onAccepted: vi.fn() }
      );
      if (status === "failed") {
        await expect(dispatch).rejects.toBeInstanceOf(
          QueuedConversationTurnFailedError
        );
        expect(mocks.append).toHaveBeenCalledWith(
          [
            expect.objectContaining({
              result: expect.objectContaining({
                retryLineage: expect.objectContaining({
                  failed: expect.objectContaining({ turnIntentId: "turn-1" }),
                }),
              }),
            }),
          ],
          "source-session"
        );
      } else {
        await expect(dispatch).resolves.toBeUndefined();
        expect(mocks.append).not.toHaveBeenCalled();
        // These branches never request a native empty-failure proof.
        mocks.loadNative.mockReset();
        mocks.loadNative.mockResolvedValue({ events: [] });
      }
      expect(mocks.recoverLocal).toHaveBeenCalledOnce();
      expect(mocks.continueLocal).not.toHaveBeenCalled();
    }
  );

  it("retains recovery ownership when raw reasoning was hidden by the portable tail", async () => {
    mocks.append.mockClear();
    mocks.continueLocal.mockResolvedValue({
      sessionId: "runner-rejected",
      terminalStatus: "failed",
      agentTail: [],
    });
    mocks.loadNative.mockResolvedValueOnce({
      events: [
        {
          id: "native-user",
          sessionId: "runner-rejected",
          source: "user",
          functionName: "user_message",
          actionType: "raw",
          args: {},
          result: { turnIntentId: "turn-1" },
        },
        {
          id: "reasoning",
          sessionId: "runner-rejected",
          source: "assistant",
          functionName: "thinking",
          actionType: "thinking",
          args: {},
          result: { thought: "partial" },
        },
      ],
    } as never);
    await expect(
      dispatchQueuedCanonicalConversation(createStore(), message(), {
        onAccepted: vi.fn(),
      })
    ).rejects.toBeInstanceOf(QueuedConversationRecoveryPendingError);
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it("does not retire the delivery owner when durable lineage persistence fails", async () => {
    mocks.continueLocal.mockResolvedValue({
      sessionId: "runner-rejected",
      terminalStatus: "failed",
      agentTail: [],
    });
    mocks.append.mockRejectedValueOnce(new Error("SQLite unavailable"));
    await expect(
      dispatchQueuedCanonicalConversation(createStore(), message(), {
        onAccepted: vi.fn(),
      })
    ).rejects.toBeInstanceOf(QueuedConversationRecoveryPendingError);
  });
});
