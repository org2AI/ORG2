import { describe, expect, it } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { walkStaticImports } from "@src/test/staticImportGraph";

import { isEmailBubbleEvent } from "../emailBubbleEvent";

function minimalSessionEvent(
  overrides: Partial<SessionEvent> = {}
): SessionEvent {
  return {
    chunk_id: null,
    id: "evt-1",
    sessionId: "sess-1",
    createdAt: "2026-03-29T12:00:00.000Z",
    functionName: "assistant",
    uiCanonical: "",
    actionType: "tool_call",
    args: {},
    result: {},
    source: "assistant",
    displayText: "",
    displayStatus: "completed",
    displayVariant: "tool_call",
    activityStatus: "agent",
    ...overrides,
  };
}

describe("email bubble classification", () => {
  it.each(["org_send_message", "send_message", "send_to_inbox"])(
    "recognizes %s",
    (functionName) => {
      expect(isEmailBubbleEvent(minimalSessionEvent({ functionName }))).toBe(
        true
      );
    }
  );
  it("recognizes inbox transcripts from args and result without a tool name", () => {
    expect(
      isEmailBubbleEvent(
        minimalSessionEvent({ args: { agentOrgInboxTranscript: true } })
      )
    ).toBe(true);
    expect(
      isEmailBubbleEvent(
        minimalSessionEvent({ result: { agentOrgInboxTranscript: true } })
      )
    ).toBe(true);
    expect(
      isEmailBubbleEvent(
        minimalSessionEvent({ args: { agentOrgInboxTranscript: "true" } })
      )
    ).toBe(false);
    expect(isEmailBubbleEvent(minimalSessionEvent())).toBe(false);
  });
  it("classifies without loading React, the renderer, or tool registry", () => {
    const graph = walkStaticImports([
      "modules/WorkStation/Chat/Communication/emailBubbleEvent.ts",
    ]);
    expect(graph.files.size).toBe(1);
    expect(graph.packages.size).toBe(0);
  });
});
