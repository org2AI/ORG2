import { describe, expect, it } from "vitest";

import { clipFindTargetName } from "./findTargetName";

describe("clipFindTargetName", () => {
  it("keeps names within the budget", () => {
    expect(clipFindTargetName("index.ts", 10)).toBe("index.ts");
    expect(clipFindTargetName("0123456789", 10)).toBe("0123456789");
  });

  it("keeps the first characters and ends with an ellipsis", () => {
    expect(
      clipFindTargetName("rename-agent-orgs-to-agent-teams_2d7544b2.plan.md")
    ).toBe("rename-agent-orgs-to-ag…");
    expect(clipFindTargetName("01234567890", 10)).toBe("012345678…");
  });

  it("counts CJK characters as double width", () => {
    expect(clipFindTargetName("修复搜索框占位符", 10)).toBe("修复搜索…");
    expect(clipFindTargetName("修复搜索框", 10)).toBe("修复搜索框");
    expect(clipFindTargetName("ab修复搜索框", 10)).toBe("ab修复搜…");
  });

  it("does not split astral characters or leave a trailing space", () => {
    expect(clipFindTargetName("😀😀😀😀😀😀", 6)).toBe("😀😀…");
    expect(clipFindTargetName("abcd efgh", 6)).toBe("abcd…");
  });
});
