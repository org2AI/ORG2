/**
 * Publishes the width of the area the station and the chat pane divide
 * between them, so the split-ratio presets describe the space they actually
 * share rather than a guess at the viewport minus a constant sidebar.
 *
 * The observed element is a sibling of the navigation sidebar, so its width
 * already accounts for the sidebar being resized, collapsed, or hidden at the
 * narrow breakpoint — no sidebar state is read here.
 *
 * Resizing the chat pane does not change this element's width (the pane is
 * inside it), so the observer cannot feed back into the drag it informs.
 */
import { useCallback, useEffect, useRef } from "react";

import { setChatSplitAreaWidth } from "@src/engines/ChatPanel/config";

export function useChatSplitAreaWidth(): (node: HTMLElement | null) => void {
  const observerRef = useRef<ResizeObserver | null>(null);

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      // Drop the stale measurement so the estimate takes over again rather
      // than pinning presets to the width of an unmounted layout.
      setChatSplitAreaWidth(0);
    },
    []
  );

  return useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;

    if (!node || typeof ResizeObserver === "undefined") {
      setChatSplitAreaWidth(0);
      return;
    }

    setChatSplitAreaWidth(node.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setChatSplitAreaWidth(entry.contentRect.width);
    });
    observer.observe(node);
    observerRef.current = observer;
  }, []);
}
