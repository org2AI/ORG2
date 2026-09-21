/**
 * VirtualizedListBase — shared windowed list for tree/list views, with the
 * scroll-preservation behaviour those views depend on.
 *
 * Every row here is exactly `itemHeight` tall (all the scroll math below is
 * `index * itemHeight`), so the list windows on `VirtualList`'s fixed-height
 * path and never pays for per-row measurement.
 *
 * SCROLL PRESERVATION — three separate problems, three mechanisms:
 *   1. Mount with a saved offset (`initialScrollTop`, typically from a Jotai
 *      atom that outlives the component): re-applied in a layout effect.
 *   2. The list's *structure* changes under the user (a folder expands, a
 *      filter narrows): the first visible item is tracked by path, and after
 *      the change the list scrolls back to wherever that item moved.
 *   3. Something resets the scroller to 0 mid-life (a remount inside a tab
 *      switch): a post-render layout effect puts the offset back.
 *
 * All three write through `isRestoringScrollRef` so a programmatic scroll is
 * not mistaken for the user scrolling, which would corrupt the tracked
 * position it is trying to restore.
 *
 * PERFORMANCE: scroll position lives in refs, never state — a tree scroll must
 * not re-render the tree.
 */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

import {
  VirtualList,
  type VirtualListHandle,
} from "@src/components/VirtualList";

import { TREE_ROW_HEIGHT } from "./config";

// ============================================
// Types
// ============================================

export interface VirtualizedListBaseHandle {
  /** Scroll to a specific index */
  scrollToIndex: (index: number, behavior?: "auto" | "smooth") => void;
  /** Get current scroll position */
  getScrollTop: () => number;
}

export interface VirtualizedListBaseProps<T> {
  /** Flattened list of items to render */
  items: T[];
  /** Render function for each item */
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Compute stable key for each item */
  computeItemKey: (item: T, index: number) => string | number;
  /** Get unique path/id for scroll restoration (optional) */
  getItemPath?: (item: T) => string;
  /** Row height — uniform for every row (defaults to TREE_ROW_HEIGHT) */
  itemHeight?: number;
  /** Number of rows to render outside the viewport (defaults to 30) */
  overscan?: number;
  /** Called when scrolling near end */
  onEndReached?: () => void;
  /** Additional class name */
  className?: string;
  /** Stick to the bottom when rows are appended and the user is already there */
  followOutput?: boolean;
  /** Top padding for sticky headers etc */
  paddingTop?: number;
  /**
   * Initial scroll position (in pixels) to restore on mount.
   * Used when external state (Jotai atom) needs to survive remounting.
   */
  initialScrollTop?: number;
  /** Callback when scroll position changes - for external state sync */
  onScrollPositionChange?: (scrollTop: number) => void;
}

/** Treat "within one row of the end" as being at the bottom. */
const FOLLOW_OUTPUT_THRESHOLD_ROWS = 1;
/** How long a programmatic scroll suppresses user-scroll tracking. */
const RESTORE_SETTLE_MS = 50;

// ============================================
// Component
// ============================================

function VirtualizedListBaseInner<T>(
  {
    items,
    renderItem,
    computeItemKey,
    getItemPath,
    itemHeight = TREE_ROW_HEIGHT,
    overscan = 30,
    onEndReached,
    className = "h-full scrollbar-hide",
    followOutput = false,
    paddingTop,
    initialScrollTop = 0,
    onScrollPositionChange,
  }: VirtualizedListBaseProps<T>,
  ref: React.ForwardedRef<VirtualizedListBaseHandle>
) {
  const listRef = useRef<VirtualListHandle>(null);

  // SCROLL PRESERVATION: Track scroll position and first visible item
  // Initialize from external state if provided (survives remounting)
  const lastScrollTopRef = useRef(initialScrollTop);
  const firstVisiblePathRef = useRef<string | null>(null);
  const isRestoringScrollRef = useRef(false);
  const prevItemsLengthRef = useRef(items.length);
  const hasRestoredInitialScrollRef = useRef(false);
  const wasAtBottomRef = useRef(true);

  // Scroll handlers read the latest items and callback without depending on
  // their identity. Written in a layout effect (never during render) so a
  // scroll that lands between renders still sees a committed value.
  const itemsRef = useRef(items);
  const onScrollPositionChangeRef = useRef(onScrollPositionChange);
  React.useLayoutEffect(() => {
    itemsRef.current = items;
    onScrollPositionChangeRef.current = onScrollPositionChange;
  });

  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const scroller = event.currentTarget;
      const scrollTop = scroller.scrollTop;
      lastScrollTopRef.current = scrollTop;
      wasAtBottomRef.current =
        scroller.scrollHeight - scrollTop - scroller.clientHeight <=
        itemHeight * FOLLOW_OUTPUT_THRESHOLD_ROWS;

      // A programmatic scroll must not overwrite the anchor it is restoring.
      if (!isRestoringScrollRef.current && getItemPath) {
        const currentItems = itemsRef.current;
        if (currentItems.length > 0) {
          const visibleIndex = Math.min(
            currentItems.length - 1,
            Math.max(0, Math.floor(scrollTop / itemHeight))
          );
          firstVisiblePathRef.current = getItemPath(currentItems[visibleIndex]);
        }
      }

      // Notify external state (Jotai atom) of scroll changes
      onScrollPositionChangeRef.current?.(scrollTop);
    },
    [getItemPath, itemHeight]
  );

  const beginRestore = useCallback(() => {
    isRestoringScrollRef.current = true;
    setTimeout(() => {
      isRestoringScrollRef.current = false;
    }, RESTORE_SETTLE_MS);
  }, []);

  // SCROLL RESTORATION: When the list structure changes, scroll back to
  // wherever the previously-visible row moved to.
  useEffect(() => {
    const prevLength = prevItemsLengthRef.current;
    const currentLength = items.length;
    prevItemsLengthRef.current = currentLength;

    // Only restore if structure actually changed
    if (prevLength === currentLength) return;

    // Appending rows while the user sits at the bottom keeps them there.
    if (followOutput && currentLength > prevLength && wasAtBottomRef.current) {
      beginRestore();
      listRef.current?.scrollToIndex({
        index: currentLength - 1,
        align: "end",
        behavior: "auto",
      });
      return;
    }

    if (!getItemPath || !firstVisiblePathRef.current) return;

    // Find the previously visible item in the new list
    const prevPath = firstVisiblePathRef.current;
    const newIndex = items.findIndex((item) => getItemPath(item) === prevPath);
    if (newIndex === -1) return;

    const expectedScrollTop = newIndex * itemHeight;
    // Only restore if scroll position would be significantly different
    if (Math.abs(expectedScrollTop - lastScrollTopRef.current) <= itemHeight) {
      return;
    }

    beginRestore();
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({
        index: newIndex,
        align: "start",
        behavior: "auto",
      });
    });
  }, [items, getItemPath, itemHeight, followOutput, beginRestore]);

  // SCROLL PRESERVATION: restore the mount-time offset once the scroller is
  // tall enough to hold it. Runs after every render (no dep array) because the
  // rows below the offset may not be laid out on the first pass; the attempt
  // that lands sets the flag.
  React.useLayoutEffect(() => {
    if (hasRestoredInitialScrollRef.current) return;
    if (initialScrollTop <= 0) {
      hasRestoredInitialScrollRef.current = true;
      return;
    }
    const scroller = listRef.current?.getScrollElement();
    if (!scroller) return;
    if (scroller.scrollHeight - scroller.clientHeight < initialScrollTop)
      return;

    hasRestoredInitialScrollRef.current = true;
    beginRestore();
    scroller.scrollTop = initialScrollTop;
    lastScrollTopRef.current = initialScrollTop;
  });

  // SCROLL PRESERVATION: After any render, check if scroll was reset and restore
  // Uses useLayoutEffect to run before paint
  React.useLayoutEffect(() => {
    const scroller = listRef.current?.getScrollElement();
    if (!scroller) return;
    if (isRestoringScrollRef.current) return;

    // If we had a scroll position but the scroller is now at 0, restore it
    const expectedScrollTop = lastScrollTopRef.current;
    if (expectedScrollTop > itemHeight && scroller.scrollTop === 0) {
      beginRestore();
      scroller.scrollTop = expectedScrollTop;
    }
  });

  // Expose handle methods
  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex: (
        index: number,
        behavior: "auto" | "smooth" = "smooth"
      ) => {
        listRef.current?.scrollToIndex({ index, align: "center", behavior });
      },
      getScrollTop: () => lastScrollTopRef.current,
    }),
    []
  );

  // Memoized render function
  const itemContent = useCallback(
    (index: number) => {
      const item = items[index];
      if (!item) return null;
      return renderItem(item, index);
    },
    [items, renderItem]
  );

  // Memoized key function
  const itemKey = useCallback(
    (index: number) => {
      const item = items[index];
      if (!item) return index;
      return computeItemKey(item, index);
    },
    [items, computeItemKey]
  );

  if (items.length === 0) {
    return null;
  }

  return (
    <VirtualList
      ref={listRef}
      totalCount={items.length}
      itemContent={itemContent}
      computeItemKey={itemKey}
      fixedItemHeight={itemHeight}
      // `overscan` is documented in ROWS here; VirtualList buffers in pixels.
      overscanPx={overscan * itemHeight}
      endReached={onEndReached}
      className={`tree-guide-scope ${className}`}
      onScroll={handleScroll}
      style={paddingTop ? { paddingTop } : undefined}
    />
  );
}

// Export with proper typing for generics
export const VirtualizedListBase = forwardRef(VirtualizedListBaseInner) as <T>(
  props: VirtualizedListBaseProps<T> & {
    ref?: React.ForwardedRef<VirtualizedListBaseHandle>;
  }
) => React.ReactElement | null;

export default VirtualizedListBase;
