import React, { useCallback } from "react";

import type { SpotlightItem } from "../../types";

interface UseWorkingDirectoryPaletteSectionTabOptions {
  addMenuActive: boolean;
  mainItems: SpotlightItem[];
  pinnedActionCount: number;
  pinnedActionStartIndex: number;
}

/**
 * Tab / Shift+Tab hop between the main list and the pinned action section,
 * skipping headers and disabled rows.
 */
export function useWorkingDirectoryPaletteSectionTab({
  addMenuActive,
  mainItems,
  pinnedActionCount,
  pinnedActionStartIndex,
}: UseWorkingDirectoryPaletteSectionTabOptions) {
  const isItemSelectable = useCallback((item: SpotlightItem) => {
    const data = item.data as Record<string, unknown> | undefined;
    return !data?.isHeader && !data?.disabled;
  }, []);

  const handleSectionTab = useCallback(
    (
      forward: boolean,
      selectedIndex: number,
      setSelectedIndex: React.Dispatch<React.SetStateAction<number>>
    ) => {
      if (addMenuActive || pinnedActionCount === 0) return;

      const firstMainItemIndex = mainItems.findIndex(isItemSelectable);
      const firstPinnedItemIndex = pinnedActionStartIndex;
      const selectedPinnedActionIndex = selectedIndex - pinnedActionStartIndex;
      const selectedWithinPinnedActions =
        selectedPinnedActionIndex >= 0 &&
        selectedPinnedActionIndex < pinnedActionCount;
      const nextIndex = forward
        ? selectedWithinPinnedActions
          ? firstMainItemIndex >= 0
            ? firstMainItemIndex
            : firstPinnedItemIndex
          : firstPinnedItemIndex
        : selectedWithinPinnedActions
          ? firstMainItemIndex >= 0
            ? firstMainItemIndex
            : firstPinnedItemIndex
          : firstPinnedItemIndex;

      setSelectedIndex(nextIndex);
    },
    [
      addMenuActive,
      isItemSelectable,
      mainItems,
      pinnedActionCount,
      pinnedActionStartIndex,
    ]
  );

  return { isItemSelectable, handleSectionTab };
}
