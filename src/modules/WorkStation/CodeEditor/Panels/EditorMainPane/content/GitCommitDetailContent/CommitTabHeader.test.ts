// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import type { CommitDiffResult } from "@src/api/http/git/types";
import { FileHeaderToolbarContext } from "@src/features/FileHeader/FileHeaderToolbarContext";
import { diffViewModeAtom } from "@src/store/workstation/codeEditor";

import { CommitTabHeader } from "./CommitTabHeader";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/util/ui/theme/themeUtils", () => ({
  useCurrentTheme: () => ({ isDark: false }),
}));

it("shares file controls, moves the menu to the host, and cleans it up on close", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect = disconnect;
    }
  );
  const container = document.createElement("div");
  const toolbar = document.createElement("div");
  document.body.append(container, toolbar);
  const root = createRoot(container);
  const store = createStore();
  store.set(diffViewModeAtom, "split");
  const onClose = vi.fn();
  const onOpenInNewTab = vi.fn();
  const author = {
    name: "Ada",
    email: "ada@example.com",
    date: new Date(Date.now() - 86_400_000).toISOString(),
  };
  const commitDiff: CommitDiffResult = {
    author,
    committer: author,
    commit_sha: "abc1234",
    short_sha: "abc1234",
    summary: "Merge pull request #1683 from Harry19081/dev/row-action",
    body: "",
    files: [],
    stats: { insertions: 1, deletions: 2, files_changed: 1 },
    parent_mode: "first-parent",
    parent_sha: "parent",
    parent_shas: ["parent"],
    selected_parent_index: 0,
  };
  const render = (target: HTMLElement | null) =>
    act(() =>
      root.render(
        createElement(
          Provider,
          { store },
          createElement(
            FileHeaderToolbarContext.Provider,
            { value: target },
            createElement(CommitTabHeader, {
              shortSha: "abc1234",
              commitMessage: "Saved changes",
              commitDiff,
              publishToWorkstationHeader: false,
              onClose,
              onOpenInNewTab,
            })
          )
        )
      )
    );
  try {
    render(null);
    const summary = container.querySelector(
      '[title="Merge pull request #1683 from Harry19081/dev/row-action"]'
    );
    expect(summary?.textContent).toBe(commitDiff.summary);
    expect(
      container.querySelectorAll('[data-icon="chevron-right"]')
    ).toHaveLength(1);
    expect(
      summary?.previousElementSibling?.previousElementSibling?.textContent
    ).toBe("abc1234");
    expect(summary?.childElementCount).toBe(0);
    const toggle = container.querySelector<HTMLButtonElement>(
      '[aria-label="workstation.switchToUnifiedDiff"]'
    );
    expect(toggle).not.toBeNull();
    act(() => toggle!.click());
    expect(store.get(diffViewModeAtom)).toBe("unified");

    render(toolbar);
    expect(container.querySelector('[aria-haspopup="menu"]')).toBeNull();
    expect(toolbar.querySelector('[aria-haspopup="menu"]')).not.toBeNull();
    expect(
      container.querySelector('[aria-label="workstation.switchToSplitDiff"]')
    ).toBeNull();
    const close = container.querySelector<HTMLButtonElement>(
      '[aria-label="common:actions.close"]'
    );
    expect(close).not.toBeNull();
    const open = container.querySelector<HTMLButtonElement>(
      '[aria-label="common:actions.openInNewTab"]'
    );
    expect(open).not.toBeNull();
    expect(close!.previousElementSibling).toBe(open);
    expect(open!.parentElement?.previousElementSibling?.textContent).toContain(
      "Ada1d"
    );
    act(() => open!.click());
    expect(onOpenInNewTab).toHaveBeenCalledOnce();
    act(() => close!.click());
    expect(onClose).toHaveBeenCalledOnce();
    act(() => root.render(null));
    expect(toolbar.childElementCount).toBe(0);
  } finally {
    act(() => root.unmount());
    container.remove();
    toolbar.remove();
    vi.unstubAllGlobals();
  }
});
