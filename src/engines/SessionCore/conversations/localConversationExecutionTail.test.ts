import { describe, expect, it } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { optimisticQueueUserEventId } from "@src/engines/SessionCore/services/userIntentDispatch";

import {
  mergeVerifiedLocalExecutionTimeline,
  projectVerifiedLocalExecutionTail,
  resolveLocalExecutionChildren,
  suppressLandedQueuedUserRows,
} from "./localConversationExecutionTail";

function event(
  id: string,
  createdAt: string,
  source: SessionEvent["source"],
  displayText: string
): SessionEvent {
  return {
    id,
    chunk_id: id,
    sessionId: "child-1",
    createdAt,
    functionName: source === "user" ? "user_message" : "assistant_message",
    uiCanonical: source === "user" ? "user" : "assistant_message",
    actionType: source === "user" ? "raw" : "assistant",
    args: {},
    result: {},
    source,
    displayText,
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "agent",
    payloadRefs: [],
  } as SessionEvent;
}

describe("local conversation execution tail", () => {
  it("resolves children with a known creation time in creation order", () => {
    const children = resolveLocalExecutionChildren(
      [
        { sessionId: "later" },
        { sessionId: "unknown-created" },
        { sessionId: "earlier" },
        { sessionId: "earlier" },
      ],
      new Map([
        ["later", "2026-09-04T06:10:00Z"],
        ["unknown-created", undefined],
        ["earlier", "2026-09-04T05:58:37Z"],
      ])
    );
    expect(children).toEqual([
      { session_id: "earlier", created_at: "2026-09-04T05:58:37Z" },
      { session_id: "later", created_at: "2026-09-04T06:10:00Z" },
    ]);
  });

  it("folds successive provider episodes into one runtime-switch timeline", () => {
    const rootEvents = [
      event("codex-u1", "2026-09-04T05:00:00Z", "user", "round one"),
      event("codex-a1", "2026-09-04T05:00:01Z", "assistant", "one"),
    ];
    // The same Claude UUID was resumed for rounds two and three, so its latest
    // native transcript contains both suffixes after the materialized Codex
    // prefix. Returning to Codex consumes this complete canonical timeline.
    const claudeEvents = [
      event("claude-copy-u1", "2026-09-04T05:01:00Z", "user", "round one"),
      event("claude-copy-a1", "2026-09-04T05:01:01Z", "assistant", "one"),
      event("claude-u2", "2026-09-04T05:02:00Z", "user", "round two"),
      event("claude-a2", "2026-09-04T05:02:01Z", "assistant", "two"),
      event("claude-u3", "2026-09-04T05:03:00Z", "user", "round three"),
      event("claude-a3", "2026-09-04T05:03:01Z", "assistant", "three"),
    ];
    const segments = [
      {
        child: {
          session_id: "claude-child",
          created_at: "2026-09-04T05:01:00Z",
        },
        events: claudeEvents,
      },
    ];
    expect(
      mergeVerifiedLocalExecutionTimeline(rootEvents, segments).map(
        (candidate) => candidate.displayText
      )
    ).toEqual(["round one", "one", "round two", "two", "round three", "three"]);
    expect(
      projectVerifiedLocalExecutionTail(rootEvents, segments, "codex-root").map(
        (candidate) => [candidate.sessionId, candidate.displayText]
      )
    ).toEqual([
      ["codex-root", "round two"],
      ["codex-root", "two"],
      ["codex-root", "round three"],
      ["codex-root", "three"],
    ]);

    // Once Codex is synchronized and resumed, the root itself contains the
    // Claude rounds plus the new Codex suffix. Replaying the older Claude
    // child must not append those rounds a second time.
    const returnedCodexEvents = [
      ...rootEvents,
      ...claudeEvents.slice(rootEvents.length),
      event("codex-u4", "2026-09-04T05:04:00Z", "user", "round four"),
      event("codex-a4", "2026-09-04T05:04:01Z", "assistant", "four"),
    ];
    expect(
      mergeVerifiedLocalExecutionTimeline(returnedCodexEvents, segments).map(
        (candidate) => candidate.displayText
      )
    ).toEqual([
      "round one",
      "one",
      "round two",
      "two",
      "round three",
      "three",
      "round four",
      "four",
    ]);
  });

  it("folds a provider-native compact marker after its verified history", () => {
    const rootEvents = [
      event("root-u1", "2026-09-04T05:00:00Z", "user", "old question"),
      event("root-a1", "2026-09-04T05:00:01Z", "assistant", "old answer"),
    ];
    const compact = {
      ...event(
        "compact-1",
        "2026-09-04T05:01:00Z",
        "assistant",
        "summary of the old exchange"
      ),
      functionName: "context_compacted",
      actionType: "context_compacted",
    } as SessionEvent;
    const childEvents = [
      event("copy-u1", "2026-09-04T05:00:00Z", "user", "old question"),
      event("copy-a1", "2026-09-04T05:00:01Z", "assistant", "old answer"),
      compact,
      event("child-u2", "2026-09-04T05:02:00Z", "user", "new question"),
      event("child-a2", "2026-09-04T05:02:01Z", "assistant", "new answer"),
    ];
    const merged = mergeVerifiedLocalExecutionTimeline(rootEvents, [
      {
        child: {
          session_id: "compacted-child",
          created_at: "2026-09-04T05:01:00Z",
        },
        events: childEvents,
      },
    ]);
    expect(merged.map((candidate) => candidate.id)).toEqual([
      "root-u1",
      "root-a1",
      "compact-1",
      "child-u2",
      "child-a2",
    ]);
  });

  it("folds a second native compact from the prior effective message list", () => {
    const firstCompact = {
      ...event(
        "compact-1",
        "2026-09-04T05:01:00Z",
        "assistant",
        "first summary"
      ),
      functionName: "context_compacted",
      actionType: "context_compacted",
    } as SessionEvent;
    const canonical = [
      event("old-u", "2026-09-04T05:00:00Z", "user", "old question"),
      event("old-a", "2026-09-04T05:00:01Z", "assistant", "old answer"),
      firstCompact,
      event("u2", "2026-09-04T05:02:00Z", "user", "after first"),
      event("a2", "2026-09-04T05:02:01Z", "assistant", "answer two"),
    ];
    const secondCompact = {
      ...event(
        "compact-2",
        "2026-09-04T05:03:01Z",
        "assistant",
        "second summary"
      ),
      functionName: "context_compacted",
      actionType: "context_compacted",
    } as SessionEvent;
    const childEvents = [
      { ...firstCompact, id: "copy-compact-1", chunk_id: "copy-compact-1" },
      event("copy-u2", "2026-09-04T05:02:00Z", "user", "after first"),
      event("copy-a2", "2026-09-04T05:02:01Z", "assistant", "answer two"),
      event("u3", "2026-09-04T05:03:00Z", "user", "trigger compact"),
      secondCompact,
      event("a3", "2026-09-04T05:03:02Z", "assistant", "answer three"),
    ];
    expect(
      mergeVerifiedLocalExecutionTimeline(canonical, [
        {
          child: {
            session_id: "second-compact-child",
            created_at: "2026-09-04T05:03:00Z",
          },
          events: childEvents,
        },
      ]).map((candidate) => candidate.id)
    ).toEqual([
      "old-u",
      "old-a",
      "compact-1",
      "u2",
      "a2",
      "u3",
      "compact-2",
      "a3",
    ]);
  });

  it("keeps an interrupted portable suffix but drops its unresolved tool call", () => {
    const rootEvents = [
      event("root-u1", "2026-09-04T05:00:00Z", "user", "inspect"),
      event("root-a1", "2026-09-04T05:00:01Z", "assistant", "starting"),
    ];
    const completedTool = {
      ...event(
        "tool-complete",
        "2026-09-04T05:01:01Z",
        "assistant",
        "file contents"
      ),
      functionName: "read_file",
      actionType: "tool_call",
      callId: "call_complete",
      args: { path: "README.md" },
      result: { status: "completed", output: "file contents" },
    } as SessionEvent;
    const unresolvedTool = {
      ...completedTool,
      id: "tool-open",
      chunk_id: "tool-open",
      callId: "call_open",
      displayStatus: "running",
      result: { status: "running" },
    } as SessionEvent;
    const childEvents = [
      event("copy-u1", "2026-09-04T05:00:00Z", "user", "inspect"),
      event("copy-a1", "2026-09-04T05:00:01Z", "assistant", "starting"),
      event("child-u2", "2026-09-04T05:01:00Z", "user", "continue"),
      completedTool,
      event(
        "child-partial",
        "2026-09-04T05:01:02Z",
        "assistant",
        "partial result"
      ),
      unresolvedTool,
    ];
    const merged = mergeVerifiedLocalExecutionTimeline(rootEvents, [
      {
        child: {
          session_id: "interrupted-child",
          created_at: "2026-09-04T05:01:00Z",
        },
        events: childEvents,
      },
    ]);
    expect(merged.map((candidate) => candidate.id)).toEqual([
      "root-u1",
      "root-a1",
      "child-u2",
      "tool-complete",
      "child-partial",
    ]);
  });

  it("drops the queue-synthesized pending row once the same user turn landed", () => {
    const pending = event(
      optimisticQueueUserEventId("intent-1"),
      "2026-09-04T05:58:37Z",
      "user",
      "Reply with exactly MARKER"
    );
    const otherPending = event(
      optimisticQueueUserEventId("intent-2"),
      "2026-09-04T05:59:00Z",
      "user",
      "another queued message"
    );
    const history = event("hist-1", "2026-08-31T10:34:04Z", "user", "old");
    const landedUser = event(
      "runlanded-user-1",
      "2026-09-04T05:58:44Z",
      "user",
      "Reply with exactly MARKER "
    );
    expect(pending.id).toBe("queued-user:intent-1:");
    expect(
      suppressLandedQueuedUserRows(
        [history, pending, otherPending],
        [landedUser]
      ).map((candidate) => candidate.id)
    ).toEqual(["hist-1", optimisticQueueUserEventId("intent-2")]);
    expect(suppressLandedQueuedUserRows([history, pending], [])).toHaveLength(
      2
    );
  });

  it("suppresses only one matching optimistic row for repeated prompt text", () => {
    const first = event(
      optimisticQueueUserEventId("repeat-1"),
      "2026-09-04T05:58:37Z",
      "user",
      "same prompt"
    );
    const second = event(
      optimisticQueueUserEventId("repeat-2"),
      "2026-09-04T05:59:00Z",
      "user",
      "same prompt"
    );
    const landed = event(
      "runlanded-repeat-2",
      "2026-09-04T05:59:01Z",
      "user",
      "same prompt"
    );
    expect(
      suppressLandedQueuedUserRows([first, second], [landed]).map(
        (candidate) => candidate.id
      )
    ).toEqual([first.id]);
  });
});
