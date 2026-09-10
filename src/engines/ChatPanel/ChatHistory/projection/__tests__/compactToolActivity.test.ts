import { describe, expect, it } from "vitest";

import { makeSessionEvent } from "@src/engines/SessionCore/rendering/props/__tests__/fixtures";
import { getToolClassifierRegistrySnapshot } from "@src/engines/SessionCore/rendering/registry/toolClassifierRegistry";

import { collectChatItemEventIds } from "../../hooks/chatSearchProjection";
import { projectChatHistory } from "../core";
import { CHAT_PROJECTION_PROTOCOL_VERSION } from "../protocol";
import { ChatProjectionRuntime } from "../runtime";

const tool = (id: string, canonical: string, extra = {}) =>
  makeSessionEvent({
    id,
    action_type: "tool_call",
    function: canonical,
    uiCanonical: canonical,
    args: { path: `${id}.ts`, command: "echo hello" },
    result: { success: true },
    ...extra,
  });
const message = (id: string, thinking = false) =>
  makeSessionEvent({
    id,
    action_type: thinking ? "thinking" : "assistant",
    function: thinking ? "thinking" : "agent_message",
    uiCanonical: thinking ? "thinking" : "agent_message",
    result: { content: id, message: id },
    displayText: id,
  });
const project = (events: ReturnType<typeof tool>[]) =>
  projectChatHistory(events, { collapseToolActivity: true });

describe("compact tool activity projection", () => {
  it("preserves messages and thinking as ordered boundaries, including trailing work", () => {
    const events = [
      message("a"),
      tool("r", "read_file"),
      tool("c", "run_shell"),
      message("b"),
      message("think1", true),
      tool("e", "edit_file"),
      message("think2", true),
      message("d"),
      tool("tail", "read_file"),
    ];
    const items = project(events).optimizedChatHistory;
    expect(
      items.map(
        (item) =>
          item.event?.id ??
          item.activityStackGroup?.events.map((event) => event.id)
      )
    ).toEqual(["a", ["r", "c"], "b", "think1", ["e"], "think2", "d", ["tail"]]);
    expect(items[1].activityStackGroup?.closedByBoundary).toBe(true);
    expect(items.at(-1)?.activityStackGroup?.closedByBoundary).toBe(false);
    expect(items.flatMap(collectChatItemEventIds)).toEqual(
      expect.arrayContaining(events.map((event) => event.id))
    );
  });

  it("preserves normal category stacks when disabled and never mutates events", () => {
    const events = [tool("r", "read_file"), tool("c", "run_shell")];
    const before = structuredClone(events);
    expect(projectChatHistory(events).optimizedChatHistory).toEqual(
      projectChatHistory(events, { collapseToolActivity: false })
        .optimizedChatHistory
    );
    expect(project(events).optimizedChatHistory).toHaveLength(1);
    expect(events).toEqual(before);
  });

  it("keeps row identity as an exploration group grows and completed results replace running calls", () => {
    const first = tool("r", "read_file", {
      callId: "read-call",
    });
    const key = project([first]).optimizedChatHistory[0].chunk_id;
    expect(
      project([first, tool("r2", "read_file")]).optimizedChatHistory[0].chunk_id
    ).toBe(key);
    expect(
      project([first, tool("done", "read_file", { callId: "read-call" })])
        .optimizedChatHistory[0].chunk_id
    ).toBe(key);
  });

  it.each([
    "thinking",
    "ask_user_questions",
    "ask_user_permissions",
    "plan_approval",
    "agent_message",
    "org_send_message",
  ])(
    "keeps %s outside a collapsed row even when represented as a tool",
    (canonical) => {
      const middle = tool("boundary", canonical, {
        displayText: "visible",
        result: { content: "visible", questions: [{ question: "Choose" }] },
      });
      const items = project([
        tool("r", "read_file"),
        middle,
        tool("c", "run_shell"),
      ]).optimizedChatHistory;
      expect(items.find((item) => item.event?.id === middle.id)).toBeDefined();
    }
  );

  it("retains failed tool details and bounds a 2000-action run to one virtual row", () => {
    const events = Array.from({ length: 2000 }, (_, index) =>
      tool(`r${index}`, "read_file", {
        result: { success: index !== 50, content: "data" },
      })
    );
    const items = project(events).optimizedChatHistory;
    expect(items).toHaveLength(1);
    expect(items[0].activityStackGroup?.events).toHaveLength(2000);
    expect(items[0].activityStackGroup?.events[50].result?.success).toBe(false);
  });

  it("keeps duplicate call IDs in separate runs inspectable with unique row keys", () => {
    const items = project([
      tool("first", "read_file", { callId: "same-call" }),
      message("thinking", true),
      tool("second", "read_file", {
        callId: "same-call",
      }),
    ]).optimizedChatHistory;
    expect(new Set(items.map((item) => item.chunk_id)).size).toBe(items.length);
    expect(items.flatMap(collectChatItemEventIds)).toEqual(
      expect.arrayContaining(["first", "second"])
    );
  });

  it("does not merge work across sessions or execution threads", () => {
    const items = project([
      tool("a", "read_file", { sessionId: "s1", threadId: "thread-a" }),
      tool("b", "run_shell", { sessionId: "s1", threadId: "thread-b" }),
      tool("c", "run_shell", { sessionId: "s2", threadId: "thread-b" }),
    ]).optimizedChatHistory.filter(
      (item) => item.activityStackGroup?.category === "work"
    );
    expect(
      items.map((item) =>
        item.activityStackGroup?.events.map((event) => event.id)
      )
    ).toEqual([["a"], ["b"], ["c"]]);
  });

  it("uses the same option and event membership in the worker runtime", () => {
    const events = [
      message("a"),
      tool("r", "read_file"),
      tool("c", "run_shell"),
      message("b"),
    ];
    const options = { collapseToolActivity: true };
    const response = new ChatProjectionRuntime().handle({
      type: "initSnapshot",
      protocolVersion: CHAT_PROJECTION_PROTOCOL_VERSION,
      sessionId: "test",
      generation: 1,
      sourceVersion: 1,
      requestId: 1,
      events,
      options,
      toolRegistry: getToolClassifierRegistrySnapshot(),
    });
    expect(response.type).toBe("projection");
    if (response.type === "projection")
      expect(response.result.optimizedChatHistory).toEqual(
        project(events).optimizedChatHistory
      );
  });
});
