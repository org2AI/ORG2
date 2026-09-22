import { describe, expect, it } from "vitest";

import type { GitHubIssue, OpenPRItem } from "@src/api/tauri/github";

import {
  mapIssueToManagedItem,
  mapPrToManagedItem,
} from "./githubManagedItemModel";
import {
  GITHUB_FACET,
  GITHUB_QUICK_FILTER,
  buildGitHubWorkItemFacets,
  clearGitHubFilters,
  countActiveGitHubFilters,
  isGitHubFacetValueSelected,
  isGitHubQuickFilterActive,
  toggleGitHubFacetValue,
  toggleGitHubQuickFilter,
} from "./githubWorkItemsFilterFacets";
import {
  parseGitHubSearchQuery,
  serializeGitHubSearchQuery,
} from "./githubWorkItemsSearchQuery";
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

function issue(overrides: Partial<GitHubIssue>): GitHubIssue {
  return {
    number: 1,
    title: "Issue",
    state: "open",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-20T00:00:00.000Z",
    comments: 0,
    labels: [],
    assignees: [],
    milestone: null,
    user: { login: "alice", avatar_url: "" },
    ...overrides,
  } as GitHubIssue;
}

function pullRequest(overrides: Partial<OpenPRItem>): OpenPRItem {
  return {
    number: 1,
    url: "",
    title: "PR",
    state: "open",
    author_login: "alice",
    author_avatar_url: null,
    requested_reviewer_logins: [],
    head_branch: "feat/x",
    base_branch: "develop",
    draft: false,
    ci_status: "success",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("GitHub work-item filter facets", () => {
  it("counts issue values for the selected repository, most used first", () => {
    const items = [
      mapIssueToManagedItem(
        issue({
          number: 1,
          labels: [{ name: "bug", color: "f00" }],
          milestone: "v2",
        } as Partial<GitHubIssue>),
        source
      ),
      mapIssueToManagedItem(
        issue({
          number: 2,
          state: "closed",
          user: { login: "Bob", avatar_url: "" },
          labels: [
            { name: "Bug", color: "f00" },
            { name: "ui", color: "0f0" },
          ],
          assignees: [{ login: "viewer", avatar_url: "" }],
        } as Partial<GitHubIssue>),
        source
      ),
      mapIssueToManagedItem(issue({ number: 3 }), {
        ...source,
        repoFullName: "other/repo",
      }),
      mapPrToManagedItem(pullRequest({ author_login: "carol" }), source),
    ];

    const facets = buildGitHubWorkItemFacets(items, "issue", "acme/repo");

    expect(facets.labels).toEqual([
      { value: "bug", count: 2 },
      { value: "ui", count: 1 },
    ]);
    expect(facets.authors).toEqual([
      { value: "alice", count: 1 },
      { value: "Bob", count: 1 },
    ]);
    expect(facets.assignees).toEqual([{ value: "viewer", count: 1 }]);
    expect(facets.milestones).toEqual([{ value: "v2", count: 1 }]);
    expect(facets.baseBranches).toEqual([]);
  });

  it("offers only filterable check states for pull requests", () => {
    const facets = buildGitHubWorkItemFacets(
      [
        mapPrToManagedItem(
          pullRequest({
            ci_status: "failure",
            requested_reviewer_logins: ["bob"],
          }),
          source
        ),
        mapPrToManagedItem(
          pullRequest({ number: 2, ci_status: "none", base_branch: "main" }),
          source
        ),
      ],
      "pr",
      "acme/repo"
    );

    expect(facets.ciStatuses).toEqual([{ value: "failure", count: 1 }]);
    expect(facets.reviewRequested).toEqual([{ value: "bob", count: 1 }]);
    expect(facets.baseBranches.map((option) => option.value)).toEqual([
      "develop",
      "main",
    ]);
    expect(facets.labels).toEqual([]);
  });

  it("toggles facet values into the serialized query", () => {
    const query = parseGitHubSearchQuery("is:issue is:open crash");
    toggleGitHubFacetValue(query, GITHUB_FACET.LABEL, "needs review");
    toggleGitHubFacetValue(query, GITHUB_FACET.AUTHOR, "alice");
    toggleGitHubFacetValue(query, GITHUB_FACET.AUTHOR, "bob");

    expect(serializeGitHubSearchQuery(query)).toBe(
      'is:issue is:open author:alice author:bob label:"needs review" crash'
    );
    expect(
      isGitHubFacetValueSelected(query, GITHUB_FACET.AUTHOR, "ALICE")
    ).toBe(true);

    toggleGitHubFacetValue(query, GITHUB_FACET.AUTHOR, "Alice");
    expect(query.authors).toEqual(["bob"]);

    toggleGitHubFacetValue(query, GITHUB_FACET.CI_STATUS, "failure");
    toggleGitHubFacetValue(query, GITHUB_FACET.CI_STATUS, "unknown");
    expect(query.ciStatuses).toEqual(["failure"]);
  });

  it("replaces quick filters that contradict each other", () => {
    const query = parseGitHubSearchQuery("is:issue assignee:bob label:bug");

    toggleGitHubQuickFilter(query, GITHUB_QUICK_FILTER.NO_ASSIGNEE);
    expect(query).toMatchObject({ assignees: [], missing: ["assignee"] });

    toggleGitHubQuickFilter(query, GITHUB_QUICK_FILTER.ASSIGNED_TO_ME);
    expect(query).toMatchObject({ assignees: ["@me"], missing: [] });

    toggleGitHubQuickFilter(query, GITHUB_QUICK_FILTER.NO_LABEL);
    expect(query).toMatchObject({ labels: [], missing: ["label"] });

    toggleGitHubQuickFilter(query, GITHUB_QUICK_FILTER.DRAFT);
    toggleGitHubQuickFilter(query, GITHUB_QUICK_FILTER.READY_FOR_REVIEW);
    expect(query.draft).toBe(false);
    expect(isGitHubQuickFilterActive(query, GITHUB_QUICK_FILTER.DRAFT)).toBe(
      false
    );

    toggleGitHubQuickFilter(query, GITHUB_QUICK_FILTER.RECENTLY_UPDATED);
    toggleGitHubQuickFilter(query, GITHUB_QUICK_FILTER.STALE);
    expect(serializeGitHubSearchQuery(query)).toContain("updated:<30d");
    expect(
      isGitHubQuickFilterActive(query, GITHUB_QUICK_FILTER.RECENTLY_UPDATED)
    ).toBe(false);

    toggleGitHubQuickFilter(query, GITHUB_QUICK_FILTER.STALE);
    expect(query.updated).toBeNull();
  });

  it("recognizes quick filters typed by hand", () => {
    const query = parseGitHubSearchQuery(
      "is:pr author:@me review-requested:@me updated:>7D linked:pr"
    );
    for (const filter of [
      GITHUB_QUICK_FILTER.CREATED_BY_ME,
      GITHUB_QUICK_FILTER.REVIEW_REQUESTED_FROM_ME,
      GITHUB_QUICK_FILTER.RECENTLY_UPDATED,
      GITHUB_QUICK_FILTER.LINKED_PR,
    ]) {
      expect(isGitHubQuickFilterActive(query, filter)).toBe(true);
    }
  });

  it("counts and clears filters without touching scope, state, or text", () => {
    const query = parseGitHubSearchQuery(
      "is:issue is:closed author:@me -label:wip no:milestone comments:>3 crash"
    );
    expect(countActiveGitHubFilters(query)).toBe(4);

    clearGitHubFilters(query);

    expect(countActiveGitHubFilters(query)).toBe(0);
    expect(serializeGitHubSearchQuery(query)).toBe("is:issue is:closed crash");
  });
});
