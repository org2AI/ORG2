import { describe, expect, it } from "vitest";

import { WIKI_ARTICLES, searchWikiArticles } from "./wikiArticles";

describe("wiki search", () => {
  it("searches article bodies with case-insensitive AND terms", () => {
    expect(searchWikiArticles("  CLAUDE oauth ").map(({ id }) => id)).toContain(
      "provider-auth"
    );
    expect(
      searchWikiArticles("device authorization").map(({ id }) => id)
    ).toContain("provider-auth");
    expect(searchWikiArticles("extract config").map(({ id }) => id)).toContain(
      "keys"
    );
  });
  it("returns the catalog for whitespace and no results for unknown terms", () => {
    expect(searchWikiArticles("   ")).toEqual(WIKI_ARTICLES);
    expect(searchWikiArticles("not-a-wiki-topic")).toEqual([]);
  });
});
