import { afterEach, describe, expect, it } from "vitest";

import {
  agentOrgExecution,
  groupOrgExecutions,
} from "@src/engines/ChatPanel/ChatHistory/agentOrgExecution";
import type { AgentOrgExecution } from "@src/engines/SessionCore/core/agentOrgHistory";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import {
  appendLiveAssistantEvent,
  resetChatEventsMemoCaches,
} from "../chatEvents";

function event(id: string, intent?: string): SessionEvent {
  return {
    id,
    sessionId: "worker",
    chunk_id: null,
    createdAt: "2026-09-24T00:00:00Z",
    source: "system",
    actionType: "agent_org_execution",
    functionName: "agent_org_execution",
    uiCanonical: "agent_org_execution",
    args: intent
      ? {
          agentOrgExecution: {
            turnIntentId: intent,
            participantId: "implementer",
            participantName: "Implementer",
            sourceKind: "task_dispatch",
          } satisfies AgentOrgExecution,
        }
      : {},
    result: {},
    displayText: "",
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "agent",
  };
}

function groups(events: SessionEvent[]) {
  return groupOrgExecutions(
    events.map((item) => ({ chunk_id: item.id, type: "activity", event: item }))
  );
}

afterEach(() => resetChatEventsMemoCaches("worker"));

describe("live assistant execution ownership", () => {
  it("keeps the first token and subsequent token frames in the formal execution", () => {
    const anchor = event("start", "formal");
    for (const text of ["\u200b", "hello", "hello again"]) {
      const live = appendLiveAssistantEvent([anchor], "worker", text);
      expect(agentOrgExecution(live.at(-1))?.turnIntentId).toBe("formal");
      expect(
        groups(live).map((group) => group.execution?.turnIntentId)
      ).toEqual(["formal"]);
      expect(anchor.args).not.toHaveProperty("syntheticLive");
    }
  });

  it("uses the execution-start order when older output arrives after a retry starts", () => {
    const old = event("old-start", "old");
    const current = event("new-start", "new");
    const lateOutput = {
      ...event("late-old-output", "old"),
      source: "assistant" as const,
      actionType: "tool_call",
    };
    const input = [old, current, lateOutput];
    const live = appendLiveAssistantEvent(input, "worker", "new response");
    expect(agentOrgExecution(live.at(-1))?.turnIntentId).toBe("new");
    expect(groups(live).map((group) => group.execution?.turnIntentId)).toEqual([
      "old",
      "new",
    ]);
    const completed = { ...live.at(-1)!, id: "saved-answer", isDelta: false };
    const reloaded = appendLiveAssistantEvent(
      [...input, completed],
      "worker",
      null
    );
    expect(
      groups(reloaded).map((group) => group.execution?.turnIntentId)
    ).toEqual(["old", "new"]);
  });

  it("retains ownership when a formal execution body is represented by a page placeholder", () => {
    const placeholder = {
      ...event("unloaded", "formal"),
      actionType: "turn_placeholder",
      result: { unloadedTurn: { turnId: "agent-org-execution-formal" } },
    };
    const live = appendLiveAssistantEvent([placeholder], "worker", "reply");
    expect(agentOrgExecution(live.at(-1))?.turnIntentId).toBe("formal");
  });

  it("does not infer ownership from an output row, another session or malformed latest start", () => {
    const old = event("old", "old");
    const missing = event("missing");
    const foreign = { ...event("foreign", "foreign"), sessionId: "other" };
    const output = { ...event("output", "old"), actionType: "tool_call" };
    for (const input of [[], [foreign], [output], [old, missing]]) {
      const live = appendLiveAssistantEvent(input, "worker", "ordinary reply");
      expect(agentOrgExecution(live.at(-1))).toBeNull();
      expect(live.at(-1)?.args).toEqual({ syntheticLive: true });
    }
  });
});
