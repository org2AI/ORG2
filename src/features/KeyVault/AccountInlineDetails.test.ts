import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { KeyVaultAccount } from "@src/hooks/keyVault";

import { AccountInlineDetails } from "./AccountInlineDetails";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { percent?: number }): string =>
      key === "keyVault.quota.percentLeft" ? `${options?.percent}% left` : key,
  }),
}));

vi.mock("./AccountCompatibilitySection", () => ({
  AccountCompatibilitySection: () => null,
}));

vi.mock("@src/api/services/keyValidation", () => ({
  getFullKey: vi.fn(),
}));

function deepSeekAccount(
  overrides: {
    remainingPercentage?: number;
    balance?: { amount: number; currency: string } | null;
  } = {}
): KeyVaultAccount {
  const {
    remainingPercentage = -1,
    balance = { amount: 12.34, currency: "USD" },
  } = overrides;
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
      remaining_percentage: remainingPercentage,
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
      balance,
      auto_message: null,
      named_message: null,
    },
  };
}

function render(account: KeyVaultAccount): string {
  return renderToStaticMarkup(createElement(AccountInlineDetails, { account }));
}

describe("AccountInlineDetails quota rows", () => {
  it("shows the exact balance instead of a meter for balance-only providers", () => {
    const markup = render(deepSeekAccount());

    expect(markup).toContain("keyVault.quota.balance");
    expect(markup).toContain("12.34");
    expect(markup).not.toContain("keyVault.quota.quotaUsage");
    expect(markup).not.toContain("% left");
  });

  it("draws no meter when the percentage is unknown and there is no balance", () => {
    const markup = render(deepSeekAccount({ balance: null }));

    expect(markup).not.toContain("keyVault.quota.balance");
    expect(markup).not.toContain("keyVault.quota.quotaUsage");
    expect(markup).not.toContain("% left");
  });

  it("keeps the overall meter for a known percentage", () => {
    const markup = render(
      deepSeekAccount({ balance: null, remainingPercentage: 25 })
    );

    expect(markup).toContain("keyVault.quota.quotaUsage");
    expect(markup).toContain("25% left");
  });
});
