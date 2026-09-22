import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";

import type { PrVirtualRow } from "./types";

/** Windowing for the flattened PR row model: scroll element and virtualizer. */
export function usePullRequestVirtualList(virtualRows: PrVirtualRow[]) {
  const listRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual exposes imperative helpers that cannot be memoized safely.
  const prListVirtualizer = useVirtualizer({
    count: virtualRows.length,
    getScrollElement: () => listRef.current,
    estimateSize: (index) => (virtualRows[index]?.kind === "status" ? 36 : 24),
    overscan: 10,
  });
  const virtualItems = prListVirtualizer.getVirtualItems();

  return { listRef, prListVirtualizer, virtualItems };
}
