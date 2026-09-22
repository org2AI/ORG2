/**
 * skipEmptyRunningEvent utilities — unit tests.
 *
 * Tests the pure event-resolution logic used by both the main Simulator and
 * the subagent grid cell replay to skip empty "still running" placeholder
 * frames when seeking to a specific replay position.
 */
import { describe, expect, it, vi } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore";

import {
  isEmptyRunningEvent,
  resolveNonEmptyEventFromIds,
} from "../skipEmptyRunningEvent";

vi.mock("@src/engines/SessionCore/rendering/registry/toolCategories", () => ({
  isFileTool: vi.fn((name: string) =>
    ["read_file", "edit_file"].includes(name)
  ),
}));

function makeEvent(
  overrides: Partial<SessionEvent> & { functionName: string }
): SessionEvent {
  return {
    chunk_id: null,
    id: `evt-${overrides.functionName}-${Math.random().toString(36).slice(2)}`,
    sessionId: "test-session",
    createdAt: "2025-01-01T00:00:00Z",
    actionType: "tool_call",
    uiCanonical: "",
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

function runningFileTool(id: string, hasContent = false): SessionEvent {
  return makeEvent({
    id,
    functionName: "read_file",
    chunk_id: id,
    result: {
      status: "running",
      ...(hasContent ? { observation: "some content" } : {}),
    },
  });
}

function completedEvent(id: string): SessionEvent {
  return makeEvent({
    id,
    functionName: "shell",
    chunk_id: id,
    result: { status: "completed", content: "done" },
  });
}

describe("isEmptyRunningEvent", () => {
  it("returns true for a file tool that is running with no content", () => {
    const event = runningFileTool("evt-1");
    expect(isEmptyRunningEvent(event)).toBe(true);
  });

  it("returns false for a file tool that is running WITH content (observation)", () => {
    const event = runningFileTool("evt-2", true);
    expect(isEmptyRunningEvent(event)).toBe(false);
  });

  it("returns false for a non-file tool", () => {
    const event = makeEvent({
      functionName: "shell",
      result: { status: "running" },
    });
    expect(isEmptyRunningEvent(event)).toBe(false);
  });

  it("returns false for a completed file tool", () => {
    const event = makeEvent({
      functionName: "read_file",
      result: { status: "completed", content: "file content" },
    });
    expect(isEmptyRunningEvent(event)).toBe(false);
  });
});

function resolveFromList(
  current: SessionEvent | null,
  events: SessionEvent[]
): SessionEvent | null {
  return resolveNonEmptyEventFromIds(
    current,
    events.map((event) => event.id),
    new Map(events.map((event) => [event.id, event]))
  );
}

describe("resolveNonEmptyEventFromIds over an event list", () => {
  it("returns the event unchanged when it is not empty+running", () => {
    const done = completedEvent("done");
    expect(resolveFromList(done, [done])).toBe(done);
  });

  it("returns null when given null", () => {
    expect(resolveFromList(null, [])).toBeNull();
  });

  it("skips forward to the nearest non-empty event", () => {
    const empty = runningFileTool("empty");
    const good = completedEvent("good");
    const events = [empty, good];
    expect(resolveFromList(empty, events)).toBe(good);
  });

  it("falls back backward when there is no forward event", () => {
    const good = completedEvent("good");
    const empty = runningFileTool("empty");
    const events = [good, empty];
    expect(resolveFromList(empty, events)).toBe(good);
  });

  it("returns the original event when no non-empty alternative exists", () => {
    const empty1 = runningFileTool("e1");
    const empty2 = runningFileTool("e2");
    const events = [empty1, empty2];
    const result = resolveFromList(empty1, events);
    expect(result).toBe(empty1);
  });
});

describe("resolveNonEmptyEventFromIds", () => {
  it("finds a non-empty event via id lookup map", () => {
    const empty = runningFileTool("empty");
    const good = completedEvent("good");
    const ids = ["empty", "good"];
    const byId = new Map([
      ["empty", empty],
      ["good", good],
    ]);
    expect(resolveNonEmptyEventFromIds(empty, ids, byId)).toBe(good);
  });

  it("returns the current event when it is not in the id list", () => {
    const empty = runningFileTool("orphan");
    const ids = ["other"];
    const byId = new Map([["other", completedEvent("other")]]);
    expect(resolveNonEmptyEventFromIds(empty, ids, byId)).toBe(empty);
  });
});
