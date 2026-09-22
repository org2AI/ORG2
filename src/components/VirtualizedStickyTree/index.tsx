/**
 * VirtualizedStickyTree Component
 *
 * Reusable virtualized tree with VS Code-style sticky scroll.
 *
 * Features:
 * - Virtualized rendering through the shared VirtualList primitive
 * - VS Code-style sticky headers with position-based clipping
 * - Scroll preservation when tree structure changes
 * - Generic - works with any tree node type
 *
 * @example
 * ```tsx
 * <VirtualizedStickyTree
 *   flattenedNodes={flattenedNodes}
 *   rowHeight={28}
 *   renderItem={(item) => <MyTreeRow node={item.node} depth={item.depth} />}
 *   renderStickyItem={(stickyNode, onClick) => (
 *     <MyStickyRow node={stickyNode.node} onClick={onClick} />
 *   )}
 * />
 * ```
 */
import { useAtomValue } from "jotai";
import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { Placeholder } from "@src/components/Placeholder";
import {
  VirtualList,
  type VirtualListHandle,
} from "@src/components/VirtualList";
import { useElementDimensions } from "@src/hooks/ui/layout/useElementDimensions";
import { editorShowTreeIndentGuidesAtom } from "@src/store/ui/editorSettingsAtom";

import { StickyHeadersContainer } from "./StickyHeadersContainer";
import {
  DEFAULT_MAX_STICKY_HEIGHT_RATIO,
  DEFAULT_MAX_STICKY_ITEMS,
  DEFAULT_OVERSCAN,
  DEFAULT_VIEWPORT_BUFFER,
} from "./config";
import { useScrollPreservation, useStickyScroll } from "./hooks";
import type { TreeNodeBase, VirtualizedStickyTreeProps } from "./types";

// Re-export types and tokens for external consumers.
export type {
  FlattenedTreeNode,
  StickyScrollNode,
  TreeNodeBase,
} from "./types";
export { STICKY_ROW, CHEVRON_SIZE, stickyRowPadding } from "./tokens";

/**
 * Handle exposed by VirtualizedStickyTree
 */
export interface VirtualizedStickyTreeHandle {
  scrollToIndex: (
    index: number,
    options?: {
      align?: "start" | "center" | "end";
      behavior?: "auto" | "smooth";
    }
  ) => void;
  scrollToPath: (
    path: string,
    options?: {
      align?: "start" | "center" | "end";
      behavior?: "smooth" | "auto";
    }
  ) => void;
}

function VirtualizedStickyTreeInner<TNode extends TreeNodeBase>(
  {
    flattenedNodes,
    rowHeight,
    renderItem,
    renderStickyItem,
    onStickyHeaderClick,
    maxStickyItems = DEFAULT_MAX_STICKY_ITEMS,
    maxStickyHeightRatio = DEFAULT_MAX_STICKY_HEIGHT_RATIO,
    overscan = DEFAULT_OVERSCAN,
    increaseViewportBy = DEFAULT_VIEWPORT_BUFFER,
    className = "",
    stickyBgClass,
    loading = false,
    error = null,
    emptyMessage = "No items",
    listRef: externalListRef,
    onEndReached,
  }: VirtualizedStickyTreeProps<TNode>,
  ref: React.ForwardedRef<VirtualizedStickyTreeHandle>
): React.ReactElement {
  const internalListRef = useRef<VirtualListHandle>(null);
  const listRef = externalListRef || internalListRef;
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportHeight = useElementDimensions(containerRef, {
    dimension: "height",
  });
  const showIndentGuides = useAtomValue(editorShowTreeIndentGuidesAtom);

  // Scroll state
  const [scrollTop, setScrollTop] = useState(0);
  const lastScrollTopRef = useRef(0);
  const scrollThrottleRef = useRef<NodeJS.Timeout | null>(null);

  // Direct ref to the scroller DOM element — used by useScrollPreservation
  // for precise scrollTop adjustment so we don't need
  // document.querySelector(".scrollbar-hide"). Populated from the list handle
  // after mount; `VirtualList` owns the scroller element itself.
  const scrollerDomRef = useRef<HTMLDivElement | null>(null);

  // Scroll preservation for tree changes (VSCode anchor pattern)
  // `isRestoringRef` is no longer read here: the only consumer was the old
  // `rangeChanged` backup, and `updateAnchor` checks restoration internally.
  const { updateAnchor } = useScrollPreservation({
    flattenedNodes,
    listRef,
    lastScrollTopRef,
    rowHeight,
    scrollerDomRef,
  });

  // Scroll handler - update scrollTop immediately for smooth clipping animation
  const handleScrollerScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const newScrollTop = event.currentTarget.scrollTop;
      lastScrollTopRef.current = newScrollTop;

      // Update scrollTop immediately for smooth sticky clipping animation
      setScrollTop(newScrollTop);

      // Throttle the anchor tracking for scroll preservation
      if (scrollThrottleRef.current) return;

      scrollThrottleRef.current = setTimeout(() => {
        // Update anchor (hook handles restoration check internally)
        updateAnchor();
        scrollThrottleRef.current = null;
      }, 16);
    },
    [updateAnchor]
  );

  // `VirtualList` owns the scrolling element, so publish it for the
  // preservation hook once it exists.
  useEffect(() => {
    scrollerDomRef.current = listRef.current?.getScrollElement() ?? null;
  });

  // Cleanup throttle
  useEffect(() => {
    return () => {
      if (scrollThrottleRef.current) clearTimeout(scrollThrottleRef.current);
    };
  }, []);

  // Sticky scroll with VS Code-style clipping (skip if no renderStickyItem)
  const stickyEnabled = !!renderStickyItem;
  const { stickyNodes, stickyHeight } = useStickyScroll({
    flattenedNodes,
    viewportHeight,
    scrollTop,
    rowHeight,
    maxStickyItems: stickyEnabled ? maxStickyItems : 0,
    maxStickyHeightRatio: stickyEnabled ? maxStickyHeightRatio : 0,
  });

  // The former `rangeChanged` callback was a backup anchor update; the
  // throttled scroll handler above is the primary one and covers every case
  // that moves the viewport, so there is nothing left for it to catch.

  // Pre-built path→index Map for O(1) lookups in click/scroll handlers
  const pathIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    for (let idx = 0; idx < flattenedNodes.length; idx++) {
      map.set(flattenedNodes[idx].node.path, idx);
    }
    return map;
  }, [flattenedNodes]);

  // Handle sticky header click — VS Code pattern:
  // Instant scroll, positioning node just below the remaining sticky widget
  const handleStickyHeaderClick = useCallback(
    (nodePath: string, node: TNode) => {
      const index = pathIndexMap.get(nodePath);
      if (index === undefined) return;

      const nodeTop = index * rowHeight;
      const depth = flattenedNodes[index].depth;
      const stickyOffset = Math.min(depth, maxStickyItems) * rowHeight;
      listRef.current?.scrollTo({
        top: Math.max(0, nodeTop - stickyOffset),
        behavior: "auto",
      });

      onStickyHeaderClick?.(nodePath, node);
    },
    [
      flattenedNodes,
      pathIndexMap,
      rowHeight,
      maxStickyItems,
      listRef,
      onStickyHeaderClick,
    ]
  );

  // Expose handle for imperative operations
  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex: (index, options) => {
        listRef.current?.scrollToIndex({
          index,
          align: options?.align ?? "start",
          behavior: options?.behavior ?? "auto",
        });
      },
      scrollToPath: (path, options) => {
        const index = pathIndexMap.get(path);
        if (index !== undefined) {
          listRef.current?.scrollToIndex({
            index,
            align: options?.align ?? "start",
            behavior: options?.behavior ?? "auto",
          });
        }
      },
    }),
    [pathIndexMap, listRef]
  );

  const hasNodes = flattenedNodes.length > 0;

  // Stable callbacks so the list's internal memo keeps working
  // when parent renders happen but the flattened list is unchanged.
  const handleItemContent = useCallback(
    (index: number) => renderItem(flattenedNodes[index], index),
    [renderItem, flattenedNodes]
  );
  const handleComputeItemKey = useCallback(
    (index: number) => flattenedNodes[index].node.path,
    [flattenedNodes]
  );

  return (
    <div
      ref={containerRef}
      className={`tree-guide-scope relative h-full overflow-hidden ${className}`}
    >
      {/* Sticky headers — always mounted to avoid DOM insertion flash on first stick */}
      {stickyEnabled && hasNodes && (
        <StickyHeadersContainer
          stickyNodes={stickyNodes}
          stickyHeight={stickyHeight}
          renderStickyItem={renderStickyItem}
          onHeaderClick={handleStickyHeaderClick}
          showIndentGuides={showIndentGuides}
          stickyBgClass={stickyBgClass}
        />
      )}

      {loading && !hasNodes && <Placeholder variant="loading" />}

      {error && !hasNodes && <Placeholder variant="error" title={error} />}

      {!loading && !error && !hasNodes && (
        <Placeholder variant="empty" title={emptyMessage} />
      )}

      {/* Virtualized list */}
      {hasNodes && (
        <div className="h-full pb-2">
          <VirtualList
            ref={listRef}
            totalCount={flattenedNodes.length}
            itemContent={handleItemContent}
            computeItemKey={handleComputeItemKey}
            className="scrollbar-hide h-full"
            fixedItemHeight={rowHeight}
            // Tree rows are uniform, so both legacy buffers are pixel budgets;
            // the larger one wins rather than being summed.
            overscanPx={Math.max(
              overscan,
              increaseViewportBy.top,
              increaseViewportBy.bottom
            )}
            onScroll={handleScrollerScroll}
            endReached={onEndReached}
            footer={<div aria-hidden="true" style={{ height: 60 }} />}
          />
        </div>
      )}
    </div>
  );
}

// Export with forwardRef and memo
export const VirtualizedStickyTree = memo(
  forwardRef(VirtualizedStickyTreeInner)
) as <TNode extends TreeNodeBase>(
  props: VirtualizedStickyTreeProps<TNode> & {
    ref?: React.ForwardedRef<VirtualizedStickyTreeHandle>;
  }
) => React.ReactElement;
