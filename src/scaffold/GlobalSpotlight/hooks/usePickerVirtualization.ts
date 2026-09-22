import {
  type Range,
  defaultRangeExtractor,
  useVirtualizer,
} from "@tanstack/react-virtual";
import { useCallback, useLayoutEffect, useRef } from "react";

import { observePickerScrollOffset } from "./observePickerScrollOffset";

const NO_STICKY_INDICES: number[] = [];

export function findStickyIndex(indices: number[], startIndex: number): number {
  let low = 0;
  let high = indices.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (indices[mid] <= startIndex) low = mid + 1;
    else high = mid;
  }
  return indices[low - 1] ?? -1;
}

interface Options {
  stickyIndices?: number[];
  count: number;
  getItemKey: (index: number) => string | number;
  estimateSize: (index: number) => number;
  containerHeight: number;
  selectedIndex: number;
  keyboardNavigated: boolean;
  searchQuery: string;
  enabled?: boolean;
  gap?: number;
  scrollPadding?: number;
  onScrollExternal?: (event: React.UIEvent<HTMLDivElement>) => void;
  onLoadMore?: () => void;
}

/** One scrolling owner for branch/PR rows in both picker presentations. */
export function usePickerVirtualization({
  stickyIndices = NO_STICKY_INDICES,
  count,
  getItemKey,
  estimateSize,
  containerHeight,
  selectedIndex,
  keyboardNavigated,
  searchQuery,
  enabled = true,
  gap = 0,
  scrollPadding = 0,
  onScrollExternal,
  onLoadMore,
}: Options) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indices = defaultRangeExtractor(range);
      const stickyIndex = findStickyIndex(stickyIndices, range.startIndex);
      return stickyIndex >= 0 && stickyIndex < indices[0]
        ? [stickyIndex, ...indices]
        : indices;
    },
    [stickyIndices]
  );
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack's imperative instance stays inside this hook; consumers receive a rendered snapshot.
  const virtualizer = useVirtualizer({
    count,
    getItemKey,
    estimateSize,
    getScrollElement: () => containerRef.current,
    observeElementOffset: observePickerScrollOffset,
    overscan: 5,
    rangeExtractor,
    enabled: enabled && count > 0,
    initialRect: { width: 0, height: containerHeight },
    gap,
    scrollPaddingStart: scrollPadding,
    scrollPaddingEnd: scrollPadding,
  });

  useLayoutEffect(() => {
    if (enabled) virtualizer.scrollToOffset(0);
  }, [searchQuery, enabled, virtualizer]);

  useLayoutEffect(() => {
    // Off-screen rows have no DOM node yet. Footer action indices are excluded.
    if (
      enabled &&
      keyboardNavigated &&
      selectedIndex >= 0 &&
      selectedIndex < count
    ) {
      virtualizer.scrollToIndex(selectedIndex, { align: "auto" });
    }
  }, [selectedIndex, keyboardNavigated, count, enabled, virtualizer]);

  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      onScrollExternal?.(event);
      const node = event.currentTarget;
      // Appending rows does not recursively drain a repository. Loading is
      // driven by scrolling (including keyboard scrolling), never an idle poll.
      if (
        node.scrollTop > 0 &&
        node.scrollHeight - node.scrollTop - node.clientHeight < 100
      ) {
        onLoadMore?.();
      }
    },
    [onScrollExternal, onLoadMore]
  );

  const rows = virtualizer.getVirtualItems();

  return {
    containerRef,
    stickyIndex: findStickyIndex(
      stickyIndices,
      virtualizer.range?.startIndex ?? 0
    ),
    rows,
    totalSize: virtualizer.getTotalSize(),
    measureElement: virtualizer.measureElement,
    handleScroll,
  };
}
