import { useAtom } from "jotai";
import { useCallback, useMemo } from "react";

import { KEY_SOURCE } from "@src/api/tauri/session";
import { ORGII_ORCHESTRATOR } from "@src/assets/providers";
import type { MarketProfileSource } from "@src/features/MarketConnect/marketProfiles";
import { findMarketSourceForRecent } from "@src/features/MarketConnect/marketProfiles";
import type { AdvancedConfig } from "@src/features/SessionCreator/types";
import type { KeyVaultAccount } from "@src/hooks/keyVault/types";
import { isPairCompatible } from "@src/hooks/models/modelPairCompatibility";
import { accountHasModel } from "@src/hooks/models/useModelAccountLookup";
import type { RecentModelEntry } from "@src/store/session/recentModelEntriesAtom";
import { recentEntriesEquivalent } from "@src/store/session/recentModelEntriesAtom";
import {
  MAX_SPOTLIGHT_MODEL_PINS,
  spotlightModelPinsAtom,
} from "@src/store/ui/spotlightPinsAtom";
import { resolveDefaultVariant } from "@src/util/defaultModelVariant";
import { resolveModelVariantFields } from "@src/util/modelVariants";

import { isModelPinned, toggleModelPin } from "../../pinning/modelPins";
import type { SpotlightItem } from "../../types";
import {
  buildKeyItems,
  buildKeyModelItems,
  buildMarketProfileItems,
  buildMarketProfileModelItems,
} from "./keyFirstItems";
import {
  MODEL_SECTION,
  type ModelSection,
  buildGroupByModel,
  buildSectionHeader,
  entryMatchesActiveConfig,
  getActiveModelId,
} from "./modelSection";
import {
  buildAllModelItems,
  buildModelSelectionSpotlightItem,
} from "./modelSelectionItems";
import { buildSourceItems } from "./sourceItems";
import type { SourceOption } from "./types";
import type { UnifiedModelPaletteData } from "./useUnifiedModelPaletteData";

interface UseUnifiedModelPaletteItemsParams {
  advancedConfig: AdvancedConfig;
  accounts: KeyVaultAccount[];
  marketSources: MarketProfileSource[];
  marketProfilesLoading: boolean;
  marketProfilesError: string | null;
  refreshMarketProfiles: () => Promise<void>;
  accountLookup: UnifiedModelPaletteData["accountLookup"];
  orgiiModelSet: UnifiedModelPaletteData["orgiiModelSet"];
  orgiiCategoryIds: UnifiedModelPaletteData["orgiiCategoryIds"];
  orgiiPoolEnabled: boolean;
  isCliAgent: boolean;
  cliAgentType: UnifiedModelPaletteData["cliAgentType"];
  recentEntries: RecentModelEntry[];
  sourceOptions: SourceOption[];
  selectedModelId: string | null;
  selectedGroupModelIds: string[];
  handleModelSelect: (
    modelId: string,
    modelLabel: string,
    groupModelIds: string[]
  ) => void;
  handleModelPreview?: (
    modelId: string,
    modelLabel: string,
    groupModelIds: string[]
  ) => void;
  handleSourceSelect: (source: SourceOption, modelOverride?: string) => void;
  handleRecentSelect: (entry: RecentModelEntry) => void;
  reselectVariant: (entry: RecentModelEntry, nextModelId: string) => void;
  /** Key-first mode inputs (see `keyFirstItems.tsx`). */
  selectedKeyAccountId: string | null;
  handleKeySelect: (accountId: string) => void;
  handleKeyModelSelect: (account: KeyVaultAccount, modelId: string) => void;
  handleMarketModelSelect: (
    source: MarketProfileSource,
    modelId: string
  ) => void;
  saveKey: UnifiedModelPaletteData["saveKey"];
  modelAliasVersion: number;
  tCommon: (key: string) => string;
}

export function useUnifiedModelPaletteItems({
  advancedConfig,
  accounts,
  marketSources,
  marketProfilesLoading,
  marketProfilesError,
  refreshMarketProfiles,
  accountLookup,
  orgiiModelSet,
  orgiiCategoryIds,
  orgiiPoolEnabled,
  isCliAgent,
  cliAgentType,
  recentEntries,
  sourceOptions,
  selectedModelId,
  selectedGroupModelIds,
  handleModelSelect,
  handleModelPreview,
  handleSourceSelect,
  handleRecentSelect,
  reselectVariant,
  selectedKeyAccountId,
  handleKeySelect,
  handleKeyModelSelect,
  handleMarketModelSelect,
  saveKey,
  modelAliasVersion,
  tCommon,
}: UseUnifiedModelPaletteItemsParams) {
  const isEntryCompatible = useCallback(
    (entry: RecentModelEntry) => {
      if (entry.credentialSource?.startsWith("market:")) {
        return Boolean(findMarketSourceForRecent(marketSources, entry));
      }
      return isPairCompatible(entry, {
        accounts,
        orgiiPoolEnabled,
        orgiiModelSet,
        orgiiCategoryIds,
        cliAgentType,
      });
    },
    [
      accounts,
      orgiiPoolEnabled,
      orgiiModelSet,
      orgiiCategoryIds,
      cliAgentType,
      marketSources,
    ]
  );

  const compatibleRecentEntries = useMemo(
    () => recentEntries.filter(isEntryCompatible),
    [recentEntries, isEntryCompatible]
  );

  const [modelPins, setModelPins] = useAtom(spotlightModelPinsAtom);
  const compatiblePinnedEntries = useMemo(
    () => modelPins.filter(isEntryCompatible),
    [modelPins, isEntryCompatible]
  );
  const buildPinState = useCallback(
    (entry: RecentModelEntry) => {
      const pinned = isModelPinned(modelPins, entry);
      return {
        pinned,
        disabled: !pinned && modelPins.length >= MAX_SPOTLIGHT_MODEL_PINS,
        onToggle: () =>
          setModelPins((previous) => toggleModelPin(previous, entry)),
      };
    },
    [modelPins, setModelPins]
  );

  const persistDefaultVariantForAccount = useCallback(
    (accountId: string, baseModel: string, modelId: string) => {
      const account = accounts.find((entry) => entry.id === accountId);
      if (!account) return;

      const nextDefaults = (account.defaultVariants ?? []).filter(
        (variant) => variant.base_model !== baseModel
      );
      nextDefaults.push({ base_model: baseModel, model: modelId });

      void saveKey({
        id: account.id,
        agent_type: account.modelType,
        default_variants: nextDefaults,
      });
    },
    [accounts, saveKey]
  );

  const groupByModel = useMemo(
    () => buildGroupByModel(accountLookup.keys()),
    [accountLookup]
  );

  const activeModelId = getActiveModelId(advancedConfig);

  const MAX_RECENT_ITEMS = 3;

  const currentModelEntry = useMemo((): RecentModelEntry | null => {
    if (!activeModelId) return null;

    const fromRecents = compatibleRecentEntries.find((entry) =>
      entryMatchesActiveConfig(entry, advancedConfig)
    );
    if (fromRecents) return fromRecents;

    const selectedAccount = advancedConfig.selectedAccountId
      ? accounts.find((entry) => entry.id === advancedConfig.selectedAccountId)
      : undefined;
    const activeModelFamily = groupByModel.get(activeModelId) ?? [
      activeModelId,
    ];
    const inferredAccount =
      selectedAccount ??
      accounts.find((account) => {
        const selectedModelType =
          advancedConfig.selectedSourceModelType ??
          advancedConfig.listingModelType;
        if (selectedModelType && account.modelType !== selectedModelType) {
          return false;
        }
        if (
          advancedConfig.selectedSourceLabel &&
          account.name !== advancedConfig.selectedSourceLabel
        ) {
          return false;
        }
        return activeModelFamily.some((modelId) =>
          accountHasModel(account, modelId)
        );
      });

    return {
      modelId: activeModelId,
      sourceType: advancedConfig.keySource ?? KEY_SOURCE.OWN,
      accountId: inferredAccount?.id ?? advancedConfig.selectedAccountId,
      accountName: advancedConfig.selectedSourceLabel ?? inferredAccount?.name,
      credentialSource: advancedConfig.credentialSource,
      marketProfileId: advancedConfig.marketProfileId,
      modelType:
        advancedConfig.selectedSourceModelType ??
        advancedConfig.listingModelType ??
        inferredAccount?.modelType ??
        ORGII_ORCHESTRATOR,
      cliAgentType: advancedConfig.cliAgentType,
    };
  }, [
    activeModelId,
    advancedConfig,
    compatibleRecentEntries,
    accounts,
    groupByModel,
  ]);

  const recentEntriesForDisplay = useMemo((): RecentModelEntry[] => {
    const entries: RecentModelEntry[] = [];

    const tryAdd = (entry: RecentModelEntry) => {
      if (
        entries.some((existing) => recentEntriesEquivalent(existing, entry))
      ) {
        return;
      }
      entries.push(entry);
    };

    // Pinned selections render in their own section, never twice.
    const tryAddUnpinned = (entry: RecentModelEntry) => {
      if (!isModelPinned(compatiblePinnedEntries, entry)) tryAdd(entry);
    };

    if (currentModelEntry) {
      tryAddUnpinned(currentModelEntry);
    }
    for (const entry of compatibleRecentEntries) {
      if (entries.length >= MAX_RECENT_ITEMS) break;
      tryAddUnpinned(entry);
    }
    return entries;
  }, [compatibleRecentEntries, compatiblePinnedEntries, currentModelEntry]);

  const buildQuickPickItem = useCallback(
    (entry: RecentModelEntry, section: ModelSection, index: number) => {
      const isCurrentSelection = entryMatchesActiveConfig(
        entry,
        advancedConfig
      );
      // The active config may hold another variant of a stored entry.
      const rowEntry =
        isCurrentSelection && activeModelId
          ? { ...entry, modelId: activeModelId }
          : entry;
      const item = buildModelSelectionSpotlightItem({
        entry: rowEntry,
        section,
        idPrefix: isCurrentSelection
          ? `${section}-current`
          : `${section}-${index}`,
        isCurrentSelection,
        accounts,
        groupByModel,
        onSelect: handleRecentSelect,
        persistDefaultVariantForAccount,
        onReselectVariant: isCurrentSelection ? reselectVariant : undefined,
        modelAliasVersion,
      });
      return {
        ...item,
        data: { ...item.data, pinState: buildPinState(rowEntry) },
      };
    },
    [
      accounts,
      activeModelId,
      advancedConfig,
      buildPinState,
      groupByModel,
      handleRecentSelect,
      modelAliasVersion,
      persistDefaultVariantForAccount,
      reselectVariant,
    ]
  );

  const pinnedItems = useMemo(
    (): SpotlightItem[] =>
      compatiblePinnedEntries.map((entry, index) =>
        buildQuickPickItem(entry, MODEL_SECTION.PINNED, index)
      ),
    [buildQuickPickItem, compatiblePinnedEntries]
  );

  const recentItems = useMemo(
    (): SpotlightItem[] =>
      recentEntriesForDisplay.map((entry, index) =>
        buildQuickPickItem(entry, MODEL_SECTION.RECENT, index)
      ),
    [buildQuickPickItem, recentEntriesForDisplay]
  );

  const resolveGroupLaunchModel = useCallback(
    (sortedVariants: string[]): string => {
      if (sortedVariants.length === 0) return "";

      const variantInfos = sortedVariants.map((modelId) =>
        resolveModelVariantFields(modelId)
      );
      const baseModel = variantInfos[0]?.base_model ?? sortedVariants[0];
      const variantModelSet = new Set(sortedVariants);

      let persistedModel: string | undefined;
      for (const account of accounts) {
        const match = (account.defaultVariants ?? []).find(
          (variant) =>
            variant.base_model === baseModel &&
            variantModelSet.has(variant.model)
        );
        if (match) {
          persistedModel = match.model;
          break;
        }
      }

      return (
        resolveDefaultVariant(baseModel, variantInfos, persistedModel) ??
        sortedVariants[0]
      );
    },
    [accounts]
  );

  const allModelItems = useMemo(
    (): SpotlightItem[] =>
      buildAllModelItems({
        accountLookup,
        accounts,
        marketSources,
        handleModelSelect,
        modelAliasVersion,
        resolveGroupLaunchModel,
      }),
    [
      accountLookup,
      accounts,
      marketSources,
      handleModelSelect,
      modelAliasVersion,
      resolveGroupLaunchModel,
    ]
  );

  const sideMenuModelItems = useMemo(
    (): SpotlightItem[] =>
      buildAllModelItems({
        accountLookup,
        accounts,
        marketSources,
        handleModelSelect: handleModelPreview ?? handleModelSelect,
        modelAliasVersion,
        resolveGroupLaunchModel,
      }),
    [
      accountLookup,
      accounts,
      marketSources,
      handleModelPreview,
      handleModelSelect,
      modelAliasVersion,
      resolveGroupLaunchModel,
    ]
  );

  const sourceItems = useMemo((): SpotlightItem[] => {
    const items = buildSourceItems({
      sourceOptions,
      selectedModelId,
      selectedGroupModelIds,
      handleSourceSelect,
      accounts,
      persistDefaultVariantForAccount,
    });
    if (marketProfilesLoading) {
      items.push({
        id: "market-profiles:loading",
        label: tCommon("integrations:marketConnection.loadingPurchases"),
        icon: "",
        type: "action",
        action: () => {},
        data: { testId: "market-profiles-loading" },
      });
    } else if (marketProfilesError) {
      items.push({
        id: "market-profiles:error",
        label: tCommon("integrations:marketConnection.purchasesFailed"),
        icon: "",
        type: "action",
        action: () => void refreshMarketProfiles(),
        data: { testId: "market-profiles-error" },
      });
    }
    return items;
  }, [
    sourceOptions,
    selectedModelId,
    selectedGroupModelIds,
    handleSourceSelect,
    accounts,
    persistDefaultVariantForAccount,
    marketProfilesLoading,
    marketProfilesError,
    refreshMarketProfiles,
    tCommon,
  ]);

  // ── Key-first mode ────────────────────────────────────────────────────
  // Left column: keys. Right column: the focused key's model families.
  const keyItems = useMemo((): SpotlightItem[] => {
    const items: SpotlightItem[] = [
      ...buildKeyItems({
        accounts,
        isCliAgent,
        onSelectKey: handleKeySelect,
        onCommit: handleKeyModelSelect,
      }),
      ...buildMarketProfileItems({
        sources: marketSources,
        onSelect: handleKeySelect,
        marketLabel: tCommon("integrations:marketConnection.title"),
      }),
    ];
    if (marketProfilesLoading) {
      items.push({
        id: "market-profiles:loading",
        label: tCommon("integrations:marketConnection.loadingPurchases"),
        icon: "",
        type: "action",
        action: () => {},
        data: { testId: "market-profiles-loading" },
      });
    } else if (marketProfilesError) {
      items.push({
        id: "market-profiles:error",
        label: tCommon("integrations:marketConnection.purchasesFailed"),
        icon: "",
        type: "action",
        action: () => void refreshMarketProfiles(),
        data: { testId: "market-profiles-error" },
      });
    }
    return items;
  }, [
    accounts,
    isCliAgent,
    handleKeySelect,
    handleKeyModelSelect,
    marketSources,
    marketProfilesLoading,
    marketProfilesError,
    refreshMarketProfiles,
    tCommon,
  ]);

  const selectedKeyAccount = useMemo(
    () =>
      selectedKeyAccountId
        ? accounts.find((account) => account.id === selectedKeyAccountId)
        : undefined,
    [accounts, selectedKeyAccountId]
  );

  const selectedMarketSource = useMemo(
    () =>
      selectedKeyAccountId
        ? marketSources.find((source) => source.id === selectedKeyAccountId)
        : undefined,
    [marketSources, selectedKeyAccountId]
  );

  const keyModelItems = useMemo(
    (): SpotlightItem[] =>
      selectedMarketSource
        ? buildMarketProfileModelItems({
            source: selectedMarketSource,
            onCommit: handleMarketModelSelect,
          })
        : selectedKeyAccount
          ? buildKeyModelItems({
              account: selectedKeyAccount,
              onCommit: handleKeyModelSelect,
              persistDefaultVariantForAccount,
            })
          : [],
    [
      selectedKeyAccount,
      selectedMarketSource,
      handleKeyModelSelect,
      handleMarketModelSelect,
      persistDefaultVariantForAccount,
    ]
  );

  const pinnedHeader = useMemo(
    () =>
      buildSectionHeader(
        MODEL_SECTION.PINNED,
        tCommon("selectors.repo.sections.pinned")
      ),
    [tCommon]
  );

  const recentHeader = useMemo(
    () =>
      buildSectionHeader(
        MODEL_SECTION.RECENT,
        tCommon("selectors.modelSelector.recentModels")
      ),
    [tCommon]
  );

  const allHeader = useMemo(
    () =>
      buildSectionHeader(
        MODEL_SECTION.ALL,
        tCommon("selectors.modelSelector.allModels")
      ),
    [tCommon]
  );

  const rawItems = useMemo((): SpotlightItem[] => {
    const items: SpotlightItem[] = [];
    if (recentItems.length > 0) {
      items.push(recentHeader);
      items.push(...recentItems);
    }
    items.push(allHeader);
    items.push(...allModelItems);
    return items;
  }, [recentItems, allModelItems, recentHeader, allHeader]);

  const sideMenuRawItems = useMemo((): SpotlightItem[] => {
    const items: SpotlightItem[] = [];
    if (recentItems.length > 0) {
      items.push(recentHeader);
      items.push(...recentItems);
    }
    items.push(allHeader);
    items.push(...sideMenuModelItems);
    return items;
  }, [recentItems, sideMenuModelItems, recentHeader, allHeader]);

  return {
    rawItems,
    sideMenuRawItems,
    sideMenuModelItems,
    pinnedItems,
    recentItems,
    allModelItems,
    pinnedHeader,
    recentHeader,
    allHeader,
    sourceItems,
    keyItems,
    keyModelItems,
  };
}
