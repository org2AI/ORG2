import { describe, expect, it } from "vitest";

import { parseGitHubSearchQuery } from "./githubWorkItemsSearchQuery";
import { getOpsPrListStates } from "./githubWorkItemsViewCache";
import {
  areRequestedPrStatesLoaded,
  normalizeGitHubSearchQueryForScope,
} from "./useGitHubWorkItemsViewState";

describe("GitHub work-items view state model", () => {
  it("canonicalizes finished qualifiers and leaves unfinished ones as typed", () => {
    expect(
      normalizeGitHubSearchQueryForScope(
        "issue",
        "is:issue is:open crash -label:wip author:alice,bob"
      )
    ).toBe("is:issue is:open author:alice author:bob -label:wip crash");
    expect(
      normalizeGitHubSearchQueryForScope(
        "issue",
        "is:issue is:open author:alice,"
      )
    ).toBe("is:issue is:open author:alice,");
    expect(
      normalizeGitHubSearchQueryForScope("pr", "is:pr is:open updated:>")
    ).toBe("is:pr is:open updated:>");
  });

  it("preserves the selected PR state and routes it to the matching loader", () => {
    const closedQuery = normalizeGitHubSearchQueryForScope(
      "pr",
      "is:pr is:closed author:@me sidebar"
    );
    expect(closedQuery).toBe("is:pr is:closed author:@me sidebar");
    expect(
      getOpsPrListStates(parseGitHubSearchQuery(closedQuery).state)
    ).toEqual(["closed"]);

    expect(
      normalizeGitHubSearchQueryForScope(
        "pr",
        "is:pr is:merged author:@me sidebar"
      )
    ).toBe("is:pr is:merged author:@me sidebar");
  });

  it("defaults PR queries without a state to open", () => {
    expect(normalizeGitHubSearchQueryForScope("pr", "is:pr sidebar")).toBe(
      "is:pr is:open sidebar"
    );
  });

  it("keeps the Closed view loading until closed PR data is available", () => {
    expect(areRequestedPrStatesLoaded(["closed"], true, false)).toBe(false);
    expect(areRequestedPrStatesLoaded(["closed"], true, true)).toBe(true);
    expect(areRequestedPrStatesLoaded(["open"], true, false)).toBe(true);
  });

  it("keeps an editable separator after qualifiers and typed search terms", () => {
    expect(
      normalizeGitHubSearchQueryForScope("issue", "is:issue is:open")
    ).toBe("is:issue is:open ");
    expect(
      normalizeGitHubSearchQueryForScope("issue", "is:issue is:open 68 ")
    ).toBe("is:issue is:open 68 ");
  });

  it("repairs text typed directly after a state qualifier", () => {
    expect(
      normalizeGitHubSearchQueryForScope("issue", "is:issue is:open68")
    ).toBe("is:issue is:open 68");
  });
});
