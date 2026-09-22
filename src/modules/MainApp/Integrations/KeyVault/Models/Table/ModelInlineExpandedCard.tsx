import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { ORGII_ORCHESTRATOR } from "@src/assets/providers/types";
import Switch from "@src/components/Switch";
import Tooltip from "@src/components/Tooltip";
import { isOrgiiTierModel } from "@src/config/orgiiCategories";
import type { KeyVaultAccount } from "@src/hooks/keyVault";
import {
  accountHasModel,
  accountModelIds,
} from "@src/hooks/models/useModelAccountLookup";
import ModelVariantInlineCard from "@src/modules/MainApp/Integrations/KeyVault/shared/ModelTable/ModelVariantInlineCard";
import type { ModelTableVariantInfo } from "@src/types/modelTable";
import { groupHasParsedModelVariants } from "@src/util/modelVariants";

import { InlineCardScrollList } from "../../shared/InlineCardPrimitives";
import {
  InlineSplitHeaderRow,
  InlineSplitKeyRow,
} from "../../shared/InlineSplitRows";
import { AccountSourceBreadcrumb } from "./AccountSourceBreadcrumb";
import {
  type IntegrationsModelGroupRow,
  applyModelGroupToEnabledSet,
} from "./integrationsModelGroups";

const NO_OPTIMISTIC_TOGGLES = new Map<string, boolean>();

interface ExpandedAccountEntry {
  key: string;
  account: KeyVaultAccount;
  groupModels: string[];
}

function accountHasAllEnabled(
  entry: ExpandedAccountEntry,
  optimisticToggles: Map<string, boolean>
): boolean {
  return entry.groupModels.every((model) =>
    isModelEnabledOnAccount(entry.account, model, optimisticToggles)
  );
}

function getAccountEnableSummary(
  entry: ExpandedAccountEntry,
  optimisticToggles: Map<string, boolean>
): { allEnabled: boolean; anyEnabled: boolean; mixed: boolean } {
  const allEnabled = accountHasAllEnabled(entry, optimisticToggles);
  const anyEnabled = accountHasAnyEnabled(entry, optimisticToggles);
  return {
    allEnabled,
    anyEnabled,
    mixed: anyEnabled && !allEnabled,
  };
}

function syncAccountEnabledForAccountModels(
  account: KeyVaultAccount,
  enabledModels: readonly string[],
  isAccountEnabled: (account: KeyVaultAccount) => boolean,
  onToggleAccount: (account: KeyVaultAccount, enabled: boolean) => void
): void {
  // Only react to the account-wide enabled-models set. A group-scoped toggle
  // (e.g. disabling Cursor for GPT 5.4) must not turn the account off when
  // other models on that account are still enabled.
  const anyModelEnabled = enabledModels.length > 0;
  const accountEnabled = isAccountEnabled(account);

  if (!anyModelEnabled && accountEnabled) {
    onToggleAccount(account, false);
  } else if (anyModelEnabled && !accountEnabled) {
    onToggleAccount(account, true);
  }
}

interface ModelInlineExpandedCardProps {
  group: IntegrationsModelGroupRow;
  accounts: KeyVaultAccount[];
  variantsByModel: Map<string, ModelTableVariantInfo>;
  onToggleModel: (
    model: string,
    agentType: string,
    enabled: boolean,
    accountId?: string
  ) => void;
  onUpdateAccountEnabledModels: (
    accountId: string,
    agentType: string,
    enabledModels: readonly string[]
  ) => void;
  onUpdateAccountDefaultVariant?: (
    accountId: string,
    baseModel: string,
    model: string
  ) => void;
  onToggleAccount: (account: KeyVaultAccount, enabled: boolean) => void;
  isAccountEnabled?: (account: KeyVaultAccount) => boolean;
}

function getAccountModelToggleKey(
  account: KeyVaultAccount,
  model: string
): string {
  return `${model}|${account.modelType}|${account.id}`;
}

function isModelEnabledOnAccount(
  account: KeyVaultAccount,
  model: string,
  optimisticToggles: Map<string, boolean>
): boolean {
  const toggleKey = getAccountModelToggleKey(account, model);
  return optimisticToggles.get(toggleKey) ?? accountHasModel(account, model);
}

/** Exported for the ordering test; the card is the only runtime caller. */
export function buildExpandedAccountEntries(
  group: IntegrationsModelGroupRow,
  accounts: KeyVaultAccount[],
  tokenMarketLabel: string
): ExpandedAccountEntry[] {
  if (group.isOrgiiGroup) {
    const tokenMarketAccount: KeyVaultAccount = {
      id: "token-market",
      hasLocalKey: false,
      isListed: false,
      modelType: ORGII_ORCHESTRATOR,
      name: tokenMarketLabel,
      status: "ready",
      hasKey: false,
      hasApiKey: false,
      hasSessionToken: false,
      enabled: true,
      availableModels: [],
      enabledModels: [],
    };
    return [
      {
        key: tokenMarketAccount.id,
        account: tokenMarketAccount,
        groupModels: group.models.map((row) => row.model),
      },
    ];
  }

  const entryByAccountId = new Map<string, ExpandedAccountEntry>();
  for (const row of group.models) {
    if (isOrgiiTierModel(row.model)) continue;

    for (const account of accounts) {
      if (!accountModelIds(account).includes(row.model)) continue;

      const existing = entryByAccountId.get(account.id);
      if (existing) {
        existing.groupModels.push(row.model);
        continue;
      }

      entryByAccountId.set(account.id, {
        key: account.id,
        account,
        groupModels: [row.model],
      });
    }
  }

  return [...entryByAccountId.values()]
    .map((entry) => ({
      ...entry,
      groupModels: [...new Set(entry.groupModels)].sort((modelA, modelB) =>
        modelA.localeCompare(modelB)
      ),
    }))
    .sort((entryA, entryB) => {
      // Keys that are on for this family lead the list; the rest follow
      // alphabetically. Ordering reads the stored state, not the optimistic
      // overlay, so a row settles into place once its write lands rather
      // than jumping out from under the switch that was just clicked.
      const enabledA = accountHasAnyEnabled(entryA, NO_OPTIMISTIC_TOGGLES);
      const enabledB = accountHasAnyEnabled(entryB, NO_OPTIMISTIC_TOGGLES);
      if (enabledA !== enabledB) return enabledA ? -1 : 1;
      return entryA.account.name.localeCompare(entryB.account.name, undefined, {
        sensitivity: "base",
      });
    });
}

function accountHasAnyEnabled(
  entry: ExpandedAccountEntry,
  optimisticToggles: Map<string, boolean>
): boolean {
  return entry.groupModels.some((model) =>
    isModelEnabledOnAccount(entry.account, model, optimisticToggles)
  );
}

const ModelInlineExpandedCard: React.FC<ModelInlineExpandedCardProps> = ({
  group,
  accounts,
  variantsByModel,
  onToggleModel: _onToggleModel,
  onUpdateAccountEnabledModels,
  onUpdateAccountDefaultVariant,
  onToggleAccount,
  isAccountEnabled = (account) => account.enabled,
}) => {
  const { t } = useTranslation("integrations");

  const [optimisticToggles, setOptimisticToggles] = useState<
    Map<string, boolean>
  >(new Map());
  const pendingRef = useRef<Set<string>>(new Set());

  const tokenMarketLabel = t("common:filters.tokenMarket");

  const accountEntries = useMemo(
    () => buildExpandedAccountEntries(group, accounts, tokenMarketLabel),
    [accounts, group, tokenMarketLabel]
  );

  useEffect(() => {
    if (pendingRef.current.size === 0) return;
    // Keep pending optimistic toggles whose desired state has not yet been
    // reflected by the server. The debounced save queue may still be in
    // flight; dropping all pending entries here would roll back UI for the
    // models that haven't yet been persisted.
    setOptimisticToggles((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      const resolvedKeys: string[] = [];
      for (const entry of accountEntries) {
        for (const model of entry.groupModels) {
          const key = getAccountModelToggleKey(entry.account, model);
          if (!pendingRef.current.has(key)) continue;
          const desired = prev.get(key);
          if (desired === undefined) {
            resolvedKeys.push(key);
            continue;
          }
          if (desired === accountHasModel(entry.account, model)) {
            next.delete(key);
            resolvedKeys.push(key);
          }
        }
      }
      for (const key of resolvedKeys) pendingRef.current.delete(key);
      return next.size === prev.size ? prev : next;
    });
  }, [accountEntries, accounts]);

  const toggleAccountModels = useCallback(
    (entry: ExpandedAccountEntry, checked: boolean) => {
      const targetModels = [
        ...new Set(
          entry.groupModels.map(
            (model) => variantsByModel.get(model)?.base_model ?? model
          )
        ),
      ];
      const nextEnabledModels = applyModelGroupToEnabledSet(
        entry.account.enabledModels ?? [],
        targetModels,
        entry.account.availableModels ?? [],
        checked
      );

      setOptimisticToggles((prev) => {
        const next = new Map(prev);
        for (const model of entry.groupModels) {
          const key = getAccountModelToggleKey(entry.account, model);
          next.set(key, checked);
          pendingRef.current.add(key);
        }
        return next;
      });

      onUpdateAccountEnabledModels(
        entry.account.id,
        entry.account.modelType,
        nextEnabledModels
      );

      syncAccountEnabledForAccountModels(
        entry.account,
        nextEnabledModels,
        isAccountEnabled,
        onToggleAccount
      );
    },
    [
      isAccountEnabled,
      onToggleAccount,
      onUpdateAccountEnabledModels,
      variantsByModel,
    ]
  );

  const handleToggleKeyGroup = useCallback(
    (entry: ExpandedAccountEntry, checked: boolean) => {
      toggleAccountModels(entry, checked);
    },
    [toggleAccountModels]
  );

  const toggleAllAccounts = useCallback(
    (checked: boolean) => {
      for (const entry of accountEntries) {
        toggleAccountModels(entry, checked);
      }
    },
    [accountEntries, toggleAccountModels]
  );

  const defaultVariantsByAccount = useMemo(() => {
    const byAccount = new Map<string, Map<string, string>>();
    for (const entry of accountEntries) {
      const map = new Map<string, string>();
      for (const variant of entry.account.defaultVariants ?? []) {
        map.set(variant.base_model, variant.model);
      }
      byAccount.set(entry.key, map);
    }
    return byAccount;
  }, [accountEntries]);

  // Keys are listed with any-enabled semantics: a key counts as ON for this
  // family as long as one of its variants is enabled. There is no mixed
  // state — the per-variant breakdown lives in each row's options dropdown.
  const anyEnabledAccountCount = accountEntries.filter(
    (entry) => getAccountEnableSummary(entry, optimisticToggles).anyEnabled
  ).length;
  const anyAccountEnabled =
    accountEntries.length > 0 && anyEnabledAccountCount > 0;

  const renderAllSourcesRow = () => (
    <InlineSplitHeaderRow
      withSeparator
      label={t("modelsTable.availableKeys", {
        enabled: anyEnabledAccountCount,
        total: accountEntries.length,
      })}
      trailing={
        <Tooltip
          kind="button"
          position="top"
          content={t(
            anyAccountEnabled
              ? "modelsTable.turnOffAllKeysFor"
              : "modelsTable.turnOnAllKeysFor",
            { model: group.label }
          )}
        >
          <span className="inline-flex">
            <Switch
              size="small"
              checked={anyAccountEnabled}
              onCheckedChange={toggleAllAccounts}
            />
          </span>
        </Tooltip>
      }
    />
  );

  // Variant parsing walks every model id, so each row's list keeps a stable
  // identity while the accounts do: a click elsewhere in the card must not
  // make every row re-derive its controls.
  const versionInfosByAccount = useMemo(() => {
    const byAccount = new Map<string, ModelTableVariantInfo[]>();
    for (const entry of accountEntries) {
      byAccount.set(
        entry.key,
        entry.groupModels.map(
          (model) =>
            variantsByModel.get(model) ?? {
              model,
              base_model: model,
              fast: false,
            }
        )
      );
    }
    return byAccount;
  }, [accountEntries, variantsByModel]);

  const renderKeyControls = (entry: ExpandedAccountEntry) => {
    const versionInfos = versionInfosByAccount.get(entry.key) ?? [];

    // Without parsed variants there is no effort ladder to pick from, so the
    // row only states what the key offers.
    if (!groupHasParsedModelVariants(entry.groupModels)) {
      return (
        <span className="shrink-0 text-xs text-text-3">
          {entry.groupModels.length > 1
            ? t("modelsTable.variantCount", { count: entry.groupModels.length })
            : t("modelsTable.variantDefault")}
        </span>
      );
    }

    return (
      <ModelVariantInlineCard
        variants={versionInfos}
        defaultVariantByBaseModel={defaultVariantsByAccount.get(entry.key)}
        onChangeDefaultVariant={
          onUpdateAccountDefaultVariant
            ? (baseModel, model) =>
                onUpdateAccountDefaultVariant(
                  entry.account.id,
                  baseModel,
                  model
                )
            : undefined
        }
        embedded
      />
    );
  };

  const renderAccountRow = (entry: ExpandedAccountEntry) => {
    const enableSummary = getAccountEnableSummary(entry, optimisticToggles);
    const switchTooltip = t(
      enableSummary.anyEnabled
        ? "modelsTable.turnOffKeyFor"
        : "modelsTable.turnOnKeyFor",
      { model: group.label }
    );

    return (
      <InlineSplitKeyRow
        key={entry.key}
        label={
          <AccountSourceBreadcrumb
            modelType={entry.account.modelType}
            accountName={entry.account.name}
          />
        }
        controls={renderKeyControls(entry)}
        switchChecked={enableSummary.anyEnabled}
        switchTooltip={switchTooltip}
        onToggle={(nextChecked) => handleToggleKeyGroup(entry, nextChecked)}
      />
    );
  };

  return (
    <InlineCardScrollList>
      {accountEntries.length > 0 ? renderAllSourcesRow() : null}
      {accountEntries.map((entry) => renderAccountRow(entry))}
      {accountEntries.length === 0 ? (
        <span className="px-1 text-xs text-text-3">
          {t("modelPreview.noSources")}
        </span>
      ) : null}
    </InlineCardScrollList>
  );
};

export default ModelInlineExpandedCard;
