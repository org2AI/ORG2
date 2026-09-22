import {
  type RefCallback,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  INITIAL_TRANSCRIPT_VIEWPORT_POLICY_STATE,
  type TranscriptFollowMode,
  type TranscriptViewportPolicyEvent,
  reduceTranscriptViewportPolicy,
} from "./transcriptViewportPolicy";

export const TRANSCRIPT_ANCHOR_ATTRIBUTE = "data-transcript-anchor-id";

const AT_TAIL_EPSILON_PX = 4;
const MAX_ANCHOR_REVEAL_ATTEMPTS = 2;
const KEYBOARD_SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  " ",
  "Spacebar",
]);
const KEYBOARD_LINE_DELTA_PX = 40;
const KEYBOARD_PAGE_DELTA_RATIO = 0.9;

export interface TranscriptViewportAnchor {
  itemId: string;
  offsetFromViewportTop: number;
}

export interface UseTranscriptViewportOptions {
  sessionKey: string | null;
  contentKey: string;
  itemCount: number;
  /** Distance intentionally retained between the content tail and scroll bottom. */
  tailGapPx?: number;
  localSubmitKey?: string | null;
  followPolicy?: "reader-controlled" | "always";
  onAtTailChange?: (atTail: boolean) => void;
  onExplicitFollow?: () => void;
  /**
   * Virtual lists can mount an off-screen anchor before the controller applies
   * its exact pixel offset. Return true when the anchor is already mounted.
   */
  ensureAnchorMounted?: (anchorId: string) => boolean;
}

export interface UseTranscriptViewportReturn {
  setScrollRoot: RefCallback<HTMLElement>;
  handleScroll: (reportedAtTail?: boolean) => void;
  followTail: () => void;
  detachForNavigation: () => void;
  preserveForLayoutMutation: () => void;
  /**
   * Apply the follow/anchor policy to the layout that is about to paint.
   * For content owners that commit geometry outside the observed elements
   * (a virtualizer flushing re-measured rows from its own ResizeObserver).
   */
  reconcileLayout: () => void;
  showScrollToBottom: boolean;
  mode: TranscriptFollowMode;
}

// Descendant controls own activation and navigation keys before transcript scrolling.
function isInteractiveKeyboardTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      "input, textarea, select, button, a[href], summary, [contenteditable='true'], [role='textbox'], [role='button'], [role='slider'], [role='tab'], [role='menuitem']"
    ) !== null
  );
}

/** A descendant owns wheel intent while it can scroll in that direction. */
function descendantOwnsWheel(event: WheelEvent, root: HTMLElement): boolean {
  let element = event.target instanceof Element ? event.target : null;
  while (element && element !== root) {
    if (element.scrollHeight > element.clientHeight) {
      const style = getComputedStyle(element);
      if (style.overflowY === "auto" || style.overflowY === "scroll") {
        const canScroll =
          event.deltaY < 0
            ? element.scrollTop > 0
            : element.scrollTop + element.clientHeight < element.scrollHeight;
        if (
          canScroll ||
          style.overscrollBehaviorY === "contain" ||
          style.overscrollBehaviorY === "none"
        ) {
          return true;
        }
      }
    }
    element = element.parentElement;
  }
  return false;
}

function isScrollbarPointerDown(
  event: PointerEvent,
  element: HTMLElement
): boolean {
  if (event.button !== 0) return false;
  const rect = element.getBoundingClientRect();
  const nativeScrollbarWidth = Math.max(
    0,
    element.offsetWidth - element.clientWidth
  );
  return event.clientX >= rect.right - Math.max(12, nativeScrollbarWidth);
}

function isElementVisible(element: HTMLElement): boolean {
  return document.visibilityState !== "hidden" && element.clientHeight > 0;
}

export function getTranscriptTailScrollTop(
  element: HTMLElement,
  tailGapPx: number
): number {
  return Math.max(
    0,
    element.scrollHeight - element.clientHeight - Math.max(0, tailGapPx)
  );
}

export function isTranscriptAtTail(
  element: HTMLElement,
  tailGapPx: number
): boolean {
  return (
    getTranscriptTailScrollTop(element, tailGapPx) - element.scrollTop <=
    AT_TAIL_EPSILON_PX
  );
}

export function captureTranscriptAnchor(
  scrollRoot: HTMLElement
): TranscriptViewportAnchor | null {
  const rootTop = scrollRoot.getBoundingClientRect().top;
  const anchors = scrollRoot.querySelectorAll<HTMLElement>(
    `[${TRANSCRIPT_ANCHOR_ATTRIBUTE}]`
  );
  let closestAbove: HTMLElement | null = null;
  let firstBelow: HTMLElement | null = null;

  for (const anchor of anchors) {
    const rect = anchor.getBoundingClientRect();
    if (rect.bottom <= rootTop) continue;
    if (rect.top <= rootTop) {
      closestAbove = anchor;
      continue;
    }
    firstBelow = anchor;
    break;
  }

  const element = closestAbove ?? firstBelow;
  const itemId = element?.getAttribute(TRANSCRIPT_ANCHOR_ATTRIBUTE);
  if (!element || !itemId) return null;
  return {
    itemId,
    offsetFromViewportTop:
      element.getBoundingClientRect().top -
      scrollRoot.getBoundingClientRect().top,
  };
}

export function restoreTranscriptAnchor(
  scrollRoot: HTMLElement,
  anchor: TranscriptViewportAnchor
): boolean {
  const elements = scrollRoot.querySelectorAll<HTMLElement>(
    `[${TRANSCRIPT_ANCHOR_ATTRIBUTE}]`
  );
  const element = Array.from(elements).find(
    (candidate) =>
      candidate.getAttribute(TRANSCRIPT_ANCHOR_ATTRIBUTE) === anchor.itemId
  );
  if (!element) return false;

  const currentOffset =
    element.getBoundingClientRect().top -
    scrollRoot.getBoundingClientRect().top;
  const delta = currentOffset - anchor.offsetFromViewportTop;
  if (Math.abs(delta) > 0.5) {
    scrollRoot.scrollTo({
      top: Math.max(0, scrollRoot.scrollTop + delta),
      behavior: "auto",
    });
  }
  return true;
}

/**
 * Source-neutral viewport owner for ordinary, Member, and Group transcripts.
 * React content signals coalesce into one pending animation frame, fenced to
 * the session generation that scheduled it. Resize signals reconcile inside
 * the ResizeObserver callback instead: it runs after layout and before paint,
 * whereas a frame requested there runs only after this frame has painted the
 * reflowed transcript at its stale offset — a visible bounce on every frame
 * of a pane resize. WebKit has no CSS scroll anchoring to absorb that gap.
 */
export function useTranscriptViewport({
  sessionKey,
  contentKey,
  itemCount,
  tailGapPx = 0,
  localSubmitKey = null,
  followPolicy = "reader-controlled",
  onAtTailChange,
  onExplicitFollow,
  ensureAnchorMounted,
}: UseTranscriptViewportOptions): UseTranscriptViewportReturn {
  const scrollRootRef = useRef<HTMLElement | null>(null);
  const [scrollRoot, setScrollRootState] = useState<HTMLElement | null>(null);
  const setScrollRoot = useCallback((node: HTMLElement | null) => {
    scrollRootRef.current = node;
    setScrollRootState((current) => (current === node ? current : node));
  }, []);

  const [mode, setModeState] = useState<TranscriptFollowMode>(
    INITIAL_TRANSCRIPT_VIEWPORT_POLICY_STATE.mode
  );
  const modeRef = useRef<TranscriptFollowMode>(
    INITIAL_TRANSCRIPT_VIEWPORT_POLICY_STATE.mode
  );
  const anchorRef = useRef<TranscriptViewportAnchor | null>(null);
  const sessionKeyRef = useRef(sessionKey);
  const generationRef = useRef(0);
  const pendingFrameRef = useRef<number | null>(null);
  const anchorRevealAttemptsRef = useRef(0);
  const lastAtTailRef = useRef(true);
  const [atTail, setAtTailState] = useState(true);
  const userScrollPendingRef = useRef(false);
  const scrollbarPointerActiveRef = useRef(false);
  const touchScrollActiveRef = useRef(false);
  const lastLocalSubmitKeyRef = useRef(localSubmitKey);
  const optionsRef = useRef({
    tailGapPx,
    followPolicy,
    onAtTailChange,
    onExplicitFollow,
    ensureAnchorMounted,
  });
  useLayoutEffect(() => {
    optionsRef.current = {
      tailGapPx,
      followPolicy,
      onAtTailChange,
      onExplicitFollow,
      ensureAnchorMounted,
    };
  }, [
    ensureAnchorMounted,
    followPolicy,
    onAtTailChange,
    onExplicitFollow,
    tailGapPx,
  ]);
  const transition = useCallback((event: TranscriptViewportPolicyEvent) => {
    const next = reduceTranscriptViewportPolicy(
      { mode: modeRef.current },
      event
    );
    if (next.mode !== modeRef.current) {
      modeRef.current = next.mode;
      setModeState(next.mode);
    }
  }, []);

  const publishAtTail = useCallback((atTail: boolean) => {
    if (lastAtTailRef.current === atTail) return;
    lastAtTailRef.current = atTail;
    setAtTailState(atTail);
    optionsRef.current.onAtTailChange?.(atTail);
  }, []);

  const cancelPendingFrame = useCallback(() => {
    if (pendingFrameRef.current === null) return;
    cancelAnimationFrame(pendingFrameRef.current);
    pendingFrameRef.current = null;
  }, []);

  const reconcileRef = useRef<() => void>(() => undefined);
  const scheduleReconcile = useCallback(() => {
    if (pendingFrameRef.current !== null) return;
    const element = scrollRootRef.current;
    if (!element || !isElementVisible(element)) return;
    const scheduledGeneration = generationRef.current;
    pendingFrameRef.current = requestAnimationFrame(() => {
      pendingFrameRef.current = null;
      if (scheduledGeneration !== generationRef.current) return;
      reconcileRef.current();
    });
  }, []);

  const reconcile = useCallback(() => {
    const element = scrollRootRef.current;
    if (!element || !isElementVisible(element)) return;
    const currentOptions = optionsRef.current;
    const shouldFollow =
      currentOptions.followPolicy === "always" ||
      modeRef.current === "following_tail";

    if (shouldFollow) {
      anchorRevealAttemptsRef.current = 0;
      element.scrollTo({
        top: getTranscriptTailScrollTop(element, currentOptions.tailGapPx),
        behavior: "auto",
      });
      publishAtTail(true);
      return;
    }

    const anchor = anchorRef.current;
    if (!anchor) {
      anchorRef.current = captureTranscriptAnchor(element);
      return;
    }
    if (restoreTranscriptAnchor(element, anchor)) {
      anchorRevealAttemptsRef.current = 0;
      publishAtTail(isTranscriptAtTail(element, currentOptions.tailGapPx));
      return;
    }

    if (
      anchorRevealAttemptsRef.current < MAX_ANCHOR_REVEAL_ATTEMPTS &&
      currentOptions.ensureAnchorMounted &&
      !currentOptions.ensureAnchorMounted(anchor.itemId)
    ) {
      anchorRevealAttemptsRef.current += 1;
      scheduleReconcile();
    }
  }, [publishAtTail, scheduleReconcile]);
  useLayoutEffect(() => {
    reconcileRef.current = reconcile;
  }, [reconcile]);

  const reconcileLayout = useCallback(() => {
    cancelPendingFrame();
    reconcileRef.current();
  }, [cancelPendingFrame]);

  const handleScroll = useCallback(
    (reportedAtTail?: boolean) => {
      const element = scrollRootRef.current;
      if (!element) return;
      const atTail =
        reportedAtTail ??
        isTranscriptAtTail(element, optionsRef.current.tailGapPx);
      publishAtTail(atTail);

      const userInitiated =
        userScrollPendingRef.current ||
        scrollbarPointerActiveRef.current ||
        touchScrollActiveRef.current;
      if (userInitiated && optionsRef.current.followPolicy !== "always") {
        transition({ type: "user_scroll", atTail });
      }
      if (modeRef.current === "detached_reading") {
        anchorRef.current = captureTranscriptAnchor(element);
      }
      if (!scrollbarPointerActiveRef.current && !touchScrollActiveRef.current) {
        userScrollPendingRef.current = false;
      }
    },
    [publishAtTail, transition]
  );

  const followTail = useCallback(() => {
    anchorRef.current = null;
    optionsRef.current.onExplicitFollow?.();
    transition({ type: "explicit_follow" });
    scheduleReconcile();
  }, [scheduleReconcile, transition]);

  const detachForNavigation = useCallback(() => {
    if (optionsRef.current.followPolicy === "always") return;
    transition({ type: "explicit_navigation" });
    anchorRef.current = null;
    scheduleReconcile();
  }, [scheduleReconcile, transition]);

  const preserveForLayoutMutation = useCallback(() => {
    if (optionsRef.current.followPolicy === "always") return;
    const element = scrollRootRef.current;
    anchorRef.current = element ? captureTranscriptAnchor(element) : null;
    transition({ type: "explicit_layout_change" });
    scheduleReconcile();
  }, [scheduleReconcile, transition]);

  useLayoutEffect(() => {
    if (sessionKeyRef.current === sessionKey) return;
    sessionKeyRef.current = sessionKey;
    generationRef.current += 1;
    cancelPendingFrame();
    userScrollPendingRef.current = false;
    scrollbarPointerActiveRef.current = false;
    touchScrollActiveRef.current = false;
    anchorRevealAttemptsRef.current = 0;
    // The destination's existing optimistic row is history, not a new submit.
    // Only a later key change within this session should explicitly re-follow.
    lastLocalSubmitKeyRef.current = localSubmitKey;

    anchorRef.current = null;
    transition({ type: "session_opened" });
    scheduleReconcile();
  }, [
    cancelPendingFrame,
    localSubmitKey,
    scheduleReconcile,
    sessionKey,
    transition,
  ]);

  useLayoutEffect(() => {
    if (itemCount <= 0) return;
    scheduleReconcile();
  }, [contentKey, itemCount, scheduleReconcile]);

  useEffect(() => {
    if (!localSubmitKey || localSubmitKey === lastLocalSubmitKeyRef.current) {
      lastLocalSubmitKeyRef.current = localSubmitKey;
      return;
    }
    lastLocalSubmitKeyRef.current = localSubmitKey;
    followTail();
  }, [followTail, localSubmitKey]);

  useEffect(() => {
    if (!scrollRoot) return;

    const markUserScroll = () => {
      userScrollPendingRef.current = true;
    };
    const handleWheel = (event: WheelEvent) => {
      if (
        event.defaultPrevented ||
        event.deltaY === 0 ||
        descendantOwnsWheel(event, scrollRoot)
      )
        return;
      markUserScroll();
      if (event.deltaY < 0 && optionsRef.current.followPolicy !== "always") {
        // Wheel fires before the browser applies its scroll delta. Leave the
        // anchor empty until the ensuing scroll event can capture real geometry.
        anchorRef.current = null;
        transition({ type: "user_scroll", atTail: false });
      }
    };
    const handleTouchStart = () => {
      touchScrollActiveRef.current = true;
      markUserScroll();
    };
    const handleTouchMove = () => {
      markUserScroll();
      if (optionsRef.current.followPolicy === "always") return;
      anchorRef.current = null;
      transition({ type: "user_scroll", atTail: false });
    };
    const handleTouchEnd = () => {
      touchScrollActiveRef.current = false;
      userScrollPendingRef.current = false;
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!isScrollbarPointerDown(event, scrollRoot)) return;
      scrollbarPointerActiveRef.current = true;
      markUserScroll();
    };
    const handlePointerUp = () => {
      scrollbarPointerActiveRef.current = false;
      userScrollPendingRef.current = false;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isInteractiveKeyboardTarget(event.target)
      ) {
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        followTail();
        return;
      }
      if (!KEYBOARD_SCROLL_KEYS.has(event.key)) {
        return;
      }
      event.preventDefault();
      markUserScroll();
      const pageDelta = Math.max(
        KEYBOARD_LINE_DELTA_PX,
        Math.floor(scrollRoot.clientHeight * KEYBOARD_PAGE_DELTA_RATIO)
      );
      const currentTop = scrollRoot.scrollTop;
      let nextTop = currentTop;
      switch (event.key) {
        case "ArrowUp":
          nextTop -= KEYBOARD_LINE_DELTA_PX;
          break;
        case "ArrowDown":
          nextTop += KEYBOARD_LINE_DELTA_PX;
          break;
        case "PageUp":
        case "Home":
          nextTop =
            event.key === "Home" ? 0 : Math.max(0, currentTop - pageDelta);
          break;
        case "PageDown":
          nextTop += pageDelta;
          break;
        case " ":
        case "Spacebar":
          nextTop += event.shiftKey ? -pageDelta : pageDelta;
          break;
      }
      const maxTop = getTranscriptTailScrollTop(
        scrollRoot,
        optionsRef.current.tailGapPx
      );
      nextTop = Math.max(0, Math.min(maxTop, nextTop));
      if (
        nextTop < currentTop &&
        optionsRef.current.followPolicy !== "always"
      ) {
        anchorRef.current = null;
        transition({ type: "user_scroll", atTail: false });
      }
      scrollRoot.scrollTo({ top: nextTop, behavior: "auto" });
      handleScroll(nextTop >= maxTop - AT_TAIL_EPSILON_PX);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        cancelPendingFrame();
      } else {
        scheduleReconcile();
      }
    };

    scrollRoot.addEventListener("wheel", handleWheel, { passive: true });
    scrollRoot.addEventListener("touchstart", handleTouchStart, {
      passive: true,
    });
    scrollRoot.addEventListener("touchmove", handleTouchMove, {
      passive: true,
    });
    scrollRoot.addEventListener("touchend", handleTouchEnd, { passive: true });
    scrollRoot.addEventListener("touchcancel", handleTouchEnd, {
      passive: true,
    });
    scrollRoot.addEventListener("pointerdown", handlePointerDown);
    scrollRoot.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const resizeObserver = new ResizeObserver(reconcileLayout);
    resizeObserver.observe(scrollRoot);
    if (scrollRoot.firstElementChild) {
      resizeObserver.observe(scrollRoot.firstElementChild);
    }
    scheduleReconcile();

    return () => {
      scrollRoot.removeEventListener("wheel", handleWheel);
      scrollRoot.removeEventListener("touchstart", handleTouchStart);
      scrollRoot.removeEventListener("touchmove", handleTouchMove);
      scrollRoot.removeEventListener("touchend", handleTouchEnd);
      scrollRoot.removeEventListener("touchcancel", handleTouchEnd);
      scrollRoot.removeEventListener("pointerdown", handlePointerDown);
      scrollRoot.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      resizeObserver.disconnect();
    };
  }, [
    cancelPendingFrame,
    followTail,
    handleScroll,
    reconcileLayout,
    scheduleReconcile,
    scrollRoot,
    transition,
  ]);

  useEffect(
    () => () => {
      generationRef.current += 1;
      cancelPendingFrame();
    },
    [cancelPendingFrame]
  );

  return {
    setScrollRoot,
    handleScroll,
    followTail,
    detachForNavigation,
    preserveForLayoutMutation,
    reconcileLayout,
    showScrollToBottom:
      itemCount > 0 && (mode === "detached_reading" || !atTail),
    mode,
  };
}
