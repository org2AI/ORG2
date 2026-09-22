import { describe, expect, it, vi } from "vitest";

import type { GitHubIssue, OpenPRItem } from "@src/api/tauri/github";

import {
  GITHUB_ITEM_KIND,
  formatGitHubItemTimeAgo,
  getManagedGitHubItemKey,
  managedItemMatchesQuery,
  managedItemMatchesRepo,
  mapIssueToManagedItem,
  mapPrToManagedItem,
} from "./githubManagedItemModel";
import { parseGitHubSearchQuery } from "./githubWorkItemsSearchQuery";
import type { GitHubRepoSource } from "./githubWorkItemsTypes";

const source: GitHubRepoSource = {
  repoId: "repo-1",
  repoPath: "/repo",
  label: "repo",
  remoteUrl: "https://github.com/acme/repo.git",
  repoFullName: "acme/repo",
  viewerLogin: "viewer",
  permissions: null,
};
const issue = {
  number: 42,
  title: "Fix crash",
  state: "open",
  updated_at: "2026-07-20T11:59:00.000Z",
  comments: 2,
  linked_pull_requests_count: 3,
  labels: [{ name: "bug", color: "ff0000" }],
  assignees: [{ login: "viewer" }],
  user: { login: "author", avatar_url: "avatar" },
} as GitHubIssue;
const pr = {
  number: 7,
  url: "https://github.com/acme/repo/pull/7",
  title: "Ship fix",
  state: "merged",
  author_login: "author",
  author_avatar_url: "avatar",
  requested_reviewer_logins: [],
  updated_at: "2026-07-20T11:00:00.000Z",
  head_branch: "fix/crash",
  base_branch: "main",
  draft: false,
  ci_status: "success",
  created_at: "2026-07-20T10:00:00.000Z",
} as OpenPRItem;

describe("GitHub managed-item model", () => {
  it("maps issues and PRs to the shared list shape", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T12:00:00.000Z"));
    expect(mapIssueToManagedItem(issue, source)).toMatchObject({
      kind: GITHUB_ITEM_KIND.ISSUE,
      id: 42,
      repo: "acme/repo",
      author: "author",
      timeAgo: "1m",
      linkedPullRequests: 3,
    });
    expect(mapPrToManagedItem(pr, source)).toMatchObject({
      kind: GITHUB_ITEM_KIND.PR,
      id: 7,
      author: "author",
      sourceBranch: "fix/crash",
      targetBranch: "main",
      timeAgo: "1h",
    });
    vi.useRealTimers();
  });

  it("keys right-pane selections by kind, repository, and number", () => {
    expect(getManagedGitHubItemKey(mapIssueToManagedItem(issue, source))).toBe(
      "issue-acme/repo-42"
    );
    expect(getManagedGitHubItemKey(mapPrToManagedItem(pr, source))).toBe(
      "pr-acme/repo-7"
    );
  });

  it("matches repository, @me, labels, state, and free text", () => {
    const item = mapIssueToManagedItem(issue, source);
    expect(managedItemMatchesRepo(item, "acme/repo")).toBe(true);
    expect(managedItemMatchesRepo(item, "other/repo")).toBe(false);
    expect(
      managedItemMatchesQuery(
        item,
        parseGitHubSearchQuery("is:issue is:open assignee:@me label:bug crash")
      )
    ).toBe(true);
    expect(
      managedItemMatchesQuery(item, parseGitHubSearchQuery("author:someone"))
    ).toBe(false);
  });

  it("applies issue-only qualifiers and rejects pull requests for them", () => {
    const item = mapIssueToManagedItem(
      { ...issue, milestone: "v2", created_at: "2026-07-01T00:00:00.000Z" },
      source
    );
    const matches = (raw: string) =>
      managedItemMatchesQuery(
        item,
        parseGitHubSearchQuery(raw),
        Date.parse("2026-07-21T00:00:00.000Z")
      );

    expect(matches("assignee:someone,viewer")).toBe(true);
    expect(matches("-assignee:@me")).toBe(false);
    expect(matches("-label:bug")).toBe(false);
    expect(matches("-label:wip")).toBe(true);
    expect(matches("-author:author")).toBe(false);
    expect(matches("milestone:V2")).toBe(true);
    expect(matches("milestone:v3")).toBe(false);
    expect(matches("no:assignee")).toBe(false);
    expect(matches("no:milestone")).toBe(false);
    expect(matches("linked:pr")).toBe(true);
    expect(matches("-linked:pr")).toBe(false);
    expect(matches("comments:>=2")).toBe(true);
    expect(matches("comments:>2")).toBe(false);
    expect(matches("updated:>7d")).toBe(true);
    expect(matches("updated:<7d")).toBe(false);
    expect(matches("created:2026-06-30..2026-07-02")).toBe(true);
    expect(matches("draft:false")).toBe(false);
    expect(matches("base:main")).toBe(false);

    const bare = mapIssueToManagedItem(
      { ...issue, labels: [], assignees: [], milestone: null },
      source
    );
    expect(
      managedItemMatchesQuery(
        bare,
        parseGitHubSearchQuery("no:assignee no:label no:milestone")
      )
    ).toBe(true);
  });

  it("applies pull-request-only qualifiers and rejects issues for them", () => {
    const item = mapPrToManagedItem(
      { ...pr, draft: true, requested_reviewer_logins: ["Viewer"] },
      source
    );
    const matches = (raw: string) =>
      managedItemMatchesQuery(item, parseGitHubSearchQuery(raw));

    expect(matches("draft:true")).toBe(true);
    expect(matches("draft:false")).toBe(false);
    expect(matches("review-requested:@me")).toBe(true);
    expect(matches("review-requested:someone")).toBe(false);
    expect(matches("base:main,develop")).toBe(true);
    expect(matches("base:develop")).toBe(false);
    expect(matches("head:fix/crash")).toBe(true);
    expect(matches("status:success")).toBe(true);
    expect(matches("status:failure,pending")).toBe(false);
    expect(matches("label:bug")).toBe(false);
    expect(matches("no:assignee")).toBe(false);
    expect(matches("-label:bug")).toBe(true);
  });

  it("matches both displayed IDs and title text", () => {
    const item = mapIssueToManagedItem(issue, source);

    expect(managedItemMatchesQuery(item, parseGitHubSearchQuery("#42"))).toBe(
      true
    );
    expect(
      managedItemMatchesQuery(item, parseGitHubSearchQuery("Fix crash"))
    ).toBe(true);
  });

  it("preserves merged PR query semantics and time boundaries", () => {
    const item = mapPrToManagedItem(pr, source);
    expect(
      managedItemMatchesQuery(item, parseGitHubSearchQuery("is:pr is:merged"))
    ).toBe(true);
    expect(formatGitHubItemTimeAgo("invalid", 0)).toBe("");
    const now = Date.parse("2026-07-20T12:00:00.000Z");
    expect(formatGitHubItemTimeAgo("2026-07-20T07:00:00.000Z", now)).toBe("5h");
    expect(formatGitHubItemTimeAgo("2026-06-20T12:00:00.000Z", now)).toBe(
      "1mo"
    );
  });
});
