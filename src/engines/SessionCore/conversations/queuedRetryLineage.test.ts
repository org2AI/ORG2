import { describe, expect, it } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { mergeVerifiedLocalExecutionTimeline } from "./localConversationExecutionTail";
import { projectNativeConversationItems } from "./nativeConversationProjection";
import {
  beginQueuedRetry,
  effectiveQueuedRetryEvents,
  recordEmptyFailedAttempt,
  retryLineageEvent,
  retryLineageForMessage,
  retryLineageOf,
} from "./queuedRetryLineage";

const message = {
  id: "queue-one",
  turnIntentId: "failed",
  content: "hello",
  displayContent: "hello",
};
const user = (id: string): SessionEvent => ({
  id,
  chunk_id: id,
  sessionId: "root",
  createdAt: "2026-09-18T00:00:00Z",
  source: "user",
  functionName: "user_message",
  actionType: "raw",
  uiCanonical: "user",
  args: {},
  result: { turnIntentId: id },
  displayText: "hello",
  displayVariant: "message",
  displayStatus: "completed",
  activityStatus: "agent",
});
const failed = user("failed");
const initial = () =>
  recordEmptyFailedAttempt(retryLineageForMessage([], message), message, [
    failed,
  ]);
const retried = () =>
  beginQueuedRetry(initial(), { ...message, turnIntentId: "retry" });

describe("explicit empty failed queue attempt lineage", () => {
  it("keeps a failure until the same queue explicitly retries; same text alone has no effect", () => {
    const marker = retryLineageEvent("root", initial());
    expect(
      effectiveQueuedRetryEvents([failed, user("independent"), marker])
    ).toHaveLength(3);
    expect(
      beginQueuedRetry(initial(), {
        ...message,
        id: "other",
        turnIntentId: "other",
      })
    ).toEqual(initial());
  });
  it("survives JSON persistence and queue retirement while preserving independent equal text", () => {
    const marker = JSON.parse(
      JSON.stringify(retryLineageEvent("root", retried()))
    ) as SessionEvent;
    expect(retryLineageOf(marker)?.superseded[0].turnIntentId).toBe("failed");
    const history = [failed, user("independent"), user("retry"), marker];
    expect(
      projectNativeConversationItems(history).map((item) =>
        item.kind === "message" ? item.turnId : ""
      )
    ).toEqual(["independent", "retry"]);
    expect(history).toHaveLength(4); // audit data is unchanged
  });
  it("preserves the old prompt when the user edits text or attachments", () => {
    for (const edit of [
      { content: "edited" },
      { imageDataUrls: ["data:image/png;base64,AA=="] },
    ]) {
      const lineage = beginQueuedRetry(initial(), {
        ...message,
        turnIntentId: "edited",
        ...edit,
      });
      expect(lineage.superseded).toEqual([]);
      expect(lineage.failed).toBeUndefined();
    }
  });
  it("never removes successful or partial assistant/tool rows", () => {
    const partial = {
      ...user("partial"),
      source: "assistant",
      actionType: "assistant",
      functionName: "assistant_message",
      result: { turnIntentId: "failed" },
    } as SessionEvent;
    expect(
      effectiveQueuedRetryEvents([
        failed,
        partial,
        retryLineageEvent("root", retried()),
      ])
    ).toContain(partial);
  });
  it("folds a rebuilt child against effective context without rewriting root audit history", () => {
    const marker = retryLineageEvent("root", retried());
    const stable = user("stable");
    const retry = user("retry");
    const merged = mergeVerifiedLocalExecutionTimeline(
      [stable, failed, marker],
      [
        {
          child: { session_id: "child", created_at: "2026-09-18T00:00:01Z" },
          events: [stable, retry],
        },
      ]
    );
    expect(merged).toContain(failed);
    expect(
      projectNativeConversationItems(merged).map((item) =>
        item.kind === "message" ? item.turnId : ""
      )
    ).toEqual(["stable", "retry"]);
  });
  it.each(["assistant_message", "thinking", "execute_tool"])(
    "rejects raw %s output even when the portable tail is empty",
    (functionName) => {
      const output = {
        ...user("output"),
        source: "assistant",
        functionName,
      } as SessionEvent;
      expect(() =>
        recordEmptyFailedAttempt(retryLineageForMessage([], message), message, [
          failed,
          output,
        ])
      ).toThrow("unresolved native output");
    }
  );
  it("does not mistake a system-sourced tool result for empty output", () => {
    const tool = {
      ...user("tool"),
      source: "system",
      functionName: "read_file",
      actionType: "tool_result",
    } as SessionEvent;
    expect(() =>
      recordEmptyFailedAttempt(retryLineageForMessage([], message), message, [
        failed,
        tool,
      ])
    ).toThrow("unresolved native output");
  });
  it("does not suppress another session's identical intent without source provenance", () => {
    const other = { ...failed, sessionId: "unrelated-root" };
    expect(
      effectiveQueuedRetryEvents([other, retryLineageEvent("root", retried())])
    ).toContain(other);
  });
  it("leaves legacy records without explicit provenance untouched", () => {
    expect(effectiveQueuedRetryEvents([failed, user("retry")])).toEqual([
      failed,
      user("retry"),
    ]);
    expect(
      retryLineageOf({
        ...retryLineageEvent("root", retried()),
        id: "wrong-queue",
      })
    ).toBeNull();
  });
});
