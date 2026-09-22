import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";

import { CHROME_INSET_TRANSITION_CLASSES } from "@src/components/layout/tokens/viewContainerTokens";
import { effectiveChatPanelMaximizedAtom } from "@src/store/chatPanel/chatPanelLayoutAtoms";
import { chatWidthAtom } from "@src/store/ui/chatPanel/widthAtoms";
import { sidebarCollapsedAtom } from "@src/store/ui/sidebarAtom";

/**
 * How long the inset transition stays on after a pane starts moving: the
 * 200ms pane transition plus headroom for the frame that starts it, so the
 * class is never removed while the padding is still moving.
 */
export const PANE_LAYOUT_INSET_TRANSITION_MS = 320;

interface PaneLayoutState {
  signature: string;
  /** Increments on every layout change; a timer only ends its own change. */
  change: number;
  animating: boolean;
}

/**
 * The pane-layout toggles that move a window edge on
 * `PANE_WIDTH_TRANSITION_CLASSES`: the sidebar collapsing or expanding, a
 * station opening or closing, and the chat pane going away or coming back.
 * `AppLayout` sizes the chat slot off the same width sentinel, so a pane is
 * in motion exactly when one of these flips.
 *
 * Deliberately excludes everything that changes a header's reservation
 * without moving a pane — opening or closing a tab, switching tabs, sessions
 * or stations, a route change. Those show or hide the pinned group in place,
 * and there the inset must snap or header controls glide on every tab change.
 * Dragging the chat divider is excluded for the same reason: the pane follows
 * the pointer with no transition, and only crossing zero changes a
 * reservation.
 */
function usePaneLayoutSignature(): string {
  const stationOpen = !useAtomValue(effectiveChatPanelMaximizedAtom);
  const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom);
  const chatPaneOpen = useAtomValue(chatWidthAtom) > 0;
  return [stationOpen, sidebarCollapsed, chatPaneOpen]
    .map((flag) => (flag ? "1" : "0"))
    .join("");
}

/**
 * Transition classes for a header row that reserves inset under the window's
 * pinned chrome, applied only while a pane is actually moving.
 *
 * A pane-layout toggle slides the panes on the shared pane transition, so the
 * reserved inset has to travel with them. Without it the header's content
 * jumps by the whole reservation on the first frame and then glides with the
 * pane — it lands at a place it never travelled to, then moves. With it the
 * inset runs the same 200ms curve as the pane, so the content goes from where
 * it is to where it belongs in one continuous move.
 *
 * The class lands in the same render as the new inset (state is adjusted
 * during render) because a CSS transition takes its timing from the
 * after-change style.
 */
export function usePaneLayoutInsetTransition(): string {
  const signature = usePaneLayoutSignature();
  const [state, setState] = useState<PaneLayoutState>(() => ({
    signature,
    change: 0,
    animating: false,
  }));

  if (state.signature !== signature) {
    setState({ signature, change: state.change + 1, animating: true });
  }

  const { animating, change } = state;
  useEffect(() => {
    if (!animating) return undefined;
    const timer = setTimeout(() => {
      setState((current) =>
        current.change === change ? { ...current, animating: false } : current
      );
    }, PANE_LAYOUT_INSET_TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [animating, change]);

  return animating ? CHROME_INSET_TRANSITION_CLASSES : "";
}
