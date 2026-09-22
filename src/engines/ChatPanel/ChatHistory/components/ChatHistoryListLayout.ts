/**
 * ChatHistoryListLayout
 *
 * Pure layout/scroll-metric helpers for `ChatHistoryList`: bottom-of-content
 * detection, per-row group metadata, and active-group pin/visibility
 * resolution used while scrolling. Extracted from `ChatHistoryList.tsx` to
 * keep that file under the 600-line limit.
 */
import { getChatContentBottomDistance } from "../config/chatFooterSpacer";
import type {
  GroupPinMetrics,
  GroupViewportMetrics,
  RowGroupMeta,
} from "./ChatHistoryListTypes";

const AT_BOTTOM_EPSILON_PX = 4;

/**
 * React identities for turn rows. A turn's visible body items change when the
 * user expands/collapses it, so body-derived keys remount the unchanged header
 * (including attached-image thumbnails). Keep identity on the turn instead.
 *
 * Headerless groups cannot use a turn id, so prefer their first immutable
 * event/chunk id. This keeps their identity stable when older history prepends.
 */
/**
 * Per-group fallback identity: the first item's immutable event/chunk id.
 * Shared so every surface that needs a group's render key — the list itself
 * and the minimap, which maps pinned anchors back to groups — derives it the
 * same way.
 */
export function buildChatGroupFallbackIds(
  flatItems: readonly {
    event?: { id?: string | null } | null;
    chunk_id?: string | null;
  }[],
  groupCounts: readonly number[]
): (string | null)[] {
  let startFlatIndex = 0;
  return groupCounts.map((groupItemCount) => {
    const firstItem = flatItems[startFlatIndex];
    startFlatIndex += groupItemCount;
    return firstItem?.event?.id ?? firstItem?.chunk_id ?? null;
  });
}

export function buildChatGroupRenderKeys(
  turnIds: readonly (string | null)[],
  fallbackIds: readonly (string | null)[] = []
): string[] {
  const occurrences = new Map<string, number>();
  return turnIds.map((turnId, groupIndex) => {
    const stableIdentity =
      turnId === null
        ? fallbackIds[groupIndex]
          ? `chat-event:${fallbackIds[groupIndex]}`
          : null
        : `chat-turn:${turnId}`;
    if (stableIdentity === null) return `chat-group-index:${groupIndex}`;
    const occurrence = occurrences.get(stableIdentity) ?? 0;
    occurrences.set(stableIdentity, occurrence + 1);
    return `${stableIdentity}:occurrence:${occurrence}`;
  });
}

export function isScrolledToContentBottom(params: {
  element: HTMLElement;
  footerSpacerHeight: number;
  bottomInset: number;
}): boolean {
  return (
    getChatContentBottomDistance({
      scrollTop: params.element.scrollTop,
      scrollHeight: params.element.scrollHeight,
      clientHeight: params.element.clientHeight,
      footerSpacerHeight: params.footerSpacerHeight,
      bottomInset: params.bottomInset,
    }) <= AT_BOTTOM_EPSILON_PX
  );
}

export const EMPTY_ROW_GROUP_META: RowGroupMeta = {
  isLastItemInGroup: false,
  isLastGroup: false,
};

export function buildRowGroupMeta(
  groupCounts: readonly number[]
): RowGroupMeta[] {
  const result: RowGroupMeta[] = [];
  let flatIndex = 0;
  const lastGroupIndex = groupCounts.length - 1;
  for (let groupIndex = 0; groupIndex < groupCounts.length; groupIndex++) {
    const groupCount = groupCounts[groupIndex];
    const groupEndFlatIndex = flatIndex + groupCount - 1;
    const isLastGroup = groupIndex === lastGroupIndex;
    for (let itemOffset = 0; itemOffset < groupCount; itemOffset++) {
      result[flatIndex] = {
        isLastItemInGroup: flatIndex === groupEndFlatIndex,
        isLastGroup,
      };
      flatIndex++;
    }
  }
  return result;
}

export function resolveVisibleGroupIndices(
  groups: readonly GroupViewportMetrics[],
  viewportHeight: number
): number[] {
  return groups
    .filter((group) => group.top < viewportHeight && group.bottom > 0)
    .map((group) => group.groupIndex);
}

export function resolveActiveGroupPinState(
  groups: readonly GroupPinMetrics[]
): { groupIndex: number; pinned: boolean } {
  let activeGroupIndex = 0;
  let activeTop = Number.NEGATIVE_INFINITY;

  for (const group of groups) {
    if (group.top <= 0 && group.top >= activeTop) {
      activeTop = group.top;
      activeGroupIndex = group.groupIndex;
    }
  }

  return {
    groupIndex: activeGroupIndex,
    pinned: Number.isFinite(activeTop) && activeTop < 0,
  };
}
