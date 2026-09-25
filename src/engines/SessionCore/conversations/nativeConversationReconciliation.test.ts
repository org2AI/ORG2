import { describe, expect, it } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { mergeInterruptedConversationProjection } from "./nativeConversationReconciliation";

function message(
  id: string,
  source: "user" | "assistant",
  intent: string
): SessionEvent {
  return {
    id,
    chunk_id: id,
    sessionId: "cliagent-test",
    createdAt: "2026-09-24T00:00:00Z",
    functionName: source === "user" ? "user_message" : "assistant",
    uiCanonical: source === "user" ? "user_message" : "agent_message",
    actionType: source === "user" ? "raw" : "assistant",
    source,
    args: {},
    result: {
      content: "same text",
      observation: "same text",
      turnIntentId: intent,
      message: { role: source, content: "same text" },
    },
    displayText: "same text",
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "agent",
    isDelta: false,
  } as SessionEvent;
}
function fixture() {
  const user = message("user-current", "user", "current");
  const aborted = {
    ...message("abort", "assistant", ""),
    source: "system",
    actionType: "task_failed",
    functionName: "task_failed",
    uiCanonical: "task_failed",
    displayVariant: "tool_call",
    result: {},
    displayText: "",
  } as SessionEvent;
  const native = [
    message("user-old", "user", "old"),
    message("answer-old", "assistant", "old"),
    user,
    aborted,
  ];
  const partial = message(
    "stream-msg-cliagent-test-1-final",
    "assistant",
    "current"
  );
  const sparse = [
    message("stream-msg-cliagent-test-0-final", "assistant", "old"),
    partial,
  ];
  return { native, sparse, user, aborted, partial };
}

describe("sparse native interrupted stream cache", () => {
  it("recovers the exact final turn without requiring cached user history", () => {
    const { native, sparse, partial } = fixture();
    const merged = mergeInterruptedConversationProjection(native, sparse);
    expect(merged).toEqual([...native, partial]);
    expect(mergeInterruptedConversationProjection(merged, sparse)).toEqual(
      merged
    );
  });
  it.each([
    "missing intent",
    "different intent",
    "duplicate anchor",
    "newer user",
    "native answer",
    "completed",
    "reset",
    "foreign session",
    "live placeholder",
    "not finalized",
  ])("rejects %s", (mode) => {
    const { native, sparse, user, partial } = fixture();
    if (mode === "missing intent") delete user.result.turnIntentId;
    if (mode === "different intent") user.result.turnIntentId = "different";
    if (mode === "duplicate anchor")
      native.unshift({ ...user, id: "duplicate" });
    if (mode === "newer user") native.push(message("new", "user", "new"));
    if (mode === "native answer")
      native.push(message("completed-answer", "assistant", "current"));
    if (mode === "completed")
      native[native.length - 1].actionType = "task_completed";
    if (mode === "reset") native.splice(0);
    if (mode === "foreign session") partial.sessionId = "other";
    if (mode === "live placeholder")
      partial.id = "stream-msg-ts-cliagent-test-1";
    if (mode === "not finalized") partial.isDelta = true;
    expect(mergeInterruptedConversationProjection(native, sparse)).toEqual(
      native
    );
  });
  it("does not duplicate persisted output rows", () => {
    const { native, sparse, partial } = fixture();
    expect(
      mergeInterruptedConversationProjection(native, [...sparse, partial])
    ).toEqual([...native, partial]);
  });
});
