import { beforeEach, describe, expect, it, vi } from "vitest";

import { projectNativeConversationItems } from "@src/engines/SessionCore/conversations/nativeConversationMaterializer";

import {
  buildPushedUserEvent,
  runConversationTurn,
} from "./conversationTurnRunner";

const mocks = vi.hoisted(() => ({
  continueLocalConversation: vi.fn(),
  pushConversationEvents: vi.fn(),
  pushConversationEventsChunked: vi.fn(),
  stageConversationTail: vi.fn(),
  drainConversationTailOutbox: vi.fn(),
}));

vi.mock(
  "@src/engines/SessionCore/conversations/localConversationContinuation",
  async (importOriginal) => ({
    ...(await importOriginal()),
    continueLocalConversation: mocks.continueLocalConversation,
  })
);

vi.mock("../org2CloudConversationEventsClient", async (importOriginal) => ({
  ...(await importOriginal()),
  boundConversationEventForPush: (event: unknown) => event,
  pushConversationEvents: mocks.pushConversationEvents,
  pushConversationEventsChunked: mocks.pushConversationEventsChunked,
}));

vi.mock("./conversationTailOutbox", () => ({
  stageConversationTail: mocks.stageConversationTail,
  drainConversationTailOutbox: mocks.drainConversationTailOutbox,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pushConversationEvents.mockResolvedValue({ firstSeq: 1, lastSeq: 1 });
  mocks.pushConversationEventsChunked.mockResolvedValue({
    firstSeq: 2,
    lastSeq: 2,
  });
  mocks.stageConversationTail.mockResolvedValue(["staged-tail"]);
  mocks.drainConversationTailOutbox.mockResolvedValue({
    pushedChunks: [{ id: "staged-tail", eventCount: 1 }],
    failedChunkIds: [],
    pendingChunkIds: [],
  });
  mocks.continueLocalConversation.mockImplementation(async (params) => {
    await params.beforeDispatch?.();
    params.onSessionReady?.("cliagent-owner", 3);
    return {
      sessionId: "cliagent-owner",
      created: false,
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
  it("binds a fresh hidden runner during preparation, then exposes its exact native prefix", async () => {
    const onRunnerReady = vi.fn();
    mocks.continueLocalConversation.mockImplementationOnce(async (params) => {
      await params.beforeDispatch?.();
      await params.onSessionPreparing?.("cliagent-fresh");
      await params.onSessionReady?.("cliagent-fresh", 7);
      return {
        sessionId: "cliagent-fresh",
        created: true,
        terminalStatus: "completed",
        agentTail: [],
      };
    });

    const result = await runConversationTurn({
      getAccessToken: async () => "token",
      authIdentityKey: "user-1",
      orgId: "org-1",
      rootSessionId: "shared-root",
      conversationTitle: "Shared conversation",
      displayText: "continue",
      timeline: [],
      target: {
        cliAgentType: "codex",
        accountId: "acct-codex",
        model: "gpt-5.6-sol",
      },
      turnIntentId: "turn-fresh",
      onRunnerReady,
    });

    expect(onRunnerReady.mock.calls).toEqual([
      ["cliagent-fresh", "turn-fresh", Number.MAX_SAFE_INTEGER],
      ["cliagent-fresh", "turn-fresh", 7],
    ]);
    expect(result).toEqual(
      expect.objectContaining({
        terminalStatus: "completed",
        pushedAgentEventCount: 0,
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
      getAccessToken: async () => "token",
      authIdentityKey: "user-1",
      orgId: "org-1",
      rootSessionId: "shared-root",
      conversationTitle: "Shared conversation",
      displayText: "continue",
      timeline: [],
      target: {
        cliAgentType: "codex",
        accountId: "acct-codex",
        model: "gpt-5.6-sol",
      },
      executionRoot,
      turnIntentId: "turn-owner",
    });

    expect(mocks.continueLocalConversation).toHaveBeenCalledWith(
      expect.objectContaining({ root: executionRoot })
    );
    expect(mocks.stageConversationTail).not.toHaveBeenCalled();
  });

  it("publishes a non-portable transcript error when execution fails after the user row", async () => {
    const failure = new Error("native materialization failed");
    mocks.continueLocalConversation.mockImplementationOnce(async (params) => {
      await params.beforeDispatch?.();
      throw failure;
    });

    await expect(
      runConversationTurn({
        getAccessToken: async () => "token",
        authIdentityKey: "user-1",
        orgId: "org-1",
        rootSessionId: "shared-root",
        conversationTitle: "Shared conversation",
        displayText: "continue",
        timeline: [],
        target: {
          cliAgentType: "codex",
          accountId: "acct-codex",
          model: "gpt-5.6-sol",
        },
        turnIntentId: "turn-failed",
      })
    ).rejects.toBe(failure);

    expect(mocks.stageConversationTail).toHaveBeenCalledOnce();
    const failurePush = mocks.stageConversationTail.mock.calls[0]?.[0];
    expect(failurePush).toEqual(
      expect.objectContaining({
        turnId: "turn-failed",
        events: [
          expect.objectContaining({
            source: "system",
            displayVariant: "error",
            displayStatus: "failed",
            result: expect.objectContaining({
              error: "native materialization failed",
            }),
          }),
        ],
      })
    );
    expect(projectNativeConversationItems(failurePush.events)).toEqual([]);
  });
});
