import { beforeEach, describe, expect, it, vi } from "vitest";

import { projectNativeConversationItems } from "@src/engines/SessionCore/conversations/nativeConversationMaterializer";
import {
  QueuedConversationRecoveryPendingError,
  QueuedConversationTurnClosedError,
  QueuedConversationTurnFailedError,
} from "@src/engines/SessionCore/conversations/queuedConversationContract";
import {
  beginQueuedRetry,
  recordEmptyFailedAttempt,
} from "@src/engines/SessionCore/conversations/queuedRetryLineage";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { Org2CloudConversationError } from "@src/features/Org2Cloud/org2CloudConversationEventsClient";

import {
  buildPushedUserEvent,
  runConversationTurn,
} from "./conversationTurnRunner";

const mocks = vi.hoisted(() => ({
  continueLocalConversation: vi.fn(),
  recoverLocalConversationTurn: vi.fn(),
  persistCloudEmptyFailure: vi.fn(),
}));

vi.mock("./cloudConversationRetry", () => ({
  persistCloudEmptyFailure: mocks.persistCloudEmptyFailure,
}));

vi.mock(
  "@src/engines/SessionCore/conversations/localConversationContinuation",
  async (importOriginal) => ({
    ...(await importOriginal()),
    continueLocalConversation: mocks.continueLocalConversation,
    recoverLocalConversationTurn: mocks.recoverLocalConversationTurn,
  })
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.persistCloudEmptyFailure.mockResolvedValue(true);
  mocks.continueLocalConversation.mockImplementation(async (params) => {
    params.onSessionReady?.("cliagent-owner", 3);
    return {
      sessionId: "cliagent-owner",
      terminalStatus: "completed",
      agentTail: [],
    };
  });
});

describe("buildPushedUserEvent", () => {
  it("keeps visible text separate from the exact agent-facing native content", () => {
    const event = buildPushedUserEvent(
      "Use my review skill",
      "<skill>review instructions</skill>\nUse my review skill",
      ["data:image/png;base64,AAAA"],
      "2026-08-26T00:00:00.000Z",
      "turn-1"
    );

    expect(event.displayText).toBe("Use my review skill");
    expect(projectNativeConversationItems([event])).toEqual([
      expect.objectContaining({
        kind: "message",
        role: "user",
        text: "<skill>review instructions</skill>\nUse my review skill",
        images: ["data:image/png;base64,AAAA"],
      }),
    ]);
  });
});

describe("runConversationTurn", () => {
  const retryParams = () => ({
    root: {
      authority: "org2-cloud" as const,
      authorityScope: ["https://cloud.example", "org-1"],
      conversationId: "shared-root",
    },
    conversationTitle: "Shared conversation",
    displayText: "continue",
    timeline: [],
    target: {
      cliAgentType: "codex" as const,
      accountId: "acct",
      model: "model",
    },
    turnIntentId: "failed-intent",
    retry: {
      message: {
        id: "queue-1",
        sessionId: "shared-root",
        turnIntentId: "failed-intent",
        content: "continue",
        displayContent: "continue",
        status: "accepted" as const,
      },
      lineage: {
        version: 1 as const,
        queueMessageId: "queue-1",
        superseded: [],
      },
    },
    publishTail: vi.fn().mockResolvedValue(undefined),
  });

  it("publishes a proved empty failure but returns the original message to explicit Retry", async () => {
    mocks.continueLocalConversation.mockResolvedValueOnce({
      sessionId: "runner",
      terminalStatus: "failed",
      agentTail: [],
    });
    const params = retryParams();
    await expect(runConversationTurn(params)).rejects.toBeInstanceOf(
      QueuedConversationTurnFailedError
    );
    expect(mocks.persistCloudEmptyFailure).toHaveBeenCalledWith(
      params.retry,
      "runner"
    );
    expect(
      mocks.persistCloudEmptyFailure.mock.invocationCallOrder[0]
    ).toBeLessThan(params.publishTail.mock.invocationCallOrder[0]!);
    expect(params.publishTail).toHaveBeenCalledOnce();
  });

  it("recovers an ambiguous failure publication without sending the provider again", async () => {
    const result = {
      sessionId: "runner",
      terminalStatus: "failed",
      agentTail: [],
    };
    mocks.continueLocalConversation.mockResolvedValueOnce(result);
    mocks.recoverLocalConversationTurn.mockResolvedValueOnce(result);
    const params = retryParams();
    params.publishTail.mockRejectedValueOnce(
      new QueuedConversationRecoveryPendingError()
    );
    await expect(runConversationTurn(params)).rejects.toBeInstanceOf(
      QueuedConversationRecoveryPendingError
    );
    await expect(
      runConversationTurn({
        ...params,
        recovery: { runnerSessionId: "runner", providerAccepted: true },
      })
    ).rejects.toBeInstanceOf(QueuedConversationTurnFailedError);
    expect(mocks.continueLocalConversation).toHaveBeenCalledOnce();
    expect(mocks.recoverLocalConversationTurn).toHaveBeenCalledOnce();
    expect(params.publishTail.mock.calls.map(([id]) => id)).toEqual([
      "failed-intent",
      "failed-intent",
    ]);
  });

  it("explicit retry succeeds with prior context once and does not repeat the failed prompt", async () => {
    const params = retryParams();
    const failedPrompt = {
      ...buildPushedUserEvent(
        "continue",
        undefined,
        undefined,
        "2026-09-18T00:00:00Z",
        params.turnIntentId
      ),
      sessionId: "shared-root",
    };
    const earlierPrompt = {
      ...buildPushedUserEvent(
        "remember amber-river-572",
        undefined,
        undefined,
        "2026-09-17T00:00:00Z",
        "earlier-intent"
      ),
      sessionId: "shared-root",
    };
    mocks.continueLocalConversation.mockResolvedValueOnce({
      sessionId: "shared-root",
      terminalStatus: "failed",
      agentTail: [],
    });
    await expect(runConversationTurn(params)).rejects.toBeInstanceOf(
      QueuedConversationTurnFailedError
    );
    const failedLineage = recordEmptyFailedAttempt(
      params.retry.lineage,
      params.retry.message,
      [earlierPrompt, failedPrompt]
    );
    const retriedMessage = {
      ...params.retry.message,
      turnIntentId: "explicit-retry",
    };
    const retriedLineage = beginQueuedRetry(failedLineage, retriedMessage);
    mocks.continueLocalConversation.mockImplementationOnce(
      async (continuation) => {
        expect(projectNativeConversationItems(continuation.timeline)).toEqual([
          expect.objectContaining({
            role: "user",
            text: "remember amber-river-572",
          }),
        ]);
        expect(continuation.displayText).toBe("continue");
        expect(continuation.turnIntentId).toBe("explicit-retry");
        return {
          sessionId: "shared-root",
          terminalStatus: "completed",
          agentTail: [],
        };
      }
    );
    await expect(
      runConversationTurn({
        ...params,
        timeline: [earlierPrompt, failedPrompt],
        turnIntentId: "explicit-retry",
        retry: { message: retriedMessage, lineage: retriedLineage },
      })
    ).resolves.toMatchObject({ terminalStatus: "completed" });
    expect(mocks.continueLocalConversation).toHaveBeenCalledTimes(2);
    expect(mocks.persistCloudEmptyFailure).toHaveBeenCalledOnce();
  });

  it("retains accepted recovery ownership when failure proof cannot persist", async () => {
    mocks.continueLocalConversation.mockResolvedValueOnce({
      sessionId: "runner",
      terminalStatus: "failed",
      agentTail: [],
    });
    mocks.persistCloudEmptyFailure.mockRejectedValueOnce(
      new QueuedConversationRecoveryPendingError("disk failed")
    );
    const params = retryParams();
    await expect(runConversationTurn(params)).rejects.toBeInstanceOf(
      QueuedConversationRecoveryPendingError
    );
    expect(params.publishTail).not.toHaveBeenCalled();
  });

  it.each(["failed", "cancelled"] as const)(
    "keeps partial output for %s without acquiring empty retry ownership",
    async (terminalStatus) => {
      const partial = {
        ...buildPushedUserEvent(
          "partial",
          undefined,
          undefined,
          "2026-09-18T00:00:00Z",
          "failed-intent"
        ),
        source: "assistant" as const,
        functionName: "assistant",
        actionType: "assistant",
      } as SessionEvent;
      mocks.continueLocalConversation.mockResolvedValueOnce({
        sessionId: "runner",
        terminalStatus,
        agentTail: [partial],
      });
      const params = retryParams();
      await expect(runConversationTurn(params)).resolves.toMatchObject({
        terminalStatus,
      });
      expect(mocks.persistCloudEmptyFailure).not.toHaveBeenCalled();
      expect(params.publishTail).toHaveBeenCalledOnce();
    }
  );

  it("does not label cancellation or an unproved empty native suffix as retryable", async () => {
    mocks.continueLocalConversation.mockResolvedValueOnce({
      sessionId: "runner",
      terminalStatus: "cancelled",
      agentTail: [],
    });
    await expect(runConversationTurn(retryParams())).resolves.toMatchObject({
      terminalStatus: "cancelled",
    });
    expect(mocks.persistCloudEmptyFailure).not.toHaveBeenCalled();
    mocks.continueLocalConversation.mockResolvedValueOnce({
      sessionId: "runner",
      terminalStatus: "failed",
      agentTail: [],
    });
    mocks.persistCloudEmptyFailure.mockResolvedValueOnce(false);
    await expect(runConversationTurn(retryParams())).resolves.toMatchObject({
      terminalStatus: "failed",
    });
  });

  it("binds a fresh hidden runner during preparation, then exposes its exact native prefix", async () => {
    const onRunnerReady = vi.fn();
    const publishTail = vi.fn();
    mocks.continueLocalConversation.mockImplementationOnce(async (params) => {
      await params.onSessionPreparing?.("cliagent-fresh");
      await params.onSessionReady?.("cliagent-fresh", 7);
      return {
        sessionId: "cliagent-fresh",
        terminalStatus: "completed",
        agentTail: [],
      };
    });

    const result = await runConversationTurn({
      root: {
        authority: "org2-cloud",
        authorityScope: ["https://cloud.example", "org-1"],
        conversationId: "shared-root",
      },
      conversationTitle: "Shared conversation",
      displayText: "continue",
      timeline: [],
      target: {
        cliAgentType: "codex",
        accountId: "acct-codex",
        model: "gpt-5.6-sol",
      },
      turnIntentId: "turn-fresh",
      queueMessageId: "queue-fresh",
      onRunnerReady,
      publishTail,
    });

    expect(mocks.continueLocalConversation).toHaveBeenCalledWith(
      expect.objectContaining({ queueMessageId: "queue-fresh" })
    );
    expect(onRunnerReady.mock.calls).toEqual([
      ["cliagent-fresh", "turn-fresh", Number.MAX_SAFE_INTEGER],
      ["cliagent-fresh", "turn-fresh", 7],
    ]);
    expect(result).toEqual(
      expect.objectContaining({
        terminalStatus: "completed",
      })
    );
  });

  it("reuses an owner's local native root while publishing to the shared plane", async () => {
    const executionRoot = {
      authority: "local-session",
      authorityScope: [],
      conversationId: "cliagent-owner",
    } as const;

    await runConversationTurn({
      root: executionRoot,
      conversationTitle: "Shared conversation",
      displayText: "continue",
      timeline: [],
      target: {
        cliAgentType: "codex",
        accountId: "acct-codex",
        model: "gpt-5.6-sol",
      },
      turnIntentId: "turn-owner",
      publishTail: vi.fn(),
    });

    expect(mocks.continueLocalConversation).toHaveBeenCalledWith(
      expect.objectContaining({ root: executionRoot })
    );
  });

  it("scopes provider-positional tail ids to the durable turn before publishing", async () => {
    // A native rollout restarts positional ids, so `codex-asst-182` from this
    // turn must never be shadowed by an earlier turn's `codex-asst-182` that
    // already lives on the Cloud plane.
    const publishTail = vi.fn().mockResolvedValue(undefined);
    const positional = {
      id: "codex-asst-182",
      chunk_id: "codex-asst-182",
      sessionId: "cliagent-reused",
      createdAt: "2026-09-07T00:00:00.000Z",
      functionName: "assistant",
      uiCanonical: "agent_message",
      actionType: "assistant",
      args: {},
      result: { content: "I'll inspect the requested files first." },
      source: "assistant",
      displayText: "I'll inspect the requested files first.",
      displayStatus: "completed",
      displayVariant: "message",
      activityStatus: "agent",
      payloadRefs: [],
    } as unknown as SessionEvent;
    mocks.continueLocalConversation.mockResolvedValueOnce({
      sessionId: "cliagent-reused",
      terminalStatus: "completed",
      agentTail: [positional],
    });

    await runConversationTurn({
      root: {
        authority: "org2-cloud",
        authorityScope: ["https://cloud.example", "org-1"],
        conversationId: "shared-root",
      },
      conversationTitle: "Shared conversation",
      displayText: "continue",
      timeline: [],
      target: {
        cliAgentType: "codex",
        accountId: "acct-codex",
        model: "gpt-5.6-sol",
      },
      turnIntentId: "turn-scoped",
      publishTail,
    });

    const [, published] = publishTail.mock.calls[0] ?? [];
    expect(published).toEqual([
      expect.objectContaining({
        id: "convturn-turn-scoped-codex-asst-182",
        chunk_id: "convturn-turn-scoped-codex-asst-182",
        displayText: "I'll inspect the requested files first.",
      }),
    ]);
    expect(projectNativeConversationItems(published)).toEqual([
      expect.objectContaining({ kind: "message", role: "assistant" }),
    ]);
  });

  it("publishes a non-portable transcript error when execution fails after the user row", async () => {
    const failure = new Error("native materialization failed");
    const publishTail = vi.fn().mockResolvedValue(undefined);
    mocks.continueLocalConversation.mockImplementationOnce(async () => {
      throw failure;
    });

    await expect(
      runConversationTurn({
        root: {
          authority: "org2-cloud",
          authorityScope: ["https://cloud.example", "org-1"],
          conversationId: "shared-root",
        },
        conversationTitle: "Shared conversation",
        displayText: "continue",
        timeline: [],
        target: {
          cliAgentType: "codex",
          accountId: "acct-codex",
          model: "gpt-5.6-sol",
        },
        turnIntentId: "turn-failed",
        publishTail,
      })
    ).rejects.toBeInstanceOf(QueuedConversationTurnClosedError);

    expect(publishTail).toHaveBeenCalledOnce();
    const [failureTurnId, failureEvents] = publishTail.mock.calls[0] ?? [];
    expect(failureTurnId).toBe("turn-failed");
    expect(failureEvents).toEqual([
      expect.objectContaining({
        id: "convturn-error-turn-failed",
        source: "system",
        actionType: "error",
        displayVariant: "error",
        displayStatus: "failed",
        result: expect.objectContaining({
          error: "native materialization failed",
          turnIntentId: "turn-failed",
        }),
      }),
    ]);
    expect(projectNativeConversationItems(failureEvents)).toEqual([]);
  });

  it("retains recovery ownership when a pre-accept failure cannot publish", async () => {
    mocks.continueLocalConversation.mockRejectedValueOnce(
      new Error("native materialization failed")
    );

    await expect(
      runConversationTurn({
        root: {
          authority: "org2-cloud",
          authorityScope: ["https://cloud.example", "org-1"],
          conversationId: "shared-root",
        },
        conversationTitle: "Shared conversation",
        displayText: "continue",
        timeline: [],
        target: {
          cliAgentType: "codex",
          accountId: "acct-codex",
          model: "gpt-5.6-sol",
        },
        turnIntentId: "turn-publish-retry",
        publishTail: vi
          .fn()
          .mockRejectedValue(
            new Org2CloudConversationError("temporary upstream failure", 503)
          ),
      })
    ).rejects.toBeInstanceOf(QueuedConversationRecoveryPendingError);
  });

  it("closes a failed turn after one definitive 4xx terminal-publication rejection", async () => {
    mocks.continueLocalConversation.mockRejectedValueOnce(
      new Error("native materialization failed")
    );
    const publishTail = vi
      .fn()
      .mockRejectedValue(new Org2CloudConversationError("ORG2_FORBIDDEN", 403));

    await expect(
      runConversationTurn({
        root: {
          authority: "org2-cloud",
          authorityScope: ["https://cloud.example", "org-1"],
          conversationId: "shared-root",
        },
        conversationTitle: "Shared conversation",
        displayText: "continue",
        timeline: [],
        target: {
          cliAgentType: "codex",
          accountId: "acct-codex",
          model: "gpt-5.6-sol",
        },
        turnIntentId: "turn-terminal-4xx",
        publishTail,
      })
    ).rejects.toBeInstanceOf(QueuedConversationTurnClosedError);

    expect(publishTail).toHaveBeenCalledOnce();
    expect(mocks.continueLocalConversation).toHaveBeenCalledOnce();
  });

  it("keeps a transient local continuation failure retryable without publishing a terminal", async () => {
    const publishTail = vi.fn();
    const pending = new QueuedConversationRecoveryPendingError(
      "native transcript is still settling"
    );
    mocks.continueLocalConversation.mockRejectedValueOnce(pending);

    await expect(
      runConversationTurn({
        root: {
          authority: "org2-cloud",
          authorityScope: ["https://cloud.example", "org-1"],
          conversationId: "shared-root",
        },
        conversationTitle: "Shared conversation",
        displayText: "continue",
        timeline: [],
        target: {
          cliAgentType: "codex",
          accountId: "acct-codex",
          model: "gpt-5.6-sol",
        },
        turnIntentId: "turn-transient",
        publishTail,
      })
    ).rejects.toBe(pending);

    expect(publishTail).not.toHaveBeenCalled();
  });
});
