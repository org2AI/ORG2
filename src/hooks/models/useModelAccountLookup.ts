import { useMemo } from "react";

import { type KeyVaultAccount, useKeyVault } from "@src/hooks/keyVault";

import { selectableAccountModelIds } from "./accountModelCatalog";
import type { ModelAccountInfo } from "./types";

export { accountHasModel, accountModelIds } from "./accountModelCatalog";

/**
 * Pure utility: build a lookup from model ID → account info
 * (total key count + unique provider agent types).
 */
export function buildAccountLookup(
  accounts: KeyVaultAccount[]
): Map<string, ModelAccountInfo> {
  const lookup = new Map<string, ModelAccountInfo>();
  for (const account of accounts) {
    for (const modelId of selectableAccountModelIds(account)) {
      const existing = lookup.get(modelId);
      if (existing) {
        existing.totalKeys += 1;
        if (!existing.agentTypes.includes(account.modelType)) {
          existing.agentTypes.push(account.modelType);
        }
      } else {
        lookup.set(modelId, {
          totalKeys: 1,
          agentTypes: [account.modelType],
        });
      }
    }
  }
  return lookup;
}

/**
 * Hook: loads code accounts and provides a memoised model → account info lookup.
 *
 * Returns both the lookup map and the raw accounts array so callers can
 * derive additional data (e.g. available source types) without a second
 * useKeyVault call.
 */
export function useModelAccountLookup() {
  const { accounts, loading, hasLoaded, error } = useKeyVault({
    autoLoad: true,
  });

  const accountLookup = useMemo(() => buildAccountLookup(accounts), [accounts]);

  return { accountLookup, accounts, loading, hasLoaded, error };
}
