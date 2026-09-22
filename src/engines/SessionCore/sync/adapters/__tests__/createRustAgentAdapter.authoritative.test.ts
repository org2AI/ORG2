import { beforeEach, describe, expect, it, vi } from "vitest";

import { projectNativeConversationItems } from "@src/engines/SessionCore/conversations/nativeConversationMaterializer";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import type { PersistedMessage } from "@src/engines/SessionCore/ingestion/agentMessageAdapters";

import { createRustAgentAdapter } from "../createRustAgentAdapter";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), usage: vi.fn() }));
vi.mock("@src/util/platform/tauri/init", () => ({ invokeTauri: mocks.invoke }));
vi.mock("@src/api/tauri/rpc", () => ({
  rpc: {
    sessionCore: {
      eventStore: {
        // The native merge command joins durable results without altering arguments.
        mergeToolResults: async ({ events }: { events: SessionEvent[] }) =>
          events
            .filter((event) => event.actionType !== "tool_result")
            .map((event) => {
              const result = events.find(
                (candidate) =>
                  candidate.actionType === "tool_result" &&
                  candidate.callId === event.callId
              );
              return result
                ? {
                    ...event,
                    result: result.result,
                    displayStatus: result.displayStatus,
                  }
                : event;
            }),
      },
    },
  },
}));
vi.mock("../rustAgent/toolUsageCache", () => ({
  loadUsageTelemetry: mocks.usage,
  applyToolUsageToEvents: (events: SessionEvent[]) => events,
  applyLlmUsageToEvents: (events: SessionEvent[]) => events,
}));

function row(
  id: string,
  role: string,
  overrides: Partial<PersistedMessage> = {}
): PersistedMessage {
  return {
    id,
    role,
    sessionId: "sdeagent-parent",
    content: "",
    toolName: null,
    toolCallId: null,
    toolInput: null,
    toolOutput: null,
    model: null,
    sequence: 1,
    createdAt: "2026-09-12T00:00:00Z",
    images: null,
    ...overrides,
  };
}

function adapterFor(args: Record<string, unknown>) {
  const rows = [
    row("user", "user", { content: "original user input" }),
    row("call", "tool_call", {
      toolName: "agent",
      toolCallId: "call-1",
      toolInput: JSON.stringify(args),
    }),
    row("result", "tool_result", {
      toolName: "agent",
      toolCallId: "call-1",
      toolOutput: "FAST_OK",
    }),
  ];
  return createRustAgentAdapter({
    category: "agent",
    features: {},
    loadMessages: async () => rows,
    cancel: async () => {},
    transformUserText: () => "display-only text",
  });
}

describe("Rust Agent authoritative history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue([
      { sessionId: "child", parentEventId: "call" },
    ]);
    mocks.usage.mockResolvedValue({
      toolUsageByCallId: new Map(),
      llmUsageByTurnId: new Map(),
    });
  });

  it("keeps display backfills out of canonical tool arguments across repeated reads", async () => {
    const args = {
      description: "Fast echo reply",
      model: "fast",
      prompt: "Reply FAST_OK",
    };
    const adapter = adapterFor(args);
    const signal = new AbortController().signal;
    const display = await adapter.loadHistory("sdeagent-parent", signal);
    expect(display.find((event) => event.id === "call")?.args).toEqual({
      ...args,
      subagentSessionId: "child",
      action: "delegate",
    });
    expect(display[0].displayText).toBe("display-only text");
    mocks.invoke.mockClear();
    mocks.usage.mockClear();

    for (let index = 0; index < 2; index++) {
      const events = await adapter.loadAuthoritativeHistory!(
        "sdeagent-parent",
        signal
      );
      expect(events[0].displayText).toBe("original user input");
      const items = projectNativeConversationItems(events);
      expect(items.find((item) => item.kind === "tool_call")).toMatchObject({
        arguments: JSON.stringify(args),
      });
      expect(items.find((item) => item.kind === "tool_result")).toMatchObject({
        output: "FAST_OK",
      });
    }
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.usage).not.toHaveBeenCalled();
  });

  it("preserves same-named arguments when they were actually persisted by the model", async () => {
    const args = {
      action: "inspect",
      subagentSessionId: "model-authored",
      model: "fast",
    };
    const events = await adapterFor(args).loadAuthoritativeHistory!(
      "sdeagent-parent",
      new AbortController().signal
    );
    expect(
      projectNativeConversationItems(events).find(
        (item) => item.kind === "tool_call"
      )
    ).toMatchObject({ arguments: JSON.stringify(args) });
  });

  it("projects the persisted compact summary and retained tail in effective-context order", async () => {
    const summary =
      "[Session Memory] Compacted 3 messages\n\nPersisted summary with continuation instructions";
    const rows = [
      row("old", "user", { sequence: 0, content: "superseded" }),
      row("older-boundary", "system", {
        sequence: 1,
        content: "old summary",
        compactFromSequence: 0,
      }),
      row("kept-user", "user", { sequence: 2, content: "retained user" }),
      row("kept-call", "tool_call", {
        sequence: 3,
        toolName: "read_file",
        toolCallId: "retained-call",
        toolInput: '{"path":"fixture.txt"}',
      }),
      row("kept-result", "tool_result", {
        sequence: 4,
        toolName: "read_file",
        toolCallId: "retained-call",
        toolOutput: "retained result",
        toolIsError: true,
      }),
      row("boundary", "system", {
        sequence: 5,
        content: summary,
        compactFromSequence: 2,
      }),
      row("after", "assistant", { sequence: 6, content: "after boundary" }),
    ];
    const before = structuredClone(rows);
    const adapter = createRustAgentAdapter({
      category: "agent",
      features: {},
      loadMessages: async () => rows,
      cancel: async () => {},
    });
    const signal = new AbortController().signal;
    for (let attempt = 0; attempt < 2; attempt++) {
      const events = await adapter.loadAuthoritativeHistory!(
        "sdeagent-parent",
        signal
      );
      expect(projectNativeConversationItems(events)).toMatchObject([
        { kind: "context_summary", summary },
        { kind: "message", role: "user", text: "retained user" },
        {
          kind: "tool_call",
          callId: "retained-call",
          arguments: '{"path":"fixture.txt"}',
        },
        {
          kind: "tool_result",
          callId: "retained-call",
          output: "retained result",
          isError: true,
        },
        { kind: "message", role: "assistant", text: "after boundary" },
      ]);
    }
    const display = await adapter.loadHistory("sdeagent-parent", signal);
    expect(display.some((event) => event.id === "old")).toBe(true);
    expect(display.find((event) => event.id === "boundary")?.functionName).toBe(
      "context_compacted"
    );
    expect(rows).toEqual(before);
  });

  it("honors a zero cutoff and a summary-only boundary without mutating history", async () => {
    for (const cutoff of [0, 3]) {
      const rows = [
        row("u", "user", { sequence: 0, content: "retained" }),
        row("b", "system", {
          sequence: 2,
          content: "summary",
          compactFromSequence: cutoff,
        }),
      ];
      const adapter = createRustAgentAdapter({
        category: "agent",
        features: {},
        loadMessages: async () => rows,
        cancel: async () => {},
      });
      const items = projectNativeConversationItems(
        await adapter.loadAuthoritativeHistory!(
          "sdeagent-parent",
          new AbortController().signal
        )
      );
      expect(
        items.map((item) =>
          item.kind === "message"
            ? item.text
            : item.kind === "context_summary"
              ? item.summary
              : item.kind
        )
      ).toEqual(cutoff === 0 ? ["summary", "retained"] : ["summary"]);
      expect(rows[1].role).toBe("system");
      expect(rows[1].compactFromSequence).toBe(cutoff);
    }
  });
});
