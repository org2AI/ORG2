import type { TFunction } from "i18next";
import { describe, expect, it, vi } from "vitest";

import type {
  ContextUsageCategory,
  ContextUsageSnapshot,
} from "@src/store/session/cliSessionStatusAtom";
import { testTranslate } from "@src/test/i18nTestTranslate";

import { buildContextInfoCategories } from "./contextInfoCategories";
import type { PanelCategory } from "./contextInfoTypes";

const translate = vi.fn((...args: Parameters<typeof testTranslate>) =>
  testTranslate(...args)
);
const t = translate as unknown as TFunction;

function snapshot(
  sections: Array<[ContextUsageCategory, number]>
): ContextUsageSnapshot {
  return {
    usedTokens: 0,
    updatedAt: "2026-09-14T00:00:00Z",
    warnings: [],
    sections: sections.map(([category, estimatedTokens]) => ({
      category,
      label: category,
      estimatedTokens,
      percent: 0,
      items: [],
    })),
  };
}

const rows = (categories: PanelCategory[]) =>
  categories.map((category) => [
    category.key,
    category.tokens,
    category.percent,
  ]);

describe("buildContextInfoCategories", () => {
  it("returns no rows without a snapshot", () => {
    expect(buildContextInfoCategories(null, 1000, t)).toEqual([]);
  });

  it("drops empty sections and leaves percents at zero when nothing is displayed", () => {
    expect(
      buildContextInfoCategories(
        snapshot([
          ["rules", 10],
          ["skills", 0],
          ["other", 5],
        ]),
        0,
        t
      )
    ).toEqual([
      { key: "rules", label: "rules", tokens: 10, percent: 0, hex: "#34d399" },
      { key: "other", label: "other", tokens: 5, percent: 0, hex: "#94a3b8" },
    ]);
  });

  it("scales over-counted sections down to the displayed tokens", () => {
    expect(
      rows(
        buildContextInfoCategories(
          snapshot([
            ["conversation", 300],
            ["tool_results", 100],
            ["memory", 100],
          ]),
          250,
          t
        )
      )
    ).toEqual([
      ["conversation", 150, 60],
      ["tool_results", 50, 20],
      ["memory", 50, 20],
    ]);
  });

  it("hands scaling remainders to the largest fractions and drops rows scaled to zero", () => {
    expect(
      rows(
        buildContextInfoCategories(
          snapshot([
            ["conversation", 2],
            ["memory", 1],
          ]),
          2,
          t
        )
      )
    ).toEqual([
      ["conversation", 1, 50],
      ["memory", 1, 50],
    ]);
    expect(
      rows(
        buildContextInfoCategories(
          snapshot([
            ["conversation", 10],
            ["memory", 1],
          ]),
          5,
          t
        )
      )
    ).toEqual([["conversation", 5, 100]]);
  });

  it("adds an Unattributed row for the uncounted remainder", () => {
    translate.mockClear();
    const categories = buildContextInfoCategories(
      snapshot([
        ["stable_prompt", 300],
        ["rules", 100],
      ]),
      1000,
      t
    );

    expect(rows(categories)).toEqual([
      ["stable_prompt", 300, 30],
      ["rules", 100, 10],
      ["unattributed", 600, 60],
    ]);
    expect(categories.at(-1)).toMatchObject({
      label: "Unattributed",
      hex: "#f87171",
    });
    expect(translate).toHaveBeenCalledWith(
      "contextInfo.categories.unattributed"
    );
  });

  it("folds the remainder into an existing unattributed section", () => {
    translate.mockClear();

    expect(
      rows(
        buildContextInfoCategories(
          snapshot([
            ["conversation", 500],
            ["unattributed", 100],
          ]),
          1000,
          t
        )
      )
    ).toEqual([
      ["conversation", 500, 50],
      ["unattributed", 500, 50],
    ]);
    expect(translate).not.toHaveBeenCalled();
  });

  it("rounds percents up to 100 by largest remainder, earliest row first", () => {
    expect(
      buildContextInfoCategories(
        snapshot([
          ["rules", 1],
          ["skills", 1],
          ["memory", 1],
        ]),
        3,
        t
      ).map((category) => category.percent)
    ).toEqual([34, 33, 33]);
  });
});
