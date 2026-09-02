import { describe, expect, it } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { conversationRunnerOverlaysEqual } from "./conversationRunnerOverlay";

function event(text: string): SessionEvent {
  return {
    id: "runlive-answer",
    chunk_id: "runlive-answer",
    sessionId: "root",
    createdAt: "2026-08-20T10:00:00Z",
    functionName: "assistant_message",
    uiCanonical: "assistant_message",
    actionType: "assistant",
    args: {},
    result: { observation: text },
    source: "assistant",
    displayText: text,
    displayStatus: "running",
    displayVariant: "message",
    activityStatus: "agent",
    payloadRefs: [],
  } as SessionEvent;
}

describe("conversation runner overlay stability", () => {
  it("reuses equal projections but publishes visible streaming changes", () => {
    const first = event("working");
    expect(
      conversationRunnerOverlaysEqual(
        [first],
        [{ ...first, args: first.args, result: first.result }]
      )
    ).toBe(true);
    expect(
      conversationRunnerOverlaysEqual(
        [first],
        [{ ...first, displayText: "new output" }]
      )
    ).toBe(false);
  });
});
