import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { KEY_SOURCE } from "@src/api/tauri/session";
import { Message } from "@src/components/Message";
import { marketActivationErrorCode } from "@src/features/MarketConnect/activationError";
import { captureMarketOwner } from "@src/features/MarketConnect/identity";
import {
  findMarketSourceForRecent,
  marketSourceModelType,
  prepareMarketProfileSource,
} from "@src/features/MarketConnect/marketProfiles";
import type { AdvancedConfig } from "@src/features/SessionCreator/types";
import type { KeyVaultAccount } from "@src/hooks/keyVault/types";
import { createLogger } from "@src/hooks/logger";
import {
  accountHasModel,
  accountModelIds as listAccountModelIds,
} from "@src/hooks/models/useModelAccountLookup";
import type { RecentModelEntry } from "@src/store/session/recentModelEntriesAtom";
import { separateEffortPillAtom } from "@src/store/session/separateEffortPillAtom";
import type { ModelSourceScope } from "@src/store/ui/spotlightModelSourceScopeAtom";
import { carryModelEffort } from "@src/util/carryModelEffort";
import { resolveDefaultVariant } from "@src/util/defaultModelVariant";
import {
  parseModelVariant,
  resolveModelVariantFields,
} from "@src/util/modelVariants";

import { buildSourceOptions, toSourceOption } from "./sourceItems";
import type { SourceOption } from "./types";
import { resolveVariantReselection } from "./variantReselect";

const marketLogger = createLogger("MarketPackages");

type ActiveColumn = "models" | "sources";

interface UseUnifiedModelPaletteSelectionParams {
  isOpen: boolean;
  isCliAgent: boolean;
  /**
   * "Key first" mode: the left column lists keys and the right column the
   * focused key's models (see `spotlightModelKeyFirstAtom`).
   */
  keyFirst: boolean;
  accountLookupSize: number;
  accounts: KeyVaultAccount[];
  marketSources: NonNullable<SourceOption["marketSource"]>[];
  /**
   * The scoped subset the Step 2 column may offer. The unscoped `accounts` /
   * `marketSources` above stay in use for the apply paths, so a Pinned or
   * Recent row still launches while the browse columns are narrowed.
   */
  listingAccounts: KeyVaultAccount[];
  listingMarketSources: NonNullable<SourceOption["marketSource"]>[];
  /** Flipping the source scope rebuilds both columns, so the cursor resets. */
  sourceScope?: ModelSourceScope;
  advancedConfig: AdvancedConfig;
  onConfigChange: (config: AdvancedConfig) => void;
  onClose: () => void;
  closeOnSourceSelect?: boolean;
  recordRecent: (entry: RecentModelEntry) => void;
}

export function useUnifiedModelPaletteSelection({
  isOpen,
  isCliAgent,
  keyFirst,
  accountLookupSize,
  accounts,
  marketSources,
  listingAccounts,
  listingMarketSources,
  sourceScope,
  advancedConfig,
  onConfigChange,
  onClose,
  closeOnSourceSelect = true,
  recordRecent,
}: UseUnifiedModelPaletteSelectionParams) {
  const { t } = useTranslation("integrations");
  const marketSelectionPendingRef = useRef(false);
  const separateEffortPill = useAtomValue(separateEffortPillAtom);
  const currentModelId = advancedConfig.model;
  // With the separate effort pill, a model pick keeps the current effort
  // instead of the row's per-key default variant.
  const withCurrentEffort = useCallback(
    (modelId: string, candidateModelIds: readonly string[]) =>
      separateEffortPill && modelId
        ? carryModelEffort(currentModelId, modelId, candidateModelIds)
        : modelId,
    [currentModelId, separateEffortPill]
  );
  const [activeColumn, setActiveColumn] = useState<ActiveColumn>("models");
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [selectedModelLabel, setSelectedModelLabel] = useState("");
  const [selectedGroupModelIds, setSelectedGroupModelIds] = useState<string[]>(
    []
  );
  const [selectedSourceIndex, setSelectedSourceIndex] = useState(-1);
  /** Key-first mode: the account previewed/focused in the left column. */
  const [selectedKeyAccountId, setSelectedKeyAccountId] = useState<
    string | null
  >(null);

  const sourceOptions = useMemo(() => {
    if (selectedModelId === null) return [];
    const modelIds =
      selectedGroupModelIds.length > 0
        ? selectedGroupModelIds
        : [selectedModelId];
    return buildSourceOptions(
      modelIds,
      listingAccounts,
      isCliAgent,
      listingMarketSources
    );
  }, [
    listingAccounts,
    isCliAgent,
    listingMarketSources,
    selectedModelId,
    selectedGroupModelIds,
  ]);

  useEffect(() => {
    if (!isOpen) return;

    const frameId = requestAnimationFrame(() => {
      setSelectedSourceIndex(-1);
      setSelectedKeyAccountId(null);
      // Model-first only: a CLI agent with no model listing skips straight
      // to the key column. In key-first mode the key column IS the first
      // column, so the normal reset applies.
      if (!keyFirst && isCliAgent && accountLookupSize === 0) {
        setActiveColumn("sources");
        setSelectedModelId("");
        setSelectedModelLabel("");
        setSelectedGroupModelIds([]);
      } else {
        setActiveColumn("models");
        setSelectedModelId(null);
        setSelectedModelLabel("");
        setSelectedGroupModelIds([]);
      }
    });
    return () => cancelAnimationFrame(frameId);
  }, [isOpen, isCliAgent, keyFirst, sourceScope, accountLookupSize]);

  const applySourceSelection = useCallback(
    (modelId: string, _modelLabel: string, source: SourceOption) => {
      const sourceAccount = source.accountId
        ? accounts.find((account) => account.id === source.accountId)
        : undefined;
      const resolvedModelId = modelId
        ? withCurrentEffort(
            modelId,
            sourceAccount
              ? listAccountModelIds(sourceAccount).filter((candidate) =>
                  accountHasModel(sourceAccount, candidate)
                )
              : []
          )
        : advancedConfig.model || "";
      onConfigChange({
        ...advancedConfig,
        keySource: KEY_SOURCE.OWN,
        selectedAccountId: source.accountId,
        credentialSource: undefined,
        marketProfileId: undefined,
        agent: source.modelType,
        provider: source.modelType,
        model: resolvedModelId,
        nativeHarnessType: source.nativeHarnessType,
        selectedSourceLabel: source.label,
        selectedSourceModelType: source.modelType,
      });
      recordRecent({
        modelId: resolvedModelId,
        sourceType: source.type,
        accountId: source.accountId,
        accountName: source.label,
        modelType: source.modelType,
      });
      if (closeOnSourceSelect) onClose();
    },
    [
      accounts,
      advancedConfig,
      closeOnSourceSelect,
      onConfigChange,
      onClose,
      recordRecent,
      withCurrentEffort,
    ]
  );

  const previewModel = useCallback(
    (modelId: string | null, modelLabel: string, groupModelIds: string[]) => {
      setSelectedModelId(modelId);
      setSelectedModelLabel(modelId ? modelLabel : "");
      setSelectedGroupModelIds(modelId ? groupModelIds : []);
      setSelectedSourceIndex(-1);
    },
    []
  );

  const handleModelPreview = useCallback(
    (modelId: string, modelLabel: string, groupModelIds: string[]) => {
      previewModel(modelId, modelLabel, groupModelIds);
    },
    [previewModel]
  );

  const handleModelSelect = useCallback(
    (modelId: string, modelLabel: string, groupModelIds: string[]) => {
      previewModel(modelId, modelLabel, groupModelIds);
      setActiveColumn("sources");
    },
    [previewModel]
  );

  const resolveLaunchModelForSource = useCallback(
    (source: SourceOption): string | null => {
      if (!selectedModelId) return null;
      const sourceAccount = source.accountId
        ? accounts.find((account) => account.id === source.accountId)
        : undefined;
      const candidateModelIds =
        selectedGroupModelIds.length > 0
          ? selectedGroupModelIds
          : [selectedModelId];
      const accountModelIds = source.marketSource
        ? candidateModelIds.filter((modelId) =>
            source.marketSource?.modelIds.includes(modelId)
          )
        : sourceAccount
          ? candidateModelIds.filter((modelId) =>
              accountHasModel(sourceAccount, modelId)
            )
          : [];
      if (accountModelIds.length === 0) return selectedModelId;

      const selectedVariant = parseModelVariant(selectedModelId);
      const baseModel = selectedVariant?.baseModel ?? selectedModelId;
      const persisted = (sourceAccount?.defaultVariants ?? []).find(
        (entry) =>
          entry.base_model === baseModel &&
          accountModelIds.includes(entry.model)
      )?.model;
      const variantInfos = accountModelIds.map((modelId) =>
        resolveModelVariantFields(modelId)
      );
      return (
        resolveDefaultVariant(baseModel, variantInfos, persisted) ??
        accountModelIds[0]
      );
    },
    [accounts, selectedModelId, selectedGroupModelIds]
  );

  const applyMarketSourceSelection = useCallback(
    (
      marketSource: NonNullable<SourceOption["marketSource"]>,
      pickedModelId: string,
      options?: { close?: boolean; keepVariant?: boolean }
    ) => {
      if (marketSelectionPendingRef.current) return;
      const modelId = options?.keepVariant
        ? pickedModelId
        : withCurrentEffort(pickedModelId, marketSource.modelIds);
      let owner: ReturnType<typeof captureMarketOwner>;
      try {
        owner = captureMarketOwner(
          marketSource.profile.connection.identity_user_id
        );
      } catch {
        Message.error(t("marketConnection.launchFailed"));
        return;
      }
      marketSelectionPendingRef.current = true;
      void prepareMarketProfileSource(marketSource, modelId)
        .then(({ credentialSource }) => {
          owner.assertCurrent();
          const modelType = marketSourceModelType(marketSource, modelId);
          onConfigChange({
            ...advancedConfig,
            keySource: KEY_SOURCE.OWN,
            selectedAccountId: undefined,
            credentialSource,
            marketProfileId: marketSource.profile.id,
            agent: modelType,
            provider: modelType,
            model: modelId,
            nativeHarnessType: undefined,
            cliAgentType: marketSource.cliAgentType,
            selectedSourceLabel: marketSource.label,
            selectedSourceModelType: modelType,
          });
          recordRecent({
            modelId,
            sourceType: KEY_SOURCE.OWN,
            accountName: marketSource.label,
            credentialSource,
            marketProfileId: marketSource.profile.id,
            modelType,
            cliAgentType: marketSource.cliAgentType,
          });
          if (options?.close ?? closeOnSourceSelect) onClose();
        })
        .catch((error: unknown) => {
          const code = marketActivationErrorCode(error);
          marketLogger.warn(`stage=activate code=${code}`);
          Message.error(
            t(
              code === "model_temporarily_unavailable"
                ? "status.unavailable"
                : "marketConnection.launchFailed"
            )
          );
        })
        .finally(() => {
          owner.dispose();
          marketSelectionPendingRef.current = false;
        });
    },
    [
      advancedConfig,
      closeOnSourceSelect,
      onClose,
      onConfigChange,
      recordRecent,
      t,
      withCurrentEffort,
    ]
  );

  const handleSourceSelect = useCallback(
    (source: SourceOption, modelOverride?: string) => {
      const launchModelId =
        modelOverride ?? resolveLaunchModelForSource(source);
      if (!launchModelId) return;
      if (source.marketSource) {
        applyMarketSourceSelection(source.marketSource, launchModelId);
        return;
      }
      applySourceSelection(launchModelId, selectedModelLabel, source);
    },
    [
      applyMarketSourceSelection,
      selectedModelLabel,
      applySourceSelection,
      resolveLaunchModelForSource,
    ]
  );

  const handleMarketModelSelect = useCallback(
    (
      marketSource: NonNullable<SourceOption["marketSource"]>,
      modelId: string
    ) => {
      applyMarketSourceSelection(marketSource, modelId);
    },
    [applyMarketSourceSelection]
  );

  // ── Key-first mode ────────────────────────────────────────────────────
  const previewKey = useCallback((accountId: string | null) => {
    setSelectedKeyAccountId(accountId);
    setSelectedSourceIndex(-1);
  }, []);

  const handleKeySelect = useCallback(
    (accountId: string) => {
      previewKey(accountId);
      setActiveColumn("sources");
    },
    [previewKey]
  );

  // `modelId` is "" for a CLI key without a model listing; the apply path
  // then falls back to the config's current model.
  const handleKeyModelSelect = useCallback(
    (account: KeyVaultAccount, modelId: string) => {
      applySourceSelection(modelId, "", toSourceOption(account));
    },
    [applySourceSelection]
  );

  // Core apply path shared by an explicit recent pick and an in-place
  // variant re-select. Rebinds the entry's account (by id, then by
  // name+type), pushes the selection through `onConfigChange` +
  // `recordRecent`, and closes the palette unless `close: false` is passed
  // (the variant-edit case keeps the palette open so the user can keep
  // tweaking after the properties dropdown closes itself). `keepVariant`
  // marks that in-place variant edit, which must not carry the old effort.
  const applyRecentEntry = useCallback(
    (
      entry: RecentModelEntry,
      options?: { close?: boolean; keepVariant?: boolean }
    ) => {
      if (entry.credentialSource?.startsWith("market:")) {
        const currentSource = findMarketSourceForRecent(marketSources, entry);
        if (!currentSource) {
          Message.error(t("marketConnection.failed"));
          return;
        }
        applyMarketSourceSelection(currentSource, entry.modelId, {
          close: options?.close !== false,
          keepVariant: options?.keepVariant,
        });
        return;
      }

      const currentAccount = accounts.find(
        (account) =>
          account.id === entry.accountId &&
          account.status === "ready" &&
          account.hasKey &&
          accountHasModel(account, entry.modelId)
      );
      const reboundAccount =
        currentAccount ??
        accounts.find(
          (account) =>
            account.name === entry.accountName &&
            account.modelType === entry.modelType &&
            account.status === "ready" &&
            account.hasKey &&
            accountHasModel(account, entry.modelId)
        );

      if (!reboundAccount) {
        return;
      }

      const reboundEntry: RecentModelEntry = {
        ...entry,
        modelId: options?.keepVariant
          ? entry.modelId
          : withCurrentEffort(
              entry.modelId,
              listAccountModelIds(reboundAccount).filter((candidate) =>
                accountHasModel(reboundAccount, candidate)
              )
            ),
        accountId: reboundAccount.id,
        accountName: reboundAccount.name,
        modelType: reboundAccount.modelType,
      };

      onConfigChange({
        ...advancedConfig,
        keySource: KEY_SOURCE.OWN,
        selectedAccountId: reboundAccount.id,
        credentialSource: undefined,
        marketProfileId: undefined,
        agent: reboundAccount.modelType,
        provider: reboundAccount.modelType,
        model: reboundEntry.modelId,
        nativeHarnessType: reboundAccount.nativeHarnessType,
        selectedSourceLabel: reboundAccount.name,
        selectedSourceModelType: reboundAccount.modelType,
      });

      recordRecent(reboundEntry);
      if (options?.close !== false) onClose();
    },
    [
      accounts,
      advancedConfig,
      applyMarketSourceSelection,
      marketSources,
      onConfigChange,
      onClose,
      recordRecent,
      t,
      withCurrentEffort,
    ]
  );

  const handleRecentSelect = useCallback(
    (entry: RecentModelEntry) => applyRecentEntry(entry),
    [applyRecentEntry]
  );

  // Editing the effort/variant of the *currently selected* model should make
  // the selected model become that variant — updating both the displayed
  // pill and the model the session actually launches with (the dispatch path
  // uses the stored concrete model id, not the per-key default variant). We
  // reuse the select path with the new model id and keep the palette open.
  const reselectVariant = useCallback(
    (entry: RecentModelEntry, nextModelId: string) => {
      const resolved = resolveVariantReselection(entry.modelId, nextModelId);
      if (!resolved) return;
      applyRecentEntry(
        { ...entry, modelId: resolved },
        { close: false, keepVariant: true }
      );
    },
    [applyRecentEntry]
  );

  const handleBack = useCallback(() => {
    setActiveColumn("models");
  }, []);

  return {
    activeColumn,
    setActiveColumn,
    selectedModelId,
    selectedGroupModelIds,
    selectedSourceIndex,
    setSelectedSourceIndex,
    sourceOptions,
    previewModel,
    handleModelPreview,
    handleModelSelect,
    handleSourceSelect,
    handleRecentSelect,
    reselectVariant,
    handleBack,
    selectedKeyAccountId,
    previewKey,
    handleKeySelect,
    handleKeyModelSelect,
    handleMarketModelSelect,
  };
}
