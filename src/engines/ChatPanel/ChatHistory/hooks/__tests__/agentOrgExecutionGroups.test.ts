import { describe, expect, it } from "vitest";

import { TurnSummarySchema } from "@src/api/tauri/rpc/schemas/sessionCore";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import type { OptimizedChatItem } from "../../chatItemPipeline/types";
import { projectChatHistory } from "../../projection/core";
import { projectChatGroups } from "../useChatGroupsProjection";

function entry(
  id: string,
  execution: string,
  inbox = false
): OptimizedChatItem {
  const event = {
    id,
    chunk_id: id,
    uiCanonical: inbox ? "user_message" : "agent_message",
    sessionId: "participant",
    createdAt: "2026-09-23T12:00:00.000Z",
    functionName: inbox ? "user_message" : "assistant_message",
    actionType: inbox ? "raw" : "assistant",
    args: {
      agentOrgExecution: {
        turnIntentId: execution,
        sourceKind: "member_messages",
        participantId: "coordinator",
        participantName: "Lead",
      },
      ...(inbox ? { agentOrgInboxTranscript: true } : {}),
    },
    result: inbox
      ? { turnIntentId: `stable-batch-${id}`, agentOrgInboxTranscript: true }
      : {},
    source: inbox ? "user" : "assistant",
    displayText: id,
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "agent",
  } as SessionEvent;
  return { chunk_id: id, type: "activity", event };
}

const options = {
  turnGrouping: { mode: "agent-org-member" as const },
  disableTurnCollapse: true,
};

describe("Org history follows formal execution identity", () => {
  it("retains execution identity through the production IPC response parser", () => {
    const execution = entry("input", "formal").event!.args.agentOrgExecution;
    const summary = TurnSummarySchema.parse({
      sessionId: "participant",
      turnId: "agent-org-execution-formal",
      turnIntentId: "formal",
      execution,
      startSequence: 1,
      endSequence: null,
      nextTurnId: null,
      startedAt: "2026-09-23T12:00:00Z",
      endedAt: null,
      durationMs: null,
      userEventIds: [],
      userPreview: "",
      eventCount: 1,
      bodyEventCount: 0,
      status: "pending",
      interrupted: false,
    });
    expect(summary.execution).toEqual(execution);
    expect(summary.turnIntentId).toBe("formal");
  });

  it("keeps two inbox batches and one user input in the same execution", () => {
    const user = entry("human", "one", true);
    user.event!.args = { ...user.event!.args, agentOrgInboxTranscript: false };
    user.event!.result = { turnIntentId: "one" };
    const projected = projectChatGroups(
      [
        user,
        entry("mail-a", "one", true),
        entry("mail-b", "one", true),
        entry("answer", "one"),
      ],
      options
    );
    expect(projected.groupMeta.map((meta) => meta.turnId)).toEqual([
      "agent-org-execution-one",
    ]);
    expect(projected.flatItems.map((item) => item.event?.id)).toEqual([
      "human",
      "mail-a",
      "mail-b",
      "answer",
    ]);
  });

  it("opens a real summary round without inventing a user message", () => {
    const projected = projectChatGroups(
      [
        entry("mail", "work", true),
        entry("answer", "work"),
        entry("summary", "report"),
      ],
      options
    );
    expect(projected.groupMeta.map((meta) => meta.turnId)).toEqual([
      "agent-org-execution-work",
      "agent-org-execution-report",
    ]);
    expect(projected.flatItems.map((item) => item.event?.id)).toEqual([
      "mail",
      "answer",
      "summary",
    ]);
  });

  it("routes late output to its original execution even at equal timestamps", () => {
    const projected = projectChatGroups(
      [
        entry("first", "one", true),
        entry("second", "two", true),
        entry("late", "one"),
        entry("answer", "two"),
      ],
      options
    );
    expect(projected.groupMeta.map((meta) => meta.turnId)).toEqual([
      "agent-org-execution-one",
      "agent-org-execution-two",
    ]);
    expect(projected.flatItems.map((item) => item.event?.id)).toEqual([
      "first",
      "late",
      "second",
      "answer",
    ]);
  });

  it("keeps an execution stopped before first output as a title without a fake message", () => {
    const marker = entry("agent-org-execution-report", "report").event!;
    Object.assign(marker, {
      source: "system",
      actionType: "agent_org_execution",
      functionName: "agent_org_execution",
      uiCanonical: "agent_org_execution",
      displayText: "",
    });
    const projected = projectChatHistory([marker], { groups: options }).groups!;
    expect(projected.groupMeta).toHaveLength(1);
    expect(projected.groupMeta[0].turnId).toBe("agent-org-execution-report");
    expect(projected.groupMeta[0].hasBody).toBe(false);
    expect(projected.flatItems).toEqual([]);
  });

  it("keeps unloaded input cards from pretending the full execution is loaded", () => {
    const input = entry("mail", "old", true);
    const placeholder = entry("placeholder", "old");
    placeholder.event!.functionName = "turn_placeholder";
    placeholder.event!.uiCanonical = "turn_placeholder";
    placeholder.event!.actionType = "turn_placeholder";
    placeholder.event!.result = {
      unloadedTurn: {
        turnId: "agent-org-execution-old",
        bodyEventCount: 8,
        eventCount: 8,
        durationMs: 10,
      },
    };
    const projected = projectChatGroups(
      [input, placeholder, entry("new", "new")],
      options
    );
    expect(projected.groupMeta[0].unloadedTurn?.turnId).toBe(
      "agent-org-execution-old"
    );
  });

  it("does not change ordinary conversation grouping", () => {
    const projected = projectChatGroups(
      [
        entry("mail", "one", true),
        entry("answer", "one"),
        entry("summary", "report"),
      ],
      { disableTurnCollapse: true }
    );
    expect(projected.groupMeta).toHaveLength(1);
    expect(projected.groupMeta[0].turnId).toBeNull();
  });
});
