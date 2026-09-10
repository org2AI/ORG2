import i18n, { type TFunction, createInstance } from "i18next";
import { describe, expect, it } from "vitest";

import en from "@src/i18n/locales/en/integrations.json";
import zh from "@src/i18n/locales/zh/integrations.json";

import {
  collectAccountQuotaCards,
  formatQuotaResetHint,
  formatQuotaResetTime,
  resolveQuotaPlanLabel,
} from "./accountQuotaDisplay";
import type { KeyVaultAccount } from "./types";

const translate = ((key: string, options?: { defaultValue?: string }) =>
  options?.defaultValue ?? key) as TFunction;

const chineseTranslations: Record<string, string> = {
  "keyVault.quota.balance": "余额",
  "keyVault.quota.payAsYouGo": "按量付费",
};

const chineseTranslate = ((key: string, options?: { defaultValue?: string }) =>
  chineseTranslations[key] ?? options?.defaultValue ?? key) as TFunction;

function deepSeekAccount(): KeyVaultAccount {
  return {
    id: "deepseek-account",
    hasLocalKey: true,
    isListed: false,
    modelType: "deepseek_api",
    name: "DeepSeek",
    status: "ready",
    hasKey: true,
    hasApiKey: true,
    hasSessionToken: false,
    enabled: true,
    quotaInfo: {
      remaining_percentage: -1,
      used: null,
      limit: null,
      remaining: null,
      reset_time: null,
      billing_start: null,
      plan_type: "Pay-as-you-go",
      limit_type: null,
      is_unlimited: false,
      quota_source: "deepseek_balance",
      usage_items: [],
      balance: { amount: 12.34, currency: "USD" },
      auto_message: null,
      named_message: null,
    },
  };
}

describe("collectAccountQuotaCards", () => {
  it("renders an exact balance without inventing a percentage meter", () => {
    const [card] = collectAccountQuotaCards(
      [deepSeekAccount()],
      translate,
      translate
    );

    expect(card.accountPlan).toBe("Pay As You Go");
    expect(card.metrics).toHaveLength(1);
    expect(card.metrics[0]).toMatchObject({
      kind: "value",
      key: "balance",
      label: "Balance",
    });
    expect(card.metrics.some((metric) => metric.kind === "percentage")).toBe(
      false
    );
  });

  it("localizes balance and Pay As You Go while preserving provider plan names", () => {
    const [card] = collectAccountQuotaCards(
      [deepSeekAccount()],
      chineseTranslate,
      chineseTranslate
    );

    expect(card.accountPlan).toBe("按量付费");
    expect(card.metrics[0]).toMatchObject({ label: "余额" });

    const glmCodingPlanAccount = deepSeekAccount();
    glmCodingPlanAccount.quotaInfo!.plan_type = "GLM Coding Plan";

    expect(resolveQuotaPlanLabel(glmCodingPlanAccount, chineseTranslate)).toBe(
      "GLM Coding Plan"
    );
  });
});

describe("provider plan and reset details", () => {
  it.each(["max_5x", "default_claude_max_5x", "max_20x"])(
    "formats reported Claude tier %s",
    (tier) => {
      const account = deepSeekAccount();
      account.modelType = "claude_code";
      account.accountMetadata = { rate_limit_tier: tier };
      expect(resolveQuotaPlanLabel(account)).toBe(
        tier.includes("20") ? "Max 20x" : "Max 5x"
      );
    }
  );

  it("passes reset details through alongside the Codex plan tier", () => {
    const account = deepSeekAccount();
    account.modelType = "codex";
    account.quotaInfo!.plan_type = "pro";
    account.quotaInfo!.named_message = "Reset credits available: 3";
    const [card] = collectAccountQuotaCards([account], translate, translate);
    expect(card.accountPlan).toBe("Pro 20x");
    expect(card.quotaMessage).toBe("3 resets available");
  });
});

it.each([
  ["prolite", "Pro 5x"],
  ["pro", "Pro 20x"],
  [" PROLITE ", "Pro 5x"],
  ["plus", "Plus"],
  ["future_plan", "Future Plan"],
  [null, null],
])("displays Codex plan %s as %s", (planType, label) => {
  const account = deepSeekAccount();
  account.modelType = "codex";
  account.quotaInfo!.plan_type = planType;
  expect(resolveQuotaPlanLabel(account)).toBe(label);
});

it("keeps other providers' Pro labels unchanged", () => {
  const account = deepSeekAccount();
  account.quotaInfo!.plan_type = "pro";
  expect(resolveQuotaPlanLabel(account)).toBe("Pro");
});

it.each([
  ["en", 0, "0 resets available"],
  ["en", 1, "1 reset available"],
  ["en", 3, "3 resets available"],
  ["zh", 3, "3个可用重置"],
])("localizes reset count for %s (%s)", async (lng, count, expected) => {
  const i18n = createInstance();
  await i18n.init({
    lng: String(lng),
    resources: { en: { integrations: en }, zh: { integrations: zh } },
  });
  const account = deepSeekAccount();
  account.modelType = "codex";
  account.quotaInfo!.named_message = `Reset credits available: ${count}`;
  const [card] = collectAccountQuotaCards(
    [account],
    translate,
    i18n.getFixedT(String(lng), "integrations")
  );
  expect(card.quotaMessage).toBe(expected);
});

describe("quota timestamp formatting", () => {
  it("uses English dates and 12-hour time for labels and tooltips", () => {
    expect(
      formatQuotaResetTime(new Date(2026, 8, 15, 6, 56).toISOString())
    ).toEqual({
      compact: "Sep 15, 6:56 AM",
      full: "Sep 15, 6:56 AM",
    });
    expect(
      formatQuotaResetTime(new Date(2026, 8, 15, 18, 6).toISOString())?.compact
    ).toBe("Sep 15, 6:06 PM");
  });
  it.each(["session", "weekly", "monthly"])(
    "uses the same timestamp format for %s",
    (usageType) => {
      expect(
        formatQuotaResetHint(
          usageType,
          50,
          new Date(2026, 8, 15, 6, 56).toISOString(),
          translate
        )?.compact
      ).toBe("Sep 15, 6:56 AM");
    }
  );
  it("keeps missing and invalid timestamps unavailable", () => {
    expect(formatQuotaResetTime(null)).toBeNull();
    expect(formatQuotaResetTime("invalid")).toBeNull();
    expect(formatQuotaResetHint("session", 50, null, translate)).toBeNull();
  });
});

it.each(["zh", "de", "en"])(
  "keeps English quota timestamps when app language is %s",
  (language) => {
    const previousLanguage = i18n.language;
    try {
      i18n.language = language;
      expect(
        formatQuotaResetTime(new Date(2026, 7, 15, 18, 9).toISOString())
          ?.compact
      ).toBe("Aug 15, 6:09 PM");
    } finally {
      i18n.language = previousLanguage;
    }
  }
);
