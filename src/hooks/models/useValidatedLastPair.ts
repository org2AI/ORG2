/**
 * useValidatedLastPair
 *
 * Returns the last model+source pair as `LastModelSelection`, or `null` when
 * the stored pair is no longer compatible with the current environment:
 *   - account deleted / not ready / key disabled
 *   - model disabled on that account
 *   - ORGII pool disabled (CLI dispatch) or tier/model no longer in pool config
 *
 * Pills and SessionCreator read through this hook instead of
 * `creatorDefaultModelSelectionAtom` directly so a stale pair never appears valid.
 */
import { useAtomValue } from "jotai";
import { useMemo } from "react";

import { isHostedKey } from "@src/api/tauri/session";
import { isOrgiiTierModel } from "@src/config/orgiiCategories";
import {
  marketConnectionMatchesOwner,
  marketOwnerKeyAtom,
} from "@src/features/MarketConnect/identity";
import {
  findMarketSourceForRecent,
  marketSourceModelType,
  useMarketExecutionProfiles,
} from "@src/features/MarketConnect/marketProfiles";
import { parseAppliedMarketSelection } from "@src/features/MarketConnect/marketSelection";
import { useKeyVault } from "@src/hooks/keyVault";
import { withNativeHarnessModels } from "@src/hooks/models/nativeHarnessAccountModels";
import {
  getCliCompatibleAccounts,
  useAgentCompatibility,
} from "@src/hooks/models/useAgentCompatibility";
import {
  type LastModelSelection,
  creatorDefaultModelPairAtom,
  deriveLastModelSelection,
} from "@src/store/session/creatorDefaultModelAtom";
import {
  cliAgentTypeAtom,
  dispatchCategoryAtom,
} from "@src/store/session/creatorStateAtom";
import type { RecentModelEntry } from "@src/store/session/recentModelEntriesAtom";

import {
  isPairCompatible,
  resolveCompatibleOwnKeyAccount,
} from "./modelPairCompatibility";
import { useOrgiiPoolCategories } from "./useOrgiiPoolCategories";

export function useValidatedLastPair(): LastModelSelection | null {
  const marketOwner = useAtomValue(marketOwnerKeyAtom);
  const pair = useAtomValue(creatorDefaultModelPairAtom);
  const dispatchCategory = useAtomValue(dispatchCategoryAtom);
  const cliAgentType = useAtomValue(cliAgentTypeAtom);
  const { registry } = useAgentCompatibility();
  const orgiiPoolEnabled = dispatchCategory !== "cli_agent";

  const { accounts: allAccounts } = useKeyVault({ autoLoad: true });

  const accounts = useMemo(() => {
    if (dispatchCategory === "cli_agent" && cliAgentType) {
      return getCliCompatibleAccounts(registry, cliAgentType, allAccounts);
    }
    return withNativeHarnessModels(allAccounts, dispatchCategory);
  }, [dispatchCategory, cliAgentType, allAccounts, registry]);

  // Only fetch ORGII pool config when the stored pair actually needs it:
  // hosted_key sessions or ORGII tier model IDs (orgii:*). Own-key pairs
  // never consult the pool, so we skip the API call entirely.
  const needsOrgiiPool =
    orgiiPoolEnabled &&
    pair !== null &&
    (isHostedKey(pair.sourceType) || isOrgiiTierModel(pair.modelId));

  const { orgiiModelSet, orgiiCategoryIds } =
    useOrgiiPoolCategories(needsOrgiiPool);
  const isMarketPair = Boolean(pair?.credentialSource?.startsWith("market:"));
  const {
    sources: marketSources,
    loading: marketProfilesLoading,
    error: marketProfilesError,
  } = useMarketExecutionProfiles({
    enabled:
      isMarketPair &&
      (dispatchCategory === "cli_agent" || dispatchCategory === "rust_agent"),
    cliAgentType:
      dispatchCategory === "rust_agent" ? "rust_agent" : cliAgentType,
  });

  return useMemo(() => {
    if (!pair) return null;
    const ok = isPairCompatible(pair, {
      accounts,
      orgiiPoolEnabled,
      orgiiModelSet,
      orgiiCategoryIds,
      cliAgentType,
    });
    if (!ok) return null;
    if (isHostedKey(pair.sourceType)) return deriveLastModelSelection(pair);
    if (pair.credentialSource?.startsWith("market:")) {
      const selection = parseAppliedMarketSelection(pair.credentialSource);
      if (
        !selection ||
        !marketConnectionMatchesOwner(selection.identityUserId, marketOwner)
      )
        return null;
      if (marketProfilesLoading) return deriveLastModelSelection(pair);
      if (marketProfilesError) return null;
      const source = findMarketSourceForRecent(marketSources, pair);
      if (!source) return null;
      return deriveLastModelSelection({
        ...pair,
        accountName: source.label,
        marketProfileId: source.profile.id,
        modelType: marketSourceModelType(source, pair.modelId),
        cliAgentType: source.cliAgentType,
      });
    }

    const account = resolveCompatibleOwnKeyAccount(pair, accounts);
    if (!account) return null;

    const reboundPair: RecentModelEntry = {
      ...pair,
      accountId: account.id,
      accountName: account.name,
      modelType: account.modelType,
    };
    return deriveLastModelSelection(reboundPair);
  }, [
    pair,
    accounts,
    orgiiPoolEnabled,
    orgiiModelSet,
    orgiiCategoryIds,
    cliAgentType,
    marketOwner,
    marketProfilesError,
    marketProfilesLoading,
    marketSources,
  ]);
}
