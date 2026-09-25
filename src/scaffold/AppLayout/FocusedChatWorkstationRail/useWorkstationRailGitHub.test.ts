// @vitest-environment jsdom
import type { TFunction } from "i18next";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { openLink } from "@src/util/ui/openLink";

import type { FocusedChatSessionContext } from "./types";
import type { SessionPullRequest } from "./useSessionPullRequests";
import { useWorkstationRailGitHub } from "./useWorkstationRailGitHub";

const { lookup, openPr, attachments } = vi.hoisted(() => ({
  lookup: vi.fn(),
  openPr: vi.fn(),
  attachments: vi.fn(() => ({
    items: [] as SessionPullRequest[],
    loading: false,
    error: false,
    refresh: vi.fn(),
  })),
}));
vi.mock("./useSessionPullRequests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./useSessionPullRequests")>()),
  useSessionPullRequests: attachments,
}));
vi.mock("@src/services/workStation/openPullRequestTab", () => ({
  openPullRequestTab: openPr,
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
  attachments.mockReturnValue({
    items: [],
    loading: false,
    error: false,
    refresh: vi.fn(),
  });
});

describe("conversation pull request association", () => {
  it("shows multiple explicit PRs despite a different session branch and deduplicates branch results", async () => {
    const make = (
      number: number,
      repoFullName = "acme/repo"
    ): SessionPullRequest => ({
      number,
      url: `https://github.com/${repoFullName}/pull/${number}`,
      repoFullName,
      title: `Attached ${number}`,
      state: "open",
      draft: false,
      headBranch: `pr-${number}`,
      ciStatus: "success",
      error: false,
    });
    attachments.mockReturnValue({
      items: [make(2153), make(2152), make(9, "other/repo")],
      loading: false,
      error: false,
      refresh: vi.fn(),
    });
    lookup.mockReturnValue({
      pr: {
        number: 2152,
        url: "https://github.com/ACME/Repo/pull/2152/files",
        state: "open",
        title: "Branch duplicate",
      },
      repoFullName: "Acme/Repo",
      ciStatus: "success",
    });
    await render({
      sessionId: "conversation",
      updatedAt: "revision",
      repoPath: "/active",
      branchName: "old-session-branch",
    });
    expect(attachments).toHaveBeenCalledWith("conversation", "revision");
    expect(latest.pullRequestItems.map((item) => item.label)).toEqual([
      "Attached 2153",
      "Attached 2152",
      "Attached 9",
    ]);
    latest.pullRequestItems[0].onClick?.({} as never);
    expect(openPr).toHaveBeenCalledWith(
      expect.objectContaining({
        prNumber: 2153,
        headBranch: "pr-2153",
        repoPath: "/active",
      })
    );
    latest.pullRequestItems[2].onClick?.({} as never);
    expect(openLink).not.toHaveBeenCalled();
    expect(openPr).toHaveBeenLastCalledWith(
      expect.objectContaining({
        prNumber: 9,
        prUrl: "https://github.com/other/repo/pull/9",
        repoPath: "",
        repoId: undefined,
      })
    );
    expect(openPr).toHaveBeenCalledTimes(2);
  });
  it("opens attached PRs in the existing detail tab before local repository resolution", async () => {
    attachments.mockReturnValue({
      items: [
        {
          number: 2153,
          url: "https://github.com/org2ai/ORG2/pull/2153",
          repoFullName: "org2ai/ORG2",
          title: "Conversation PR",
          state: "open",
          draft: false,
          headBranch: "feature",
          ciStatus: "success",
          error: false,
        },
      ],
      loading: false,
      error: false,
      refresh: vi.fn(),
    });
    lookup.mockReturnValue({ pr: null, repoFullName: null });
    await render({
      sessionId: "conversation",
      repoPath: "/active",
      branchName: "main",
    });
    latest.pullRequestItems[0].onClick?.({} as never);
    expect(openPr).toHaveBeenCalledWith(
      expect.objectContaining({
        prNumber: 2153,
        repoPath: "",
        prUrl: "https://github.com/org2ai/ORG2/pull/2153",
      })
    );
    expect(openLink).not.toHaveBeenCalled();
  });
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
