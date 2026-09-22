/**
 * projectChatGroups — turn-collapse survivor tests.
 *
 * Focus: the structural collapse transform must keep terminal error cards
 * (quota exhausted / rate limited / stream retry budget exhausted) visible.
 * Regression coverage for the "quota error renders as blank space" bug
 * (2026-06-10): a collapsed turn whose tail was tool calls + error event
 * previously dropped the error and survived as a structural-only row.
 *
 * Exercises the pure projection used by the production chat pipeline.
 */
import { describe, expect, it } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { processChatItems } from "../../chatItemPipeline/pipeline";
import type { OptimizedChatItem } from "../../chatItemPipeline/types";
import {
  type ChatGroupMeta,
  isTurnCollapseEligible,
  isTurnPreviewItem,
  projectChatGroups,
  resolveTurnDefaultCollapsed,
} from "../useChatGroupsProjection";

let counter = 0;

it.each([false, true])(
  "uses native timing without rendering lifecycle rows (collapsed=%s)",
  (collapsed) => {
    const user = userItem("retry this request");
    user.event!.createdAt = "2026-09-08T04:59:09.964Z";
    const failure = cliErrorItem("database is locked");
    failure.event!.createdAt = "2026-09-08T04:59:12.170Z";
    const start = item(
      makeEvent({
        actionType: "task_start",
        functionName: "task_start",
        createdAt: "2026-09-08T06:09:11.351Z",
      })
    );
    const end = item(
      makeEvent({
        actionType: "task_completed",
        functionName: "task_completed",
        createdAt: "2026-09-08T06:09:14.496Z",
      })
    );
    const answer = assistantItem("recovered");
    answer.event!.createdAt = "2026-09-08T06:09:14.475Z";
    const projected = projectChatGroups([user, failure, start, answer, end], {
      tailTurnPhase: "complete",
      allTurnsCollapsed: collapsed,
    });
    expect(projected.groupMeta[0]).toMatchObject({
      startMs: Date.parse(start.event!.createdAt),
      endMs: Date.parse(end.event!.createdAt),
      durationMs: 3145,
    });
    expect(user.event!.createdAt).toBe("2026-09-08T04:59:09.964Z");
    expect(projected.flatItems.map((entry) => entry.event?.id)).not.toContain(
      start.event!.id
    );
    expect(projected.flatItems.map((entry) => entry.event?.id)).not.toContain(
      end.event!.id
    );
    expect(projected.flatItems.map((entry) => entry.event?.id)).toContain(
      failure.event!.id
    );
    expect(projected.flatItems.map((entry) => entry.event?.id)).toContain(
      answer.event!.id
    );
    expect(projected.flatItems.map((entry) => entry.event?.id)).toEqual([
      failure.event!.id,
      answer.event!.id,
    ]);
    expect(projected.originalToFlatIndex.size).toBe(5);
    for (const index of projected.originalToFlatIndex.values()) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(projected.totalFlatItems);
    }
  }
);

it.each([undefined, "invalid", "2026-09-08T03:00:00Z"])(
  "keeps legacy timing without a valid execution start (%s)",
  (timestamp) => {
    const user = userItem("request");
    user.event!.createdAt = "2026-09-08T04:00:00Z";
    const answer = assistantItem("answer");
    answer.event!.createdAt = "2026-09-08T04:00:05Z";
    const events = [user];
    if (timestamp !== undefined) {
      events.push(
        item(
          makeEvent({
            actionType: "task_start",
            createdAt: timestamp,
          })
        )
      );
    }
    events.push(answer);
    expect(projectChatGroups(events).groupMeta[0].durationMs).toBe(5000);
  }
);

function makeEvent(overrides: Partial<SessionEvent>): SessionEvent {
  counter++;
  return {
    id: `event-${counter}`,
    chunk_id: `event-${counter}`,
    sessionId: "session-test",
    createdAt: `2026-06-10T10:00:${String(counter).padStart(2, "0")}Z`,
    functionName: "read_file",
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
  } as SessionEvent;
}

function item(event: SessionEvent): OptimizedChatItem {
  return { chunk_id: event.id, type: "activity", event };
}

function userItem(text: string): OptimizedChatItem {
  return item(
    makeEvent({
      functionName: "user_message",
      actionType: "raw",
      source: "user",
      displayText: text,
      displayVariant: "message",
    })
  );
}

function agentOrgMemberTurnItem(text: string): OptimizedChatItem {
  const entry = userItem(text);
  entry.event!.args = { agentOrgInboxTranscript: true };
  entry.event!.result = { agentOrgInboxTranscript: true };
  return entry;
}

function toolItem(): OptimizedChatItem {
  return item(
    makeEvent({
      functionName: "run_shell",
      actionType: "tool_call",
      displayText: "run_shell",
    })
  );
}

function assistantItem(text: string): OptimizedChatItem {
  return item(
    makeEvent({
      functionName: "assistant_message",
      actionType: "assistant",
      displayText: text,
      displayVariant: "message",
      result: { content: text },
    })
  );
}

it("projects the provider-recorded model onto its user-message turn", () => {
  const assistant = assistantItem("Hello");
  assistant.event!.llmUsage = {
    inputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    model: "gpt-5.3-codex-high",
    attributionMethod: "provider_exact",
  };

  const projection = projectChatGroups([userItem("Hi"), assistant]);

  expect(projection.groupMeta[0]?.assistantModelId).toBe("gpt-5.3-codex-high");
});

function canonicalAgentMessageItem(text: string): OptimizedChatItem {
  return item(
    makeEvent({
      functionName: "assistant",
      uiCanonical: "agent_message",
      actionType: "raw_event",
      source: "assistant",
      displayText: text,
      displayVariant: "message",
      result: { content: text },
    })
  );
}

/** Shape stamped by Rust build_session_error_event / FE makeErrorEvent. */
function errorItem(message: string): OptimizedChatItem {
  return item(
    makeEvent({
      functionName: "system",
      actionType: "assistant",
      displayText: `Error: ${message}`,
      displayStatus: "failed",
      displayVariant: "message",
      result: { observation: `Error: ${message}` },
    })
  );
}

/** Shape emitted by normalized Codex CLI and native-transcript error chunks. */
function cliErrorItem(message: string): OptimizedChatItem {
  return item(
    makeEvent({
      functionName: "error",
      actionType: "error",
      displayText: message,
      displayStatus: "failed",
      displayVariant: "error",
      result: { error: message, success: false },
    })
  );
}

/** Shape stamped by persistedMessageToSessionEvent for a compact-boundary row. */
function boundaryItem(summary: string): OptimizedChatItem {
  return item(
    makeEvent({
      functionName: "context_compacted",
      uiCanonical: "context_compacted",
      actionType: "system",
      source: "system",
      displayText: summary,
      displayVariant: "message",
      result: { observation: summary, compactedCount: 6 },
    })
  );
}

function unloadedTurnItem(
  turnId: string,
  bodyEventCount: number
): OptimizedChatItem {
  return item(
    makeEvent({
      id: `turn-placeholder-${turnId}`,
      functionName: "turn_placeholder",
      uiCanonical: "turn_placeholder",
      actionType: "turn_placeholder",
      displayText: "Turn is not loaded yet",
      result: {
        unloadedTurn: {
          turnId,
          bodyEventCount,
          durationMs: 20_000,
        },
      },
    })
  );
}

function turnPreviewItem(text: string): OptimizedChatItem {
  const preview = canonicalAgentMessageItem(text);
  preview.event!.args = { turnPreviewOnly: true };
  return preview;
}

function unloadedTurnPreviewItem(
  turnId: string,
  bodyEventCount: number,
  text: string
): OptimizedChatItem {
  const preview = unloadedTurnItem(turnId, bodyEventCount);
  preview.event!.functionName = "assistant";
  preview.event!.actionType = "assistant";
  preview.event!.source = "assistant";
  preview.event!.displayText = text;
  preview.event!.displayVariant = "message";
  preview.event!.args = { turnPreviewOnly: true };
  preview.event!.result = {
    ...preview.event!.result,
    observation: text,
    content: text,
  };
  return preview;
}

function flatTexts(items: OptimizedChatItem[]): string[] {
  return items.map((entry) => entry.event?.displayText ?? "");
}

describe("projectChatGroups", () => {
  it("accepts custom turn callbacks as plain function inputs", () => {
    const boundary = boundaryItem("new logical turn");
    const history = [toolItem(), boundary, assistantItem("reply")];

    const result = projectChatGroups(history, {
      disableTurnCollapse: true,
      isTurnBoundaryItem: (entry) => entry === boundary,
    });

    expect(result.groupHeaders).toEqual([null, boundary]);
    expect(result.groupCounts).toEqual([1, 1]);
  });

  it("keeps each persisted Agent Org member execution as a separate round", () => {
    const firstTurn = agentOrgMemberTurnItem("first delegated task");
    const secondTurn = agentOrgMemberTurnItem("second delegated task");
    const history = [
      firstTurn,
      unloadedTurnItem(firstTurn.event!.id, 8),
      secondTurn,
      assistantItem("second task complete"),
    ];

    const result = projectChatGroups(history, {
      turnGrouping: { mode: "agent-org-member" },
    });

    expect(result.groupHeaders).toEqual([firstTurn, secondTurn]);
    expect(result.groupMeta).toHaveLength(2);
    expect(result.groupMeta[0].unloadedTurn?.turnId).toBe(firstTurn.event!.id);
    expect(result.groupMeta[1].unloadedTurn).toBeNull();
  });
});

describe("projectChatGroups collapse — terminal error survival", () => {
  it("collapses completed historical turns by default", () => {
    const history = [
      userItem("first turn"),
      toolItem(),
      assistantItem("first reply"),
      userItem("current turn"),
      toolItem(),
      assistantItem("current reply"),
    ];

    const result = projectChatGroups(history);

    // The prior turn defaults to the compact summary, while the live tail
    // remains expanded while its round is still running.
    expect(result.groupCounts).toEqual([1, 2]);
    expect(flatTexts(result.flatItems)).toEqual([
      "first reply",
      "run_shell",
      "current reply",
    ]);
  });

  it("keeps a canonical agent message outside a collapsed historical turn", () => {
    const history = [
      userItem("first turn"),
      toolItem(),
      canonicalAgentMessageItem("canonical final reply"),
      userItem("current turn"),
      assistantItem("current reply"),
    ];

    const result = projectChatGroups(history);

    expect(result.groupCounts).toEqual([1, 1]);
    expect(flatTexts(result.flatItems)).toEqual([
      "canonical final reply",
      "current reply",
    ]);
  });

  it("shows a final-reply preview while the historical turn body stays unloaded", () => {
    const firstTurn = userItem("first turn");
    const history = [
      firstTurn,
      turnPreviewItem("unloaded final reply"),
      unloadedTurnItem(firstTurn.event!.id, 12),
      userItem("current turn"),
      assistantItem("current reply"),
    ];

    const result = projectChatGroups(history);

    expect(result.groupMeta[0].unloadedTurn?.turnId).toBe(firstTurn.event!.id);
    expect(flatTexts(result.flatItems)).toContain("unloaded final reply");
    expect(flatTexts(result.flatItems)).not.toContain("Turn is not loaded yet");
  });

  it("shows a final-reply preview carried by the unloaded-turn placeholder", () => {
    const firstTurn = userItem("first turn");
    const preview = unloadedTurnPreviewItem(
      firstTurn.event!.id,
      12,
      "bounded final reply"
    );
    const history = [
      firstTurn,
      preview,
      userItem("current turn"),
      assistantItem("current reply"),
    ];

    const result = projectChatGroups(history);

    expect(isTurnPreviewItem(preview)).toBe(true);
    expect(result.groupMeta[0].unloadedTurn?.turnId).toBe(firstTurn.event!.id);
    expect(flatTexts(result.flatItems)).toContain("bounded final reply");
  });

  it("replaces a partial table preview with the complete response while the turn stays collapsed", () => {
    const firstTurn = userItem("first turn");
    const partialTable = "| Column |\n|---|\n| par…";
    const fullTable =
      "| Column |\n|---|\n| partial becomes complete |\n| final row |";
    const preview = unloadedTurnPreviewItem(
      firstTurn.event!.id,
      12,
      partialTable
    );
    const result = projectChatGroups([
      firstTurn,
      preview,
      toolItem(),
      assistantItem(fullTable),
      userItem("current turn"),
      assistantItem("current reply"),
    ]);

    expect(result.groupMeta[0].unloadedTurn).toBeNull();
    expect(result.groupCounts[0]).toBe(1);
    expect(flatTexts(result.flatItems)).toEqual([fullTable, "current reply"]);
  });

  it("keeps the error card when a collapsed turn has no completed assistant reply", () => {
    const history = [
      userItem("first turn"),
      toolItem(),
      toolItem(),
      errorItem("rate limit exceeded"),
      // Second turn makes turn 1 a non-tail, collapse-eligible group;
      // `allTurnsCollapsed` folds it (the collapse-all / pin-bar state).
      userItem("second turn"),
      assistantItem("second reply"),
    ];

    const result = projectChatGroups(history, { allTurnsCollapsed: true });

    const texts = flatTexts(result.flatItems);
    expect(texts).toContain("Error: rate limit exceeded");
    // Tool calls are dropped by the collapse.
    expect(texts.filter((text) => text === "run_shell")).toHaveLength(0);
    // No structural-only placeholder for turn 1 — the error IS the survivor.
    expect(result.flatItems.some((entry) => entry.structuralOnly)).toBe(false);
  });

  it("keeps a normalized CLI error when its historical turn is collapsed", () => {
    const history = [
      userItem("first turn"),
      toolItem(),
      cliErrorItem("unexpected status 402 Payment Required"),
      userItem("second turn"),
      assistantItem("second reply"),
    ];

    const result = projectChatGroups(history, { allTurnsCollapsed: true });

    expect(flatTexts(result.flatItems)).toContain(
      "unexpected status 402 Payment Required"
    );
  });

  it("keeps both the final reply and the trailing error in a collapsed turn", () => {
    const history = [
      userItem("first turn"),
      assistantItem("found the bug"),
      toolItem(),
      errorItem("credit balance too low"),
      userItem("second turn"),
      assistantItem("second reply"),
    ];

    const result = projectChatGroups(history, { allTurnsCollapsed: true });

    const texts = flatTexts(result.flatItems);
    expect(texts).toContain("found the bug");
    expect(texts).toContain("Error: credit balance too low");
    expect(result.groupCounts[0]).toBe(2);
  });

  it("keeps errors that precede the final reply", () => {
    const history = [
      userItem("first turn"),
      errorItem("transient blip"),
      assistantItem("recovered and finished"),
      userItem("second turn"),
      assistantItem("second reply"),
    ];

    const result = projectChatGroups(history, { allTurnsCollapsed: true });

    const texts = flatTexts(result.flatItems);
    expect(texts).toContain("Error: transient blip");
    expect(texts).toContain("recovered and finished");
    expect(result.groupCounts[0]).toBe(2);
  });

  it("collapses to the last reply only when the turn has no errors", () => {
    const history = [
      userItem("first turn"),
      toolItem(),
      assistantItem("all done"),
      userItem("second turn"),
      assistantItem("second reply"),
    ];

    const result = projectChatGroups(history, { allTurnsCollapsed: true });

    expect(result.groupCounts[0]).toBe(1);
    expect(flatTexts(result.flatItems)).toContain("all done");
  });

  it("maps dropped items to the surviving error's flat index", () => {
    const history = [
      userItem("first turn"), // orig 0 (header)
      toolItem(), // orig 1 (dropped)
      errorItem("quota gone"), // orig 2 (survivor, flat 0)
      userItem("second turn"), // orig 3 (header)
      assistantItem("second reply"), // orig 4 (flat 1)
    ];

    const result = projectChatGroups(history, { allTurnsCollapsed: true });

    expect(result.flatItems[0]?.event?.displayText).toBe("Error: quota gone");
    expect(result.originalToFlatIndex.get(1)).toBe(0);
    expect(result.originalToFlatIndex.get(2)).toBe(0);
    expect(result.totalFlatItems).toBe(2);
  });

  it("keeps the compact-boundary marker visible when a collapsed turn folds", () => {
    // A context-compaction boundary is appended as the trailing system row
    // of the round it followed. Collapsing that round must not drop it.
    const history = [
      userItem("first turn"),
      assistantItem("read the file"),
      toolItem(),
      assistantItem("final reply"),
      boundaryItem("earlier conversation summary"),
      userItem("second turn"),
      assistantItem("second reply"),
    ];

    // `allTurnsCollapsed` force-collapses every eligible (multi-item, non-tail)
    // turn, exactly the state a user reaches via collapse-all or the pin-bar.
    const result = projectChatGroups(history, { allTurnsCollapsed: true });

    const texts = flatTexts(result.flatItems);
    // The final assistant reply and the boundary both survive the collapse.
    expect(texts).toContain("final reply");
    expect(texts).toContain("earlier conversation summary");
    // Intermediate narration/tool calls are still folded away.
    expect(texts.filter((text) => text === "run_shell")).toHaveLength(0);
    expect(result.groupCounts[0]).toBe(2);
  });

  it("keeps a boundary-only collapsed turn (no completed reply) visible", () => {
    const history = [
      userItem("first turn"),
      toolItem(),
      boundaryItem("summary without a trailing reply"),
      userItem("second turn"),
      assistantItem("second reply"),
    ];

    const result = projectChatGroups(history, { allTurnsCollapsed: true });

    const texts = flatTexts(result.flatItems);
    expect(texts).toContain("summary without a trailing reply");
    expect(texts.filter((text) => text === "run_shell")).toHaveLength(0);
    expect(result.flatItems.some((entry) => entry.structuralOnly)).toBe(false);
  });

  it("keeps errors visible in expanded (non-collapsed) turns untouched", () => {
    const history = [
      userItem("first turn"),
      toolItem(),
      errorItem("rate limit exceeded"),
      userItem("second turn"),
      assistantItem("second reply"),
    ];

    const firstTurnId = history[0].event!.id;
    const result = projectChatGroups(history, {
      collapseOverrides: new Map([[firstTurnId, false]]),
    });

    const texts = flatTexts(result.flatItems);
    expect(texts).toContain("Error: rate limit exceeded");
    expect(texts.filter((text) => text === "run_shell")).toHaveLength(1);
  });
});

describe("isTurnCollapseEligible — unloaded placeholder affordance", () => {
  function meta(overrides: Partial<ChatGroupMeta>): ChatGroupMeta {
    const itemCount = overrides.itemCount ?? 0;
    return {
      turnId: "turn-1",
      durationMs: 0,
      itemCount,
      // Ungrouped rows weigh one event each; tests that need the two to
      // diverge pass `bodyEventCount` explicitly.
      bodyEventCount: itemCount,
      hasBody: true,
      previewText: "",
      startMs: null,
      endMs: null,
      unloadedTurn: null,
      ...overrides,
    };
  }

  it("shows the summary for even a single loaded event", () => {
    expect(isTurnCollapseEligible(meta({ itemCount: 1 }), 0, 3, {})).toBe(true);
    expect(isTurnCollapseEligible(meta({ itemCount: 2 }), 0, 3, {})).toBe(true);
  });

  it("measures the body in events, so one grouped row still collapses", () => {
    // A round of shell commands renders as a single TerminalActivityGroup
    // row. Counting rows called it trivial and withheld the bar.
    expect(
      isTurnCollapseEligible(
        meta({ itemCount: 1, bodyEventCount: 2 }),
        0,
        3,
        {}
      )
    ).toBe(true);
    // Single events get the same summary as grouped work.
    expect(
      isTurnCollapseEligible(
        meta({ itemCount: 1, bodyEventCount: 1 }),
        0,
        3,
        {}
      )
    ).toBe(true);
  });

  it("shows the bar for any unloaded turn with a nonzero body surrogate", () => {
    // With turn pagination off, the collapse bar is the ONLY affordance that
    // can fetch an unloaded body — a 1-line body must still render it.
    const unloaded = meta({
      unloadedTurn: { turnId: "turn-1", bodyEventCount: 1 },
    });
    expect(isTurnCollapseEligible(unloaded, 0, 3, {})).toBe(true);
  });

  it("hides the bar only for measured-empty unloaded turns", () => {
    const empty = meta({
      unloadedTurn: { turnId: "turn-1", bodyEventCount: 0 },
    });
    expect(isTurnCollapseEligible(empty, 0, 3, {})).toBe(false);
  });

  it("drops the bar from a historical round the agent never worked in", () => {
    // Lifecycle markers alone clear the event threshold.
    const bodyless = meta({ bodyEventCount: 2, hasBody: false });
    expect(isTurnCollapseEligible(bodyless, 0, 3, {})).toBe(false);
    expect(
      isTurnCollapseEligible(bodyless, 0, 3, { forceCollapseAllTurns: true })
    ).toBe(false);
    // The tail keeps the regular rules: its agent may not have started yet.
    expect(
      isTurnCollapseEligible(bodyless, 2, 3, { tailTurnPhase: "complete" })
    ).toBe(true);
  });

  it("shows the tail bar as soon as the round ends, with no wait or size threshold", () => {
    const smallTail = meta({ itemCount: 2 });
    // A running tail is never collapsible.
    expect(isTurnCollapseEligible(smallTail, 2, 3, {})).toBe(false);
    expect(
      isTurnCollapseEligible(smallTail, 2, 3, { tailTurnPhase: "running" })
    ).toBe(false);
    // A completed tail is eligible regardless of size.
    expect(
      isTurnCollapseEligible(smallTail, 2, 3, { tailTurnPhase: "complete" })
    ).toBe(true);
  });

  it("shows the bar for a single-event completed tail", () => {
    expect(
      isTurnCollapseEligible(meta({ itemCount: 1 }), 2, 3, {
        tailTurnPhase: "complete",
      })
    ).toBe(true);
  });

  it("shows the completed tail bar for a single grouped tool row", () => {
    expect(
      isTurnCollapseEligible(meta({ itemCount: 1, bodyEventCount: 2 }), 2, 3, {
        tailTurnPhase: "complete",
      })
    ).toBe(true);
  });

  it("resolves the shared default-collapse decision per phase", () => {
    // Non-tail turns default to collapsed.
    expect(resolveTurnDefaultCollapsed(false, {})).toBe(true);
    // A completed tail collapses immediately.
    expect(
      resolveTurnDefaultCollapsed(true, { tailTurnPhase: "complete" })
    ).toBe(true);
    expect(
      resolveTurnDefaultCollapsed(true, { tailTurnPhase: "running" })
    ).toBe(false);
    // An explicit expanded-by-default surface wins over everything.
    expect(
      resolveTurnDefaultCollapsed(true, {
        defaultTurnCollapsed: false,
        tailTurnPhase: "complete",
      })
    ).toBe(false);
  });
});

describe("projectChatGroups — rounds the agent never worked in", () => {
  function lifecycleItem(
    actionType: "task_start" | "task_completed"
  ): OptimizedChatItem {
    return item(makeEvent({ actionType, functionName: actionType }));
  }

  it.each([true, false])(
    "gives a lifecycle-only historical round no bar and no rows (default collapsed=%s)",
    (defaultTurnCollapsed) => {
      const history = [
        userItem("update the PR"),
        lifecycleItem("task_start"),
        lifecycleItem("task_completed"),
        userItem("fix the conflict"),
        toolItem(),
        assistantItem("resolved"),
      ];

      const result = projectChatGroups(history, {
        tailTurnPhase: "complete",
        defaultTurnCollapsed,
      });

      expect(result.groupMeta.map((meta) => meta.hasBody)).toEqual([
        false,
        true,
      ]);
      // The two markers used to clear the one-event threshold and paint an
      // "Agent worked for" bar over an empty round.
      expect(result.groupMeta[0].bodyEventCount).toBe(2);
      expect(
        isTurnCollapseEligible(result.groupMeta[0], 0, 2, {
          tailTurnPhase: "complete",
        })
      ).toBe(false);
      // Completed turns now default to collapsed, leaving only the final reply.
      expect(result.groupCounts).toEqual([0, defaultTurnCollapsed ? 1 : 2]);
    }
  );

  it("keeps the regular bar rules for a lifecycle-only tail round", () => {
    const history = [
      userItem("first"),
      toolItem(),
      assistantItem("done"),
      userItem("update the PR"),
      lifecycleItem("task_start"),
      lifecycleItem("task_completed"),
    ];

    const result = projectChatGroups(history, { tailTurnPhase: "complete" });

    expect(result.groupMeta[1].hasBody).toBe(false);
    expect(
      isTurnCollapseEligible(result.groupMeta[1], 1, 2, {
        tailTurnPhase: "complete",
      })
    ).toBe(true);
  });

  it("drops the placeholder row of an unloaded round measured as empty", () => {
    const empty = userItem("update the PR");
    const history = [
      empty,
      unloadedTurnItem(empty.event!.id, 0),
      userItem("fix the conflict"),
      assistantItem("resolved"),
    ];

    const result = projectChatGroups(history, { tailTurnPhase: "complete" });

    expect(result.groupMeta[0]).toMatchObject({
      hasBody: false,
      unloadedTurn: { bodyEventCount: 0 },
    });
    // A kept placeholder rendered as a blank row plus a full turn gap.
    expect(result.groupCounts).toEqual([0, 1]);
    expect(flatTexts(result.flatItems)).toEqual(["resolved"]);
  });

  it("keeps unloaded rounds with a body or a reply preview", () => {
    const measured = userItem("measured");
    const previewed = userItem("previewed");
    const history = [
      measured,
      unloadedTurnItem(measured.event!.id, 1),
      previewed,
      unloadedTurnPreviewItem(previewed.event!.id, 0, "final reply"),
      userItem("current"),
      assistantItem("done"),
    ];

    const result = projectChatGroups(history, { tailTurnPhase: "complete" });

    expect(result.groupMeta.map((meta) => meta.hasBody)).toEqual([
      true,
      true,
      true,
    ]);
    expect(
      isTurnCollapseEligible(result.groupMeta[0], 0, 3, {
        tailTurnPhase: "complete",
      })
    ).toBe(true);
  });
});

describe("projectChatGroups — completed tail turn", () => {
  function history(): OptimizedChatItem[] {
    return [
      userItem("first turn"),
      toolItem(),
      assistantItem("first reply"),
      userItem("current turn"),
      toolItem(),
      assistantItem("current reply"),
    ];
  }

  it("collapses the completed tail immediately and keeps its final reply", () => {
    const result = projectChatGroups(history(), { tailTurnPhase: "complete" });
    expect(result.groupCounts).toEqual([1, 1]);
    expect(flatTexts(result.flatItems)).toEqual([
      "first reply",
      "current reply",
    ]);
  });

  it("honors an explicit collapse override on the completed tail", () => {
    const items = history();
    const tailTurnId = items[3].event!.id;

    const result = projectChatGroups(items, {
      tailTurnPhase: "complete",
      collapseOverrides: new Map([[tailTurnId, true]]),
    });

    expect(result.groupCounts).toEqual([1, 1]);
    expect(flatTexts(result.flatItems)).toEqual([
      "first reply",
      "current reply",
    ]);
  });

  it("ignores a tail collapse override while the round is still running", () => {
    const items = history();
    const tailTurnId = items[3].event!.id;

    const result = projectChatGroups(items, {
      collapseOverrides: new Map([[tailTurnId, true]]),
    });

    // A running tail is not collapse-eligible at all.
    expect(result.groupCounts).toEqual([1, 2]);
  });

  it("honors an expanded-by-default surface", () => {
    const result = projectChatGroups(history(), {
      tailTurnPhase: "complete",
      defaultTurnCollapsed: false,
    });
    expect(result.groupCounts).toEqual([2, 2]);
  });

  it("lets an explicit expand override beat the completed default", () => {
    const items = history();
    const tailTurnId = items[3].event!.id;

    const result = projectChatGroups(items, {
      tailTurnPhase: "complete",
      collapseOverrides: new Map([[tailTurnId, false]]),
    });

    expect(result.groupCounts).toEqual([1, 2]);
    expect(flatTexts(result.flatItems)).toEqual([
      "first reply",
      "run_shell",
      "current reply",
    ]);
  });
});

/**
 * Regression: a round whose entire body is shell commands renders as ONE
 * TerminalActivityGroup row, so the row-count threshold in
 * `isTurnCollapseEligible` classified it as trivial and withheld the
 * "Agent worked for X" bar no matter how many commands it ran.
 */
describe("projectChatGroups — grouped tool rows carry their event weight", () => {
  function shellEvent(command: string): SessionEvent {
    return makeEvent({
      functionName: "run_shell",
      uiCanonical: "run_shell",
      actionType: "tool_call",
      args: { command },
      result: { success: true },
      displayText: command,
      displayVariant: "tool_call",
    });
  }

  function shellOnlyTurn(commandCount: number) {
    const events = [
      makeEvent({
        functionName: "user_message",
        uiCanonical: "",
        actionType: "raw",
        source: "user",
        displayText: "let's git pull first",
        displayVariant: "message",
      }),
      ...Array.from({ length: commandCount }, (_, index) =>
        shellEvent(`command-${index}`)
      ),
    ];
    return processChatItems(events).items;
  }

  it("folds consecutive shell commands into a single row", () => {
    const items = shellOnlyTurn(2);

    // Header + one grouped row: the shape the bug depends on.
    expect(items).toHaveLength(2);
    expect(items[1].type).toBe("activityStackGroup");
    expect(items[1].activityStackGroup?.events).toHaveLength(2);
  });

  it("reports the grouped row's events in the turn's body count", () => {
    const result = projectChatGroups(shellOnlyTurn(2));
    const [meta] = result.groupMeta;

    expect(meta.itemCount).toBe(1);
    expect(meta.bodyEventCount).toBe(2);
  });

  it("gives a completed shell-only tail turn its collapse bar", () => {
    const result = projectChatGroups(shellOnlyTurn(2), {
      tailTurnPhase: "complete",
    });

    expect(
      isTurnCollapseEligible(result.groupMeta[0], 0, result.groupMeta.length, {
        tailTurnPhase: "complete",
      })
    ).toBe(true);
  });

  it("gives a one-command completed turn its summary", () => {
    const result = projectChatGroups(shellOnlyTurn(1));

    expect(result.groupMeta[0].bodyEventCount).toBe(1);
    expect(
      isTurnCollapseEligible(result.groupMeta[0], 0, result.groupMeta.length, {
        tailTurnPhase: "complete",
      })
    ).toBe(true);
  });
});

it.each([true, false])(
  "places the complete image gallery after all text, collapsed=%s",
  (collapsed) => {
    const user = userItem("make images");
    user.event!.result = { images: ["/input.png"] };
    const first = toolItem();
    first.event!.result = { images: ["/first.png"] };
    const second = toolItem();
    second.event!.result = { images: ["/second.png", "/first.png"] };
    const answer = assistantItem("Final answer");
    const nextUser = userItem("Next turn");
    const projected = projectChatGroups(
      [
        user,
        first,
        assistantItem("Commentary"),
        second,
        answer,
        nextUser,
        assistantItem("Next answer"),
      ],
      { allTurnsCollapsed: collapsed, tailTurnPhase: "complete" }
    );
    const firstTurn = projected.flatItems.slice(0, projected.groupCounts[0]);
    expect(firstTurn.at(-1)?.event?.id).toBe(answer.event!.id);
    expect(firstTurn.at(-1)?.outputImages).toEqual([
      "/first.png",
      "/second.png",
    ]);
    expect(firstTurn.filter((item) => item.outputImages)).toHaveLength(1);
    expect(projected.flatItems.at(-1)?.outputImages).toBeUndefined();
  }
);

it("keeps an image-only turn visible after collapse", () => {
  const image = toolItem();
  image.event!.result = { images: ["/only.png"] };
  const projected = projectChatGroups([userItem("draw"), image], {
    tailTurnPhase: "complete",
    allTurnsCollapsed: true,
  });
  expect(projected.flatItems).toHaveLength(1);
  expect(projected.flatItems[0].outputImages).toEqual(["/only.png"]);
});

it("shows output references from an unloaded turn preview without its tool body", () => {
  const preview = assistantItem("Final answer");
  preview.event!.args = { turnPreviewOnly: true };
  preview.event!.result = {
    images: ["orgii-transcript-image:reference"],
    unloadedTurn: { turnId: "historical", bodyEventCount: 3 },
  };
  const projected = projectChatGroups(
    [userItem("draw"), preview, userItem("continue"), assistantItem("next")],
    { allTurnsCollapsed: true, tailTurnPhase: "complete" }
  );
  expect(
    projected.flatItems.slice(0, projected.groupCounts[0]).at(-1)?.outputImages
  ).toEqual(["orgii-transcript-image:reference"]);
});
