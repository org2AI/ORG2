// @vitest-environment jsdom
import i18next from "i18next";
import { Provider, createStore } from "jotai";
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAgentIcon } from "@src/config/agentIcons";
import { DEFAULT_BUTTON_TOOLTIP_DELAY_MS } from "@src/config/tooltip";
import common from "@src/i18n/locales/en/common.json";
import navigation from "@src/i18n/locales/en/navigation.json";
import sessions from "@src/i18n/locales/en/sessions.json";
import { createSessionTab } from "@src/store/chatPanel/chatPanelTabFactories";
import { chatPanelTabsAtom } from "@src/store/chatPanel/chatPanelTabsState";
import { createChatPanelTerminalAtom } from "@src/store/chatPanel/chatPanelTerminalAtom";
import { workspaceGitStatusMapAtom } from "@src/store/git";
import {
  closeMiniTerminalAtom,
  miniTerminalCollapsedAtom,
  openMiniTerminalAtom,
  releaseMiniTerminalSessionAtom,
} from "@src/store/ui/miniTerminalAtom";
import {
  sideChatSessionIdAtom,
  sideChatVisibleAtom,
} from "@src/store/ui/sideChatAtom";
import {
  activeWorkspaceIdAtom,
  workspaceFoldersAtom,
} from "@src/store/workspace";
import {
  editorAddTerminalSessionAtom,
  markTerminalInitializedAtom,
  terminalSessionsAtom,
} from "@src/store/workstation/codeEditor/terminal";
import { sessionTrailSurfaceAtom } from "@src/store/workstation/sessionTrailSurfaceAtom";
import { workstationLayoutAtom } from "@src/store/workstation/tabs";
import { SDE_AGENT_ICON_ID } from "@src/util/session/sessionDispatch";

import { FocusedChatWorkstationRail } from ".";
import type {
  FocusedChatRailSource,
  FocusedChatRailSubagent,
  FocusedChatSessionContext,
} from "./types";

const gitMocks = vi.hoisted(() => ({
  useWorkingTreeDiffTotals: vi.fn(
    (_repoId: string | undefined, repoPath: string | undefined) =>
      repoPath?.includes("secondary")
        ? { additions: 8, deletions: 2 }
        : repoPath
          ? { additions: 12, deletions: 4 }
          : { additions: 0, deletions: 0 }
  ),
}));

const openLinkMocks = vi.hoisted(() => ({ openInBrowserApp: vi.fn() }));

vi.mock("@src/util/ui/openLink", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@src/util/ui/openLink")>()),
  openInBrowserApp: openLinkMocks.openInBrowserApp,
}));
vi.mock("@src/scaffold/ImagePreviewOverlay", () => ({
  default: (props: {
    dataUrl: string;
    images?: unknown[];
    initialIndex?: number;
  }) =>
    React.createElement("div", {
      "data-testid": "source-image-preview",
      "data-src": props.dataUrl,
      "data-count": props.images?.length,
      "data-index": props.initialIndex,
    }),
}));
vi.mock("@src/hooks/git/useActiveRepoRef", () => ({
  useActiveRepoRef: () => ({ repoId: null, repoPath: "" }),
}));
vi.mock("@src/hooks/git/useRepoSelection", () => ({
  useRepoSelection: () => ({ currentBranch: "" }),
}));
vi.mock("@src/hooks/git/useWorkingTreeDiffTotals", () => ({
  useWorkingTreeDiffTotals: gitMocks.useWorkingTreeDiffTotals,
}));
vi.mock("@src/hooks/git/useBranchPullRequestStatus", () => ({
  useBranchPullRequestStatus: () => ({ ciStatus: null, pr: null }),
}));
vi.mock("@src/hooks/tabHost/useCloseTabWithGuard", () => ({
  useCloseTabWithGuard: () => vi.fn(),
}));
// Exercise the parent projection and both real section renderers without
// launching a PTY or depending on popup positioning/animation in jsdom.
vi.mock("./WorkstationTrailTerminal", () => ({
  WorkstationTrailTerminal: () => null,
}));
vi.mock("@src/components/FileTypeIcon", () => ({ default: () => null }));
vi.mock("@src/components/Dropdown", () => ({
  default: ({
    children,
    droplist,
  }: React.PropsWithChildren<{
    droplist: React.ReactNode;
  }>) => React.createElement(React.Fragment, null, children, droplist),
}));

const i18n = i18next.createInstance();
await i18n.init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { common, navigation, sessions } },
  interpolation: { escapeValue: false },
});

describe.each(["wide rail", "compact menu"])(
  "environment tabs in %s",
  (view) => {
    let root: Root;
    let container: HTMLDivElement;
    let menuHost: HTMLDivElement;
    let store: ReturnType<typeof createStore>;

    beforeEach(() => {
      Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
      localStorage.clear();
      sessionStorage.clear();
      gitMocks.useWorkingTreeDiffTotals.mockClear();
      store = createStore();
      container = document.createElement("div");
      menuHost = document.createElement("div");
      document.body.append(container, menuHost);
      root = createRoot(container);
      store.set(terminalSessionsAtom, []);
      store.set(workstationLayoutAtom, {
        mainPane: {
          tabs: [
            {
              id: "session-sources:current",
              type: "session-sources",
              title: "Sources duplicate tab",
              data: { sessionId: "current" },
            },
            {
              id: "file:readme",
              type: "file",
              title: "README.md",
              data: { filePath: "/workspace/README.md" },
            },
          ],
          activeTabId: "file:readme",
        },
      });
    });

    afterEach(() => {
      act(() => root.unmount());
      container.remove();
      menuHost.remove();
      localStorage.clear();
      sessionStorage.clear();
      vi.restoreAllMocks();
      vi.useRealTimers();
      Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    });

    function addStationTerminal(name: string) {
      const id = store.set(editorAddTerminalSessionAtom, {
        name,
        bypassCreationCooldown: true,
      });
      store.set(markTerminalInitializedAtom, id);
      return id;
    }

    async function mount(
      subagents?: FocusedChatRailSubagent[],
      sessionContext?: FocusedChatSessionContext,
      sources?: FocusedChatRailSource[],
      onOpenSources?: () => void
    ) {
      await act(async () => {
        root.render(
          React.createElement(
            Provider,
            { store },
            React.createElement(
              I18nextProvider,
              { i18n },
              React.createElement(
                MemoryRouter,
                null,
                React.createElement(FocusedChatWorkstationRail, {
                  compactMenuHost: menuHost,
                  sessionContext,
                  sources: sources ?? [],
                  onOpenSources,
                  subagentIcon: resolveAgentIcon(SDE_AGENT_ICON_ID),
                  subagents: subagents ?? [],
                })
              )
            )
          )
        );
      });
    }

    function tabSection() {
      const host = view === "wide rail" ? container : menuHost;
      return [...host.querySelectorAll("section")].find((section) =>
        section.textContent?.includes("Open Tabs")
      );
    }

    it("puts cloud session identity above the local environment", async () => {
      await mount(undefined, {
        environmentKind: "cloud",
        owner: {
          identityId: "user-alice",
          displayName: "Alice",
          avatarUrl: "https://example.com/alice.png",
        },
        repoName: "ORGII",
      });

      const host = view === "wide rail" ? container : menuHost;
      const text = host.textContent ?? "";
      expect(text).toContain("Alice");
      expect(text).not.toContain("@Alice");
      expect(text.indexOf("Session Env")).toBeLessThan(
        text.indexOf("Local env")
      );
      expect(text.indexOf("Alice")).toBeLessThan(text.indexOf("Cloud"));
      expect(text.indexOf("Alice")).toBeLessThan(text.indexOf("Local env"));
      expect(
        host.querySelector('[data-owner-id="user-alice"] img')
      ).not.toBeNull();
    });

    if (view === "wide rail") {
      it("shows shortcut tooltips on collapsed icons and disposes them on expansion", async () => {
        vi.useFakeTimers();
        await mount();
        act(() =>
          container
            .querySelector('[data-icon="chevrons-right"]')!
            .closest("button")!
            .click()
        );

        for (const [label, key] of [
          ["Changes", "E"],
          ["Terminal", "J"],
          ["Files", "G"],
          ["Browser", null],
        ]) {
          const button = container.querySelector<HTMLButtonElement>(
            `button[aria-label="${label}"]`
          )!;
          expect(button).not.toBeNull();
          expect(button.hasAttribute("title")).toBe(false);
          act(() =>
            button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
          );
          act(() => vi.advanceTimersByTime(DEFAULT_BUTTON_TOOLTIP_DELAY_MS));
          act(() => vi.advanceTimersByTime(32));

          const tooltip = document.querySelector(".native-tooltip")!;
          expect(tooltip?.textContent).toContain(label);
          expect(tooltip.classList.contains("native-tooltip-visible")).toBe(
            true
          );
          expect(container.contains(tooltip)).toBe(false);
          const keys = tooltip.querySelectorAll("kbd");
          expect(keys).toHaveLength(key ? 1 : 0);
          if (key) expect(keys[0].textContent?.endsWith(key)).toBe(true);

          act(() =>
            button.dispatchEvent(
              new MouseEvent("mouseout", {
                bubbles: true,
                relatedTarget: document.body,
              })
            )
          );
          act(() => vi.advanceTimersByTime(100));
          expect(document.querySelector(".native-tooltip")).toBeNull();
        }

        // Expanding before the delay expires must not leave a stale popup.
        const review = container.querySelector('button[aria-label="Changes"]')!;
        act(() =>
          review.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
        );
        act(() =>
          container
            .querySelector('[data-icon="chevrons-left"]')!
            .closest("button")!
            .click()
        );
        act(() => vi.advanceTimersByTime(DEFAULT_BUTTON_TOOLTIP_DELAY_MS));
        expect(document.querySelector(".native-tooltip")).toBeNull();
      });

      it("folds the workspace group from the panel title and widens the gap to section rhythm", async () => {
        store.set(activeWorkspaceIdAtom, "workspace:single");
        store.set(workspaceFoldersAtom, [
          {
            id: "primary",
            name: "Rail Repo",
            path: "/workspace/primary",
            uri: "file:///workspace/primary",
            isPrimary: true,
            kind: "git",
          },
        ]);
        await mount();
        const titleButton = () =>
          [...container.querySelectorAll("button")].find((candidate) =>
            candidate.textContent?.includes("Rail Repo")
          )!;
        const headerRow = () => titleButton().parentElement!;

        expect(container.textContent?.match(/Rail Repo/g)).toHaveLength(1);
        const changesRow = [...container.querySelectorAll("button")].find(
          (button) => button.textContent === "Changes"
        )!;
        expect(changesRow.querySelector("svg")).not.toBeNull();
        const changesLabel = [...changesRow.querySelectorAll("span")].find(
          (span) =>
            span.textContent === "Changes" && span.classList.contains("flex-1")
        );
        expect(changesLabel?.classList.contains("text-left")).toBe(true);
        expect(changesRow.className).toContain("btn-hover:bg-surface-hover");
        expect(titleButton().className).toContain("btn-hover:bg-surface-hover");
        expect(changesRow.closest("section")!.textContent).toMatch(/^Changes/);
        expect(headerRow().className).toContain("mb-1");
        expect(container.textContent).toContain("Changes");

        act(() => titleButton().click());
        expect(container.textContent).not.toContain("Changes");
        expect(headerRow().className).toContain("mb-3");

        act(() => titleButton().click());
        expect(container.textContent).toContain("Changes");
        expect(headerRow().className).toContain("mb-1");
      });
    }

    it("shows folded repository totals while keeping secondary details collapsed", async () => {
      store.set(activeWorkspaceIdAtom, "workspace:multi");
      store.set(workspaceFoldersAtom, [
        {
          id: "primary",
          name: "Primary Repo",
          path: "/workspace/primary",
          uri: "file:///workspace/primary",
          isPrimary: true,
          kind: "git",
        },
        {
          id: "secondary",
          name: "Secondary Repo",
          path: "/workspace/secondary",
          uri: "file:///workspace/secondary",
          isPrimary: false,
          kind: "git",
        },
      ]);
      const status = (branch: string) => ({
        current_branch: branch,
        current_upstream_branch: null,
        current_tip: "abc123",
        branch_ahead_behind: null,
        exists: true,
        merge_head_found: false,
        squash_msg_found: false,
        rebase_in_progress: false,
        cherry_pick_in_progress: false,
        working_directory: { files: [] },
        do_conflicted_files_exist: false,
      });
      store.set(
        workspaceGitStatusMapAtom,
        new Map([
          ["/workspace/primary", status("primary-branch")],
          ["/workspace/secondary", status("secondary-branch")],
        ])
      );

      await mount();

      const host = view === "wide rail" ? container : menuHost;
      const secondaryToggle = host.querySelector<HTMLButtonElement>(
        '[data-workstation-group-toggle="workspace:secondary"]'
      )!;
      expect(host.textContent?.match(/Primary Repo/g)).toHaveLength(1);
      expect(host.textContent).toContain("primary-branch");
      expect(host.textContent!.indexOf("primary-branch")).toBeLessThan(
        host.textContent!.indexOf("Changes")
      );
      expect(host.textContent?.match(/Secondary Repo/g)).toHaveLength(1);
      expect(host.textContent).not.toContain("secondary-branch");
      expect(secondaryToggle.getAttribute("aria-expanded")).toBe("false");

      const requestedPaths = () =>
        gitMocks.useWorkingTreeDiffTotals.mock.calls.map((call) => call[1]);
      expect(requestedPaths()).toContain("/workspace/primary");
      expect(requestedPaths()).toContain("/workspace/secondary");
      expect(secondaryToggle.textContent).toContain("+8");
      expect(secondaryToggle.textContent).toContain("-2");
      expect(
        secondaryToggle.querySelector('[data-icon="chevron-right"]')
          ?.nextElementSibling?.textContent
      ).toBe("+8-2");

      act(() => secondaryToggle.click());

      expect(host.textContent).toContain("secondary-branch");
      expect(secondaryToggle.getAttribute("aria-expanded")).toBe("true");
      expect(requestedPaths()).toContain("/workspace/secondary");
    });

    it("lists My Station files and terminals without docked or chat-panel terminals", async () => {
      addStationTerminal("Station shell");
      const pinned = addStationTerminal("Pinned shell");
      store.set(openMiniTerminalAtom, pinned);
      const chatTerminal = store.set(createChatPanelTerminalAtom, {
        name: "Chat shell",
      });
      store.set(markTerminalInitializedAtom, chatTerminal);
      store.set(terminalSessionsAtom, (sessions) => [
        ...sessions,
        { id: "agent-pty-task", name: "Agent shell", isActive: false },
      ]);
      store.set(markTerminalInitializedAtom, "agent-pty-task");

      await mount();

      expect(tabSection()?.textContent).toContain("README.md");
      expect(tabSection()?.textContent).toContain("Station shell");
      expect(tabSection()?.textContent).not.toContain("Pinned shell");
      expect(tabSection()?.textContent).not.toContain("Chat shell");
      expect(tabSection()?.textContent).not.toContain("Agent shell");
      expect(store.get(terminalSessionsAtom)).toHaveLength(4);
    });

    it("keeps the summary visible when folded and opens children in the shared Trail", async () => {
      const chat = createSessionTab({ sessionId: "parent" });
      store.set(chatPanelTabsAtom, { tabs: [chat], activeTabId: chat.id });
      const subagents: FocusedChatRailSubagent[] = Array.from(
        { length: 6 },
        (_, index) => ({
          sessionId: `child-${index}`,
          name: "Explore",
          description: `Task ${index}`,
          status: index === 0 ? "running" : "completed",
        })
      );
      await mount(subagents, { sessionId: "parent" });
      const host = view === "wide rail" ? container : menuHost;
      const section = [...host.querySelectorAll("section")].find((item) =>
        item.textContent?.includes("Subagents")
      )!;
      expect(section.textContent).toContain("1 active · 5 finished");
      expect(section.textContent).not.toContain("Task 0");
      act(() =>
        [...section.querySelectorAll("button")]
          .find((button) => button.textContent?.includes("1 active"))!
          .click()
      );
      expect(store.get(sessionTrailSurfaceAtom)).toMatchObject({
        kind: "subagents",
        sessionId: "parent",
      });
      expect(store.get(sideChatVisibleAtom)).toBe(false);
      expect(store.get(chatPanelTabsAtom).activeTabId).toBe(chat.id);
    });

    it("opens a preview row directly in Trail detail without selecting a new chat", async () => {
      const chat = createSessionTab({ sessionId: "parent" });
      store.set(chatPanelTabsAtom, { tabs: [chat], activeTabId: chat.id });
      await mount(
        [
          {
            sessionId: "child",
            name: "Explore",
            description: "Inspect layout",
            status: "completed",
          },
        ],
        { sessionId: "parent" }
      );
      const host = view === "wide rail" ? container : menuHost;
      act(() =>
        host
          .querySelector<HTMLButtonElement>(
            '[data-workstation-group-toggle="subagents"]'
          )!
          .click()
      );
      act(() =>
        [...host.querySelectorAll("button")]
          .find((button) => button.textContent?.includes("Inspect layout"))!
          .click()
      );
      expect(store.get(sessionTrailSurfaceAtom)).toMatchObject({
        kind: "subagents",
        childSessionId: "child",
        sessionId: "parent",
      });
      expect(store.get(sideChatSessionIdAtom)).toBeNull();
      expect(store.get(chatPanelTabsAtom).activeTabId).toBe(chat.id);
    });

    it.each([0, 3])(
      "keeps View all reachable with %s sources while folded and after refolding",
      async (count) => {
        const openSources = vi.fn();
        await mount(
          undefined,
          undefined,
          Array.from({ length: count }, (_, index) => ({
            kind: "link" as const,
            key: `link:${index}`,
            url: `https://example.com/${index}`,
            label: `Source ${index}`,
          })),
          openSources
        );
        const host = view === "wide rail" ? container : menuHost;
        expect(host.textContent).not.toContain("Sources duplicate tab");
        const toggle = host.querySelector<HTMLButtonElement>(
          '[data-workstation-group-toggle="sources"]'
        )!;
        const section = toggle.closest("section")!;
        const viewAll = () =>
          [...section.querySelectorAll("button")].filter((button) =>
            button.textContent?.includes("View all")
          );

        expect(toggle.getAttribute("aria-expanded")).toBe("false");
        expect(viewAll()).toHaveLength(1);
        expect(section.textContent).not.toContain("Source 0");
        act(() => viewAll()[0].click());
        expect(openSources).toHaveBeenCalledTimes(1);
        expect(toggle.getAttribute("aria-expanded")).toBe("false");

        act(() => toggle.click());
        expect(viewAll()).toHaveLength(1);
        if (count > 0) expect(section.textContent).toContain("Source 0");
        act(() => toggle.click());
        expect(section.textContent).not.toContain("Source 0");
        expect(viewAll()).toHaveLength(1);
        act(() => viewAll()[0].click());
        expect(openSources).toHaveBeenCalledTimes(2);
      }
    );

    it("folds sources by default and opens links in the Browser and images in the viewer", async () => {
      openLinkMocks.openInBrowserApp.mockClear();
      const image = (index: number): FocusedChatRailSource => ({
        kind: "image",
        key: `image:${index}`,
        ref: `data:image/png;base64,${index}`,
        fileName: index === 0 ? null : `shot-${index}.png`,
      });
      const link = (index: number): FocusedChatRailSource => ({
        kind: "link",
        key: `link:${index}`,
        url: `https://example.com/page-${index}`,
        label: `example.com/page-${index}`,
      });
      const openSources = vi.fn();
      await mount(
        undefined,
        undefined,
        [
          ...["exec", "cua_repl", "apply_patch"].map(
            (group): FocusedChatRailSource => ({
              kind: "tool-group",
              key: `tool-group:${group}`,
              group,
              operations: [],
            })
          ),
          link(0),
          image(0),
          image(1),
          link(1),
          link(2),
          image(2),
          link(3),
        ],
        openSources
      );

      const host = view === "wide rail" ? container : menuHost;
      const sourceSection = () =>
        [...host.querySelectorAll("section")].find((section) =>
          section.textContent?.includes("10 Sources")
        );

      // Default collapsed: no preview rows or image reads, but navigation remains available.
      expect(sourceSection()).toBeDefined();
      expect(sourceSection()?.textContent).not.toContain("example.com");
      expect(sourceSection()?.querySelector("img")).toBeNull();
      expect(sourceSection()?.textContent).toContain("View all");
      act(() =>
        [...sourceSection()!.querySelectorAll("button")]
          .find((row) => row.textContent?.includes("View all"))!
          .click()
      );
      expect(openSources).toHaveBeenCalledTimes(1);

      act(() =>
        host
          .querySelector<HTMLButtonElement>(
            '[data-workstation-group-toggle="sources"]'
          )!
          .click()
      );

      const expanded = sourceSection()!;
      for (const label of ["example.com/page-0", "Image", "shot-1.png"]) {
        expect(expanded.textContent).toContain(label);
      }
      expect(expanded.textContent).not.toContain("shot-2.png");
      expect(expanded.textContent).toContain("View all");
      expect(expanded.querySelectorAll("img")).toHaveLength(2);

      // A link opens in My Station's Browser.
      const linkRow = [...expanded.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("example.com/page-0")
      )!;
      act(() => linkRow.click());
      expect(openLinkMocks.openInBrowserApp).toHaveBeenCalledWith(
        "https://example.com/page-0"
      );

      // View all delegates to the session-scoped workstation tab opener.
      act(() =>
        [...sourceSection()!.querySelectorAll("button")]
          .find((row) => row.textContent?.includes("View all"))!
          .click()
      );
      expect(openSources).toHaveBeenCalledTimes(2);
      // Summary thumbnails share the entire session gallery, not only the preview.
      act(() =>
        [...sourceSection()!.querySelectorAll("button")]
          .find((row) => row.textContent?.includes("shot-1.png"))!
          .click()
      );
      const preview = document.querySelector(
        '[data-testid="source-image-preview"]'
      );
      expect(preview?.getAttribute("data-src")).toBe("data:image/png;base64,1");
      expect(preview?.getAttribute("data-count")).toBe("3");
      expect(preview?.getAttribute("data-index")).toBe("1");
    });

    it("keeps pins excluded while collapsed and restores them only on release", async () => {
      const first = addStationTerminal("First shell");
      const second = addStationTerminal("Second shell");
      await mount();
      expect(tabSection()?.textContent).toContain("First shell");
      expect(tabSection()?.textContent).toContain("Second shell");

      await act(async () => {
        store.set(openMiniTerminalAtom, first);
        store.set(openMiniTerminalAtom, second);
        store.set(miniTerminalCollapsedAtom, true);
      });
      expect(tabSection()?.textContent).not.toContain("First shell");
      expect(tabSection()?.textContent).not.toContain("Second shell");

      await act(async () => store.set(releaseMiniTerminalSessionAtom, first));
      expect(tabSection()?.textContent).toContain("First shell");
      expect(tabSection()?.textContent).not.toContain("Second shell");

      await act(async () => store.set(closeMiniTerminalAtom));
      expect(tabSection()?.textContent).toContain("First shell");
      expect(tabSection()?.textContent).toContain("Second shell");
      expect(store.get(terminalSessionsAtom)).toHaveLength(2);
    });
  }
);
