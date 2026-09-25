// @vitest-environment jsdom
import type { TFunction } from "i18next";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FocusedChatSessionContext } from "./types";
import { useWorkstationRailGitHub } from "./useWorkstationRailGitHub";

const { lookup, openPr } = vi.hoisted(() => ({
  lookup: vi.fn(),
  openPr: vi.fn(),
}));
vi.mock("jotai", () => ({ useSetAtom: () => openPr }));
vi.mock("@src/store/chatPanel/chatPanelTabsAtom", () => ({
  openGitHubPrInChatPanelTabAtom: {},
}));
vi.mock("@src/hooks/git/useActiveRepoRef", () => ({
  useActiveRepoRef: () => ({ repoId: "active", repoPath: "/active" }),
}));
vi.mock("@src/hooks/git/useRepoSelection", () => ({
  useRepoSelection: () => ({ currentBranch: "main" }),
}));
vi.mock("@src/hooks/git/useBranchPullRequestStatus", () => ({
  useBranchPullRequestStatus: lookup,
}));
vi.mock("@src/services/workStation/WorkStationViewService", () => ({
  WorkStationViewService: {},
}));
vi.mock("@src/util/ui/openLink", () => ({ openLink: vi.fn() }));
vi.mock("@src/assets/channelIcons/github.svg", () => ({ default: () => null }));

const t = ((key: string) => key) as TFunction;
let latest: ReturnType<typeof useWorkstationRailGitHub>;
function Probe({ context }: { context?: FocusedChatSessionContext }) {
  const value = useWorkstationRailGitHub({ sessionContext: context, t });
  useEffect(() => {
    latest = value;
  }, [value]);
  return null;
}
const roots: Array<ReturnType<typeof createRoot>> = [];
async function render(context?: FocusedChatSessionContext) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  await act(async () => root.render(createElement(Probe, { context })));
}
afterEach(() => {
  roots.splice(0).forEach((root) => act(() => root.unmount()));
  vi.clearAllMocks();
});

describe("conversation pull request association", () => {
  it("uses the session worktree and opens native PR details with that scope", async () => {
    lookup.mockImplementation(({ repoPath }) => ({
      pr:
        repoPath === "/worktree"
          ? {
              number: 8,
              title: "Session work",
              state: "open",
              draft: true,
              url: "https://github.com/acme/repo/pull/8",
            }
          : null,
      ciStatus: "failure",
    }));
    await render({
      repoPath: "/repo",
      worktreePath: "/worktree",
      branchName: "base",
      worktreeBranchName: "session",
    });
    expect(lookup).toHaveBeenCalledWith(
      expect.objectContaining({
        repoPath: "/worktree",
        branchName: "session",
        includeClosed: true,
      })
    );
    expect(latest.pullRequestItems[0].label).toBe("Session work");
    expect(latest.pullRequestItems[0].status?.state).toBe("failure");
    latest.pullRequestItems[0].onClick?.({} as never);
    expect(openPr).toHaveBeenCalledWith(
      expect.objectContaining({
        repoPath: "/worktree",
        headBranch: "session",
        prStatus: "draft",
        prNumber: 8,
      })
    );
    expect(latest.sessionItems).toEqual([]);
    expect(
      latest.workspaceItems.some((item) => item.key.startsWith("pull-request"))
    ).toBe(false);
  });
  it("does not borrow an active-workspace PR when the conversation scope is unresolved", async () => {
    lookup.mockImplementation(({ repoPath }) => ({
      pr:
        repoPath === "/active"
          ? {
              number: 1,
              state: "open",
              url: "https://github.com/acme/repo/pull/1",
            }
          : null,
    }));
    await render({ branchName: "other" });
    expect(latest.pullRequestItems).toEqual([]);
  });
  it("reuses one lookup when conversation and workspace match", async () => {
    lookup.mockReturnValue({
      pr: null,
      compareUrl: "https://github.com/acme/repo/compare",
    });
    await render({ repoPath: "/active", branchName: "main" });
    expect(
      lookup.mock.calls.filter(
        ([options]) => options.repoPath && options.branchName
      )
    ).toHaveLength(1);
    expect(
      latest.workspaceItems.some((item) => item.key === "compare-branch")
    ).toBe(true);
  });
});
