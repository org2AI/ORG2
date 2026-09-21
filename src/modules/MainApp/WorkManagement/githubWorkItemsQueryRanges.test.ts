import { describe, expect, it } from "vitest";

import {
  matchesGitHubDateRange,
  matchesGitHubNumberRange,
} from "./githubWorkItemsQueryRanges";
import type { GitHubQueryRange } from "./githubWorkItemsSearchQuery";

const NOW = new Date(2026, 8, 20, 12, 0, 0).getTime();
const at = (day: number, hour = 12) =>
  new Date(2026, 8, day, hour, 0, 0).toISOString();
const compare = (
  operator: ">" | ">=" | "<" | "<=",
  operand: string
): GitHubQueryRange => ({ kind: "compare", operator, operand });

describe("GitHub work-item query ranges", () => {
  it("treats a calendar date as the whole local day", () => {
    expect(
      matchesGitHubDateRange(at(10, 23), compare(">", "2026-09-10"), NOW)
    ).toBe(false);
    expect(
      matchesGitHubDateRange(at(11, 0), compare(">", "2026-09-10"), NOW)
    ).toBe(true);
    expect(
      matchesGitHubDateRange(at(10, 0), compare(">=", "2026-09-10"), NOW)
    ).toBe(true);
    expect(
      matchesGitHubDateRange(at(10, 0), compare("<", "2026-09-10"), NOW)
    ).toBe(false);
    expect(
      matchesGitHubDateRange(at(10, 23), compare("<=", "2026-09-10"), NOW)
    ).toBe(true);
    expect(
      matchesGitHubDateRange(
        at(10, 9),
        { kind: "exact", operand: "2026-09-10" },
        NOW
      )
    ).toBe(true);
  });

  it("resolves relative ages against now", () => {
    expect(matchesGitHubDateRange(at(15), compare(">", "7d"), NOW)).toBe(true);
    expect(matchesGitHubDateRange(at(10), compare(">", "7d"), NOW)).toBe(false);
    expect(matchesGitHubDateRange(at(10), compare("<", "1w"), NOW)).toBe(true);
    expect(
      matchesGitHubDateRange(at(20, 11), { kind: "exact", operand: "2h" }, NOW)
    ).toBe(true);
  });

  it("matches inclusive date spans", () => {
    const span: GitHubQueryRange = {
      kind: "between",
      from: "2026-09-01",
      to: "2026-09-10",
    };
    expect(matchesGitHubDateRange(at(10, 23), span, NOW)).toBe(true);
    expect(matchesGitHubDateRange(at(11, 0), span, NOW)).toBe(false);
  });

  it("matches nothing when a range cannot be resolved", () => {
    expect(matchesGitHubDateRange(at(10), compare(">", "soon"), NOW)).toBe(
      false
    );
    expect(matchesGitHubDateRange("invalid", compare(">", "7d"), NOW)).toBe(
      false
    );
    expect(matchesGitHubNumberRange(3, compare(">", "many"))).toBe(false);
  });

  it("compares counts", () => {
    expect(matchesGitHubNumberRange(5, compare(">", "5"))).toBe(false);
    expect(matchesGitHubNumberRange(5, compare(">=", "5"))).toBe(true);
    expect(matchesGitHubNumberRange(5, compare("<", "6"))).toBe(true);
    expect(matchesGitHubNumberRange(5, compare("<=", "4"))).toBe(false);
    expect(matchesGitHubNumberRange(5, { kind: "exact", operand: "5" })).toBe(
      true
    );
    expect(
      matchesGitHubNumberRange(5, { kind: "between", from: "1", to: "5" })
    ).toBe(true);
  });
});
