// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import type { WorkStationTab } from "@src/store/workstation/tabs";

// Use the same entry point as CodeEditor: importing only SidebarSlot would
// miss the module-init registration that the dead-code cleanup removed.
import { SidebarSlot, hasTabSidebar } from "./index";

vi.mock("./SourceControl", () => ({}));
vi.mock("@/src/engines/TerminalCore/hooks/useTerminalState", () => ({
  useTerminalState: () => ({
    sessions: [],
    activeSessionId: null,
  }),
}));
vi.mock("@src/store/repo", async () => {
  const { atom } = await import("jotai");
  return { selectedRepoPathAtom: atom("/repo") };
});
vi.mock("@src/store/workstation/codeEditor/terminalTargetAtom", async () => {
  const { atom } = await import("jotai");
  return {
    codeEditorTerminalTargetAtom: atom(null),
    clearTerminalTargetReferencesAtom: atom(null),
  };
});
vi.mock("./Terminal/TerminalSidebarContent", () => ({
  default: () => createElement("div", { "data-testid": "terminal-sidebar" }),
}));

const terminalTab = {
  id: "terminal:pty-1",
  type: "terminal",
  title: "zsh",
  data: { sessionId: "pty-1", sessionName: "zsh" },
} as WorkStationTab;
const fileTab = {
  id: "file:readme",
  type: "file",
  title: "README.md",
  data: {},
} as WorkStationTab;

it("registers the terminal sidebar through the production entry point", () => {
  expect(hasTabSidebar("terminal")).toBe(true);
});

it("shows terminal navigation, restores explorer on file tabs, and removes closed sidebars", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const render = (activeTab: WorkStationTab, retainedTabs: WorkStationTab[]) =>
    act(() =>
      root.render(
        createElement(SidebarSlot, {
          activeTab,
          retainedTabs,
          repoPath: "/repo",
          repoId: "repo",
          defaultSidebar: createElement("div", { "data-testid": "file-tree" }),
        })
      )
    );
  try {
    // Terminal tabs are normally rebuilt on activation, not kept warm.
    render(terminalTab, []);
    expect(
      container.querySelector('[data-testid="terminal-sidebar"]')
    ).not.toBeNull();
    expect(container.querySelector('[data-testid="file-tree"]')).toBeNull();
    render(fileTab, []);
    expect(
      container.querySelector('[data-testid="terminal-sidebar"]')
    ).toBeNull();

    render(terminalTab, [terminalTab]);
    const sidebar = container.querySelector('[data-testid="terminal-sidebar"]');
    expect(sidebar).not.toBeNull();
    expect(container.querySelector('[data-testid="file-tree"]')).toBeNull();

    render(fileTab, [terminalTab]);
    expect(container.querySelector('[data-testid="file-tree"]')).not.toBeNull();
    expect(sidebar?.parentElement?.getAttribute("aria-hidden")).toBe("true");

    render(terminalTab, [terminalTab]);
    expect(container.querySelector('[data-testid="terminal-sidebar"]')).toBe(
      sidebar
    );
    expect(sidebar?.parentElement?.getAttribute("aria-hidden")).toBe("false");

    render(fileTab, []);
    expect(
      container.querySelector('[data-testid="terminal-sidebar"]')
    ).toBeNull();
    expect(container.querySelector('[data-testid="file-tree"]')).not.toBeNull();
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
