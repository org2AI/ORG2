import type { TFunction } from "i18next";

import type { ContextUsageSnapshot } from "@src/store/session/cliSessionStatusAtom";

import type { PanelCategory } from "./contextInfoTypes";

function normalizeCategoryTokens(
  categories: PanelCategory[],
  totalTokens: number
): PanelCategory[] {
  const rawTotal = categories.reduce(
    (sum, category) => sum + category.tokens,
    0
  );
  if (rawTotal <= 0 || totalTokens <= 0 || rawTotal <= totalTokens) {
    return categories;
  }

  const scaled = categories.map((category, index) => {
    const exact = (category.tokens / rawTotal) * totalTokens;
    const tokens = Math.floor(exact);
    return {
      category: { ...category, tokens },
      index,
      remainder: exact - tokens,
    };
  });

  const assigned = scaled.reduce(
    (sum, entry) => sum + entry.category.tokens,
    0
  );
  let remaining = Math.max(0, totalTokens - assigned);

  scaled
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .forEach((entry) => {
      if (remaining <= 0) return;
      entry.category.tokens += 1;
      remaining -= 1;
    });

  return scaled
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.category)
    .filter((category) => category.tokens > 0);
}

function applyCategoryPercents(
  categories: PanelCategory[],
  totalTokens: number
): PanelCategory[] {
  if (totalTokens <= 0) return categories;

  const exactPercentages = categories.map((category, index) => {
    const exact = (category.tokens / totalTokens) * 100;
    const percent = Math.floor(exact);
    return {
      index,
      percent,
      remainder: exact - percent,
    };
  });

  const currentTotal = exactPercentages.reduce(
    (sum, entry) => sum + entry.percent,
    0
  );
  const targetTotal =
    categories.reduce((sum, category) => sum + category.tokens, 0) >=
    totalTokens
      ? 100
      : currentTotal;
  let remaining = Math.max(0, targetTotal - currentTotal);

  exactPercentages
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .forEach((entry) => {
      if (remaining <= 0) return;
      entry.percent += 1;
      remaining -= 1;
    });

  const percentsByIndex = exactPercentages
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.percent);

  return categories.map((category, index) => ({
    ...category,
    percent: percentsByIndex[index] ?? 0,
  }));
}

/**
 * Panel rows from the provider request sections: scaled down to the
 * displayed token count when the sections over-count, topped up with an
 * "Unattributed" row when they under-count, then given whole percents.
 */
export function buildContextInfoCategories(
  contextUsage: ContextUsageSnapshot | null,
  displayTokens: number,
  t: TFunction
): PanelCategory[] {
  const colors: Record<string, string> = {
    stable_prompt: "#9ca3af",
    dynamic_prompt: "#a78bfa",
    rules: "#34d399",
    skills: "#fbbf24",
    memory: "#22c55e",
    conversation: "#fb923c",
    tool_results: "#60a5fa",
    attachments: "#e879f9",
    other: "#94a3b8",
    unattributed: "#f87171",
  };
  const rawCategories = (contextUsage?.sections ?? [])
    .filter((section) => section.estimatedTokens > 0)
    .map((section) => ({
      key: section.category,
      label: section.label,
      tokens: section.estimatedTokens,
      percent: 0,
      hex: colors[section.category] ?? colors.other,
    }));

  const totalTokens = displayTokens;
  if (rawCategories.length === 0 || totalTokens <= 0) {
    return rawCategories.map((category) => ({
      ...category,
      percent: category.percent,
    }));
  }

  const rawTotal = rawCategories.reduce(
    (sum, category) => sum + category.tokens,
    0
  );
  const categories =
    rawTotal > totalTokens
      ? normalizeCategoryTokens(rawCategories, totalTokens)
      : rawCategories;
  const categoryTotal = categories.reduce(
    (sum, category) => sum + category.tokens,
    0
  );
  if (categoryTotal > 0 && categoryTotal < totalTokens) {
    const delta = totalTokens - categoryTotal;
    const unattributedIndex = categories.findIndex(
      (category) => category.key === "unattributed"
    );
    if (unattributedIndex >= 0) {
      categories[unattributedIndex] = {
        ...categories[unattributedIndex],
        tokens: categories[unattributedIndex].tokens + delta,
      };
    } else {
      categories.push({
        key: "unattributed",
        label: t("contextInfo.categories.unattributed"),
        tokens: delta,
        percent: 0,
        hex: colors.unattributed,
      });
    }
  }

  return applyCategoryPercents(categories, totalTokens);
}
