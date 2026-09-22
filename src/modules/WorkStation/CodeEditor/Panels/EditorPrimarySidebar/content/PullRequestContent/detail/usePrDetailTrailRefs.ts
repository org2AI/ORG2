import { useCallback, useRef } from "react";

/**
 * Scroll-trail targets for the details rail, fed by callback refs from the
 * conversation tab. A detached conversation node falls back to the
 * conversation tab panel's content node.
 */
export function usePrDetailTrailRefs() {
  const tabContentRef = useRef<HTMLDivElement>(null);
  const trailScrollContainerRef = useRef<HTMLElement>(null);
  const trailContentRef = useRef<HTMLElement>(null);
  const setTabContentNode = useCallback((node: HTMLDivElement | null) => {
    tabContentRef.current = node;
  }, []);
  const setConversationScrollNode = useCallback(
    (node: HTMLDivElement | null) => {
      trailScrollContainerRef.current = node ?? tabContentRef.current;
    },
    []
  );
  const setConversationContentNode = useCallback(
    (node: HTMLDivElement | null) => {
      trailContentRef.current = node ?? tabContentRef.current;
    },
    []
  );

  return {
    trailScrollContainerRef,
    trailContentRef,
    setTabContentNode,
    setConversationScrollNode,
    setConversationContentNode,
  };
}
