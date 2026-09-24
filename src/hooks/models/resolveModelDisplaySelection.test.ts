import { describe, expect, it } from "vitest";

import type { KeyVaultAccount } from "@src/hooks/keyVault/types";
import type { LastModelSelection } from "@src/store/session/creatorDefaultModelAtom";

import { resolveModelDisplaySelection } from "./resolveModelDisplaySelection";

const account: KeyVaultAccount = {
  id: "key",
  name: "Account",
  modelType: "codex",
  enabled: true,
  hasLocalKey: true,
  isListed: false,
  hasKey: true,
  hasApiKey: false,
  hasSessionToken: true,
  status: "ready",
  availableModels: ["family"],
  enabledModels: ["family"],
  modelVariants: [
    {
      model: "deployment-a",
      base_model: "family",
      reasoning: "low",
      fast: false,
    },
    {
      model: "deployment-b",
      base_model: "family",
      reasoning: "high",
      fast: false,
    },
  ],
  defaultVariants: [{ base_model: "family", model: "deployment-b" }],
};
const selection: LastModelSelection = {
  model: "family",
  selectedAccountId: "key",
  keySource: "own_key",
};

describe("model display selection catalog metadata", () => {
  it("resolves an active bare family through variant-only account defaults", () => {
    expect(
      resolveModelDisplaySelection(selection, [account], true)?.model
    ).toBe("deployment-b");
  });
  it("keeps an explicitly selected opaque variant rather than applying the account default", () => {
    const explicit = { ...selection, model: "deployment-a" };
    expect(resolveModelDisplaySelection(explicit, [account], true)).toBe(
      explicit
    );
  });
  it("keeps historical sessions and explicitly disabled models unchanged", () => {
    expect(resolveModelDisplaySelection(selection, [account], false)).toBe(
      selection
    );
    expect(
      resolveModelDisplaySelection(
        selection,
        [{ ...account, enabledModels: [] }],
        true
      )
    ).toBe(selection);
  });
});
