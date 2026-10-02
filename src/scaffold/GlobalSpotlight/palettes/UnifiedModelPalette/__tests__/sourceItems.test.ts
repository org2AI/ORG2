import { describe, expect, it, vi } from "vitest";

import type { KeyVaultAccount } from "@src/hooks/keyVault/types";
import { buildAccountLookup } from "@src/hooks/models/useModelAccountLookup";

import { buildKeyModelItems, selectableKeyAccounts } from "../keyFirstItems";
import { buildAllModelItems } from "../modelSelectionItems";
import { buildSourceItems, buildSourceOptions } from "../sourceItems";

function account(overrides: Partial<KeyVaultAccount> = {}): KeyVaultAccount {
  return {
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
    availableModels: [],
    enabledModels: ["catalog-family"],
    modelVariants: [
      {
        model: "deployment-a",
        base_model: "catalog-family",
        reasoning: "low",
        fast: false,
      },
      {
        model: "deployment-b",
        base_model: "catalog-family",
        reasoning: "high",
        fast: false,
      },
    ],
    defaultVariants: [{ base_model: "catalog-family", model: "deployment-b" }],
    ...overrides,
  };
}

describe("model and source catalog parity", () => {
  it("offers a variants-only model with the same source and default in both column orders", () => {
    const source = account();
    const lookup = buildAccountLookup([source]);
    const options = buildSourceOptions([...lookup.keys()], [source], false);
    expect(options.map((option) => option.accountId)).toEqual([source.id]);
    const allRows = buildAllModelItems({
      accountLookup: lookup,
      accounts: [source],
      handleModelSelect: vi.fn(),
      modelAliasVersion: 0,
      resolveGroupLaunchModel: (models) => models[0],
    });
    expect(allRows).toHaveLength(1);
    expect(allRows[0].data?.groupModelIds).toEqual(
      expect.arrayContaining(["deployment-a", "deployment-b"])
    );
    const onCommit = vi.fn();
    const [keyRow] = buildKeyModelItems({
      account: source,
      onCommit,
      persistDefaultVariantForAccount: vi.fn(),
    });
    keyRow.action?.();
    expect(onCommit).toHaveBeenCalledWith(source, "deployment-b");
    const [sourceRow] = buildSourceItems({
      sourceOptions: options,
      selectedModelId: "deployment-a",
      selectedGroupModelIds: [...lookup.keys()],
      accounts: [source],
      handleSourceSelect: vi.fn(),
      persistDefaultVariantForAccount: vi.fn(),
    });
    expect(sourceRow.data?.rightContent).toMatchObject({
      props: { modelId: "deployment-b", variantMetadata: source.modelVariants },
    });
  });

  it.each([
    { enabled: false },
    { hasKey: false },
    { status: "error" as const },
    { enabledModels: [] },
  ])(
    "does not expose an unusable account in either column: %j",
    (overrides) => {
      const source = account(overrides);
      expect(buildAccountLookup([source]).size).toBe(0);
      expect(buildSourceOptions(["deployment-a"], [source], true)).toEqual([]);
      expect(selectableKeyAccounts([source], true)).toEqual([]);
    }
  );

  it("preserves model-less CLI launch, without treating all-disabled models as no catalog", () => {
    const noCatalog = account({ modelVariants: [], enabledModels: [] });
    expect(buildSourceOptions([], [noCatalog], true)).toHaveLength(1);
    expect(selectableKeyAccounts([noCatalog], true)).toEqual([noCatalog]);
    expect(
      buildSourceOptions([], [account({ enabledModels: [] })], true)
    ).toEqual([]);
  });
});
