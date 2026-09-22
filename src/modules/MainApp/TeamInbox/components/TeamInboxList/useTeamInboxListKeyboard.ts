import type React from "react";
import { useCallback, useRef } from "react";

import { type TeamInboxItem, getTeamInboxItemKey } from "../../domain";

/** Arrow/Home/End selection across the ordered Inbox rows. */
export function useTeamInboxListKeyboard({
  orderedInboxItems,
  selectedIndex,
  onSelectItem,
}: {
  orderedInboxItems: readonly TeamInboxItem[];
  selectedIndex: number;
  onSelectItem: (item: TeamInboxItem) => void;
}) {
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const selectAt = useCallback(
    (index: number) => {
      const item = orderedInboxItems[index];
      if (!item) return;
      onSelectItem(item);
      rowRefs.current.get(getTeamInboxItemKey(item))?.focus();
    },
    [onSelectItem, orderedInboxItems]
  );

  const handleListKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (orderedInboxItems.length === 0) return;
      const currentIndex = selectedIndex >= 0 ? selectedIndex : 0;
      let nextIndex: number | null = null;
      switch (event.key) {
        case "ArrowDown":
          nextIndex = Math.min(currentIndex + 1, orderedInboxItems.length - 1);
          break;
        case "ArrowUp":
          nextIndex = Math.max(currentIndex - 1, 0);
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = orderedInboxItems.length - 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      selectAt(nextIndex);
    },
    [orderedInboxItems.length, selectAt, selectedIndex]
  );

  return { rowRefs, handleListKeyDown };
}
