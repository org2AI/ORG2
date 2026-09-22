import { Provider } from "jotai";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { CodePanel } from "..";
import { convertToShellOperation } from "../../converters/shellConverter";
import {
  CODE_PANEL_MODE,
  FILE_OPERATION_TYPE,
  type FileOperationEntry,
} from "../../types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { code?: number }) =>
      options?.code !== undefined ? `${key}: ${options.code}` : key,
  }),
}));

vi.mock("@src/engines/SessionCore/rendering/registry/initToolRegistry", () => ({
  getToolDisplayBehavior: () => "wait_for_result",
  getAppSubtool: () => "shell",
}));

vi.mock("@src/features/CodeViewer/VirtualizedModernDiff", () => ({
  VirtualizedModernDiff: () =>
    React.createElement("div", { "data-testid": "single-diff" }),
}));

vi.mock("@src/features/FileHeader", () => ({
  FileHeader: () => React.createElement("header"),
  default: () => React.createElement("header"),
}));

vi.mock("@src/modules/WorkStation/shared", () => ({
  NoTabsPlaceholder: () => React.createElement("div"),
  useSimulatorAwaitingAgentCaption: () => "Awaiting agent",
  useSimulatorPlaceholderActions: () => [],
}));

vi.mock("@src/modules/WorkStation/shared/SelectedTextAddToChat", () => ({
  SelectedTextAddToChat: ({
    children,
    displayName,
    filePath,
    scopeKey,
  }: {
    children?: React.ReactNode;
    displayName: string;
    filePath?: string;
    scopeKey?: string | number;
  }) =>
    React.createElement(
      "div",
      {
        "data-selected-text-owner": displayName,
        "data-selected-file-path": filePath,
        "data-selection-scope": scopeKey,
      },
      children
    ),
}));

vi.mock("../CombinedDiffView", () => ({
  CombinedDiffView: () =>
    React.createElement("div", { "data-testid": "combined-diff" }),
}));

vi.mock("../useLiveReadFileContent", () => ({
  useLiveReadFileContent: () => ({ content: undefined, status: "idle" }),
}));

const EVENT: SessionEvent = {
  chunk_id: null,
  id: "event-1",
  sessionId: "session-1",
  createdAt: "2026-08-24T00:00:00.000Z",
  functionName: "edit_file",
  uiCanonical: "edit_file",
  actionType: "tool_call",
  args: {},
  result: {},
  source: "assistant",
  displayText: "Edit file",
  displayStatus: "completed",
  displayVariant: "tool_call",
  activityStatus: "agent",
};

function makeWriteOperation(
  overrides: Partial<FileOperationEntry> = {}
): FileOperationEntry {
  return {
    filePath: "/repo/src/example.ts",
    fileName: "example.ts",
    directory: "/repo/src",
    type: FILE_OPERATION_TYPE.WRITE,
    event: EVENT,
    eventId: "event-1",
    isCurrent: true,
    oldContent: "const before = 1;",
    newContent: "const after = 2;",
    ...overrides,
  };
}

function renderPanel(operation: FileOperationEntry): string {
  return renderToStaticMarkup(
    React.createElement(
      Provider,
      null,
      React.createElement(CodePanel, { operation })
    )
  );
}

describe("CodePanel selected-text ownership", () => {
  it("mounts the shared Add to Chat owner around a single edit diff", () => {
    const markup = renderPanel(makeWriteOperation());

    expect(markup).toContain('data-selected-text-owner="example.ts"');
    // The path makes a selection a file pill instead of a terminal snippet.
    expect(markup).toContain('data-selected-file-path="/repo/src/example.ts"');
    expect(markup).toContain('data-selection-scope="event-1"');
    expect(markup).toContain('data-testid="single-diff"');
  });

  it("mounts the same owner around combined edit diffs", () => {
    const first = makeWriteOperation({ eventId: "event-0", isCurrent: false });
    const current = makeWriteOperation({
      relatedOperations: [first, makeWriteOperation()],
    });
    const markup = renderPanel(current);

    expect(markup).toContain('data-selected-text-owner="example.ts"');
    expect(markup).toContain('data-selected-file-path="/repo/src/example.ts"');
    expect(markup).toContain('data-selection-scope="event-1"');
    expect(markup).toContain('data-testid="combined-diff"');
  });
});

describe("CodePanel failed command output", () => {
  it.each([
    { output: "GraphQL: merge is already in progress", exitCode: 1 },
    { output: "", exitCode: 1 },
    { output: "command not found", exitCode: 127 },
    { output: "merge completed", exitCode: 0 },
  ])("renders output and exit $exitCode", ({ output, exitCode }) => {
    const shellOperation = convertToShellOperation(
      {
        ...EVENT,
        functionName: "run_shell",
        uiCanonical: "run_shell",
        displayStatus: exitCode === 0 ? "completed" : "failed",
        args: { command: "gh pr merge 123" },
        extracted: {
          kind: "shell",
          command: "gh pr merge 123",
          output,
          exitCode,
          isFailure: exitCode !== 0,
          gitArtifacts: [],
        },
      },
      true
    );
    expect(shellOperation).toMatchObject({ output, exitCode });
    const markup = renderToStaticMarkup(
      React.createElement(
        Provider,
        null,
        React.createElement(CodePanel, {
          operation: null,
          mode: CODE_PANEL_MODE.TERMINAL,
          shellOperation,
        })
      )
    );
    expect(markup.replace(/<[^>]*>/g, "")).toContain("gh pr merge 123");
    if (output) expect(markup).toContain(output);
    expect(markup).toContain(
      `simulator.replay.ide.shell.exitCode: ${exitCode}`
    );
    expect(markup).not.toContain("tools.failedPlaceholder");
  });
});
