import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { isHostedKey } from "@src/api/tauri/session";
import { useKeyVault } from "@src/hooks/keyVault";
import { buildGroupByModel } from "@src/scaffold/GlobalSpotlight/palettes/UnifiedModelPalette/modelSection";
import type { LastModelSelection } from "@src/store/session/creatorDefaultModelAtom";
import {
  formatReasoningLevel,
  toModelReasoningLevel,
} from "@src/util/modelVariants";
import { buildVariantEditOptions } from "@src/util/variantEditOptions";

import { resolveAccountModelVariant } from "./accountModelCatalog";
import { resolveModelDisplaySelection } from "./resolveModelDisplaySelection";
import {
  accountHasModel,
  useModelAccountLookup,
} from "./useModelAccountLookup";

export interface UseModelEffortSegmentParams {
  selection: LastModelSelection | null | undefined;
  isActiveSession?: boolean;
  onApply?: (nextModelId: string) => void;
}

export interface ModelEffortSegmentState {
  editable: boolean;
  effortLabel: string;
  effortAriaLabel: string;
  modelId: string | undefined;
  variantOptions: ReturnType<typeof buildVariantEditOptions>;
  handleApply: (nextModelId: string) => void;
}

export function useModelEffortSegment({
  selection,
  isActiveSession = false,
  onApply,
}: UseModelEffortSegmentParams): ModelEffortSegmentState {
  const { t } = useTranslation();
  const { accounts, accountLookup } = useModelAccountLookup();
  const { saveKey } = useKeyVault();

  const displaySelection = useMemo(
    () => resolveModelDisplaySelection(selection, accounts, isActiveSession),
    [accounts, isActiveSession, selection]
  );

  const modelId = displaySelection?.model;
  const isHosted = displaySelection
    ? isHostedKey(displaySelection.keySource)
    : true;

  const { groupModelIds, selectedAccountId, editable } = useMemo(() => {
    if (!modelId || isHosted || !onApply) {
      return {
        groupModelIds: [] as string[],
        selectedAccountId: undefined as string | undefined,
        editable: false,
      };
    }

    const groupByModel = buildGroupByModel(accountLookup.keys(), accounts);
    const family = groupByModel.get(modelId) ?? [modelId];

    const selectedAccount = accounts.find((account) => {
      if (displaySelection?.selectedAccountId) {
        return account.id === displaySelection.selectedAccountId;
      }
      if (
        displaySelection?.selectedSourceModelType &&
        account.modelType !== displaySelection.selectedSourceModelType
      ) {
        return false;
      }
      if (displaySelection?.selectedSourceLabel) {
        return account.name === displaySelection.selectedSourceLabel;
      }
      return family.some((candidateId) =>
        accountHasModel(account, candidateId)
      );
    });

    const accountFamilyIds = selectedAccount
      ? family.filter((candidateId) =>
          accountHasModel(selectedAccount, candidateId)
        )
      : family;

    return {
      groupModelIds: accountFamilyIds,
      selectedAccountId: selectedAccount?.id,
      editable: accountFamilyIds.length > 1,
    };
  }, [accountLookup, accounts, displaySelection, isHosted, modelId, onApply]);

  const variantMetadata = useMemo(() => {
    const account = accounts.find((entry) => entry.id === selectedAccountId);
    return (
      groupModelIds.length > 0 ? groupModelIds : modelId ? [modelId] : []
    ).map((model) => resolveAccountModelVariant(account, model));
  }, [accounts, groupModelIds, modelId, selectedAccountId]);

  const variantOptions = useMemo(
    () =>
      buildVariantEditOptions(
        groupModelIds.length > 0 ? groupModelIds : modelId ? [modelId] : [],
        variantMetadata
      ),
    [groupModelIds, modelId, variantMetadata]
  );

  const effectiveModelId = modelId
    ? (variantOptions.resolveVariantId(
        variantOptions.parseSelection(modelId)
      ) ?? modelId)
    : undefined;
  const variant = effectiveModelId
    ? variantMetadata.find((entry) => entry.model === effectiveModelId)
    : undefined;

  const effortLabel = useMemo(() => {
    const parts: string[] = [];
    if (variant?.reasoning) {
      parts.push(
        formatReasoningLevel(toModelReasoningLevel(variant.reasoning))
      );
    }
    if (variant?.fast) {
      parts.push("Fast");
    }
    if (parts.length > 0) return parts.join(" · ");
    if (!variant || (!variant.thinking && parts.length === 0)) {
      return t("common:selectors.modelProperties.default");
    }
    return t("common:selectors.modelProperties.effort");
  }, [variant, t]);

  const effortAriaLabel = t("common:selectors.modelProperties.effort");

  const persistDefaultVariant = useCallback(
    (nextModelId: string) => {
      if (!selectedAccountId) return;
      const account = accounts.find((entry) => entry.id === selectedAccountId);
      if (!account) return;

      const baseModel = resolveAccountModelVariant(
        account,
        nextModelId
      ).base_model;

      void saveKey({
        id: account.id,
        agent_type: account.modelType,
        default_variant_overrides: [
          { base_model: baseModel, model: nextModelId },
        ],
      });
    },
    [accounts, saveKey, selectedAccountId]
  );

  const handleApply = useCallback(
    (nextModelId: string) => {
      if (!nextModelId || nextModelId === modelId || !onApply) return;
      persistDefaultVariant(nextModelId);
      onApply(nextModelId);
    },
    [modelId, onApply, persistDefaultVariant]
  );

  return {
    editable,
    effortLabel,
    effortAriaLabel,
    modelId,
    variantOptions,
    handleApply,
  };
}
