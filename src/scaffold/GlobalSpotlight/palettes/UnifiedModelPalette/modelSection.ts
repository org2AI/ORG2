import type { AdvancedConfig } from "@src/features/SessionCreator/types";
import {
  type RecentModelEntry,
  marketSelectionsEquivalent,
} from "@src/store/session/recentModelEntriesAtom";
import { groupModels } from "@src/util/modelGrouping";
import { getModelVariantBaseModel } from "@src/util/modelVariants";

import type { SpotlightItem } from "../../types";

export const MODEL_SECTION = {
  PINNED: "pinned",
  RECENT: "recent",
  ALL: "all",
} as const;

export type ModelSection = (typeof MODEL_SECTION)[keyof typeof MODEL_SECTION];

export function buildSectionHeader(
  id: ModelSection,
  label: string
): SpotlightItem {
  return {
    id: `model-section:${id}`,
    label,
    icon: "",
    type: "option" as const,
    data: { isHeader: true },
    action: () => {},
  };
}

export function getActiveModelId(
  config: Pick<AdvancedConfig, "model" | "listingModel">
): string | undefined {
  return config.model || config.listingModel || undefined;
}

export function entryMatchesActiveConfig(
  entry: RecentModelEntry,
  config: Pick<
    AdvancedConfig,
    | "model"
    | "listingModel"
    | "selectedAccountId"
    | "credentialSource"
    | "marketProfileId"
    | "selectedSourceLabel"
    | "selectedSourceModelType"
    | "listingModelType"
    | "cliAgentType"
  >
): boolean {
  const activeModel = getActiveModelId(config);
  if (
    !activeModel ||
    getModelVariantBaseModel(entry.modelId) !==
      getModelVariantBaseModel(activeModel)
  ) {
    return false;
  }

  if (entry.credentialSource || config.credentialSource) {
    return marketSelectionsEquivalent(entry, {
      credentialSource: config.credentialSource,
      marketProfileId: config.marketProfileId,
      cliAgentType: config.cliAgentType,
      modelType: config.selectedSourceModelType ?? config.listingModelType,
    });
  }

  if (entry.accountId && config.selectedAccountId) {
    return entry.accountId === config.selectedAccountId;
  }

  const configModelType =
    config.cliAgentType ??
    config.selectedSourceModelType ??
    config.listingModelType;
  const entryModelType = entry.cliAgentType ?? entry.modelType;
  if (configModelType && entryModelType !== configModelType) {
    return false;
  }

  if (entry.accountName && config.selectedSourceLabel) {
    return entry.accountName === config.selectedSourceLabel;
  }

  if (entry.accountId || config.selectedAccountId) {
    return entry.accountId === config.selectedAccountId;
  }

  return true;
}

export function buildGroupByModel(
  modelIds: Iterable<string>
): Map<string, readonly string[]> {
  const groups = groupModels(Array.from(modelIds));
  const groupMap = new Map<string, readonly string[]>();
  for (const group of groups) {
    for (const modelId of group.models) {
      groupMap.set(modelId, group.models);
    }
  }
  return groupMap;
}
