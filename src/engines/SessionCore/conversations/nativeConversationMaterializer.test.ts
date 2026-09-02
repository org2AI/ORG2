import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import {
  MAX_PORTABLE_TOOL_CALL_ID_LENGTH,
  NATIVE_SOURCE_EVENT_ID_ARG,
  assertNativeConversationPayloadWithinBounds,
  materializeNativeConversation,
  mergeInterruptedConversationProjection,
  nativeConversationItemsArePrefix,
  nativeConversationItemsEqual,
  projectNativeConversation,
  projectNativeConversationItems,
  supportsNativeConversationTarget,
  synchronizeNativeConversation,
} from "./nativeConversationMaterializer";

const mocks = vi.hoisted(() => ({
  invokeTauri: vi.fn(),
  loadEvents: vi.fn(),
}));

vi.mock("@src/util/platform/tauri/init", () => ({
  invokeTauri: mocks.invokeTauri,
}));
vi.mock("@src/engines/SessionCore/sync/authoritativeSessionEvents", () => ({
  loadAuthoritativeSessionEvents: mocks.loadEvents,
}));

function message(
  id: string,
  source: "user" | "assistant",
  text: string
): SessionEvent {
  return {
    id,
    chunk_id: id,
    sessionId: "source",
    createdAt: "2026-08-26T00:00:00.000Z",
    functionName: source === "user" ? "user_message" : "assistant_message",
    uiCanonical: source === "user" ? "user_message" : "agent_message",
    actionType: "raw",
    args: {},
    result: { message: { role: source, content: text }, content: text },
    source,
    displayText: text,
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "agent",
    payloadRefs: [],
  } as SessionEvent;
}

function tool(): SessionEvent {
  return {
    id: "tool-1",
    chunk_id: "tool-1",
    sessionId: "source",
    createdAt: "2026-08-26T00:00:01.000Z",
    functionName: "read_file",
    uiCanonical: "tool_call",
    actionType: "tool_call",
    callId: "call-1",
    args: {
      path: "/repo/README.md",
      nested: { second: 2, first: 1 },
      conversationTurnId: "internal-turn",
      conversationSender: { displayName: "Ada" },
      __orgiiPrivate: true,
    },
    result: {},
    source: "assistant",
    displayText: "",
    displayStatus: "completed",
    displayVariant: "tool_call",
    activityStatus: "agent",
    payloadRefs: [],
  } as SessionEvent;
}

function lifecycle(actionType: "task_start" | "task_completed"): SessionEvent {
  return {
    ...tool(),
    id: `imported-session-c716811f02b60f8b4671537ff7f85579~codex-lifecycle-154-${actionType}`,
    chunk_id: `lifecycle-${actionType}`,
    actionType,
    callId: undefined,
    functionName: actionType,
    displayVariant: "tool_call",
  } as SessionEvent;
}

function compactMarker(id = "compact-1"): SessionEvent {
  return {
    ...message(id, "assistant", "provider summary"),
    functionName: "context_compacted",
    uiCanonical: "context_compacted",
    actionType: "context_compacted",
    source: "system",
    result: {
      header: "Context compacted",
      observation: "provider summary",
      native: true,
    },
  } as SessionEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("native conversation materialization", () => {
  it("carries canonical event and turn identity through a rendered projection", () => {
    const user = message("convplane-row-1", "user", "continue");
    user.args = {
      [NATIVE_SOURCE_EVENT_ID_ARG]: "source-user-1",
      conversationTurnId: "turn-1",
    };
    const assistant = message("convplane-row-2", "assistant", "done");
    assistant.args = {
      [NATIVE_SOURCE_EVENT_ID_ARG]: "source-assistant-1",
    };

    expect(projectNativeConversationItems([user, assistant])).toEqual([
      expect.objectContaining({
        id: "source-user-1",
        role: "user",
        turnId: "turn-1",
      }),
      expect.objectContaining({
        id: "source-assistant-1",
        role: "assistant",
      }),
    ]);
  });

  it("projects roles and paired tools without rendering history into a prompt", () => {
    const items = projectNativeConversationItems([
      message("u1", "user", "inspect it"),
      tool(),
      message("a1", "assistant", "done"),
    ]);

    expect(items).toEqual([
      expect.objectContaining({
        kind: "message",
        role: "user",
        text: "inspect it",
      }),
      expect.objectContaining({
        kind: "tool_call",
        callId: "call-1",
        name: "read_file",
      }),
      expect.objectContaining({
        kind: "tool_result",
        callId: "call-1",
        output: "",
        isError: false,
        interrupted: false,
      }),
      expect.objectContaining({
        kind: "message",
        role: "assistant",
        text: "done",
      }),
    ]);
    const args = JSON.parse(
      (items[1] as Extract<(typeof items)[number], { kind: "tool_call" }>)
        .arguments
    );
    expect(args).toEqual({
      path: "/repo/README.md",
      nested: { second: 2, first: 1 },
    });
  });

  it("keeps native user text clean and reports unsupported authorship metadata", () => {
    const user = message("u1", "user", "looks good");
    user.args = {
      conversationSender: { userId: "user-1", displayName: "Alice" },
    };

    expect(projectNativeConversation([user])).toEqual({
      items: [expect.objectContaining({ text: "looks good" })],
      fidelity: {
        level: "lossy",
        omitted: ["participant_authorship"],
      },
    });
  });

  it("rejects oversized native payloads before crossing the Tauri boundary", () => {
    const items = projectNativeConversationItems([
      message("u1", "user", "a payload that exceeds a tiny test bound"),
    ]);
    expect(() =>
      assertNativeConversationPayloadWithinBounds(items, { maxBytes: 16 })
    ).toThrow("native transcript is");
  });

  it("keeps pending and failed human messages visible without executing them", () => {
    const pending = message("pending", "user", "not accepted yet");
    pending.displayStatus = "pending";
    pending.result = { ...pending.result, deliveryStatus: "pending" };
    const failed = message("failed", "user", "retry this later");
    failed.displayStatus = "failed";
    failed.result = { ...failed.result, deliveryStatus: "failed" };
    const sent = message("sent", "user", "accepted message");
    sent.result = { ...sent.result, deliveryStatus: "sent" };

    expect(projectNativeConversationItems([pending, failed, sent])).toEqual([
      expect.objectContaining({ id: "sent", text: "accepted message" }),
    ]);
  });

  it("keeps the safe partial prefix of an interrupted turn", () => {
    const completed = tool();
    completed.id = "tool-completed";
    completed.chunk_id = "tool-completed";
    completed.callId = "call-completed";
    const interrupted = tool();
    interrupted.id = "tool-interrupted";
    interrupted.chunk_id = "tool-interrupted";
    interrupted.callId = "call-interrupted";
    interrupted.displayStatus = "pending";

    const events = [
      message("u1", "user", "inspect the repo"),
      message("a-partial", "assistant", "I found the entrypoint."),
      completed,
      interrupted,
      lifecycle("task_completed"),
    ];
    const items = projectNativeConversationItems(events);

    expect(items.map((item) => item.id)).toEqual([
      "u1",
      "a-partial",
      "tool-completed:call",
      "tool-completed:result",
    ]);
  });

  it("extends an older readable native fork with a durable interrupted suffix", () => {
    const native = [
      message("native-u1", "user", "first"),
      message("native-a1", "assistant", "done"),
    ];
    const completed = tool();
    const interrupted = tool();
    interrupted.id = "pending-tool";
    interrupted.chunk_id = "pending-tool";
    interrupted.callId = "pending-call";
    interrupted.displayStatus = "pending";
    const projected = [
      message("projected-u1", "user", "first"),
      message("projected-a1", "assistant", "done"),
      message("interrupted-user", "user", "second"),
      message("interrupted-partial", "assistant", "partial finding"),
      completed,
      interrupted,
    ];

    const merged = mergeInterruptedConversationProjection(native, projected);
    expect(merged.map((event) => event.id)).toEqual([
      "native-u1",
      "native-a1",
      "interrupted-user",
      "interrupted-partial",
      "tool-1",
    ]);
  });

  it("preserves message ids that happen to end in a tool suffix", () => {
    const native = [message("native-u1", "user", "first")];
    const projected = [
      message("projected-u1", "user", "first"),
      message("human:call", "user", "second"),
      message("answer:result", "assistant", "partial answer"),
    ];

    expect(
      mergeInterruptedConversationProjection(native, projected).map(
        (event) => event.id
      )
    ).toEqual(["native-u1", "human:call", "answer:result"]);
  });

  it("fails closed when the projected history diverged from native truth", () => {
    const native = [message("native-u1", "user", "first")];
    const projected = [message("projected-u1", "user", "rewritten")];
    expect(mergeInterruptedConversationProjection(native, projected)).toEqual(
      native
    );
  });

  it("does not promote production-shaped lifecycle rows into provider tools", () => {
    const items = projectNativeConversationItems([
      message("u1", "user", "inspect it"),
      lifecycle("task_start"),
      lifecycle("task_completed"),
      message("a1", "assistant", "done"),
    ]);

    expect(items.map((item) => item.kind)).toEqual(["message", "message"]);
  });

  it("collapses the Rust acceptance row into its persisted user message", () => {
    const accepted = message("turn-message-id", "user", "one prompt");
    accepted.functionName = "user_input";
    accepted.uiCanonical = "user_input";
    const persisted = message(
      "user-message-turn-message-id",
      "user",
      "one prompt"
    );
    persisted.result = {
      ...persisted.result,
      messageId: "turn-message-id",
      backendPersisted: true,
    };

    expect(projectNativeConversationItems([accepted, persisted])).toEqual([
      expect.objectContaining({
        id: "user-message-turn-message-id",
        kind: "message",
        role: "user",
        text: "one prompt",
      }),
    ]);
    expect(projectNativeConversationItems([accepted])).toHaveLength(1);
  });

  it("keeps tool pairing stable inside the strict provider call-id envelope", () => {
    const event = tool();
    event.callId = `call-${"x".repeat(96)}`;

    const first = projectNativeConversationItems([event]);
    const second = projectNativeConversationItems([structuredClone(event)]);
    const call = first[0];
    const result = first[1];

    expect(call?.kind).toBe("tool_call");
    expect(result?.kind).toBe("tool_result");
    if (call?.kind !== "tool_call" || result?.kind !== "tool_result") return;
    expect(call.callId).toBe(result.callId);
    expect(call.callId.length).toBeLessThanOrEqual(
      MAX_PORTABLE_TOOL_CALL_ID_LENGTH
    );
    expect(second).toEqual(first);
  });

  it("preserves a provider-native call id that already fits", () => {
    const items = projectNativeConversationItems([tool()]);
    expect(items[0]).toMatchObject({ kind: "tool_call", callId: "call-1" });
    expect(items[1]).toMatchObject({ kind: "tool_result", callId: "call-1" });
  });

  it("rewrites provider call ids with characters rejected by Claude", () => {
    const event = tool();
    event.callId = "call_native:part-0";

    const items = projectNativeConversationItems([event]);
    expect(items[0]).toMatchObject({
      kind: "tool_call",
      callId: expect.stringMatching(/^call_[A-Za-z0-9_-]+$/),
    });
    expect(items[1]).toMatchObject({
      kind: "tool_result",
      callId: (items[0] as { callId: string }).callId,
    });
    expect((items[0] as { callId: string }).callId).not.toContain(":");
  });

  it("compares JSON tool arguments semantically rather than by object key order", () => {
    const left = projectNativeConversationItems([tool()]);
    const right = structuredClone(left);
    if (right[0]?.kind === "tool_call") {
      right[0].arguments =
        '{"nested":{"first":1,"second":2},"path":"/repo/README.md"}';
    }
    expect(nativeConversationItemsEqual(left, right)).toBe(true);
  });

  it("rebuilds the provider's effective context from its latest compact boundary", () => {
    const compacted = projectNativeConversationItems([
      message("u1", "user", "old question"),
      tool(),
      message("a1", "assistant", "old answer"),
      compactMarker(),
    ]);
    const withDelta = projectNativeConversationItems([
      message("u1", "user", "old question"),
      tool(),
      message("a1", "assistant", "old answer"),
      compactMarker(),
      message("u2", "user", "continue"),
    ]);

    expect(compacted).toEqual([
      expect.objectContaining({
        kind: "context_summary",
        id: "compact-1",
        summary: "provider summary",
      }),
    ]);
    expect(nativeConversationItemsArePrefix(compacted, withDelta)).toBe(true);
    expect(withDelta.at(-1)).toMatchObject({
      kind: "message",
      id: "u2",
      role: "user",
    });
  });

  it("preserves failed and interrupted tool-result semantics", () => {
    const event = tool();
    event.displayStatus = "failed";
    event.result = {
      observation: "partial tool output",
      status: "interrupted",
      interrupted: true,
    };

    expect(projectNativeConversationItems([event])).toEqual([
      expect.objectContaining({ kind: "tool_call", callId: "call-1" }),
      expect.objectContaining({
        kind: "tool_result",
        callId: "call-1",
        output: "partial tool output",
        isError: true,
        interrupted: true,
      }),
    ]);
  });

  it("does not synthesize an empty provider-native compact", () => {
    const empty = compactMarker("empty-compact");
    empty.result = {
      ...(empty.result ?? {}),
      observation: "",
    };

    expect(
      projectNativeConversationItems([
        message("u1", "user", "old question"),
        empty,
        message("a1", "assistant", "old answer"),
      ])
    ).toEqual([
      expect.objectContaining({ kind: "message", id: "u1" }),
      expect.objectContaining({ kind: "message", id: "a1" }),
    ]);
  });

  it("supports native Agent plus verified Claude and Codex writers", () => {
    expect(supportsNativeConversationTarget({})).toBe(true);
    expect(
      supportsNativeConversationTarget({ cliAgentType: "claude_code" })
    ).toBe(true);
    expect(supportsNativeConversationTarget({ cliAgentType: "codex" })).toBe(
      true
    );
    expect(
      supportsNativeConversationTarget({ cliAgentType: "cursor_cli" })
    ).toBe(false);
  });

  it("requires the target's authoritative reader to return the same native transcript", async () => {
    const timeline = [message("u1", "user", "hello")];
    mocks.invokeTauri.mockResolvedValue({
      nativeSessionId: "native-1",
      itemCount: 1,
    });
    mocks.loadEvents.mockResolvedValue({
      events: timeline,
      source: "native_store",
    });

    await expect(
      materializeNativeConversation({
        sessionId: "agentsession-target",
        timeline,
      })
    ).resolves.toMatchObject({
      receipt: { nativeSessionId: "native-1", itemCount: 1 },
    });
    expect(mocks.invokeTauri).toHaveBeenCalledWith(
      "materialize_native_conversation",
      expect.objectContaining({ sessionId: "agentsession-target" })
    );
  });

  it("leaves an empty target fresh instead of inventing an unresumable native id", async () => {
    await expect(
      materializeNativeConversation({
        sessionId: "cli-session-empty",
        timeline: [],
      })
    ).resolves.toEqual({
      events: [],
      receipt: {
        nativeSessionId: "",
        itemCount: 0,
        fidelity: { level: "exact", omitted: [] },
      },
    });
    expect(mocks.invokeTauri).not.toHaveBeenCalled();
    expect(mocks.loadEvents).not.toHaveBeenCalled();
  });

  it("lets Rust verify the authoritative native prefix before synchronizing", async () => {
    const existing = [message("u1", "user", "hello")];
    const timeline = [...existing, message("a1", "assistant", "done")];
    mocks.invokeTauri.mockResolvedValue({
      nativeSessionId: "native-1",
      itemCount: 2,
    });
    mocks.loadEvents.mockResolvedValue({
      events: timeline,
      source: "native_store",
    });

    await expect(
      synchronizeNativeConversation({
        sessionId: "cliagent-target",
        timeline,
      })
    ).resolves.toMatchObject({
      receipt: { nativeSessionId: "native-1", itemCount: 2 },
    });
    expect(mocks.invokeTauri).toHaveBeenCalledWith(
      "synchronize_native_conversation",
      {
        sessionId: "cliagent-target",
        completeItems: projectNativeConversationItems(timeline),
      }
    );
  });

  it("fails closed when the provider reader does not round-trip the write", async () => {
    mocks.invokeTauri.mockResolvedValue({
      nativeSessionId: "native-1",
      itemCount: 1,
    });
    mocks.loadEvents.mockResolvedValue({
      events: [message("a1", "assistant", "different")],
      source: "native_store",
    });

    await expect(
      materializeNativeConversation({
        sessionId: "agentsession-target",
        timeline: [message("u1", "user", "hello")],
      })
    ).rejects.toThrow("round-trip verification failed");
  });

  it("removes a failed CLI materialization without touching other native history", async () => {
    mocks.invokeTauri.mockResolvedValueOnce({
      nativeSessionId: "native-1",
      itemCount: 1,
    });
    mocks.loadEvents.mockResolvedValue({
      events: [message("a1", "assistant", "different")],
      source: "cli_history",
    });

    await expect(
      materializeNativeConversation({
        sessionId: "cliagent-target",
        timeline: [message("u1", "user", "hello")],
      })
    ).rejects.toThrow("round-trip verification failed");
    expect(mocks.invokeTauri).toHaveBeenNthCalledWith(
      2,
      "discard_native_conversation_materialization",
      { sessionId: "cliagent-target", nativeSessionId: "native-1" }
    );
  });
});
