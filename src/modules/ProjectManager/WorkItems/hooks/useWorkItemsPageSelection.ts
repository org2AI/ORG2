import { useMemo, useState } from "react";

import type { WorkItem as WorkItemExtended } from "@src/types/core/workItem";

import type { BatchQuickField } from "../workItemPartialUpdate";
import { useMultiSelect } from "./useMultiSelect";
import type { useWorkItems } from "./useWorkItems";

interface UseWorkItemsPageSelectionParams {
  data: ReturnType<typeof useWorkItems>["data"];
  filteredWorkItems: WorkItemExtended[];
  onDelete: (workItemId: string) => Promise<void>;
  projectSlug?: string | null;
  onBatchDeleteComplete?: () => void;
  onBeforeDelete?: (count: number) => Promise<boolean>;
}

/**
 * Multi-select for the Work Items list: the checked ids and bulk actions, the
 * selection's short ids, and the open state of the batch edit dialogs.
 */
export function useWorkItemsPageSelection({
  data,
  filteredWorkItems,
  onDelete,
  projectSlug,
  onBatchDeleteComplete,
  onBeforeDelete,
}: UseWorkItemsPageSelectionParams) {
  const {
    selectedIds,
    bulkDeleting,
    handleCheckedChange,
    handleSelectAll,
    handleUnselectAll,
    handleBulkDelete,
  } = useMultiSelect({
    filteredWorkItems,
    onDelete,
    projectSlug,
    getShortId: data.getShortId,
    onBatchDeleteComplete,
    onBeforeDelete,
  });

  const selectedShortIds = useMemo(
    () =>
      Array.from(selectedIds)
        .map((id) => data.getShortId(id))
        .filter((shortId): shortId is string => Boolean(shortId)),
    [data, selectedIds]
  );

  const [batchPropertyOpen, setBatchPropertyOpen] = useState(false);
  const [batchQuickField, setBatchQuickField] =
    useState<BatchQuickField | null>(null);

  return {
    selectedIds,
    bulkDeleting,
    handleCheckedChange,
    handleSelectAll,
    handleUnselectAll,
    handleBulkDelete,
    selectedShortIds,
    batchPropertyOpen,
    setBatchPropertyOpen,
    batchQuickField,
    setBatchQuickField,
  };
}
