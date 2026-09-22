import { type ReactNode, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { ToolPanel } from "../CodePanel/ToolPanel";
import { FileSidebar } from "../FileSidebar";
import type { FileTreeInput } from "../fileTreeUtils";
import { FILE_PANEL_VIEW_MODE } from "../types";

// Preserve real title selection and list projection; replace only host chrome
// and virtualization so the owning components can render without a desktop.
vi.mock("@src/features/FileHeader", () => ({
  FileHeader: ({ titleSlot }: { titleSlot: ReactNode }) =>
    createElement("header", null, titleSlot),
}));
vi.mock("../../../shared", () => ({
  PrimarySidebarLayoutWithSections: ({
    tabs,
  }: {
    tabs: { sections: { content: ReactNode }[] }[];
  }) =>
    createElement(
      "aside",
      null,
      tabs.flatMap((tab) =>
        tab.sections.map((section, index) =>
          createElement("section", { key: index }, section.content)
        )
      )
    ),
}));
vi.mock("../components/SimulatorTreePanel", () => ({
  default: ({ items }: { items: FileTreeInput[] }) =>
    createElement(
      "ul",
      null,
      items.map((item) => createElement("li", { key: item.id }, item.fileName))
    ),
}));

const event: SessionEvent = {
  chunk_id: null,
  id: "js",
  sessionId: "test",
  createdAt: "2026-09-22T00:00:00Z",
  functionName: "js",
  uiCanonical: "tool_call",
  actionType: "tool_call",
  args: { title: "Inspect window", code: "await app.getState()" },
  result: {},
  source: "assistant",
  displayText: "",
  displayStatus: "completed",
  displayVariant: "tool_call",
  activityStatus: "agent",
};

describe("replay tool call titles", () => {
  it("uses the call title in the detail header even with an old derived displayName", () => {
    const markup = renderToStaticMarkup(
      createElement(ToolPanel, {
        operation: {
          toolName: "js",
          displayName: "Js",
          event,
          eventId: event.id,
          isCurrent: true,
        },
        publishEnabled: false,
      })
    );
    expect(markup).toContain('title="Inspect window"');
    expect(markup).toContain(">Inspect window</span>");
    expect(markup).toContain("min-w-0 truncate");
  });

  it("shows the invocation title in the actual sidebar projection", () => {
    const noop = () => {};
    const markup = renderToStaticMarkup(
      createElement(FileSidebar, {
        fileViewMode: FILE_PANEL_VIEW_MODE.TERMINAL,
        onFileViewModeChange: noop,
        fileOperations: [],
        exploreOperations: [],
        shellOperations: [],
        toolOperations: [
          {
            toolName: "js",
            displayName: "Js",
            event,
            eventId: event.id,
            isCurrent: true,
          },
        ],
        selectedFileEventId: null,
        selectedExploreEventId: null,
        selectedShellEventId: null,
        selectedToolEventId: event.id,
        activeSelectionKind: "tool",
        currentEventId: event.id,
        onSelectFileOperation: noop,
        onSelectExploreOperation: noop,
        onSelectShellOperation: noop,
        onSelectToolOperation: noop,
      })
    );
    expect(markup).toContain("<li>Inspect window</li>");
    expect(markup).not.toContain("<li>Js</li>");
  });
});
