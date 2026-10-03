import type { Virtualizer } from "@tanstack/react-virtual";
import { type RefObject, useImperativeHandle } from "react";

import {
  findChatSearchTargetElement,
  getSearchTargetScrollTop,
} from "../hooks/chatSearch/chatSearchTargetDom";
import type { ChatHistoryListHandle } from "./ChatHistoryListTypes";

/** The list supplies geometry only. The viewport owns every navigation write. */
export function useChatHistoryListNavigation({
  virtualListRef,
  virtualScrollerRef,
  staticScrollerRef,
  virtualizer,
  groupRenderKeys,
  measuredRows,
  committedRowSizes,
  layoutRevision,
}: {
  virtualListRef: RefObject<ChatHistoryListHandle | null>;
  virtualScrollerRef: RefObject<HTMLDivElement | null>;
  staticScrollerRef?: RefObject<HTMLDivElement | null>;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  groupRenderKeys: string[];
  measuredRows: WeakMap<Element, number>;
  committedRowSizes: RefObject<Map<number, number>>;
  layoutRevision: RefObject<number>;
}) {
  useImperativeHandle(virtualListRef, () => {
    const getRoot = () =>
      virtualScrollerRef.current ?? staticScrollerRef?.current;
    const findAnchor = (id: string) =>
      Array.from(
        getRoot()?.querySelectorAll<HTMLElement>(
          "[data-transcript-anchor-id]"
        ) ?? []
      ).find((node) => node.dataset.transcriptAnchorId === id);
    return {
      getGroupAnchorId: (index) => groupRenderKeys[index] ?? null,
      readNavigationGeometry: ({ anchorId, eventId, itemId }) => {
        const root = getRoot();
        if (!root) return { status: "pending" };
        const index = anchorId ? groupRenderKeys.indexOf(anchorId) : -1;
        if (anchorId && index < 0) return { status: "missing" };
        const group = anchorId ? findAnchor(anchorId) : undefined;
        const target =
          eventId || itemId
            ? findChatSearchTargetElement(root, { eventId, itemId })
            : group;
        if (!group || !target) {
          const offset =
            index >= 0 && virtualScrollerRef.current
              ? virtualizer.getOffsetForIndex(index, "start")?.[0]
              : undefined;
          return { status: "pending", scrollTop: offset };
        }
        const groupRect = group.getBoundingClientRect();
        const virtual = root === virtualScrollerRef.current;
        if (
          virtual &&
          (!measuredRows.has(group) ||
            committedRowSizes.current.get(index) !==
              Math.round(groupRect.height))
        ) {
          return { status: "pending" };
        }
        const rootRect = root.getBoundingClientRect();
        const requestedTop =
          eventId || itemId
            ? getSearchTargetScrollTop(root, target, true)
            : root.scrollTop + groupRect.top - rootRect.top;
        const top = Math.max(
          0,
          Math.min(root.scrollHeight - root.clientHeight, requestedTop)
        );
        return {
          status: "measured",
          revision: layoutRevision.current,
          scrollTop: top,
          anchor: {
            itemId: anchorId!,
            offsetFromViewportTop:
              groupRect.top - rootRect.top - (top - root.scrollTop),
          },
        };
      },
      revealTranscriptAnchor: (id) => {
        const root = getRoot();
        if (!root) return false;
        if (findAnchor(id)) return true;
        const index = groupRenderKeys.indexOf(id);
        const offset =
          index >= 0 && virtualScrollerRef.current
            ? virtualizer.getOffsetForIndex(index, "start")?.[0]
            : undefined;
        if (offset !== undefined)
          root.scrollTo({ top: offset, behavior: "auto" });
        return false;
      },
    };
  }, [
    virtualScrollerRef,
    staticScrollerRef,
    virtualizer,
    groupRenderKeys,
    measuredRows,
    committedRowSizes,
    layoutRevision,
  ]);
}
