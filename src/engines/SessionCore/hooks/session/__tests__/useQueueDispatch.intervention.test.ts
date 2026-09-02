// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UserIntentSendError } from "@src/engines/SessionCore/services/userIntentDispatch";
import {
  type QueuedMessage,
  messageQueueAtom,
} from "@src/store/ui/messageQueueAtom";
import { type SmokeRoot, createSmokeRoot } from "@src/test/reactSmokeHarness";

import { useQueueDispatch } from "../useQueueDispatch";

const SESSION_ID = "agent-builtin:sde-queued-worker";

const mocks = vi.hoisted(() => ({
  append: vi.fn(),
  beginOptimisticTurn: vi.fn(),
  beginTurnDispatch: vi.fn(),
  beginTurnStopping: vi.fn(),
  cancelTurn: vi.fn(),
  clearTurnLifecycleSession: vi.fn(),
  dispatchCanonicalConversation: vi.fn(),
  confirmTurnRunning: vi.fn(),
  failOptimisticTurn: vi.fn(),
  getSession: vi.fn(),
  getTurnGeneration: vi.fn(),
  getTurnPhase: vi.fn(),
  markSessionActive: vi.fn(),
  markTurnTerminal: vi.fn(),
  messageError: vi.fn(),
  messageWarning: vi.fn(),
  loadDurableMessageQueue: vi.fn(),
  persistDurableMessageQueue: vi.fn(),
  restoreTurnWorkingAfterInterruptFailure: vi.fn(),
  sendMessage: vi.fn(),
  updateById: vi.fn(),
}));

vi.mock("@src/api/tauri/agent", () => ({
  getSession: mocks.getSession,
}));

vi.mock("@src/components/Message", () => ({
  Message: {
    error: mocks.messageError,
    warning: mocks.messageWarning,
  },
}));

vi.mock("@src/engines/SessionCore/control/optimisticTurnStatus", () => ({
  beginOptimisticTurn: mocks.beginOptimisticTurn,
  failOptimisticTurn: mocks.failOptimisticTurn,
}));

vi.mock("@src/engines/SessionCore/control/sessionTimelineBoundary", () => ({
  cancelTurnForTimelineBoundary: mocks.cancelTurn,
}));

vi.mock("@src/engines/SessionCore/control/turnLifecycle", async () => {
  const { atom } = await import("jotai/vanilla");
  return {
    beginTurnDispatch: mocks.beginTurnDispatch,
    beginTurnStopping: mocks.beginTurnStopping,
    clearTurnLifecycleSession: mocks.clearTurnLifecycleSession,
    confirmTurnRunning: mocks.confirmTurnRunning,
    getTurnGeneration: mocks.getTurnGeneration,
    getTurnPhase: mocks.getTurnPhase,
    markTurnTerminal: mocks.markTurnTerminal,
    restoreTurnWorkingAfterInterruptFailure:
      mocks.restoreTurnWorkingAfterInterruptFailure,
    turnLifecycleSignalAtom: atom(0),
  };
});

vi.mock("@src/engines/SessionCore/core/store/EventStoreProxy", () => ({
  eventStoreProxy: {
    append: mocks.append,
    updateById: mocks.updateById,
  },
}));

vi.mock("@src/engines/SessionCore/services/SessionService", () => ({
  SessionService: { sendMessage: mocks.sendMessage },
}));

vi.mock("@src/engines/SessionCore/sync/adapters/shared/eventFactories", () => ({
  createSyntheticUserEvent: (sessionId: string) => ({
    id: "synthetic-user-event",
    chunk_id: null,
    sessionId,
    createdAt: "2026-07-18T00:00:00.000Z",
    functionName: "user_message",
    uiCanonical: "",
    actionType: "raw",
    source: "user",
    args: {},
    result: { syntheticUserInput: true, deliveryStatus: "pending" },
    displayText: "queued worker follow-up",
    displayStatus: "pending",
    displayVariant: "message",
    activityStatus: "agent",
    isDelta: false,
  }),
}));

vi.mock("@src/hooks/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock("@src/store/session", () => ({
  markSessionActive: mocks.markSessionActive,
}));

vi.mock("@src/store/ui/messageQueueRepository", () => ({
  loadDurableMessageQueue: mocks.loadDurableMessageQueue,
  persistDurableMessageQueue: mocks.persistDurableMessageQueue,
}));

vi.mock("@src/util/platform/tauri/init", () => ({
  invokeTauri: vi.fn(),
}));

vi.mock("@src/util/session/resolveModelForMessage", () => ({
  resolveModelForMessage: () => ({
    model: "test-model",
    accountId: "test-account",
  }),
}));

vi.mock("@src/util/session/selectionFromSession", () => ({
  selectionFromSession: () => null,
}));

vi.mock("@src/util/session/sessionDispatch", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@src/util/session/sessionDispatch")
  >()),
  isAgentSession: () => false,
  isCliSession: () => false,
  isCursorIdeSession: () => false,
}));

function makeQueuedMessage(): QueuedMessage {
  return {
    id: "queued-intervention-1",
    turnIntentId: "turn-intent-queued-1",
    sessionId: SESSION_ID,
    content: "queued worker follow-up",
    displayContent: "queued worker follow-up",
    modelSelection: { model: "test-model" },
    agentExecMode: "build",
    priority: "now",
    status: "queued",
    createdAt: "2026-07-18T00:00:00.000Z",
  };
}

function makeCanonicalMessage(
  id: string,
  conversationId = "root-1"
): QueuedMessage {
  return {
    ...makeQueuedMessage(),
    id,
    turnIntentId: `turn-intent-${id}`,
    priority: "next",
    conversationDispatch: {
      kind: "canonical_conversation",
      root: {
        authority: "local-session",
        authorityScope: [],
        conversationId,
      },
      target: {
        cliAgentType: "codex",
        accountId: "openai-1",
        model: "gpt-5.6-sol",
        workspaceRepoPath: "/repo",
      },
    },
  };
}

function installLifecycleSimulation(): void {
  const phases = new Map<string, string>();
  const generations = new Map<string, number>();
  mocks.beginTurnDispatch.mockImplementation((scopeKey: string) => {
    const generation = (generations.get(scopeKey) ?? 0) + 1;
    generations.set(scopeKey, generation);
    phases.set(scopeKey, "dispatching");
    return generation;
  });
  mocks.beginTurnStopping.mockImplementation((scopeKey: string) => {
    phases.set(scopeKey, "stopping");
  });
  mocks.clearTurnLifecycleSession.mockImplementation((scopeKey: string) => {
    phases.delete(scopeKey);
    generations.delete(scopeKey);
  });
  mocks.confirmTurnRunning.mockImplementation((scopeKey: string) => {
    phases.set(scopeKey, "working");
  });
  mocks.getTurnGeneration.mockImplementation(
    (scopeKey: string) => generations.get(scopeKey) ?? 0
  );
  mocks.getTurnPhase.mockImplementation(
    (scopeKey: string) => phases.get(scopeKey) ?? "idle"
  );
  mocks.markTurnTerminal.mockImplementation((scopeKey: string) => {
    phases.set(scopeKey, "idle");
  });
  mocks.restoreTurnWorkingAfterInterruptFailure.mockImplementation(
    (scopeKey: string) => {
      if (phases.get(scopeKey) === "stopping") {
        phases.set(scopeKey, "working");
      }
    }
  );
}

function QueueDispatchHarness(): null {
  useQueueDispatch(mocks.dispatchCanonicalConversation);
  return null;
}

describe("useQueueDispatch Agent Org intervention", () => {
  let root: SmokeRoot;
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    mocks.append.mockReset().mockResolvedValue(undefined);
    mocks.beginOptimisticTurn.mockReset();
    mocks.beginTurnDispatch.mockReset().mockReturnValue(11);
    mocks.beginTurnStopping.mockReset();
    mocks.cancelTurn.mockReset().mockResolvedValue(undefined);
    mocks.clearTurnLifecycleSession.mockReset();
    mocks.dispatchCanonicalConversation
      .mockReset()
      .mockImplementation(async (_store, message, callbacks) => {
        await callbacks.onAccepted(message.sessionId);
        return { terminalStatus: "completed" };
      });
    mocks.confirmTurnRunning.mockReset();
    mocks.failOptimisticTurn.mockReset();
    mocks.getSession.mockReset().mockResolvedValue(null);
    mocks.getTurnGeneration.mockReset().mockReturnValue(11);
    mocks.getTurnPhase.mockReset().mockReturnValue("idle");
    mocks.markSessionActive.mockReset();
    mocks.markTurnTerminal.mockReset();
    mocks.messageError.mockReset();
    mocks.messageWarning.mockReset();
    mocks.loadDurableMessageQueue.mockReset().mockResolvedValue([]);
    mocks.persistDurableMessageQueue.mockReset().mockResolvedValue(undefined);
    mocks.restoreTurnWorkingAfterInterruptFailure.mockReset();
    mocks.sendMessage.mockReset().mockResolvedValue(undefined);
    mocks.updateById.mockReset().mockResolvedValue(true);
    store = createStore();
    root = createSmokeRoot();
  });

  afterEach(async () => {
    await root.unmount();
  });

  async function mountWithMessages(messages: QueuedMessage[]): Promise<void> {
    store.set(messageQueueAtom, messages);
    await root.render(
      createElement(Provider, { store }, createElement(QueueDispatchHarness))
    );
  }

  async function mountWithQueuedMessage(): Promise<void> {
    await mountWithMessages([makeQueuedMessage()]);
  }

  it("persists the queued event and dispatches it as direct user intent", async () => {
    await mountWithQueuedMessage();

    await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledOnce());

    expect(mocks.append).toHaveBeenCalledOnce();
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESSION_ID,
        content: "queued worker follow-up",
        turnIntentId: "turn-intent-queued-1",
        turnIntentSource: "force_send",
        directUserIntent: true,
      })
    );
    expect(mocks.append.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sendMessage.mock.invocationCallOrder[0]
    );
    await vi.waitFor(() => expect(store.get(messageQueueAtom)).toEqual([]));
  });

  it("does not let a blocked Send Now freeze another idle session", async () => {
    const blocked = makeQueuedMessage();
    const ready: QueuedMessage = {
      ...makeQueuedMessage(),
      id: "queued-other-session",
      turnIntentId: "turn-intent-other-session",
      sessionId: "agent-builtin:sde-other-session",
      content: "independent follow-up",
      displayContent: "independent follow-up",
      priority: "next",
    };
    mocks.getTurnPhase.mockImplementation((sessionId: string) =>
      sessionId === SESSION_ID ? "working" : "idle"
    );

    await mountWithMessages([blocked, ready]);

    await vi.waitFor(() =>
      expect(mocks.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: ready.sessionId })
      )
    );
    expect(mocks.cancelTurn).toHaveBeenCalledWith(
      SESSION_ID,
      "force-send",
      expect.objectContaining({ onError: expect.any(Function) })
    );
    await vi.waitFor(() =>
      expect(store.get(messageQueueAtom)).toEqual([
        expect.objectContaining({ id: blocked.id }),
      ])
    );
  });

  it("transfers a send-stage failure from the queue card to one failed bubble", async () => {
    mocks.sendMessage.mockRejectedValue(new Error("backend send unavailable"));

    await mountWithQueuedMessage();

    await vi.waitFor(() =>
      expect(mocks.updateById).toHaveBeenCalledWith(
        "synthetic-user-event",
        expect.objectContaining({
          displayStatus: "failed",
          result: expect.objectContaining({
            deliveryStatus: "failed",
            deliveryError: "backend send unavailable",
          }),
        }),
        SESSION_ID
      )
    );

    await vi.waitFor(() => expect(store.get(messageQueueAtom)).toEqual([]));
  });

  it("retains the queue card when the optimistic row could not be stored", async () => {
    mocks.append.mockRejectedValue(new Error("event store unavailable"));

    await mountWithQueuedMessage();

    await vi.waitFor(() =>
      expect(store.get(messageQueueAtom)).toEqual([
        expect.objectContaining({
          id: "queued-intervention-1",
          requiresExplicitDispatch: true,
        }),
      ])
    );
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("drains canonical rows through the singleton headless dispatcher", async () => {
    installLifecycleSimulation();
    const canonical = makeCanonicalMessage("canonical-user-event");

    await mountWithMessages([canonical]);
    await vi.waitFor(() =>
      expect(mocks.dispatchCanonicalConversation).toHaveBeenCalledOnce()
    );
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(store.get(messageQueueAtom)).toEqual([]));
    expect(mocks.updateById).not.toHaveBeenCalled();
  });

  it("propagates the provider terminal instead of manufacturing completion", async () => {
    mocks.dispatchCanonicalConversation.mockImplementationOnce(
      async (_store, message, callbacks) => {
        await callbacks.onAccepted(message.sessionId);
        return { terminalStatus: "cancelled" };
      }
    );

    await mountWithMessages([makeCanonicalMessage("canonical-cancelled")]);

    await vi.waitFor(() =>
      expect(mocks.markTurnTerminal).toHaveBeenCalledWith(
        expect.stringContaining("root-1"),
        "cancelled",
        expect.objectContaining({ generation: 11 })
      )
    );
  });

  it("transfers a prepared canonical failure from the queue card to its failed bubble", async () => {
    mocks.dispatchCanonicalConversation.mockRejectedValueOnce(
      new UserIntentSendError("native launch failed", "native-user-event")
    );

    await mountWithMessages([makeCanonicalMessage("canonical-failed")]);

    await vi.waitFor(() => expect(store.get(messageQueueAtom)).toEqual([]));
    expect(mocks.messageError).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("native launch failed"),
      })
    );
  });

  it("retains a canonical queue card when no optimistic row was stored", async () => {
    mocks.dispatchCanonicalConversation.mockRejectedValueOnce(
      new Error("native preparation failed")
    );
    const message = makeCanonicalMessage("canonical-unprepared");

    await mountWithMessages([message]);

    await vi.waitFor(() =>
      expect(store.get(messageQueueAtom)).toEqual([
        expect.objectContaining({
          id: message.id,
          requiresExplicitDispatch: true,
        }),
      ])
    );
  });

  it("serializes two canonical turns for one root through turnLifecycle", async () => {
    installLifecycleSimulation();
    let releaseFirst!: () => void;
    const firstTerminal = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    mocks.dispatchCanonicalConversation.mockImplementation(
      async (_store, message, callbacks) => {
        const runnerId = `runner-${message.id}`;
        await callbacks.onRunnerReady?.(runnerId, 0);
        await callbacks.onAccepted(runnerId);
        if (message.id === "canonical-first") await firstTerminal;
        return { terminalStatus: "completed" };
      }
    );

    await mountWithMessages([
      makeCanonicalMessage("canonical-first"),
      makeCanonicalMessage("canonical-second"),
    ]);

    await vi.waitFor(() =>
      expect(mocks.dispatchCanonicalConversation).toHaveBeenCalledTimes(1)
    );
    expect(mocks.dispatchCanonicalConversation.mock.calls[0]?.[1].id).toBe(
      "canonical-first"
    );
    expect(store.get(messageQueueAtom)).toEqual([
      expect.objectContaining({
        id: "canonical-first",
        status: "accepted",
        runnerSessionId: "runner-canonical-first",
      }),
      expect.objectContaining({ id: "canonical-second", status: "queued" }),
    ]);

    releaseFirst();
    await vi.waitFor(() =>
      expect(mocks.dispatchCanonicalConversation).toHaveBeenCalledTimes(2)
    );
    expect(mocks.dispatchCanonicalConversation.mock.calls[1]?.[1].id).toBe(
      "canonical-second"
    );
    await vi.waitFor(() => expect(store.get(messageQueueAtom)).toEqual([]));
  });

  it("admits another canonical root after the first provider accepts", async () => {
    installLifecycleSimulation();
    let acceptFirst!: () => void;
    const firstAcceptance = new Promise<void>((resolve) => {
      acceptFirst = resolve;
    });
    mocks.dispatchCanonicalConversation.mockImplementation(
      async (_store, message, callbacks) => {
        const runnerId = `runner-${message.id}`;
        await callbacks.onRunnerReady?.(runnerId, 0);
        if (message.id === "root-a") await firstAcceptance;
        await callbacks.onAccepted(runnerId);
        return { terminalStatus: "completed" };
      }
    );

    await mountWithMessages([
      makeCanonicalMessage("root-a", "conversation-a"),
      makeCanonicalMessage("root-b", "conversation-b"),
    ]);

    await vi.waitFor(() =>
      expect(mocks.dispatchCanonicalConversation).toHaveBeenCalledTimes(1)
    );
    expect(mocks.dispatchCanonicalConversation.mock.calls[0]?.[1].id).toBe(
      "root-a"
    );
    expect(store.get(messageQueueAtom).map((message) => message.id)).toEqual([
      "root-a",
      "root-b",
    ]);
    acceptFirst();
    await vi.waitFor(() =>
      expect(mocks.dispatchCanonicalConversation).toHaveBeenCalledTimes(2)
    );
    expect(mocks.dispatchCanonicalConversation.mock.calls[1]?.[1].id).toBe(
      "root-b"
    );
    await vi.waitFor(() => expect(store.get(messageQueueAtom)).toEqual([]));
  });

  it("routes canonical Send Now through the active native runner", async () => {
    installLifecycleSimulation();
    let releaseFirst!: () => void;
    const firstTerminal = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    mocks.dispatchCanonicalConversation.mockImplementation(
      async (_store, message, callbacks) => {
        const runnerId = `runner-${message.id}`;
        await callbacks.onRunnerReady?.(runnerId, 0);
        await callbacks.onAccepted(runnerId);
        if (message.id === "canonical-running") await firstTerminal;
        return { terminalStatus: "completed" };
      }
    );
    const forceSend = {
      ...makeCanonicalMessage("canonical-force-send"),
      priority: "now" as const,
    };

    await mountWithMessages([makeCanonicalMessage("canonical-running")]);
    await vi.waitFor(() =>
      expect(mocks.dispatchCanonicalConversation).toHaveBeenCalledTimes(1)
    );
    store.set(messageQueueAtom, (current) => [...current, forceSend]);

    await vi.waitFor(() =>
      expect(mocks.cancelTurn).toHaveBeenCalledWith(
        "runner-canonical-running",
        "force-send",
        expect.objectContaining({ onError: expect.any(Function) })
      )
    );
    expect(mocks.dispatchCanonicalConversation).toHaveBeenCalledTimes(1);
    releaseFirst();
    await vi.waitFor(() =>
      expect(mocks.dispatchCanonicalConversation).toHaveBeenCalledTimes(2)
    );
  });

  it("holds Send Now visibly when the interrupt transport rejects", async () => {
    mocks.getTurnPhase.mockImplementation((sessionId: string) =>
      sessionId === SESSION_ID ? "working" : "idle"
    );
    mocks.getTurnGeneration.mockReturnValue(7);
    mocks.cancelTurn.mockImplementation(
      async (_sessionId, _reason, options) => {
        options?.onError?.("interrupt transport unavailable");
      }
    );

    await mountWithQueuedMessage();

    await vi.waitFor(() =>
      expect(store.get(messageQueueAtom)).toEqual([
        expect.objectContaining({
          id: "queued-intervention-1",
          priority: "next",
          requiresExplicitDispatch: true,
        }),
      ])
    );
    expect(mocks.restoreTurnWorkingAfterInterruptFailure).toHaveBeenCalledWith(
      SESSION_ID,
      { generation: 7 }
    );
    expect(mocks.messageError).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("interrupt transport unavailable"),
      })
    );
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
});
