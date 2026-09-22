import { describe, expect, it } from "vitest";

import type { KeyVaultAccount } from "@src/hooks/keyVault";

import { buildExpandedAccountEntries } from "./ModelInlineExpandedCard";
import type { IntegrationsModelGroupRow } from "./integrationsModelGroups";

const MODEL = "gpt-6-astra-high";

function account(name: string, enabledModels: string[]): KeyVaultAccount {
  return {
    id: name.toLowerCase(),
    hasLocalKey: true,
    isListed: false,
    modelType: "openai",
    name,
    status: "ready",
    hasKey: true,
    hasApiKey: true,
    hasSessionToken: false,
    enabled: true,
    availableModels: [MODEL],
    enabledModels,
  } as KeyVaultAccount;
}

const GROUP = {
  label: "GPT 6 Astra",
  isOrgiiGroup: false,
  models: [{ model: MODEL }],
} as IntegrationsModelGroupRow;

describe("buildExpandedAccountEntries ordering", () => {
  it("lists keys that are on for the family before the rest", () => {
    const entries = buildExpandedAccountEntries(
      GROUP,
      [account("Zed", [MODEL]), account("Alpha", []), account("Beta", [MODEL])],
      "Token market"
    );

    expect(entries.map((entry) => entry.account.name)).toEqual([
      "Beta",
      "Zed",
      "Alpha",
    ]);
  });

  it("falls back to name order when every key is off", () => {
    const entries = buildExpandedAccountEntries(
      GROUP,
      [account("Zed", []), account("Alpha", [])],
      "Token market"
    );

    expect(entries.map((entry) => entry.account.name)).toEqual([
      "Alpha",
      "Zed",
    ]);
  });
});
