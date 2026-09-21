import { describe, expect, it } from "vitest";

import {
  GITHUB_QUERY_SCOPE,
  GITHUB_QUERY_STATE,
  createEmptyGitHubSearchQuery,
  getIssuePageStatesForQuery,
  parseGitHubSearchQuery,
  serializeGitHubSearchQuery,
} from "./githubWorkItemsSearchQuery";

describe("GitHub work-item search query", () => {
  it("parses scopes, state, quoted qualifiers, and free text", () => {
    expect(
      parseGitHubSearchQuery(
        'is:issue is:closed label:"good first issue" author:@me crash report'
      )
    ).toEqual({
      ...createEmptyGitHubSearchQuery(),
      scope: GITHUB_QUERY_SCOPE.ISSUE,
      state: GITHUB_QUERY_STATE.CLOSED,
      labels: ["good first issue"],
      authors: ["@me"],
      freeText: "crash report",
    });
  });

  it("normalizes merged and conflicting scopes", () => {
    expect(parseGitHubSearchQuery("is:merged")).toMatchObject({
      scope: GITHUB_QUERY_SCOPE.PR,
      state: GITHUB_QUERY_STATE.MERGED,
    });
    expect(parseGitHubSearchQuery("is:issue is:pr").scope).toBe(
      GITHUB_QUERY_SCOPE.ALL
    );
  });

  it("round-trips supported qualifiers with spaces", () => {
    const parsed = parseGitHubSearchQuery(
      'is:issue state:all assignee:@me label:"needs review" hello'
    );
    expect(serializeGitHubSearchQuery(parsed)).toBe(
      'is:issue state:all assignee:@me label:"needs review" hello'
    );
  });

  it("parses exclusions, missing fields, and pull request qualifiers", () => {
    expect(
      parseGitHubSearchQuery(
        "is:pr -author:bot -label:wip no:assignee draft:false base:develop status:failure review-requested:@me"
      )
    ).toMatchObject({
      excludedAuthors: ["bot"],
      excludedLabels: ["wip"],
      missing: ["assignee"],
      draft: false,
      baseBranches: ["develop"],
      ciStatuses: ["failure"],
      reviewRequested: ["@me"],
      freeText: "",
    });
    expect(parseGitHubSearchQuery("is:draft").draft).toBe(true);
    expect(parseGitHubSearchQuery("-is:draft").draft).toBe(false);
    expect(parseGitHubSearchQuery("-linked:pr").linkedPullRequest).toBe(false);
  });

  it("collects repeated and comma-separated logins without duplicates", () => {
    expect(
      parseGitHubSearchQuery("author:alice,bob author:Alice author:carol")
        .authors
    ).toEqual(["alice", "bob", "carol"]);
  });

  it("parses count and date ranges", () => {
    expect(
      parseGitHubSearchQuery(
        "comments:>=5 updated:>7d created:2026-01-01..2026-02-01"
      )
    ).toMatchObject({
      comments: { kind: "compare", operator: ">=", operand: "5" },
      updated: { kind: "compare", operator: ">", operand: "7d" },
      created: { kind: "between", from: "2026-01-01", to: "2026-02-01" },
    });
  });

  it("keeps unfinished or unknown qualifiers as free text", () => {
    for (const raw of [
      "label:",
      "author:alice,",
      "base:,main",
      "comments:>",
      "updated:..",
      "status:green",
      "no:reviewer",
      "-milestone:v1",
      "https://example.com/x",
    ]) {
      expect(parseGitHubSearchQuery(raw).freeText).toBe(raw);
    }
  });

  it("round-trips every qualifier through the canonical order", () => {
    const canonical =
      'is:pr is:open draft:true assignee:@me -assignee:bob author:alice -author:bot review-requested:@me label:"needs review" -label:wip milestone:"v2 beta" no:label base:develop head:fix/crash status:failure -linked:pr comments:>5 updated:<30d created:2026-01-01..2026-02-01 crash';
    expect(serializeGitHubSearchQuery(parseGitHubSearchQuery(canonical))).toBe(
      canonical
    );
  });

  it("selects issue request states without changing PR behavior", () => {
    expect(
      getIssuePageStatesForQuery(parseGitHubSearchQuery("is:issue is:open"))
    ).toEqual(["open"]);
    expect(
      getIssuePageStatesForQuery(parseGitHubSearchQuery("is:issue state:all"))
    ).toEqual(["open", "closed"]);
    expect(
      getIssuePageStatesForQuery(parseGitHubSearchQuery("is:pr is:open"))
    ).toEqual([]);
  });
});
