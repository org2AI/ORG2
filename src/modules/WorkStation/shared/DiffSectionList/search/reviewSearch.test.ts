import { SearchQuery } from "@codemirror/search";
import { describe, expect, it } from "vitest";

import { searchReview } from "./reviewSearch";
import { REVIEW_SEARCH_LIMIT } from "./reviewSearchTypes";

describe("review payload search", () => {
  const files = [
    {
      path: "a.ts",
      oldContent: "same\nremoved alpha",
      newContent: "same\nadded alpha",
    },
    { path: "b.ts", oldContent: "deleted alpha", newContent: "" },
  ];
  it("finds added and removed text across all files, including full deletions", () => {
    expect(
      searchReview(files, new SearchQuery({ search: "alpha" })).map(
        ({ path, side }) => [path, side]
      )
    ).toEqual([
      ["a.ts", "new"],
      ["a.ts", "old"],
      ["b.ts", "old"],
    ]);
  });
  it("counts unchanged context once", () => {
    expect(
      searchReview(files, new SearchQuery({ search: "same" }))
    ).toHaveLength(1);
  });
  it("supports file filtering, match modes, and invalid expressions", () => {
    expect(
      searchReview(
        files.filter((f) => f.path === "b.ts"),
        new SearchQuery({ search: "ALPHA", caseSensitive: true })
      )
    ).toHaveLength(0);
    expect(
      searchReview(files, new SearchQuery({ search: "alph", wholeWord: true }))
    ).toHaveLength(0);
    expect(
      searchReview(files, new SearchQuery({ search: "[", regexp: true }))
    ).toHaveLength(0);
    expect(
      searchReview(files, new SearchQuery({ search: "a[a-z]+a", regexp: true }))
    ).toHaveLength(3);
  });
  it("bounds results and skips unavailable/binary payloads", () => {
    expect(
      searchReview(
        [{ path: "big", newContent: "a ".repeat(2000) }],
        new SearchQuery({ search: "a" })
      )
    ).toHaveLength(REVIEW_SEARCH_LIMIT);
    expect(
      searchReview(
        [
          { path: "binary", isBinary: true, newContent: "a" },
          { path: "missing", isUnavailable: true, newContent: "a" },
        ],
        new SearchQuery({ search: "a" })
      )
    ).toHaveLength(0);
  });
});
