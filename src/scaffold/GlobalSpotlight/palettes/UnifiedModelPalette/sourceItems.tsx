import React from "react";

import { KEY_SOURCE } from "@src/api/tauri/session";
import ModelIcon from "@src/components/ModelIcon";
import type { MarketProfileSource } from "@src/features/MarketConnect/marketProfiles";
import type { KeyVaultAccount } from "@src/hooks/keyVault/types";
import {
  accountHasModel,
  accountModelIds,
  isSelectableModelAccount,
  resolveAccountModelVariant,
} from "@src/hooks/models/accountModelCatalog";
import { resolveDefaultVariant } from "@src/util/defaultModelVariant";

import type { SpotlightItem } from "../../types";
import { VariantPill } from "./VariantPill";
import { withModelRowAttributes } from "./modelRowAttributes";
import type { SourceOption } from "./types";

/** The {@link SourceOption} a Key Vault account is launched through. */
export function toSourceOption(account: KeyVaultAccount): SourceOption {
  return {
    id: account.id,
    label: account.name,
    modelType: account.modelType,
    type: KEY_SOURCE.OWN,
    accountId: account.id,
    nativeHarnessType: account.nativeHarnessType,
  };
}

export function buildSourceOptions(
  modelIds: string[],
  accounts: KeyVaultAccount[],
  isCliAgent: boolean,
  marketSources: MarketProfileSource[] = []
): SourceOption[] {
  const options: SourceOption[] = [];
  const variantSet = new Set(modelIds.filter(Boolean));

  const readyAccounts = accounts.filter(isSelectableModelAccount);
  for (const account of readyAccounts) {
    const hasConcreteModelFilter = variantSet.size > 0;
    const hasAnyVariant = [...variantSet].some((modelId) =>
      accountHasModel(account, modelId)
    );
    const modelMatches = hasConcreteModelFilter
      ? hasAnyVariant
      : isCliAgent && accountModelIds(account).length === 0;
    if (modelMatches) {
      options.push(toSourceOption(account));
    }
  }

  for (const marketSource of marketSources) {
    if (modelIds.some((modelId) => marketSource.modelIds.includes(modelId))) {
      options.push({
        id: marketSource.id,
        label: marketSource.label,
        modelType: marketSource.modelType,
        type: KEY_SOURCE.OWN,
        marketSource,
        modelIds: marketSource.modelIds,
      });
    }
  }

  return options;
}

interface BuildSourceItemsParams {
  sourceOptions: SourceOption[];
  selectedModelId: string | null;
  selectedGroupModelIds: string[];
  accounts: KeyVaultAccount[];
  handleSourceSelect: (source: SourceOption, modelOverride?: string) => void;
  persistDefaultVariantForAccount: (
    accountId: string,
    baseModel: string,
    modelId: string
  ) => void;
}

export function buildSourceItems({
  sourceOptions,
  selectedModelId,
  selectedGroupModelIds,
  accounts,
  handleSourceSelect,
  persistDefaultVariantForAccount,
}: BuildSourceItemsParams): SpotlightItem[] {
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  return sourceOptions.map((source) => {
    const SourceIcon = () => (
      <ModelIcon agentType={source.modelType} size={14} />
    );

    const sourceAccount = source.accountId
      ? accountById.get(source.accountId)
      : undefined;
    const previewBaseModel = selectedModelId
      ? resolveAccountModelVariant(sourceAccount, selectedModelId).base_model
      : undefined;

    const accountVariantIds = source.marketSource
      ? selectedGroupModelIds.filter((modelId) =>
          source.marketSource?.modelIds.includes(modelId)
        )
      : sourceAccount
        ? selectedGroupModelIds.filter((modelId) =>
            accountHasModel(sourceAccount, modelId)
          )
        : [];

    const variantInfos = accountVariantIds.map((modelId) =>
      resolveAccountModelVariant(sourceAccount, modelId)
    );
    let accountEffectiveModelId: string | undefined;
    if (
      (sourceAccount || source.marketSource) &&
      previewBaseModel &&
      accountVariantIds.length > 0
    ) {
      const persisted = (sourceAccount?.defaultVariants ?? []).find(
        (entry) =>
          entry.base_model === previewBaseModel &&
          accountVariantIds.includes(entry.model)
      )?.model;
      accountEffectiveModelId =
        resolveDefaultVariant(previewBaseModel, variantInfos, persisted) ??
        accountVariantIds[0];
    }

    const handleApply = source.marketSource
      ? (nextModelId: string) => handleSourceSelect(source, nextModelId)
      : sourceAccount && previewBaseModel
        ? (nextModelId: string) =>
            persistDefaultVariantForAccount(
              sourceAccount.id,
              previewBaseModel,
              nextModelId
            )
        : undefined;

    const hasMultipleVariants = accountVariantIds.length > 1;
    const trailing: React.ReactNode = (() => {
      if (
        (!sourceAccount && !source.marketSource) ||
        accountVariantIds.length === 0
      )
        return null;
      if (hasMultipleVariants && accountEffectiveModelId) {
        return (
          <VariantPill
            modelId={accountEffectiveModelId}
            groupModelIds={accountVariantIds}
            variantMetadata={variantInfos}
            onApply={handleApply}
          />
        );
      }
      return <VariantPill modelId={previewBaseModel ?? ""} />;
    })();

    return withModelRowAttributes({
      id: source.id,
      label: source.label,
      icon: SourceIcon,
      type: "action" as const,
      data: {
        isSelector: true,
        rightContent: trailing,
        testId: "unified-model-source-option",
        sourceAccountId: source.accountId,
        sourceModelType: source.modelType,
        sourceType: source.type,
        isMarketProfile: Boolean(source.marketSource),
      },
      action: () => handleSourceSelect(source),
    });
  });
}
