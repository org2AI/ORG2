import { describe, expect, it } from "vitest";

import {
  CLI_AGENT,
  NATIVE_HARNESS_TYPE,
} from "@src/api/tauri/rpc/schemas/validation";
import type { KeyVaultAccount } from "@src/hooks/keyVault/types";
import type { AgentRegistry } from "@src/store/session/agentRegistryAtom";

import {
  getModelPickerAccounts,
  groupCatalogModels,
  resolveAccountModelVariant,
  selectableAccountModelIds,
} from "./accountModelCatalog";
import { withNativeHarnessModels } from "./nativeHarnessAccountModels";

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
    authMethod: "oauth",
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
        fast: true,
      },
    ],
    ...overrides,
  };
}

describe("account model catalog", () => {
  it("derives selectable IDs and grouping from a variants-only catalog", () => {
    const source = account();
    expect(selectableAccountModelIds(source)).toEqual([
      "deployment-a",
      "deployment-b",
    ]);
    expect(
      groupCatalogModels(selectableAccountModelIds(source), [source])
    ).toEqual([
      {
        label: "catalog-family",
        sortVersion: -1,
        models: ["deployment-a", "deployment-b"],
      },
    ]);
    expect(resolveAccountModelVariant(source, "deployment-b")).toEqual(
      source.modelVariants?.[1]
    );
  });

  it.each([
    { enabled: false },
    { hasKey: false },
    { status: "error" as const },
    { enabledModels: [] },
  ])("never offers an unavailable account/model: %j", (overrides) => {
    expect(selectableAccountModelIds(account(overrides))).toEqual([]);
  });

  it.each([CLI_AGENT.CODEX, CLI_AGENT.CLAUDE_CODE, CLI_AGENT.CURSOR] as const)(
    "preserves %s health through native adaptation",
    (modelType) => {
      const source = account({
        modelType,
        status: "error",
        canUseNativeHarness: true,
        nativeHarnessType: NATIVE_HARNESS_TYPE.CURSOR,
      });
      const adapted = withNativeHarnessModels([source], "rust_agent")[0];
      expect(adapted.status).toBe("error");
      expect(selectableAccountModelIds(adapted)).toEqual([]);
    }
  );

  it("uses the same account capability for Agent Org and palette callers", () => {
    const registry = {
      agents: [],
      apiProviders: [],
    } as unknown as AgentRegistry;
    const unsupported = account({
      id: "unsupported",
      supportsRustAgents: false,
    });
    const supported = account({ id: "supported", supportsRustAgents: true });
    expect(
      getModelPickerAccounts(registry, [unsupported, supported], "rust_agent")
    ).toEqual([supported]);
  });
});
