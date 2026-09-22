import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import AnyIcon from "@src/components/AnyIcon";
import Button from "@src/components/Button";
import ModelIcon from "@src/components/ModelIcon";
import Switch from "@src/components/Switch";
import Tooltip from "@src/components/Tooltip";
import type { KeyVaultAccount } from "@src/hooks/keyVault";
import { accountModelIds } from "@src/hooks/models/useModelAccountLookup";
import {
  ArrangeByLettersZAIcon,
  ArrangeByNumbersOneNineIcon,
} from "@src/icons";
import {
  applyModelGroupToEnabledSet,
  getModelGroupEnableSummary,
} from "@src/modules/MainApp/Integrations/KeyVault/Models/Table/integrationsModelGroups";
import { InlineCardScrollList } from "@src/modules/MainApp/Integrations/KeyVault/shared/InlineCardPrimitives";
import {
  InlineSplitHeaderRow,
  InlineSplitKeyRow,
} from "@src/modules/MainApp/Integrations/KeyVault/shared/InlineSplitRows";
import ModelVariantInlineCard from "@src/modules/MainApp/Integrations/KeyVault/shared/ModelTable/ModelVariantInlineCard";
import type { ModelTableVariantInfo } from "@src/types/modelTable";
import {
  MODEL_GROUP_SORT_MODE,
  type ModelGroup,
  type ModelGroupSortMode,
  groupModels,
  sortModelGroups,
} from "@src/util/modelGrouping";
import { groupHasParsedModelVariants } from "@src/util/modelVariants";

interface AccountModelsInlineSplitProps {
  account: KeyVaultAccount;
  enabledSet: Set<string>;
  isAccountEnabled: boolean;
  variantsByModel: Map<string, ModelTableVariantInfo>;
  onSetModelEnabled: (model: string, enabled: boolean) => void;
  onUpdateEnabledModels: (enabledModels: readonly string[]) => void;
  onUpdateAccountDefaultVariant?: (
    accountId: string,
    baseModel: string,
    model: string
  ) => void;
}

function getGroupKey(group: ModelGroup): string {
  return `${group.label}|${group.models.join("|")}`;
}

const AccountModelsInlineSplit: React.FC<AccountModelsInlineSplitProps> = ({
  account,
  enabledSet,
  isAccountEnabled,
  variantsByModel,
  onSetModelEnabled: _onSetModelEnabled,
  onUpdateEnabledModels,
  onUpdateAccountDefaultVariant,
}) => {
  const { t } = useTranslation("integrations");
  const [sortMode, setSortMode] = useState<ModelGroupSortMode>(
    MODEL_GROUP_SORT_MODE.ENABLED_FIRST
  );

  const availableModels = useMemo(() => accountModelIds(account), [account]);

  const groups = useMemo(() => groupModels(availableModels), [availableModels]);

  const sortedGroups = useMemo(
    () => sortModelGroups(groups, sortMode, enabledSet),
    [enabledSet, groups, sortMode]
  );

  const commitEnabledModels = useCallback(
    (nextEnabledModels: readonly string[]) => {
      onUpdateEnabledModels(nextEnabledModels);
    },
    [onUpdateEnabledModels]
  );

  const defaultVariantByBaseModel = useMemo(() => {
    const map = new Map<string, string>();
    for (const variant of account.defaultVariants ?? []) {
      map.set(variant.base_model, variant.model);
    }
    return map;
  }, [account.defaultVariants]);

  const handleChangeDefaultVariant = useCallback(
    (baseModel: string, model: string) => {
      if (!onUpdateAccountDefaultVariant) return;
      onUpdateAccountDefaultVariant(account.id, baseModel, model);
    },
    [account.id, onUpdateAccountDefaultVariant]
  );

  const handleToggleGroup = useCallback(
    (group: ModelGroup, checked: boolean) => {
      const targetModels = [
        ...new Set(
          group.models.map(
            (model) => variantsByModel.get(model)?.base_model ?? model
          )
        ),
      ];
      const baseAvailableModels = [
        ...new Set(
          availableModels.map(
            (model) => variantsByModel.get(model)?.base_model ?? model
          )
        ),
      ];
      const nextEnabledModels = applyModelGroupToEnabledSet(
        enabledSet,
        targetModels,
        baseAvailableModels,
        checked
      );
      commitEnabledModels(nextEnabledModels);
    },
    [availableModels, commitEnabledModels, enabledSet, variantsByModel]
  );

  const handleToggleAllGroups = useCallback(
    (checked: boolean) => {
      const baseAvailableModels = [
        ...new Set(
          availableModels.map(
            (model) => variantsByModel.get(model)?.base_model ?? model
          )
        ),
      ];
      commitEnabledModels(checked ? baseAvailableModels : []);
    },
    [availableModels, commitEnabledModels, variantsByModel]
  );

  const allModelsSummary = useMemo(
    () => getModelGroupEnableSummary(availableModels, enabledSet),
    [availableModels, enabledSet]
  );

  const enabledGroupCount = useMemo(
    () =>
      sortedGroups.filter(
        (group) =>
          getModelGroupEnableSummary(group.models, enabledSet).anyEnabled
      ).length,
    [enabledSet, sortedGroups]
  );

  const renderAllModelsRow = () => {
    const SortModeIcon =
      sortMode === MODEL_GROUP_SORT_MODE.ENABLED_FIRST
        ? ArrangeByNumbersOneNineIcon
        : ArrangeByLettersZAIcon;
    const sortLabel =
      sortMode === MODEL_GROUP_SORT_MODE.ENABLED_FIRST
        ? t("modelsTable.sortEnabledFirst")
        : t("modelsTable.sortAlphabetical");

    return (
      <InlineSplitHeaderRow
        withSeparator
        label={t("modelsTable.availableModels", {
          enabled: enabledGroupCount,
          total: sortedGroups.length,
        })}
        trailing={
          <>
            <Tooltip kind="button" content={sortLabel} position="top">
              <Button
                variant="tertiary"
                size="mini"
                iconOnly
                icon={<AnyIcon icon={SortModeIcon} size={14} strokeWidth={2} />}
                className="table-sorter shrink-0 hover:text-text-2"
                aria-label={sortLabel}
                onClick={() =>
                  setSortMode((current) =>
                    current === MODEL_GROUP_SORT_MODE.ENABLED_FIRST
                      ? MODEL_GROUP_SORT_MODE.ALPHABETICAL
                      : MODEL_GROUP_SORT_MODE.ENABLED_FIRST
                  )
                }
              />
            </Tooltip>
            <Switch
              size="small"
              checked={allModelsSummary.allEnabled}
              mixed={allModelsSummary.mixed}
              type={allModelsSummary.mixed ? "warning" : "primary"}
              onCheckedChange={handleToggleAllGroups}
            />
          </>
        }
      />
    );
  };

  // Variant parsing walks every model id, so each row's list keeps a stable
  // identity while the groups do: a click elsewhere in the card must not make
  // every row re-derive its controls.
  const versionInfosByGroup = useMemo(() => {
    const byGroup = new Map<string, ModelTableVariantInfo[]>();
    for (const group of sortedGroups) {
      byGroup.set(
        getGroupKey(group),
        group.models.map(
          (model) =>
            variantsByModel.get(model) ?? {
              model,
              base_model: model,
              fast: false,
            }
        )
      );
    }
    return byGroup;
  }, [sortedGroups, variantsByModel]);

  const renderGroupControls = useCallback(
    (group: ModelGroup) => {
      const versionInfos = versionInfosByGroup.get(getGroupKey(group)) ?? [];

      // Without parsed variants there is no effort ladder to pick from, so the
      // row only states what the model offers.
      if (!groupHasParsedModelVariants(group.models)) {
        return (
          <span className="shrink-0 text-xs text-text-3">
            {group.models.length > 1
              ? t("modelsTable.variantCount", { count: group.models.length })
              : t("modelsTable.variantDefault")}
          </span>
        );
      }

      return (
        <ModelVariantInlineCard
          variants={versionInfos}
          defaultVariantByBaseModel={defaultVariantByBaseModel}
          onChangeDefaultVariant={
            onUpdateAccountDefaultVariant
              ? handleChangeDefaultVariant
              : undefined
          }
          embedded
        />
      );
    },
    [
      defaultVariantByBaseModel,
      handleChangeDefaultVariant,
      onUpdateAccountDefaultVariant,
      t,
      versionInfosByGroup,
    ]
  );

  const renderGroupRow = useCallback(
    (group: ModelGroup) => {
      const groupSummary = getModelGroupEnableSummary(group.models, enabledSet);
      const checked = isAccountEnabled && groupSummary.anyEnabled;
      const primaryModel = group.models[0];

      return (
        <InlineSplitKeyRow
          key={getGroupKey(group)}
          label={
            <>
              {primaryModel ? (
                <ModelIcon
                  modelName={primaryModel}
                  size="small"
                  className="shrink-0"
                />
              ) : null}
              <span className="min-w-0 truncate leading-none font-medium text-text-1">
                {group.label}
              </span>
            </>
          }
          controls={renderGroupControls(group)}
          switchChecked={checked}
          onToggle={(nextChecked) => handleToggleGroup(group, nextChecked)}
        />
      );
    },
    [enabledSet, handleToggleGroup, isAccountEnabled, renderGroupControls]
  );

  return (
    // The account detail panel is the container here; a card would nest.
    <InlineCardScrollList wrapInCard={false}>
      {groups.length > 0 ? renderAllModelsRow() : null}
      {sortedGroups.map((group) => renderGroupRow(group))}
      {groups.length === 0 ? (
        <span className="px-1 text-xs text-text-3">
          {t("keyVault.info.noModelsConfigured")}
        </span>
      ) : null}
    </InlineCardScrollList>
  );
};

export default AccountModelsInlineSplit;
