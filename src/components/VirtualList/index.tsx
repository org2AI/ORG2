/**
 * VirtualList — the app's single windowed-list primitive.
 *
 * Built on `@tanstack/react-virtual`, which is also what ChatHistoryList,
 * TurnPageList and the Spotlight pickers already use. It exists so plain
 * "render N rows in a scroller" surfaces do not each hand-roll a virtualizer,
 * and so the app ships one virtualization library instead of two.
 *
 * The prop surface deliberately mirrors the `react-virtuoso` call sites it
 * replaced (`data` / `totalCount`, `itemContent`, `computeItemKey`) so the
 * migration stayed a rename rather than a rewrite. Two conversions are not
 * cosmetic and are easy to get wrong in the other direction:
 *
 *   - Virtuoso's `overscan` / `increaseViewportBy` are PIXELS. TanStack's
 *     `overscan` is a ROW COUNT. `overscanPx` below does the division so call
 *     sites keep expressing the buffer in the units they were tuned in.
 *   - Virtuoso measures every row by default. TanStack only measures rows whose
 *     node is attached to `measureElement`. Rows are measured here unless
 *     `fixedItemHeight` is given, which is the cheaper path and skips the
 *     per-row ResizeObserver entirely.
 *
 * Sticky group headers are supported via `stickyIndices` (what `GroupedVirtuoso`
 * provided). Stick-to-bottom and scroll-anchor restoration are NOT folded in:
 * they need per-surface policy about what counts as "at the bottom" or which
 * row is the anchor, so the tree components own those on top of
 * `useVirtualizer` directly.
 */
import {
  type Range,
  defaultRangeExtractor,
  useVirtualizer,
} from "@tanstack/react-virtual";
import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

const NO_STICKY_INDICES: readonly number[] = [];

/**
 * Last index in `indices` that is <= `startIndex` — the group header the
 * viewport is currently inside. Binary search: group headers are re-derived on
 * every scroll frame, so a linear scan here shows up on long lists.
 */
export function findStickyIndex(
  indices: readonly number[],
  startIndex: number
): number {
  let low = 0;
  let high = indices.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (indices[mid] <= startIndex) low = mid + 1;
    else high = mid;
  }
  return indices[low - 1] ?? -1;
}

/** Imperative handle. Mirrors the slice of `VirtuosoHandle` the app used. */
export interface VirtualListHandle {
  scrollToIndex(
    location:
      | number
      | {
          index: number;
          align?: "start" | "center" | "end" | "auto";
          behavior?: "auto" | "smooth";
        }
  ): void;
  scrollTo(options: { top?: number; behavior?: ScrollBehavior }): void;
  /** The scrolling element, for callers that adjust `scrollTop` directly. */
  getScrollElement(): HTMLDivElement | null;
}

interface VirtualListProps<T> {
  /** Row data. Omit and pass `totalCount` for index-only lists. */
  data?: readonly T[];
  /** Row count when there is no `data` array. Ignored when `data` is given. */
  totalCount?: number;
  itemContent: (index: number, item: T) => React.ReactNode;
  computeItemKey?: (index: number, item: T) => React.Key;
  /**
   * Exact row height. Skips per-row measurement, so only pass it when every
   * row really is this tall — a wrong value here misplaces rows rather than
   * merely mis-estimating the scrollbar.
   */
  fixedItemHeight?: number;
  /** Starting estimate for measured rows. Refined as rows are measured. */
  estimatedItemHeight?: number;
  /** Off-screen buffer in PIXELS (Virtuoso's unit), converted to rows here. */
  overscanPx?: number;
  /**
   * Position ordinary rows with `top` instead of a transform so an item's own
   * `position: sticky` descendants resolve against this list's scroller.
   * Leave disabled for ordinary lists, where transform positioning remains the
   * cheaper default.
   */
  preserveStickyDescendants?: boolean;
  /**
   * Ascending row indices that pin to the top of the scroller while the
   * viewport is inside their section — group headers. The active one stays
   * rendered even when scrolled out of range, which is how a sticky header
   * survives windowing.
   */
  stickyIndices?: readonly number[];
  /** Fired once per `count` when the last row enters the rendered window. */
  endReached?: () => void;
  /** Rendered after the windowed rows, inside the scroller (trailing padding). */
  footer?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  onScroll?: (event: React.UIEvent<HTMLDivElement>) => void;
  "data-testid"?: string;
}

const DEFAULT_ESTIMATED_ITEM_HEIGHT = 32;
const DEFAULT_OVERSCAN_PX = 200;

function VirtualListImpl<T>(
  {
    data,
    totalCount,
    itemContent,
    computeItemKey,
    fixedItemHeight,
    estimatedItemHeight,
    overscanPx = DEFAULT_OVERSCAN_PX,
    preserveStickyDescendants = false,
    stickyIndices = NO_STICKY_INDICES,
    endReached,
    footer,
    className,
    style,
    onScroll,
    "data-testid": testId,
  }: VirtualListProps<T>,
  ref: React.ForwardedRef<VirtualListHandle>
) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const count = data ? data.length : (totalCount ?? 0);

  const rowHeight =
    fixedItemHeight ?? estimatedItemHeight ?? DEFAULT_ESTIMATED_ITEM_HEIGHT;
  const estimateSize = useCallback(() => rowHeight, [rowHeight]);

  // Virtuoso buffers by pixels, TanStack by rows. Round up so a converted
  // buffer is never smaller than the one the call site was tuned with.
  const overscan = Math.max(1, Math.ceil(overscanPx / rowHeight));

  const getItemKey = useCallback(
    (index: number): React.Key => {
      if (!computeItemKey) return index;
      // `data` is undefined for index-only lists; those keys ignore the item.
      return computeItemKey(index, (data?.[index] as T) ?? (undefined as T));
    },
    [computeItemKey, data]
  );

  // Keep the active group header in the rendered set even once its own row has
  // scrolled out of the window, otherwise the sticky header vanishes mid-group.
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indices = defaultRangeExtractor(range);
      if (stickyIndices.length === 0) return indices;
      const stickyIndex = findStickyIndex(stickyIndices, range.startIndex);
      return stickyIndex >= 0 && stickyIndex < indices[0]
        ? [stickyIndex, ...indices]
        : indices;
    },
    [stickyIndices]
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack's imperative instance stays inside this component; consumers get a rendered snapshot.
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollerRef.current,
    estimateSize,
    getItemKey,
    overscan,
    rangeExtractor,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const activeStickyIndex =
    stickyIndices.length === 0
      ? -1
      : findStickyIndex(stickyIndices, virtualizer.range?.startIndex ?? 0);

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex(location) {
        const { index, align, behavior } =
          typeof location === "number" ? { index: location } : location;
        virtualizer.scrollToIndex(index, {
          align: align === "auto" ? undefined : align,
          behavior,
        });
      },
      scrollTo({ top, behavior }) {
        if (top === undefined) return;
        virtualizer.scrollToOffset(top, { behavior });
      },
      getScrollElement: () => scrollerRef.current,
    }),
    [virtualizer]
  );

  // Fire once per count: re-arming on `count` lets an appended page trigger
  // the next fetch, while a re-render at the same length does not re-fetch.
  const endReachedCountRef = useRef(-1);
  const lastIndex = virtualItems.at(-1)?.index ?? -1;
  useEffect(() => {
    if (!endReached || count === 0) return;
    if (lastIndex < count - 1) return;
    if (endReachedCountRef.current === count) return;
    endReachedCountRef.current = count;
    endReached();
  }, [endReached, lastIndex, count]);

  const measureRef = fixedItemHeight ? undefined : virtualizer.measureElement;
  // The virtualizer instance is stable while its row count and measurements
  // change. Read the current extent each render so removed rows leave no gap.
  const spacerStyle = {
    height: virtualizer.getTotalSize(),
    position: "relative" as const,
  };

  return (
    <div
      ref={scrollerRef}
      className={className}
      style={{ overflowY: "auto", ...style }}
      onScroll={onScroll}
      data-testid={testId}
    >
      <div style={spacerStyle}>
        {virtualItems.map((virtualItem) => {
          // A sticky group row is pinned with `top`, never a transform. Rows
          // whose content owns a sticky descendant also opt out of transforms:
          // a transformed wrapper establishes a containing block that prevents
          // that descendant from pinning to this scroller.
          const isSticky = virtualItem.index === activeStickyIndex;
          return (
            <div
              key={virtualItem.key}
              ref={isSticky ? undefined : measureRef}
              data-index={virtualItem.index}
              className={
                isSticky
                  ? "sticky top-0 left-0 z-10 w-full"
                  : "absolute top-0 left-0 w-full"
              }
              style={{
                ...(isSticky
                  ? null
                  : preserveStickyDescendants
                    ? { top: virtualItem.start }
                    : { transform: `translateY(${virtualItem.start}px)` }),
                ...(fixedItemHeight ? { height: fixedItemHeight } : null),
              }}
            >
              {itemContent(
                virtualItem.index,
                (data?.[virtualItem.index] as T) ?? (undefined as T)
              )}
            </div>
          );
        })}
      </div>
      {footer}
    </div>
  );
}

/** `forwardRef` erases the generic, so restore it on the exported binding. */
export const VirtualList = React.forwardRef(VirtualListImpl) as <T>(
  props: VirtualListProps<T> & { ref?: React.Ref<VirtualListHandle> }
) => React.ReactElement;

export default VirtualList;
