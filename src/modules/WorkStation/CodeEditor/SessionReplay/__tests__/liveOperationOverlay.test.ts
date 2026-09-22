import { describe, expect, it } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { applyLiveOperationOverlay } from "../liveOperationOverlay";
import type {
  ExploreOperationEntry,
  FileOperationEntry,
  ShellOperationEntry,
  SimulatorIDEState,
  ToolOperationEntry,
} from "../types";

function minimalSessionEvent(
  overrides: Partial<SessionEvent> = {}
): SessionEvent {
  return {
    chunk_id: null,
    id: "evt-1",
    sessionId: "sess-1",
    createdAt: "2026-03-29T12:00:00.000Z",
    functionName: "code_search",
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

function baseDerivedState(
  overrides: Partial<
    Pick<
      SimulatorIDEState,
      | "fileOperations"
      | "shellOperations"
      | "exploreOperations"
      | "toolOperations"
    >
  > = {}
): Pick<
  SimulatorIDEState,
  "fileOperations" | "shellOperations" | "exploreOperations" | "toolOperations"
> {
  return {
    fileOperations: [],
    shellOperations: [],
    exploreOperations: [],
    toolOperations: [],
    ...overrides,
  };
}

it("updates live JS call titles through failure, retry, and selection changes", () => {
  const first = minimalSessionEvent({
    functionName: "js",
    args: { title: "Inspect window" },
    displayStatus: "running",
  });
  let state = applyLiveOperationOverlay(baseDerivedState(), first);
  expect(state.toolOperations[0].displayName).toBe("Inspect window");
  state = applyLiveOperationOverlay(state, {
    ...first,
    displayStatus: "failed",
  });
  expect(state.toolOperations[0]).toMatchObject({
    displayName: "Inspect window",
    isFailed: true,
  });
  state = applyLiveOperationOverlay(state, {
    ...first,
    args: { title: "Inspect again" },
  });
  expect(state.toolOperations).toHaveLength(1);
  expect(state.toolOperations[0].displayName).toBe("Inspect again");
  state = applyLiveOperationOverlay(state, {
    ...first,
    id: "other-call",
    args: {},
  });
  expect(
    state.toolOperations.find((op) => op.eventId === "other-call")?.displayName
  ).toBe("Js");
  expect(
    state.toolOperations.find((op) => op.eventId === first.id)?.displayName
  ).toBe("Inspect again");
});

function staleExploreOperation(
  overrides: Partial<ExploreOperationEntry> = {}
): ExploreOperationEntry {
  const event = minimalSessionEvent({
    id: "evt-1",
    displayStatus: "running",
  });
  return {
    query: "token",
    exploreType: "code_search",
    results: [],
    files: [],
    totalMatches: 0,
    event,
    eventId: event.id,
    isCurrent: false,
    isLoading: true,
    ...overrides,
  };
}

function staleFileOperation(
  overrides: Partial<FileOperationEntry> = {}
): FileOperationEntry {
  const event = minimalSessionEvent({
    id: "evt-1",
    functionName: "read_file",
    args: { path: "/repo/a.ts" },
    displayStatus: "running",
  });
  return {
    filePath: "/repo/a.ts",
    fileName: "a.ts",
    directory: "/repo",
    type: "read",
    event,
    eventId: event.id,
    isCurrent: false,
    content: undefined,
    ...overrides,
  };
}

function staleShellOperation(
  overrides: Partial<ShellOperationEntry> = {}
): ShellOperationEntry {
  const event = minimalSessionEvent({
    id: "evt-1",
    functionName: "run_shell",
    args: { command: "pnpm test" },
    displayStatus: "running",
  });
  return {
    command: "pnpm test",
    shortCommand: "pnpm",
    commandKeywords: "pnpm",
    event,
    eventId: event.id,
    isCurrent: false,
    isLoading: true,
    ...overrides,
  };
}

function staleToolOperation(
  overrides: Partial<ToolOperationEntry> = {}
): ToolOperationEntry {
  const event = minimalSessionEvent({
    id: "evt-1",
    functionName: "custom_tool",
    displayStatus: "running",
  });
  return {
    toolName: "custom_tool",
    displayName: "Custom Tool",
    event,
    eventId: event.id,
    isCurrent: false,
    isLoading: true,
    ...overrides,
  };
}

describe("applyLiveOperationOverlay", () => {
  it("replaces stale code_search operation with live completed results", () => {
    const currentEvent = minimalSessionEvent({
      id: "search-1",
      functionName: "code_search",
      args: { action: "grep", pattern: "token" },
      result: {
        output: {
          success: {
            results: [{ file: "src/a.ts", line: 7, content: "token" }],
          },
        },
      },
    });

    const state = applyLiveOperationOverlay(
      baseDerivedState({
        exploreOperations: [
          staleExploreOperation({ eventId: "search-1", event: currentEvent }),
        ],
      }),
      currentEvent
    );

    expect(state.exploreOperations).toHaveLength(1);
    expect(state.exploreOperations[0].eventId).toBe("search-1");
    expect(state.exploreOperations[0].isCurrent).toBe(true);
    expect(state.exploreOperations[0].results).toHaveLength(1);
    expect(state.exploreOperations[0].totalMatches).toBe(1);
  });

  it("replaces stale list_dir operation with live completed files and count", () => {
    const currentEvent = minimalSessionEvent({
      id: "list-1",
      functionName: "list_dir",
      args: { path: "/repo" },
      result: {
        output: "[dir] src/\n[file] README.md",
      },
    });

    const state = applyLiveOperationOverlay(
      baseDerivedState({
        exploreOperations: [
          staleExploreOperation({
            eventId: "list-1",
            event: currentEvent,
            query: "ls /repo",
            exploreType: "list_dir",
          }),
        ],
      }),
      currentEvent
    );

    expect(state.exploreOperations).toHaveLength(1);
    expect(state.exploreOperations[0].eventId).toBe("list-1");
    expect(state.exploreOperations[0].files).toEqual(["src/", "README.md"]);
    expect(state.exploreOperations[0].listDirTotalListedCount).toBe(2);
  });

  it("marks a live running list_dir operation as loading immediately", () => {
    const currentEvent = minimalSessionEvent({
      id: "list-running",
      functionName: "list_dir",
      args: { path: "/repo/src" },
      displayStatus: "running",
      result: {},
    });

    const state = applyLiveOperationOverlay(baseDerivedState(), currentEvent);

    expect(state.exploreOperations).toHaveLength(1);
    expect(state.exploreOperations[0].eventId).toBe("list-running");
    expect(state.exploreOperations[0].query).toBe("ls /repo/src");
    expect(state.exploreOperations[0].exploreType).toBe("list_dir");
    expect(state.exploreOperations[0].isCurrent).toBe(true);
    expect(state.exploreOperations[0].isLoading).toBe(true);
  });

  it("marks a live running code_search operation as loading immediately", () => {
    const currentEvent = minimalSessionEvent({
      id: "search-running",
      functionName: "code_search",
      args: { action: "grep", pattern: "SessionReplay" },
      displayStatus: "running",
      result: {},
    });

    const state = applyLiveOperationOverlay(baseDerivedState(), currentEvent);

    expect(state.exploreOperations).toHaveLength(1);
    expect(state.exploreOperations[0].eventId).toBe("search-running");
    expect(state.exploreOperations[0].query).toBe("SessionReplay");
    expect(state.exploreOperations[0].exploreType).toBe("code_search");
    expect(state.exploreOperations[0].isCurrent).toBe(true);
    expect(state.exploreOperations[0].isLoading).toBe(true);
  });

  it("replaces stale read_file operation with live completed content", () => {
    const currentEvent = minimalSessionEvent({
      id: "read-1",
      functionName: "read_file",
      args: { path: "/repo/a.ts" },
      result: {
        success: {
          path: "/repo/a.ts",
          content: "const live = true;",
        },
      },
    });

    const state = applyLiveOperationOverlay(
      baseDerivedState({
        fileOperations: [staleFileOperation({ eventId: "read-1" })],
      }),
      currentEvent
    );

    expect(state.fileOperations).toHaveLength(1);
    expect(state.fileOperations[0].eventId).toBe("read-1");
    expect(state.fileOperations[0].isCurrent).toBe(true);
    expect(state.fileOperations[0].isLoading).toBe(false);
    expect(state.fileOperations[0].content).toBe("const live = true;");
  });

  it("marks a live running read_file operation as loading until content arrives", () => {
    const currentEvent = minimalSessionEvent({
      id: "read-running",
      functionName: "read_file",
      args: { path: "/repo/loading.ts" },
      displayStatus: "running",
      result: {},
    });

    const state = applyLiveOperationOverlay(baseDerivedState(), currentEvent);

    expect(state.fileOperations).toHaveLength(1);
    expect(state.fileOperations[0].eventId).toBe("read-running");
    expect(state.fileOperations[0].isCurrent).toBe(true);
    expect(state.fileOperations[0].isLoading).toBe(true);
    expect(state.fileOperations[0].content).toBeUndefined();
  });

  it("replaces stale terminal operation with live running stream output", () => {
    const currentEvent = minimalSessionEvent({
      id: "shell-running",
      functionName: "run_shell",
      args: { command: "pnpm test", streamOutput: "running tests" },
      displayStatus: "running",
    });

    const state = applyLiveOperationOverlay(
      baseDerivedState({
        shellOperations: [staleShellOperation({ eventId: "shell-running" })],
      }),
      currentEvent
    );

    expect(state.shellOperations).toHaveLength(1);
    expect(state.shellOperations[0].eventId).toBe("shell-running");
    expect(state.shellOperations[0].isCurrent).toBe(true);
    expect(state.shellOperations[0].isLoading).toBe(true);
    expect(state.shellOperations[0].streamOutput).toBe("running tests");
  });

  it("adds a live running terminal operation immediately", () => {
    const currentEvent = minimalSessionEvent({
      id: "shell-new-running",
      functionName: "run_shell",
      args: { command: "pnpm lint", streamOutput: "linting" },
      displayStatus: "running",
    });

    const state = applyLiveOperationOverlay(baseDerivedState(), currentEvent);

    expect(state.shellOperations).toHaveLength(1);
    expect(state.shellOperations[0].eventId).toBe("shell-new-running");
    expect(state.shellOperations[0].isCurrent).toBe(true);
    expect(state.shellOperations[0].streamOutput).toBe("linting");
  });

  it("replaces stale generic tool operation with the live completed event", () => {
    const currentEvent = minimalSessionEvent({
      id: "tool-1",
      functionName: "custom_tool",
      result: { content: "done" },
    });

    const state = applyLiveOperationOverlay(
      baseDerivedState({
        toolOperations: [staleToolOperation({ eventId: "tool-1" })],
      }),
      currentEvent
    );

    expect(state.toolOperations).toHaveLength(1);
    expect(state.toolOperations[0].eventId).toBe("tool-1");
    expect(state.toolOperations[0].isCurrent).toBe(true);
    expect(state.toolOperations[0].isLoading).toBe(false);
    expect(state.toolOperations[0].event.result).toEqual({ content: "done" });
  });
});
