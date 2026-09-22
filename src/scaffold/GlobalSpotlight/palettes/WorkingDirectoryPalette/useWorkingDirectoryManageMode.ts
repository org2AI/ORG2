import { useCallback, useState } from "react";

interface UseWorkingDirectoryManageModeOptions {
  initialManageMode: boolean;
  setSearchQuery: (query: string) => void;
}

/**
 * Manage-mode state: whether the palette is in bulk-manage mode and which
 * rows are ticked. Workspaces use the `workspace-${ws.workspaceId}` id form;
 * repos use the raw `repo.id`.
 */
export function useWorkingDirectoryManageMode({
  initialManageMode,
  setSearchQuery,
}: UseWorkingDirectoryManageModeOptions) {
  const [isManageMode, setIsManageMode] = useState(initialManageMode);
  /** Set of selected item IDs in manage mode. Workspaces use the
   *  `workspace-${ws.workspaceId}` form; repos use the raw `repo.id`. */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const toggleManageMode = useCallback(() => {
    setIsManageMode((prev) => {
      if (prev) {
        setSelectedIds(new Set());
        return false;
      }
      setSearchQuery("");
      return true;
    });
  }, [setSearchQuery]);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectedCount = selectedIds.size;

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  return {
    isManageMode,
    setIsManageMode,
    selectedIds,
    setSelectedIds,
    selectedCount,
    toggleManageMode,
    toggleSelection,
    clearSelection,
  };
}
