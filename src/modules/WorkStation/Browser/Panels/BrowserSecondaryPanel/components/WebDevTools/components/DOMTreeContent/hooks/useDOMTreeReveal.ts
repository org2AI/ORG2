import { useEffect, useRef } from "react";

import type { VirtualListHandle } from "@src/components/VirtualList";

import type { FlattenedDOMNode } from "../types";
import { findNodeIndex } from "../utils";

interface UseDOMTreeRevealOptions {
  flattenedNodes: FlattenedDOMNode[];
  virtualized: boolean;
  revealXPath?: string | null;
  revealKey?: number;
}

export function useDOMTreeReveal({
  flattenedNodes,
  virtualized,
  revealXPath,
  revealKey,
}: UseDOMTreeRevealOptions) {
  const listRef = useRef<VirtualListHandle>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastRevealKeyRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (
      revealKey === undefined ||
      revealKey === lastRevealKeyRef.current ||
      !revealXPath
    ) {
      return;
    }

    const attemptScroll = (): boolean => {
      const index = findNodeIndex(flattenedNodes, revealXPath);
      if (index === -1) return false;

      requestAnimationFrame(() => {
        if (virtualized && listRef.current) {
          listRef.current.scrollToIndex({
            index,
            align: "center",
            behavior: "smooth",
          });
          return;
        }

        const targetNode = Array.from(
          scrollContainerRef.current?.querySelectorAll("[data-xpath]") ?? []
        ).find((element) => element.getAttribute("data-xpath") === revealXPath);
        targetNode?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return true;
    };

    if (attemptScroll()) {
      lastRevealKeyRef.current = revealKey;
      return;
    }

    let attempts = 0;
    const intervalId = setInterval(() => {
      attempts += 1;
      if (attemptScroll() || attempts >= 20) {
        clearInterval(intervalId);
        lastRevealKeyRef.current = revealKey;
      }
    }, 100);
    return () => clearInterval(intervalId);
  }, [flattenedNodes, revealKey, revealXPath, virtualized]);

  return { listRef, scrollContainerRef };
}
