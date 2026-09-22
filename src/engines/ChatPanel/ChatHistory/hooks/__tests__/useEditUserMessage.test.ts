// @vitest-environment jsdom
import nativeFailureFixture from "@/src-tauri/crates/orgtrack-core/src/sources/fixtures/codex_native_failed_user.json";
import { createStore } from "jotai/vanilla";
import type { Store } from "jotai/vanilla/store";
import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  QueuedConversationDispatch,
  QueuedConversationDispatchResolution,
} from "@src/engines/SessionCore/conversations/queuedConversationContract";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { appendQueuedUserEvents } from "@src/engines/SessionCore/derived/chatEvents";
import {
  type QueuedMessage,
  messageQueueAtom,
} from "@src/store/ui/messageQueueAtom";

import type { OptimizedChatItem } from "../../chatItemPipeline/types";
import { useEditUserMessage } from "../useEditUserMessage";

const {
  askNativeDialogSpy,
  checkSnapshotChangesSpy,
  durableHydrationRows,
  evictSessionSpy,
  invokeTauriSpy,
  flushMessageQueueSpy,
  hydrateMessageQueueSpy,
  messageQueueHydrated,
  queuedDeliveries,
  realQueueStore,
  removeByIdPrefixSpy,
  updateByIdSpy,
  upsertSpy,
  storeSetSpy,
  surfaceSessionId,
  submitUserIntentSpy,
  refreshMessageDeliveriesSpy,
  storeSessionId,
  truncateBeforeIdSpy,
} = vi.hoisted(() => ({
  askNativeDialogSpy: vi.fn(async () => true),
  checkSnapshotChangesSpy: vi.fn(async () => false),
  durableHydrationRows: { current: [] as Array<Record<string, unknown>> },
  evictSessionSpy: vi.fn(async () => undefined),
  invokeTauriSpy: vi.fn(async () => 0),
  flushMessageQueueSpy: vi.fn(async () => undefined),
  hydrateMessageQueueSpy: vi.fn(async () => undefined),
  messageQueueHydrated: { current: true },
  queuedDeliveries: { current: [] as Array<Record<string, unknown>> },
  realQueueStore: { current: null as Store | null },
  removeByIdPrefixSpy: vi.fn(async () => 1),
  updateByIdSpy: vi.fn(async () => true),
  upsertSpy: vi.fn(async (..._args: unknown[]) => undefined),
  storeSetSpy: vi.fn((_atom: unknown, _update: unknown) => true),
  surfaceSessionId: { current: undefined as string | undefined },
  submitUserIntentSpy: vi.fn(async (..._args: unknown[]) => undefined),
  refreshMessageDeliveriesSpy: vi.fn(async () => undefined),
  storeSessionId: { current: "osagent-session-1" },
  truncateBeforeIdSpy: vi.fn(async () => undefined),
}));

vi.mock("jotai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("jotai")>()),
  useSetAtom: () => vi.fn(),
  useStore: () => ({
    get: (atom: { debugLabel?: string }) =>
      atom.debugLabel === "messageQueueAtom"
        ? (realQueueStore.current?.get(messageQueueAtom) ??
          queuedDeliveries.current)
        : atom.debugLabel === "messageQueueHydratedAtom"
          ? messageQueueHydrated.current
          : storeSessionId.current,
    set: storeSetSpy,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@src/api/tauri/agent", () => ({
  checkSnapshotChanges: checkSnapshotChangesSpy,
  truncateAfterMessage: vi.fn(async () => undefined),
}));

vi.mock("@src/components/Message", () => ({
  default: { warning: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@src/engines/ChatPanel/ChatSessionContext", () => ({
  useChatSessionId: () => surfaceSessionId.current,
}));

vi.mock(
  "@src/engines/ChatPanel/hooks/useWorkspaceChat/useUserIntentSubmit",
  () => ({
    useUserIntentSubmit: () => submitUserIntentSpy,
  })
);

vi.mock("@src/engines/SessionCore", () => ({
  editTruncationTimestampAtom: {},
  triggerSessionReloadAtom: { debugLabel: "triggerSessionReloadAtom" },
}));

vi.mock(
  "@src/engines/SessionCore/conversations/localConversationExecutionTail",
  () => ({
    LOCAL_EXECUTION_TAIL_EVENT_PREFIX: "runlanded-",
  })
);

vi.mock("@src/engines/SessionCore/control/optimisticTurnStatus", () => ({
  beginOptimisticTurn: vi.fn(),
  failOptimisticTurn: vi.fn(),
}));

vi.mock("@src/engines/SessionCore/control/sessionTimelineBoundary", () => ({
  cancelTurnForTimelineBoundary: vi.fn(async () => undefined),
}));

vi.mock("@src/engines/SessionCore/core/atoms", () => ({
  sessionIdAtom: {},
}));

vi.mock("@src/engines/SessionCore/core/store/EventStoreProxy", () => ({
  eventStoreProxy: {
    removeByIdPrefix: removeByIdPrefixSpy,
    updateById: updateByIdSpy,
    upsert: upsertSpy,
    truncateBeforeId: truncateBeforeIdSpy,
    evictSession: evictSessionSpy,
  },
}));

vi.mock(
  "@src/engines/SessionCore/hooks/session/messageQueuePersistence",
  () => ({
    flushMessageQueuePersistence: flushMessageQueueSpy,
    hydrateMessageQueue: hydrateMessageQueueSpy,
    refreshMessageDeliveries: refreshMessageDeliveriesSpy,
  })
);

vi.mock("@src/engines/SessionCore/storage/cacheAdapter", () => ({
  deleteSession: vi.fn(async () => undefined),
}));

vi.mock("@src/hooks/logger", () => ({
  createLogger: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("@src/store/session/planApprovalAtom", () => ({
  clearPendingPlanApproval: vi.fn((prev: unknown) => prev),
  pendingPlanApprovalsAtom: {},
}));

vi.mock("@src/store/session/viewAtom", () => ({
  activeSessionIdAtom: {},
}));

vi.mock("@src/store/ui/todoAtom", () => ({
  clearTodosForSessionAtom: {},
}));

vi.mock("@src/util/dialogs/nativeDialog", () => ({
  askNativeDialogSafely: askNativeDialogSpy,
}));

vi.mock("@src/util/platform/tauri/init", () => ({
  invokeTauri: invokeTauriSpy,
}));

vi.mock("../../components/RevertConfirmDialog", () => ({
  showRevertConfirm: vi.fn(async () => "revert"),
}));

function chatItem(): OptimizedChatItem {
  return {
    event: {
      id: "user-message-abc",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    chunk_id: "chunk-1",
  } as unknown as OptimizedChatItem;
}

type EditUserMessageFn = (
  item: OptimizedChatItem,
  newText: string,
  imageDataUrls?: string[]
) => Promise<void>;
type FailedUserIntentRetry = NonNullable<
  Parameters<typeof useEditUserMessage>[0]
>;

let resolveDispatchForTest:
  | (() => QueuedConversationDispatchResolution)
  | undefined;
let failedUserIntentRetryForTest: FailedUserIntentRetry | undefined;

function resolveDispatchViaTest(): QueuedConversationDispatchResolution {
  return resolveDispatchForTest?.() ?? { action: "preserve" };
}

async function retryFailedUserIntentViaTest(
  input: Parameters<FailedUserIntentRetry>[0]
): Promise<boolean> {
  return (await failedUserIntentRetryForTest?.(input)) ?? false;
}

function Harness({ onReady }: { onReady: (fn: EditUserMessageFn) => void }) {
  const editUserMessage = useEditUserMessage(
    retryFailedUserIntentViaTest,
    resolveDispatchViaTest
  );
  useEffect(() => {
    onReady(editUserMessage);
  }, [editUserMessage, onReady]);
  return null;
}

describe("useEditUserMessage resend projection", () => {
  let container: HTMLDivElement;
  let root: Root;
  let editUserMessage: EditUserMessageFn | null = null;
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    askNativeDialogSpy.mockReset();
    askNativeDialogSpy.mockResolvedValue(true);
    checkSnapshotChangesSpy.mockClear();
    durableHydrationRows.current = [];
    evictSessionSpy.mockClear();
    invokeTauriSpy.mockClear();
    flushMessageQueueSpy.mockClear();
    hydrateMessageQueueSpy.mockClear();
    hydrateMessageQueueSpy.mockImplementation(async () => {
      queuedDeliveries.current = [...durableHydrationRows.current];
      messageQueueHydrated.current = true;
    });
    messageQueueHydrated.current = true;
    queuedDeliveries.current = [];
    realQueueStore.current = null;
    removeByIdPrefixSpy.mockClear();
    updateByIdSpy.mockReset();
    updateByIdSpy.mockResolvedValue(true);
    upsertSpy.mockReset();
    upsertSpy.mockResolvedValue(undefined);
    storeSetSpy.mockReset();
    storeSetSpy.mockReturnValue(true);
    submitUserIntentSpy.mockClear();
    refreshMessageDeliveriesSpy.mockClear();
    truncateBeforeIdSpy.mockClear();
    storeSessionId.current = "osagent-session-1";
    surfaceSessionId.current = undefined;
    failedUserIntentRetryForTest = undefined;
    resolveDispatchForTest = undefined;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
      root.render(
        createElement(Harness, {
          onReady: (fn: EditUserMessageFn) => {
            editUserMessage = fn;
          },
        })
      )
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    editUserMessage = null;
  });

  afterAll(() => {
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("re-runs the outgoing projection so the agent gets the contract, not raw pills", async () => {
    await act(async () => {
      await editUserMessage?.(
        chatItem(),
        "canvas [skill:/canvas] build a timer"
      );
    });

    expect(submitUserIntentSpy).toHaveBeenCalledTimes(1);
    const call = submitUserIntentSpy.mock.calls[0]?.[0] as unknown as {
      displayContent: string;
      agentContent?: string;
    };
    expect(call.displayContent).toBe("canvas [skill:/canvas] build a timer");
    expect(call.agentContent).toContain("render_inline_canvas exactly once");
    expect(call.agentContent).toContain("build a timer");
    expect(call.agentContent).not.toContain("[skill:/canvas]");
  });

  it("leaves plain edits without a separate agent copy", async () => {
    await act(async () => {
      await editUserMessage?.(chatItem(), "just fix the test");
    });

    const call = submitUserIntentSpy.mock.calls[0]?.[0] as unknown as {
      displayContent: string;
      agentContent?: string;
    };
    expect(call.displayContent).toBe("just fix the test");
    expect(call.agentContent).toBeUndefined();
  });

  it("does not project the canvas contract when resending with images", async () => {
    await act(async () => {
      await editUserMessage?.(chatItem(), "/canvas build a timer", [
        "data:image/png;base64,AAA",
      ]);
    });

    const call = submitUserIntentSpy.mock.calls[0]?.[0] as unknown as {
      displayContent: string;
      agentContent?: string;
    };
    expect(call.displayContent).toBe("/canvas build a timer");
    expect(call.agentContent).toBeUndefined();
  });

  it("retries a failed delivery without truncating later history", async () => {
    const failed = {
      event: {
        id: "user-input-failed",
        createdAt: "2026-01-01T00:00:00.000Z",
        source: "user",
        functionName: "user_message",
        uiCanonical: "",
        displayText: "retry this exact request",
        displayStatus: "failed",
        result: {
          syntheticUserInput: true,
          deliveryStatus: "failed",
          turnIntentId: "turn-intent-failed",
        },
      },
      chunk_id: "user-input-failed",
    } as unknown as OptimizedChatItem;

    await act(async () => {
      await editUserMessage?.(failed, "retry this exact request");
    });
    expect(askNativeDialogSpy).not.toHaveBeenCalled();

    expect(submitUserIntentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        displayContent: "retry this exact request",
        turnIntentId: "turn-intent-failed",
      })
    );
    expect(removeByIdPrefixSpy).toHaveBeenCalledWith(
      "user-input-failed",
      "osagent-session-1"
    );
    expect(checkSnapshotChangesSpy).not.toHaveBeenCalled();
    expect(truncateBeforeIdSpy).not.toHaveBeenCalled();
  });

  it("falls back to the mounted Member dispatcher when canonical retry declines", async () => {
    surfaceSessionId.current = "member-session";
    storeSessionId.current = "root-session";
    const canonicalRetry = vi.fn().mockResolvedValue(false);
    failedUserIntentRetryForTest = canonicalRetry;
    act(() =>
      root.render(
        createElement(Harness, {
          onReady: (fn: EditUserMessageFn) => {
            editUserMessage = fn;
          },
        })
      )
    );
    const failed = {
      event: {
        id: "member-user-input-failed",
        source: "user",
        displayText: "retry with the same Member",
        displayStatus: "failed",
        result: {
          syntheticUserInput: true,
          deliveryStatus: "failed",
          turnIntentId: "member-turn-intent-failed",
        },
      },
      chunk_id: "member-user-input-failed",
    } as unknown as OptimizedChatItem;

    await act(async () => {
      await editUserMessage?.(failed, "retry with the same Member");
    });

    expect(canonicalRetry).toHaveBeenCalledOnce();
    expect(submitUserIntentSpy).toHaveBeenCalledOnce();
    expect(submitUserIntentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "member-session",
        displayContent: "retry with the same Member",
        turnIntentId: "member-turn-intent-failed",
      })
    );
    expect(removeByIdPrefixSpy).toHaveBeenCalledWith(
      "member-user-input-failed",
      "member-session"
    );
  });

  it("retries a reconciled orphan through the current submit path", async () => {
    const failed = {
      event: {
        id: "queued-user:legacy-orphan:",
        createdAt: "2026-01-01T00:00:00.000Z",
        source: "user",
        functionName: "user_message",
        uiCanonical: "",
        displayText: "@VantaNode inspect this",
        displayStatus: "failed",
        result: {
          syntheticUserInput: true,
          deliveryStatus: "failed",
          deliveryError:
            "This message was not sent because its pending delivery could not be recovered. Retry to send it again.",
          turnIntentId: "turn-intent-orphan",
          message: {
            role: "user",
            content: "@VantaNode inspect this",
          },
          images: ["data:image/png;base64,keep"],
          mentions: [{ id: "vanta", label: "VantaNode" }],
        },
      },
      chunk_id: "queued-user:legacy-orphan:",
    } as unknown as OptimizedChatItem;

    await act(async () => {
      await editUserMessage?.(failed, "@VantaNode inspect this", [
        "data:image/png;base64,keep",
      ]);
    });

    expect(refreshMessageDeliveriesSpy).not.toHaveBeenCalled();
    expect(submitUserIntentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "osagent-session-1",
        displayContent: "@VantaNode inspect this",
        imageDataUrls: ["data:image/png;base64,keep"],
        turnIntentId: "turn-intent-orphan",
      })
    );
    expect(removeByIdPrefixSpy).toHaveBeenCalledWith(
      "queued-user:legacy-orphan:",
      "osagent-session-1"
    );
    expect(storeSetSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ debugLabel: "forceSendMessageAtom" }),
      expect.anything()
    );
  });

  it("retries a hydrated failed queue row in place without losing attachments", async () => {
    queuedDeliveries.current = [
      {
        id: "queue-failed",
        turnIntentId: "turn-intent-failed",
        sessionId: "osagent-session-1",
        content: "retry this exact request",
        displayContent: "retry this exact request",
        imageDataUrls: ["data:image/png;base64,keep"],
        priority: "next",
        status: "queued",
        requiresExplicitDispatch: true,
        deliveryError: "provider unavailable",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const failed = {
      event: {
        id: "queued-user-turn-intent-failed",
        displayText: "retry this exact request",
        displayStatus: "failed",
        result: {
          syntheticUserInput: true,
          deliveryStatus: "failed",
          queueMessageId: "queue-failed",
          turnIntentId: "turn-intent-failed",
        },
      },
      chunk_id: "queued-user-turn-intent-failed",
    } as unknown as OptimizedChatItem;

    await act(async () => {
      await editUserMessage?.(failed, "retry this exact request");
    });

    expect(updateByIdSpy).toHaveBeenCalledWith(
      "queued-user:queue-failed:",
      expect.objectContaining({
        displayText: "retry this exact request",
        displayStatus: "pending",
        result: expect.objectContaining({
          images: ["data:image/png;base64,keep"],
          turnIntentId: expect.not.stringMatching("turn-intent-failed"),
          deliveryStatus: "pending",
          queueMessageId: "queue-failed",
        }),
      }),
      "osagent-session-1"
    );
    expect(removeByIdPrefixSpy).not.toHaveBeenCalled();
    expect(storeSetSpy).toHaveBeenCalledWith(
      expect.objectContaining({ debugLabel: "forceSendMessageAtom" }),
      "queue-failed"
    );
  });

  it("retries a held canonical row with the runtime the picker shows now", async () => {
    const admittedDispatch: QueuedConversationDispatch = {
      kind: "canonical_conversation",
      root: {
        authority: "local-session",
        authorityScope: [],
        conversationId: "osagent-session-1",
      },
      target: {
        cliAgentType: "codex",
        accountId: "openai-1",
        model: "gpt-5.3-codex-medium",
      },
    };
    const currentDispatch: QueuedConversationDispatch = {
      ...admittedDispatch,
      target: {
        cliAgentType: "codex",
        accountId: "openai-1",
        model: "gpt-5.6-sol",
      },
    };
    resolveDispatchForTest = () => ({
      action: "replace",
      dispatch: currentDispatch,
    });
    queuedDeliveries.current = [
      {
        id: "queue-rejected",
        turnIntentId: "turn-intent-rejected",
        sessionId: "osagent-session-1",
        content: "reply with the marker",
        displayContent: "reply with the marker",
        priority: "next",
        status: "queued",
        requiresExplicitDispatch: true,
        deliveryError: "model not supported",
        createdAt: "2026-01-01T00:00:00.000Z",
        conversationDispatch: admittedDispatch,
      },
    ];
    const failed = {
      event: {
        id: "queued-user-turn-intent-rejected",
        displayText: "reply with the marker",
        displayStatus: "failed",
        result: {
          syntheticUserInput: true,
          deliveryStatus: "failed",
          queueMessageId: "queue-rejected",
          turnIntentId: "turn-intent-rejected",
        },
      },
      chunk_id: "queued-user-turn-intent-rejected",
    } as unknown as OptimizedChatItem;

    try {
      await act(async () => {
        await editUserMessage?.(failed, "reply with the marker");
      });
    } finally {
      resolveDispatchForTest = undefined;
    }

    expect(storeSetSpy).toHaveBeenCalledWith(
      expect.objectContaining({ debugLabel: "editMessageAtom" }),
      expect.objectContaining({
        messageId: "queue-rejected",
        conversationDispatch: currentDispatch,
      })
    );
    expect(storeSetSpy).toHaveBeenCalledWith(
      expect.objectContaining({ debugLabel: "forceSendMessageAtom" }),
      "queue-rejected"
    );
  });

  it("clears stale canonical ownership when a Member retries its durable failed row", async () => {
    surfaceSessionId.current = "member-session";
    storeSessionId.current = "root-session";
    const admittedDispatch: QueuedConversationDispatch = {
      kind: "canonical_conversation",
      root: {
        authority: "local-session",
        authorityScope: [],
        conversationId: "root-session",
      },
      target: {
        cliAgentType: "codex",
        accountId: "root-account",
        model: "gpt-root",
      },
    };
    resolveDispatchForTest = () => ({ action: "clear" });
    queuedDeliveries.current = [
      {
        id: "member-queue-rejected",
        turnIntentId: "member-turn-intent-rejected",
        sessionId: "member-session",
        content: "retry on the member",
        displayContent: "retry on the member",
        imageDataUrls: ["data:image/png;base64,member"],
        priority: "next",
        status: "queued",
        requiresExplicitDispatch: true,
        deliveryError: "old root runtime failed",
        createdAt: "2026-01-01T00:00:00.000Z",
        conversationDispatch: admittedDispatch,
      },
    ];
    act(() =>
      root.render(
        createElement(Harness, {
          onReady: (fn: EditUserMessageFn) => {
            editUserMessage = fn;
          },
        })
      )
    );
    const failed = {
      event: {
        id: "queued-user:member-queue-rejected:",
        displayText: "retry on the member",
        displayStatus: "failed",
        result: {
          syntheticUserInput: true,
          deliveryStatus: "failed",
          queueMessageId: "member-queue-rejected",
          turnIntentId: "member-turn-intent-rejected",
        },
      },
      chunk_id: "queued-user:member-queue-rejected:",
    } as unknown as OptimizedChatItem;

    try {
      await act(async () => {
        await editUserMessage?.(failed, "retry on the member");
      });
    } finally {
      resolveDispatchForTest = undefined;
    }

    expect(storeSetSpy).toHaveBeenCalledWith(
      expect.objectContaining({ debugLabel: "editMessageAtom" }),
      expect.objectContaining({
        messageId: "member-queue-rejected",
        conversationDispatch: null,
        imageDataUrls: undefined,
      })
    );
    expect(updateByIdSpy).toHaveBeenCalledWith(
      "queued-user:member-queue-rejected:",
      expect.objectContaining({
        result: expect.objectContaining({
          images: ["data:image/png;base64,member"],
          queueMessageId: "member-queue-rejected",
        }),
      }),
      "member-session"
    );
    expect(storeSetSpy).toHaveBeenCalledWith(
      expect.objectContaining({ debugLabel: "forceSendMessageAtom" }),
      "member-queue-rejected"
    );
    expect(submitUserIntentSpy).not.toHaveBeenCalled();
  });

  it("hydrates a cold failed owner and patches its runner row from the root surface", async () => {
    messageQueueHydrated.current = false;
    durableHydrationRows.current = [
      {
        id: "queue-cold",
        turnIntentId: "turn-intent-cold",
        // The canonical root is mounted, but the queue projection belongs to
        // the concrete local execution Session selected at admission.
        sessionId: "cliagent-runner-child",
        content: "cold retry",
        displayContent: "cold retry",
        priority: "next",
        status: "queued",
        requiresExplicitDispatch: true,
        deliveryError: "database is locked",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const failed = {
      event: {
        id: "queued-user:queue-cold:",
        sessionId: "cliagent-runner-child",
        displayText: "cold retry",
        displayStatus: "failed",
        result: {
          syntheticUserInput: true,
          deliveryStatus: "failed",
          queueMessageId: "queue-cold",
          turnIntentId: "turn-intent-cold",
        },
      },
      chunk_id: "queued-user:queue-cold:",
    } as unknown as OptimizedChatItem;

    await act(async () => {
      await editUserMessage?.(failed, "cold retry");
    });

    expect(hydrateMessageQueueSpy).toHaveBeenCalledOnce();
    expect(refreshMessageDeliveriesSpy).not.toHaveBeenCalled();
    expect(updateByIdSpy).toHaveBeenCalledWith(
      "queued-user:queue-cold:",
      expect.objectContaining({
        displayText: "cold retry",
        displayStatus: "pending",
      }),
      "cliagent-runner-child"
    );
    expect(removeByIdPrefixSpy).not.toHaveBeenCalled();
    expect(submitUserIntentSpy).not.toHaveBeenCalled();
  });

  it("never deletes a queue-owned bubble while its cold owner is unavailable", async () => {
    messageQueueHydrated.current = false;
    const failed = {
      event: {
        id: "queued-user:queue-missing:",
        displayText: "keep this failed row",
        displayStatus: "failed",
        result: {
          syntheticUserInput: true,
          deliveryStatus: "failed",
          queueMessageId: "queue-missing",
          turnIntentId: "turn-intent-missing",
        },
      },
      chunk_id: "queued-user:queue-missing:",
    } as unknown as OptimizedChatItem;

    await act(async () => {
      await editUserMessage?.(failed, "keep this failed row");
    });

    expect(hydrateMessageQueueSpy).toHaveBeenCalledOnce();
    expect(refreshMessageDeliveriesSpy).toHaveBeenCalledOnce();
    expect(removeByIdPrefixSpy).not.toHaveBeenCalled();
    expect(submitUserIntentSpy).not.toHaveBeenCalled();
    expect(updateByIdSpy).not.toHaveBeenCalled();
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(storeSetSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ debugLabel: "forceSendMessageAtom" }),
      expect.anything()
    );
  });

  it("retries a retired failed delivery as a fresh intent", async () => {
    messageQueueHydrated.current = true;
    const failed = {
      event: {
        id: "queued-user:queue-retired:",
        source: "user",
        displayText: "retry after the owner retired",
        displayStatus: "failed",
        result: {
          syntheticUserInput: true,
          deliveryStatus: "failed",
          deliveryOwnerRetired: true,
          queueMessageId: "queue-retired",
          turnIntentId: "turn-intent-retired",
        },
      },
      chunk_id: "queued-user:queue-retired:",
    } as unknown as OptimizedChatItem;

    await act(async () => {
      await editUserMessage?.(failed, "retry after the owner retired");
    });

    expect(refreshMessageDeliveriesSpy).toHaveBeenCalledOnce();
    expect(submitUserIntentSpy).toHaveBeenCalledOnce();
    expect(submitUserIntentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        displayContent: "retry after the owner retired",
        turnIntentId: "turn-intent-retired",
      })
    );
    expect(removeByIdPrefixSpy).toHaveBeenCalledWith(
      "queued-user:queue-retired:",
      expect.any(String)
    );
  });

  it("edits a hydrated failed queue row and patches its existing bubble", async () => {
    queuedDeliveries.current = [
      {
        id: "queue-failed",
        turnIntentId: "turn-intent-failed",
        sessionId: "osagent-session-1",
        content: "retry this exact request",
        displayContent: "retry this exact request",
        imageDataUrls: ["data:image/png;base64,old"],
        priority: "next",
        status: "queued",
        requiresExplicitDispatch: true,
        deliveryError: "provider unavailable",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const failed = {
      event: {
        id: "queued-user-turn-intent-failed",
        displayText: "retry this exact request",
        displayStatus: "failed",
        result: {
          syntheticUserInput: true,
          deliveryStatus: "failed",
          queueMessageId: "queue-failed",
          turnIntentId: "turn-intent-failed",
        },
      },
      chunk_id: "queued-user-turn-intent-failed",
    } as unknown as OptimizedChatItem;

    await act(async () => {
      await editUserMessage?.(failed, "@VantaNode inspect the retry", [
        "data:image/png;base64,new",
      ]);
    });

    expect(storeSetSpy).toHaveBeenCalledWith(
      expect.objectContaining({ debugLabel: "editMessageAtom" }),
      expect.objectContaining({
        messageId: "queue-failed",
        content: "@VantaNode inspect the retry",
        imageDataUrls: ["data:image/png;base64,new"],
        turnIntentId: expect.any(String),
      })
    );
    expect(flushMessageQueueSpy).toHaveBeenCalledOnce();
    expect(updateByIdSpy).toHaveBeenCalledWith(
      "queued-user:queue-failed:",
      expect.objectContaining({
        displayText: "@VantaNode inspect the retry",
        displayStatus: "pending",
        result: expect.objectContaining({
          message: {
            role: "user",
            content: "@VantaNode inspect the retry",
          },
          images: ["data:image/png;base64,new"],
          turnIntentId: expect.any(String),
          deliveryStatus: "pending",
          queueMessageId: "queue-failed",
        }),
      }),
      "osagent-session-1"
    );
    expect(removeByIdPrefixSpy).not.toHaveBeenCalled();
    expect(storeSetSpy).toHaveBeenCalledWith(
      expect.objectContaining({ debugLabel: "forceSendMessageAtom" }),
      "queue-failed"
    );
    expect(submitUserIntentSpy).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "restores a queue-only failed retry before dispatch (projection write fails: %s)",
    async (writeFails) => {
      const original = {
        id: "queue-restored",
        turnIntentId: "original-intent",
        sessionId: "cliagent-restored-root",
        content: "original request",
        displayContent: "original request",
        imageDataUrls: ["data:image/png;base64,original"],
        priority: "next",
        status: "queued",
        requiresExplicitDispatch: true,
        deliveryError: "native history unavailable",
        conversationDispatch: {
          kind: "canonical_conversation",
          root: {
            authority: "local-session",
            authorityScope: [],
            conversationId: "cliagent-restored-root",
          },
          target: { cliAgentType: "claude_code", model: "claude-sonnet-5" },
        },
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      queuedDeliveries.current = [original];
      updateByIdSpy.mockResolvedValue(false);
      if (writeFails) {
        upsertSpy.mockRejectedValueOnce(new Error("projection write failed"));
      }
      const failed = {
        event: {
          // appendQueuedUserEvents synthesizes this read-side ID from the
          // durable intent; no queue-owned EventStore row exists after restart.
          id: "queued-user-original-intent",
          sessionId: original.sessionId,
          displayText: original.displayContent,
          displayStatus: "failed",
          result: {
            syntheticUserInput: true,
            deliveryStatus: "failed",
            queueMessageId: original.id,
            turnIntentId: original.turnIntentId,
          },
        },
        chunk_id: "queued-user-original-intent",
      } as unknown as OptimizedChatItem;

      await act(async () => {
        await editUserMessage?.(failed, original.displayContent);
      });

      const editCall = storeSetSpy.mock.calls.find(
        ([atom]) =>
          (atom as { debugLabel?: string }).debugLabel === "editMessageAtom"
      );
      const retryIntent = (editCall?.[1] as { turnIntentId: string })
        .turnIntentId;
      expect(retryIntent).not.toBe(original.turnIntentId);
      expect(upsertSpy).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          id: "queued-user:queue-restored:",
          sessionId: original.sessionId,
          displayText: original.displayContent,
          displayStatus: "pending",
          createdAt: original.createdAt,
          result: expect.objectContaining({
            images: original.imageDataUrls,
            queueMessageId: original.id,
            turnIntentId: retryIntent,
            deliveryStatus: "pending",
          }),
        }),
        original.sessionId
      );
      expect(flushMessageQueueSpy.mock.invocationCallOrder[0]).toBeLessThan(
        upsertSpy.mock.invocationCallOrder[0]!
      );
      const forced = storeSetSpy.mock.calls.filter(
        ([atom]) =>
          (atom as { debugLabel?: string }).debugLabel ===
          "forceSendMessageAtom"
      );
      if (writeFails) {
        expect(forced).toHaveLength(0);
        const restore = storeSetSpy.mock.calls.find(
          ([atom]) =>
            (atom as { debugLabel?: string }).debugLabel === "messageQueueAtom"
        );
        expect(
          (restore?.[1] as (rows: unknown[]) => unknown[])([
            { ...original, turnIntentId: retryIntent },
          ])
        ).toEqual([original]);
        expect(flushMessageQueueSpy).toHaveBeenCalledTimes(2);
      } else {
        expect(forced).toHaveLength(1);
        expect(forced[0]?.[1]).toBe(original.id);
        const forceIndex = storeSetSpy.mock.calls.indexOf(forced[0]!);
        expect(upsertSpy.mock.invocationCallOrder[0]).toBeLessThan(
          storeSetSpy.mock.invocationCallOrder[forceIndex]!
        );
      }
      expect(submitUserIntentSpy).not.toHaveBeenCalled();
      expect(removeByIdPrefixSpy).not.toHaveBeenCalled();
      expect(truncateBeforeIdSpy).not.toHaveBeenCalled();
    }
  );

  it("admits only one retry when a restored native-history failure is clicked twice", async () => {
    const queueStore = createStore();
    realQueueStore.current = queueStore;
    storeSetSpy.mockImplementation(
      (atom, update) =>
        queueStore.set(atom as Parameters<Store["set"]>[0], update) as boolean
    );
    const original: QueuedMessage = {
      id: "queue-double-click",
      turnIntentId: nativeFailureFixture.user.result.turnIntentId,
      sessionId: "cliagent-restored-root",
      content: nativeFailureFixture.user.result.message.content,
      displayContent: nativeFailureFixture.user.result.message.content,
      priority: "next",
      status: "queued",
      requiresExplicitDispatch: true,
      deliveryError: "previous preparation failed",
      createdAt: "2026-01-01T00:00:00.000Z",
      conversationDispatch: {
        kind: "canonical_conversation",
        root: {
          authority: "local-session",
          authorityScope: [],
          conversationId: "cliagent-restored-root",
        },
        target: { cliAgentType: "codex", model: "gpt-5.6-luna" },
      },
    };
    queueStore.set(messageQueueAtom, [original]);
    updateByIdSpy.mockResolvedValue(false);
    const nativeEcho: SessionEvent = {
      ...nativeFailureFixture.normalizedUser,
      chunk_id: null,
      sessionId: original.sessionId,
      source: "user",
      args: {},
      displayVariant: "message",
      activityStatus: "agent",
      displayText: original.displayContent,
      displayStatus: "completed",
      createdAt: original.createdAt,
    };
    expect(nativeEcho.result.backendPersisted).toBeUndefined();
    const [projectedFailure] = appendQueuedUserEvents(
      [nativeEcho],
      original.sessionId,
      queueStore.get(messageQueueAtom)
    );
    expect(projectedFailure?.displayStatus).toBe("failed");
    expect(queueStore.get(messageQueueAtom)).toEqual([original]);
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(submitUserIntentSpy).not.toHaveBeenCalled();
    const failed = {
      event: projectedFailure,
      chunk_id: projectedFailure?.id,
    } as unknown as OptimizedChatItem;

    await act(async () => {
      await Promise.all([
        editUserMessage?.(failed, original.displayContent),
        editUserMessage?.(failed, original.displayContent),
      ]);
    });

    const queue = queueStore.get(messageQueueAtom);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      id: original.id,
      content: original.content,
      conversationDispatch: original.conversationDispatch,
      priority: "now",
      requiresExplicitDispatch: false,
    });
    expect(queue[0]?.turnIntentId).not.toBe(original.turnIntentId);
    expect(queue[0]?.deliveryError).toBeUndefined();
    expect(upsertSpy).toHaveBeenCalledOnce();
    expect(
      storeSetSpy.mock.calls.filter(
        ([atom]) =>
          (atom as { debugLabel?: string }).debugLabel ===
          "forceSendMessageAtom"
      )
    ).toHaveLength(1);
    expect(flushMessageQueueSpy).toHaveBeenCalledOnce();
    expect(submitUserIntentSpy).not.toHaveBeenCalled();
    expect(removeByIdPrefixSpy).not.toHaveBeenCalled();
  });

  it("confirms appending a landed execution-tail row without rewinding or reusing its old identity", async () => {
    surfaceSessionId.current = "cliagent-root";
    storeSessionId.current = "cliagent-root";
    const canonicalRetry = vi.fn().mockResolvedValue(true);
    failedUserIntentRetryForTest = canonicalRetry;
    resolveDispatchForTest = () => ({
      action: "replace",
      dispatch: {
        kind: "canonical_conversation",
        root: {
          authority: "local-session",
          authorityScope: [],
          conversationId: "cliagent-root",
        },
        target: { cliAgentType: "claude_code", model: "claude-sonnet-5" },
      },
    });
    act(() =>
      root.render(
        createElement(Harness, {
          onReady: (fn: EditUserMessageFn) => {
            editUserMessage = fn;
          },
        })
      )
    );
    // The child ran this turn; Claude Code answered "API Error: 502" as an
    // agent row, so the queue row completed and the optimistic bubble was
    // replaced by the landed child user row re-stamped onto the root.
    const landed = {
      event: {
        id: "runlanded-child-user-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        source: "user",
        functionName: "user_message",
        uiCanonical: "",
        displayText: "run the failing tail again",
        displayStatus: "completed",
        sessionId: "cliagent-root",
        result: {
          deliveryStatus: "completed",
          turnIntentId: "turn-intent-landed",
        },
      },
      chunk_id: "runlanded-child-user-1",
    } as unknown as OptimizedChatItem;

    await act(async () => {
      await editUserMessage?.(landed, "run the failing tail again");
    });

    expect(canonicalRetry).toHaveBeenCalledOnce();
    expect(canonicalRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        displayText: "run the failing tail again",
        turnIntentId: expect.any(String),
      })
    );
    expect(askNativeDialogSpy).toHaveBeenCalledWith(
      "landedMessageEdit.body",
      expect.objectContaining({ okLabel: "landedMessageEdit.sendNew" })
    );
    expect(canonicalRetry.mock.calls[0]?.[0].turnIntentId).not.toBe(
      "turn-intent-landed"
    );
    expect(submitUserIntentSpy).not.toHaveBeenCalled();
    expect(invokeTauriSpy).not.toHaveBeenCalledWith(
      "cli_agent_truncate_after_chunk",
      expect.anything()
    );
    expect(evictSessionSpy).not.toHaveBeenCalled();
    expect(truncateBeforeIdSpy).not.toHaveBeenCalled();
    expect(checkSnapshotChangesSpy).not.toHaveBeenCalled();
    expect(removeByIdPrefixSpy).not.toHaveBeenCalled();
  });

  it("mints a fresh turn identity when a landed tail row is resent with edited text", async () => {
    surfaceSessionId.current = "cliagent-root";
    storeSessionId.current = "cliagent-root";
    const canonicalRetry = vi.fn().mockResolvedValue(true);
    failedUserIntentRetryForTest = canonicalRetry;
    act(() =>
      root.render(
        createElement(Harness, {
          onReady: (fn: EditUserMessageFn) => {
            editUserMessage = fn;
          },
        })
      )
    );
    const landed = {
      event: {
        id: "runlanded-child-user-3",
        createdAt: "2026-01-01T00:00:00.000Z",
        source: "user",
        displayText: "the original text",
        displayStatus: "completed",
        sessionId: "cliagent-root",
        result: {
          deliveryStatus: "completed",
          turnIntentId: "turn-intent-original",
        },
      },
      chunk_id: "runlanded-child-user-3",
    } as unknown as OptimizedChatItem;

    await act(async () => {
      await editUserMessage?.(landed, "different text now");
    });

    expect(canonicalRetry).toHaveBeenCalledOnce();
    const [payload] = canonicalRetry.mock.calls[0] as [
      { displayText: string; turnIntentId?: string },
    ];
    expect(payload.displayText).toBe("different text now");
    // An edited resend is a NEW submission: reusing the old identity would
    // collapse it into the turn it is meant to replace.
    expect(payload.turnIntentId).toEqual(expect.any(String));
    expect(payload.turnIntentId).not.toBe("turn-intent-original");
    expect(invokeTauriSpy).not.toHaveBeenCalledWith(
      "cli_agent_truncate_after_chunk",
      expect.anything()
    );
    expect(truncateBeforeIdSpy).not.toHaveBeenCalled();
  });

  it("falls back to the direct dispatcher for a landed tail row when the router declines", async () => {
    surfaceSessionId.current = "cliagent-root";
    storeSessionId.current = "cliagent-root";
    const canonicalRetry = vi.fn().mockResolvedValue(false);
    failedUserIntentRetryForTest = canonicalRetry;
    act(() =>
      root.render(
        createElement(Harness, {
          onReady: (fn: EditUserMessageFn) => {
            editUserMessage = fn;
          },
        })
      )
    );
    const landed = {
      event: {
        id: "runlanded-child-user-2",
        createdAt: "2026-01-01T00:00:00.000Z",
        source: "user",
        displayText: "try once more",
        displayStatus: "completed",
        result: { deliveryStatus: "completed" },
      },
      chunk_id: "runlanded-child-user-2",
    } as unknown as OptimizedChatItem;

    await act(async () => {
      await editUserMessage?.(landed, "try once more");
    });

    expect(canonicalRetry).toHaveBeenCalledOnce();
    expect(submitUserIntentSpy).toHaveBeenCalledOnce();
    expect(submitUserIntentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "cliagent-root",
        displayContent: "try once more",
        source: "dispatch",
      })
    );
    expect(invokeTauriSpy).not.toHaveBeenCalled();
    expect(evictSessionSpy).not.toHaveBeenCalled();
    expect(truncateBeforeIdSpy).not.toHaveBeenCalled();
  });

  it.each(["cancel", "dialog error", "surface switch", "unmount"])(
    "does not submit or mutate an older successful child turn after %s",
    async (outcome) => {
      const canonicalRetry = vi.fn().mockResolvedValue(true);
      failedUserIntentRetryForTest = canonicalRetry;
      const landed = {
        event: {
          id: "runlanded-old-success",
          source: "user",
          displayText: "earlier successful prompt",
          displayStatus: "completed",
          result: { turnIntentId: "old-success-identity" },
        },
        chunk_id: "runlanded-old-success",
      } as unknown as OptimizedChatItem;
      let resolveDialog!: (confirmed: boolean) => void;
      if (outcome === "cancel") {
        askNativeDialogSpy.mockResolvedValue(false);
      } else if (outcome === "dialog error") {
        askNativeDialogSpy.mockRejectedValue(new Error("dialog unavailable"));
      } else {
        askNativeDialogSpy.mockImplementation(
          () =>
            new Promise<boolean>((resolve) => {
              resolveDialog = resolve;
            })
        );
      }
      await act(async () => {
        const pending = editUserMessage?.(landed, "edited earlier prompt");
        if (outcome === "surface switch") {
          storeSessionId.current = "cliagent-other";
          resolveDialog(true);
        } else if (outcome === "unmount") {
          root.unmount();
          resolveDialog(true);
        }
        await pending;
      });
      expect(askNativeDialogSpy).toHaveBeenCalledOnce();
      expect(canonicalRetry).not.toHaveBeenCalled();
      expect(submitUserIntentSpy).not.toHaveBeenCalled();
      expect(invokeTauriSpy).not.toHaveBeenCalled();
      expect(truncateBeforeIdSpy).not.toHaveBeenCalled();
      expect(removeByIdPrefixSpy).not.toHaveBeenCalled();
      expect(evictSessionSpy).not.toHaveBeenCalled();
      expect(storeSetSpy).not.toHaveBeenCalled();
    }
  );

  it("cancels an outstanding landed edit when the mounted surface changes", async () => {
    surfaceSessionId.current = "cliagent-old-root";
    act(() =>
      root.render(
        createElement(Harness, {
          onReady: (fn: EditUserMessageFn) => {
            editUserMessage = fn;
          },
        })
      )
    );
    const canonicalRetry = vi.fn().mockResolvedValue(true);
    failedUserIntentRetryForTest = canonicalRetry;
    let resolveDialog!: (confirmed: boolean) => void;
    askNativeDialogSpy.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveDialog = resolve;
        })
    );
    const landed = {
      event: { id: "runlanded-old", displayText: "old text", source: "user" },
      chunk_id: "runlanded-old",
    } as unknown as OptimizedChatItem;
    let pending: Promise<void> | undefined;
    act(() => {
      pending = editUserMessage?.(landed, "new text");
    });
    surfaceSessionId.current = "cliagent-new-root";
    act(() =>
      root.render(
        createElement(Harness, {
          onReady: (fn: EditUserMessageFn) => {
            editUserMessage = fn;
          },
        })
      )
    );
    await act(async () => {
      resolveDialog(true);
      await pending;
    });
    expect(canonicalRetry).not.toHaveBeenCalled();
    expect(submitUserIntentSpy).not.toHaveBeenCalled();
    expect(invokeTauriSpy).not.toHaveBeenCalled();
  });

  it("reloads the rewound cli session after evicting it so the anchor is not left empty", async () => {
    surfaceSessionId.current = "cliagent-plain";
    storeSessionId.current = "cliagent-plain";
    act(() =>
      root.render(
        createElement(Harness, {
          onReady: (fn: EditUserMessageFn) => {
            editUserMessage = fn;
          },
        })
      )
    );

    await act(async () => {
      await editUserMessage?.(chatItem(), "edit an earlier native turn");
    });

    expect(invokeTauriSpy).toHaveBeenCalledWith(
      "cli_agent_truncate_after_chunk",
      expect.objectContaining({
        sessionId: "cliagent-plain",
        createdAt: "2026-01-01T00:00:00.000Z",
      })
    );
    expect(evictSessionSpy).toHaveBeenCalledWith("cliagent-plain");
    const evictOrder = evictSessionSpy.mock.invocationCallOrder[0] ?? 0;
    const reloadCallIndex = storeSetSpy.mock.calls.findIndex(
      ([atom]) =>
        (atom as { debugLabel?: string }).debugLabel ===
        "triggerSessionReloadAtom"
    );
    expect(reloadCallIndex).toBeGreaterThanOrEqual(0);
    expect(storeSetSpy.mock.calls[reloadCallIndex]?.[1]).toBe("cliagent-plain");
    const reloadOrder =
      storeSetSpy.mock.invocationCallOrder[reloadCallIndex] ?? 0;
    expect(reloadOrder).toBeGreaterThan(evictOrder);
    expect(submitUserIntentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "cliagent-plain",
        displayContent: "edit an earlier native turn",
      })
    );
  });

  it("retries against the mounted SideChat session instead of global active", async () => {
    surfaceSessionId.current = "osagent-side-chat";
    storeSessionId.current = "osagent-main-chat";
    act(() =>
      root.render(
        createElement(Harness, {
          onReady: (fn: EditUserMessageFn) => {
            editUserMessage = fn;
          },
        })
      )
    );
    const failed = {
      event: {
        id: "side-chat-failed",
        displayText: "retry in side chat",
        displayStatus: "failed",
        result: { syntheticUserInput: true, deliveryStatus: "failed" },
      },
      chunk_id: "side-chat-failed",
    } as unknown as OptimizedChatItem;

    await act(async () => {
      await editUserMessage?.(failed, "retry in side chat");
    });

    expect(submitUserIntentSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "osagent-side-chat" })
    );
    expect(removeByIdPrefixSpy).toHaveBeenCalledWith(
      "side-chat-failed",
      "osagent-side-chat"
    );
  });
});
