import type { SpotlightItem, SpotlightItemData } from "../../shared";

interface ModelRowData {
  testId?: string;
  modelSection?: string;
  modelId?: string;
  groupModelIds?: readonly string[];
  sourceAccountId?: string;
  sourceModelType?: string;
  sourceType?: string;
}
export function withModelRowAttributes<
  T extends SpotlightItem & { data: SpotlightItemData & ModelRowData },
>(item: T): T {
  const data = item.data;
  return {
    ...item,
    data: {
      ...data,
      domAttributes: {
        "data-testid": data.testId,
        "data-spotlight-model-section": data.modelSection,
        "data-spotlight-model-id": data.modelId,
        "data-spotlight-group-model-ids": data.groupModelIds?.join(" "),
        "data-source-account-id": data.sourceAccountId,
        "data-source-model-type": data.sourceModelType,
        "data-source-type": data.sourceType,
      },
    },
  };
}
