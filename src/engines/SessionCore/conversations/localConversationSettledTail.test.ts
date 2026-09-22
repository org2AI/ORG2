import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import terminalErrorFixture from "../../../../src-tauri/crates/orgtrack-core/src/sources/fixtures/codex_terminal_error.json";
import { loadSettledTail } from "./localConversationSettledTail";
import {
  nativeSourceEventId,
  projectNativeConversationItems,
} from "./nativeConversationMaterializer";
import { QueuedConversationRecoveryPendingError } from "./queuedConversationContract";
import {
  recordEmptyFailedAttempt,
  retryLineageForMessage,
} from "./queuedRetryLineage";

const mocks = vi.hoisted(() => ({ reconcile: vi.fn(), recover: vi.fn() }));
vi.mock("@src/engines/SessionCore/sync/nativeTranscriptReconcile", () => ({
  reconcileNativeTranscript: mocks.reconcile,
  recoverNativeTranscriptAfterMismatch: mocks.recover,
}));

const message = {
  id: "queue-1",
  turnIntentId: "failed-intent",
  content: "Recall the remembered marker. No tools.",
  displayContent: "Recall the remembered marker. No tools.",
};
function event(
  id: string,
  source: SessionEvent["source"],
  text: string,
  actionType = "raw"
): SessionEvent {
  return {
    id,
    chunk_id: id,
    sessionId: "runner",
    createdAt: "2026-09-18T15:15:55Z",
    functionName: source === "user" ? "user_message" : actionType,
    actionType,
    uiCanonical: "",
    args: {},
    result: {},
    source,
    displayText: text,
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "agent",
  } as SessionEvent;
}
const before = [
  event("old-user", "user", "Remember cedar-moon-926."),
  event("old-assistant", "assistant", "READY", "assistant"),
];
const nativePrompt = {
  ...event("codex-user-27", "user", message.content),
  result: { turnIntentId: message.turnIntentId },
};
// Exact normalized shape produced by Codex's real task_started → private
// correlated user message → task_complete(last_agent_message:null) rollout.
const start = event("codex-task-start", "system", "", "task_start");
const completed = event("codex-task-complete", "system", "", "task_completed");
const native = [...before, start, nativePrompt, completed];
// Rust's raw-rollout regression verifies these shared expected chunk fields.
const diagnostic = {
  ...event(
    "codex-error-2",
    "assistant",
    terminalErrorFixture.diagnostic.result.observation,
    "error"
  ),
  ...terminalErrorFixture.diagnostic,
} as SessionEvent;
const failed = {
  ...event("codex-task-failed", "assistant", "", "task_failed"),
  ...terminalErrorFixture.failedLifecycle,
} as SessionEvent;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.reconcile.mockResolvedValue(native);
  mocks.recover.mockResolvedValue(native);
});

describe("native settled tail lifecycle boundary", () => {
  it("settles the real task_complete.error shape as a visible receipt and proves the original queue failure", async () => {
    const raw = [...before, start, nativePrompt, diagnostic, failed];
    mocks.reconcile.mockResolvedValueOnce(raw);
    const settled = await loadSettledTail(
      "runner",
      before,
      message.turnIntentId,
      { text: message.content, images: [] },
      "failed"
    );
    expect(settled.agentTail).toEqual([]);
    expect(settled.events).toContain(diagnostic);
    expect(settled.events).toContain(failed);
    expect(projectNativeConversationItems(raw)).toEqual(
      projectNativeConversationItems([...before, nativePrompt])
    );
    expect(
      recordEmptyFailedAttempt(
        retryLineageForMessage([], message),
        message,
        settled.events
      ).failed?.turnIntentId
    ).toBe(message.turnIntentId);
  });

  it("does not rematerialize a legacy assistant echo of a typed receipt, without deleting audit rows", async () => {
    const oldReceipt = {
      ...diagnostic,
      id: "old-error",
      chunk_id: "old-error",
    };
    const echo = {
      ...event("old-echo", "assistant", oldReceipt.displayText, "assistant"),
      args: { __orgiiSourceEventId: nativeSourceEventId(oldReceipt) },
    };
    const oldHistory = [...before, oldReceipt];
    const raw = [...oldHistory, echo, start, nativePrompt, diagnostic, failed];
    mocks.reconcile.mockResolvedValueOnce(raw);
    const settled = await loadSettledTail(
      "runner",
      oldHistory,
      message.turnIntentId,
      { text: message.content, images: [] },
      "failed"
    );
    expect(settled.agentTail).toEqual([]);
    expect(settled.events).toContain(echo);
    expect(projectNativeConversationItems(raw)).toEqual(
      projectNativeConversationItems([...before, nativePrompt])
    );
    expect(
      recordEmptyFailedAttempt(
        retryLineageForMessage([], message),
        message,
        settled.events
      ).failed
    ).toBeDefined();
    // Without the authoritative receipt (for example another native child),
    // the echo is unknown content and must not be silently removed.
    expect(projectNativeConversationItems([echo])).toHaveLength(1);
    expect(raw).toHaveLength(8);
  });

  it.each(["missing", "other-turn", "other-session", "completed"])(
    "refuses raw empty-failure proof when the diagnostic's failed lifecycle is %s",
    async (kind) => {
      const closing =
        kind === "missing"
          ? []
          : [
              {
                ...failed,
                ...(kind === "other-turn"
                  ? { args: { providerTurnId: "another-turn" } }
                  : {}),
                ...(kind === "other-session"
                  ? { sessionId: "another-session" }
                  : {}),
                ...(kind === "completed"
                  ? {
                      actionType: "task_completed",
                      functionName: "task_completed",
                    }
                  : {}),
              },
            ];
      const raw = [...before, start, nativePrompt, diagnostic, ...closing];
      mocks.reconcile.mockResolvedValueOnce(raw);
      const settled = await loadSettledTail(
        "runner",
        before,
        message.turnIntentId,
        { text: message.content, images: [] },
        "failed"
      );
      expect(() =>
        recordEmptyFailedAttempt(
          retryLineageForMessage([], message),
          message,
          settled.events
        )
      ).toThrow("unresolved native output suffix");
    }
  );

  it.each([
    { actionType: "error", functionName: "error", callId: "tool-error" },
    { actionType: "thinking", functionName: "thinking" },
    { actionType: "tool_call", functionName: "error" },
    { actionType: "tool_result", functionName: "error" },
    { actionType: "assistant", functionName: "assistant" },
    { actionType: "error", functionName: "error", args: {} },
  ])(
    "keeps non-receipt output despite error text or borrowed metadata: %j",
    async (shape) => {
      const output = {
        ...diagnostic,
        ...shape,
        id: "real-output",
        chunk_id: "real-output",
      };
      const raw = [...before, start, nativePrompt, diagnostic, output, failed];
      mocks.reconcile.mockResolvedValueOnce(raw);
      const settled = await loadSettledTail(
        "runner",
        before,
        message.turnIntentId,
        { text: message.content, images: [] },
        "failed"
      );
      expect(settled.agentTail).toContain(output);
      expect(() =>
        recordEmptyFailedAttempt(
          retryLineageForMessage([], message),
          message,
          settled.events
        )
      ).toThrow("unresolved native output suffix");
    }
  );

  it.each([
    { actionType: "thinking", functionName: "thinking" },
    { actionType: "tool_call", functionName: "error", callId: "call-1" },
    { actionType: "assistant", functionName: "assistant", isDelta: true },
  ])(
    "does not exempt a non-message echo sharing the receipt source ID: %j",
    async (shape) => {
      const output = {
        ...event("opaque-output", "assistant", "", "assistant"),
        ...shape,
        args: { __orgiiSourceEventId: nativeSourceEventId(diagnostic) },
      };
      const raw = [...before, start, nativePrompt, diagnostic, output, failed];
      mocks.reconcile.mockResolvedValueOnce(raw);
      const settled = await loadSettledTail(
        "runner",
        before,
        message.turnIntentId,
        { text: message.content, images: [] },
        "failed"
      );
      expect(settled.agentTail).toContain(output);
      expect(() =>
        recordEmptyFailedAttempt(
          retryLineageForMessage([], message),
          message,
          raw
        )
      ).toThrow("unresolved native output suffix");
    }
  );

  it("preserves and refuses an orphan materialized error message", async () => {
    const orphanEcho = {
      ...event("orphan-echo", "assistant", diagnostic.displayText, "assistant"),
      args: { __orgiiSourceEventId: nativeSourceEventId(diagnostic) },
    };
    const raw = [...before, start, nativePrompt, orphanEcho, failed];
    mocks.reconcile.mockResolvedValueOnce(raw);
    const settled = await loadSettledTail(
      "runner",
      before,
      message.turnIntentId,
      { text: message.content, images: [] },
      "failed"
    );
    expect(settled.agentTail).toContain(orphanEcho);
    expect(projectNativeConversationItems([orphanEcho])).toHaveLength(1);
    expect(() =>
      recordEmptyFailedAttempt(
        retryLineageForMessage([], message),
        message,
        raw
      )
    ).toThrow("unresolved native output suffix");
  });
  it("refuses a matching failed diagnostic pair belonging to another session", () => {
    const raw = [
      ...before,
      start,
      nativePrompt,
      { ...diagnostic, sessionId: "foreign-session" },
      { ...failed, sessionId: "foreign-session" },
    ];
    expect(() =>
      recordEmptyFailedAttempt(
        retryLineageForMessage([], message),
        message,
        raw
      )
    ).toThrow("unresolved native output suffix");
  });

  it("excludes the exact diagnostic echo in the current suffix from context while retaining raw proof", async () => {
    const echo = {
      ...event(
        "receipt-echo",
        "assistant",
        diagnostic.displayText,
        "assistant"
      ),
      args: { __orgiiSourceEventId: nativeSourceEventId(diagnostic) },
    };
    const raw = [...before, start, nativePrompt, diagnostic, failed, echo];
    mocks.reconcile.mockResolvedValueOnce(raw);
    const settled = await loadSettledTail(
      "runner",
      before,
      message.turnIntentId,
      { text: message.content, images: [] },
      "failed"
    );
    expect(settled.agentTail).toEqual([]);
    expect(
      recordEmptyFailedAttempt(
        retryLineageForMessage([], message),
        message,
        raw
      ).failed
    ).toBeDefined();
    expect(settled.events).toContain(echo);
  });

  it.each(["failed", "cancelled", "completed"] as const)(
    "returns an empty %s provider tail while preserving native execution receipts",
    async (terminal) => {
      const result = await loadSettledTail(
        "runner",
        before,
        message.turnIntentId,
        { text: message.content, images: [] },
        terminal
      );
      expect(result).toEqual({ agentTail: [], events: native });
      expect(mocks.recover).not.toHaveBeenCalled();
      if (terminal === "failed") {
        expect(
          recordEmptyFailedAttempt(
            retryLineageForMessage([], message),
            message,
            result.events
          ).failed?.turnIntentId
        ).toBe(message.turnIntentId);
      }
    }
  );

  it("recognizes a lifecycle-only failure when the canonical and native prefixes have different event ids", async () => {
    const canonical = before.map((row) => ({
      ...row,
      id: `plane-${row.id}`,
      chunk_id: `plane-${row.id}`,
    }));
    await expect(
      loadSettledTail(
        "runner",
        canonical,
        message.turnIntentId,
        { text: message.content, images: [] },
        "failed"
      )
    ).resolves.toMatchObject({ agentTail: [] });
  });

  it.each([
    ["assistant", "assistant"],
    ["tool", "tool_call"],
    ["tool", "tool_result"],
    ["assistant", "thinking"],
    ["system", "error"],
  ] as const)(
    "retains real %s/%s output beside a terminal lifecycle marker",
    async (source, actionType) => {
      const output = event(
        "actual-output",
        source as SessionEvent["source"],
        "partial native output",
        actionType
      );
      const raw = [...before, start, nativePrompt, output, completed];
      mocks.reconcile.mockResolvedValueOnce(raw);
      const result = await loadSettledTail(
        "runner",
        before,
        message.turnIntentId,
        { text: message.content, images: [] },
        "failed"
      );
      expect(result.agentTail).toContain(output);
      expect(() =>
        recordEmptyFailedAttempt(
          retryLineageForMessage([], message),
          message,
          raw
        )
      ).toThrow("unresolved native output suffix");
    }
  );

  it.each([{}, { privateReasoning: "opaque provider reasoning" }])(
    "does not certify empty failure from visually hidden reasoning %j",
    async (result) => {
      const thinking = {
        ...event("hidden-reasoning", "assistant", "", "thinking"),
        result,
        displayVariant: "thinking",
      } as SessionEvent;
      const raw = [...before, start, nativePrompt, thinking, completed];
      mocks.reconcile.mockResolvedValueOnce(raw);
      const settled = await loadSettledTail(
        "runner",
        before,
        message.turnIntentId,
        { text: message.content, images: [] },
        "failed"
      );
      expect(settled.agentTail).toContain(thinking);
      expect(() =>
        recordEmptyFailedAttempt(
          retryLineageForMessage([], message),
          message,
          raw
        )
      ).toThrow("unresolved native output suffix");
    }
  );

  it("does not mistake a closing lifecycle for proof when native history diverged", async () => {
    const divergent = [
      event("different", "user", "different history"),
      nativePrompt,
      completed,
    ];
    mocks.reconcile.mockResolvedValueOnce(divergent);
    mocks.recover.mockResolvedValueOnce(divergent);
    await expect(
      loadSettledTail(
        "runner",
        before,
        message.turnIntentId,
        { text: message.content, images: [] },
        "failed"
      )
    ).rejects.toBeInstanceOf(QueuedConversationRecoveryPendingError);
  });

  it("does not certify a failed prompt when a later concurrent user exists", async () => {
    const raw = [...native, event("other-user", "user", "another turn")];
    mocks.reconcile.mockResolvedValueOnce(raw);
    const result = await loadSettledTail(
      "runner",
      before,
      message.turnIntentId,
      { text: message.content, images: [] },
      "failed"
    );
    expect(result.agentTail).toEqual([]);
    expect(() =>
      recordEmptyFailedAttempt(
        retryLineageForMessage([], message),
        message,
        result.events
      )
    ).toThrow("unresolved native output suffix");
  });
});
