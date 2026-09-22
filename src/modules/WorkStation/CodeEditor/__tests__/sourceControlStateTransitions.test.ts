import { describe, expect, it } from "vitest";

import type { PanelState, WorkStationTab } from "@src/store/workstation/tabs";
import type { GitFile } from "@src/types/git/types";

import { deriveSourceControlMainProps } from "../Panels/EditorMainPane/content/sourceControlMainProps";
import {
  rememberSourceControlFocusPath,
  setSourceControlMainMode,
  switchSourceControlCategory,
} from "../sourceControlStateTransitions";

function sourceControlTab(data: Record<string, unknown> = {}): WorkStationTab {
  return {
    id: "source-control",
    type: "source-control",
    title: "Source Control",
    data,
  } as WorkStationTab;
}

function fileTab(): WorkStationTab {
  return {
    id: "file:/repo/README.md",
    type: "file",
    title: "README.md",
    data: { path: "/repo/README.md" },
  } as WorkStationTab;
}

function panel(data: Record<string, unknown> = {}): PanelState {
  return {
    tabs: [fileTab(), sourceControlTab(data)],
    activeTabId: "source-control",
  };
}

function changedFile(path = "src/a.ts"): GitFile {
  return {
    id: `${path}-0`,
    path,
    status: "modified",
    staged: false,
    additions: 1,
    deletions: 0,
    original_path: null,
  };
}

describe("Source Control Focus hand-off", () => {
  it("opens the last file inspected in All Changes when Focus is selected", () => {
    const file = changedFile();
    const allChangesState = panel({ mode: "all-changes", focusPath: null });

    const remembered = rememberSourceControlFocusPath(
      allChangesState,
      "/repo/src/a.ts"
    );
    const rememberedTab = remembered.tabs.find(
      (tab) => tab.type === "source-control"
    );
    expect(rememberedTab?.data).toMatchObject({
      mode: "all-changes",
      focusPath: "/repo/src/a.ts",
    });

    const focused = setSourceControlMainMode(remembered, "focus");
    const focusedTab = focused.tabs.find(
      (tab) => tab.type === "source-control"
    );
    const view = deriveSourceControlMainProps({
      tabData: focusedTab?.data ?? {},
      gitFilesByPath: new Map([[file.path, file]]),
      sourceControlFiles: [file],
      sourceControlFilterMode: "uncommitted",
      repoPath: "/repo",
      activeRepoRoot: "/repo",
    });

    expect(view.mode).toBe("focus");
    expect(view.hasFocus).toBe(true);
    expect(view.focusGitFile).toBe(file);
  });

  it("uses the latest file after repeated All Changes selections", () => {
    const first = rememberSourceControlFocusPath(
      panel({ mode: "all-changes" }),
      "/repo/src/a.ts"
    );
    const latest = rememberSourceControlFocusPath(first, "/repo/src/b.ts");
    const sourceControl = latest.tabs.find(
      (tab) => tab.type === "source-control"
    );

    expect(sourceControl?.data.focusPath).toBe("/repo/src/b.ts");
    expect(sourceControl?.data.mode).toBe("all-changes");
  });

  it("retains the remembered file across mode switches and clears history detail", () => {
    const initial = panel({
      mode: "all-changes",
      focusPath: "/repo/src/a.ts",
      historySelection: { type: "commit", commitSha: "abc" },
    });

    const focused = setSourceControlMainMode(initial, "focus");
    const allChanges = setSourceControlMainMode(focused, "all-changes");
    const sourceControl = allChanges.tabs.find(
      (tab) => tab.type === "source-control"
    );

    expect(sourceControl?.data).toMatchObject({
      mode: "all-changes",
      focusPath: "/repo/src/a.ts",
      historySelection: null,
    });
  });

  it("does not alter unrelated tabs or panels without Source Control", () => {
    const initial = panel({ mode: "all-changes" });
    const unrelatedTab = initial.tabs[0];
    const updated = rememberSourceControlFocusPath(initial, "/repo/src/a.ts");
    expect(updated.tabs[0]).toBe(unrelatedTab);
    expect(updated.activeTabId).toBe(initial.activeTabId);

    const withoutSourceControl: PanelState = {
      tabs: [fileTab()],
      activeTabId: "file:/repo/README.md",
    };
    expect(
      rememberSourceControlFocusPath(withoutSourceControl, "/repo/src/a.ts")
    ).toBe(withoutSourceControl);
    expect(setSourceControlMainMode(withoutSourceControl, "focus")).toBe(
      withoutSourceControl
    );
  });
});

describe("Source Control category switching", () => {
  const counts = { uncommitted: 86, unstaged: 80, staged: 6, stashed: 64 };
  it.each([
    "uncommitted",
    "unstaged",
    "staged",
    "stashed",
    "history",
    "pr",
    "issues",
  ] as const)("clears the previous detail when switching to %s", (category) => {
    const initial = panel({
      mode: "all-changes",
      focusPath: "/repo/src/a.ts",
      historySelection: { type: "stash", commitSha: "abc" },
      staged: false,
      fileCount: 86,
    });
    const updated = switchSourceControlCategory(initial, category, counts);
    expect(updated.tabs[0]).toBe(initial.tabs[0]);
    expect(updated.activeTabId).toBe(initial.activeTabId);
    expect(updated.tabs[1].data).toMatchObject({
      mode: "focus",
      focusPath: null,
      historySelection: null,
    });
    if (category in counts) {
      expect(updated.tabs[1].data.staged).toBe(category === "staged");
      expect(updated.tabs[1].data.fileCount).toBe(
        counts[category as keyof typeof counts]
      );
    }
    const view = deriveSourceControlMainProps({
      tabData: updated.tabs[1].data,
      gitFilesByPath: new Map([["src/a.ts", changedFile()]]),
      sourceControlFiles: [changedFile()],
      sourceControlFilterMode: category,
      repoPath: "/repo",
      activeRepoRoot: "/repo",
    });
    expect(view.hasFocus).toBe(false);
    expect(view.focusGitFile).toBeNull();
    expect(view.historySelection).toBeNull();
    expect(view.mode).toBe("focus");
  });
  it("does not create a Source Control tab when none is open", () => {
    const state = { tabs: [fileTab()], activeTabId: "file:/repo/README.md" };
    expect(switchSourceControlCategory(state, "stashed", counts)).toBe(state);
  });
});
