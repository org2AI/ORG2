import type { KeyVaultAccount } from "@src/hooks/keyVault/types";
import type { AgentRegistry } from "@src/store/session/agentRegistryAtom";
import { type ModelGroup, groupModels } from "@src/util/modelGrouping";
import {
  type ResolvedModelVariantFields,
  resolveModelVariantFields,
} from "@src/util/modelVariants";
import { getModelEffortBaseModel } from "@src/util/selectableModelVariants";

import { withNativeHarnessModels } from "./nativeHarnessAccountModels";
import {
  getCliCompatibleAccounts,
  isSourceCompatibleWithAgent,
} from "./useAgentCompatibility";

/** A launchable credential is independent of the executor's model adapter. */
export function isSelectableModelAccount(account: KeyVaultAccount): boolean {
  return account.enabled && account.status === "ready" && account.hasKey;
}

/** Catalog membership includes synthesized variants, even without available IDs. */
export function accountModelIds(
  account: Pick<KeyVaultAccount, "availableModels" | "modelVariants">
): string[] {
  return [
    ...new Set(
      [
        ...(account.availableModels ?? []),
        ...(account.modelVariants ?? []).map((variant) => variant.model),
      ].filter(Boolean)
    ),
  ];
}

/** An explicit empty enabled set stays empty; variant rows inherit their base. */
export function accountHasModel(
  account: Pick<
    KeyVaultAccount,
    "availableModels" | "enabledModels" | "enabled" | "modelVariants"
  >,
  modelId: string
): boolean {
  if (!account.enabled) return false;
  const enabled = new Set(account.enabledModels ?? []);
  return (
    enabled.has(modelId) ||
    (account.modelVariants ?? []).some(
      (variant) => variant.model === modelId && enabled.has(variant.base_model)
    )
  );
}

export function selectableAccountModelIds(account: KeyVaultAccount): string[] {
  return isSelectableModelAccount(account)
    ? accountModelIds(account).filter((modelId) =>
        accountHasModel(account, modelId)
      )
    : [];
}

export function resolveAccountModelVariant(
  account: KeyVaultAccount | undefined,
  modelId: string
) {
  return resolveModelVariantFields(
    modelId,
    account?.modelVariants?.find((variant) => variant.model === modelId)
  );
}

/** Model-first browsing has no chosen account yet; source rows resolve locally. */
export function resolveCatalogModelVariant(
  accounts: readonly KeyVaultAccount[],
  modelId: string
) {
  const account = accounts.find(
    (candidate) =>
      isSelectableModelAccount(candidate) &&
      accountHasModel(candidate, modelId) &&
      candidate.modelVariants?.some((variant) => variant.model === modelId)
  );
  return resolveAccountModelVariant(account, modelId);
}

/** Keep existing display grouping, but use catalog base IDs when supplied. */
export function groupCatalogModels(
  modelIds: string[],
  accounts: readonly KeyVaultAccount[],
  agentType?: string
): ModelGroup[] {
  // This index is local to the projection; it adds no retained cache or loader.
  const metadata = new Map<string, ResolvedModelVariantFields>();
  for (const account of accounts) {
    if (!isSelectableModelAccount(account)) continue;
    const enabled = new Set(account.enabledModels ?? []);
    for (const variant of account.modelVariants ?? []) {
      if (
        !metadata.has(variant.model) &&
        (enabled.has(variant.model) || enabled.has(variant.base_model))
      ) {
        metadata.set(variant.model, variant);
      }
    }
  }
  const catalogBases = new Set(
    [...metadata.values()].map((variant) => variant.base_model)
  );
  const groups = new Map<string, ModelGroup>();
  for (const modelId of modelIds) {
    const variant = metadata.get(modelId);
    const base = variant?.base_model ?? getModelEffortBaseModel(modelId);
    const [group] = groupModels([variant?.base_model ?? modelId], agentType);
    if (!group) continue;
    const key = catalogBases.has(base)
      ? `catalog:${base}`
      : `label:${group.label}`;
    const existing = groups.get(key);
    if (existing) existing.models.push(modelId);
    else groups.set(key, { ...group, models: [modelId] });
  }
  return [...groups.values()].sort(
    (left, right) => right.sortVersion - left.sortVersion
  );
}

/** Shared executor compatibility for palette, saved pair validation and Agent Org. */
export function getModelPickerAccounts(
  registry: AgentRegistry,
  accounts: KeyVaultAccount[],
  dispatchCategory: string | null,
  cliAgentType?: string | null
): KeyVaultAccount[] {
  if (dispatchCategory === "cli_agent" && cliAgentType) {
    return getCliCompatibleAccounts(registry, cliAgentType, accounts);
  }
  if (dispatchCategory !== "rust_agent") return accounts;
  return withNativeHarnessModels(accounts, dispatchCategory).filter(
    (account) =>
      account.supportsRustAgents ??
      isSourceCompatibleWithAgent(
        registry,
        "rust_agent",
        undefined,
        account.modelType
      )
  );
}
