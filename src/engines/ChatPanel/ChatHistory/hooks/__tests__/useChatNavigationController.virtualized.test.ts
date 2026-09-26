// @vitest-environment jsdom
import {
  act,
  createElement,
  createRef,
  useCallback,
  useLayoutEffect,
} from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { HIDDEN_AGENT_STATUS_TRAIL_STATE } from "@src/engines/ChatPanel/hooks/agentStatusTrailMath";

import type { OptimizedChatItem } from "../../chatItemPipeline/types";
import ChatHistoryList, {
  type ChatHistoryListHandle,
} from "../../components/ChatHistoryList";
import { useTranscriptViewport } from "../../viewport/useTranscriptViewport";
import { useChatNavigationController } from "../useChatNavigationController";

// Only body rendering is replaced. The list, viewport and TanStack range/size
// machinery are real; DOM geometry and browser event delivery are controlled.
vi.mock("../../renderers", () => ({ GroupItemRenderer: () => null }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps an initially unmounted turn after distant navigation and row measurement", () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.set(++frameId, cb);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const observers = new Set<{
    nodes: Set<Element>;
    callback: ResizeObserverCallback;
  }>();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      nodes = new Set<Element>();
      constructor(public callback: ResizeObserverCallback) {
        observers.add(this);
      }
      observe(node: Element) {
        this.nodes.add(node);
      }
      unobserve(node: Element) {
        this.nodes.delete(node);
      }
      disconnect() {
        this.nodes.clear();
        observers.delete(this);
      }
    }
  );
  const heights = new Map<number, number>();
  let scrollPending = false;
  const isRoot = (el: HTMLElement) =>
    el.dataset.testid === "chat-history-scroll-container";
  const height = (el: HTMLElement): number =>
    isRoot(el)
      ? 400
      : el.dataset.index !== undefined
        ? (heights.get(Number(el.dataset.index)) ?? 360)
        : Number.parseFloat(el.style.height) || 400;
  for (const property of ["clientHeight", "offsetHeight"] as const) {
    vi.spyOn(HTMLElement.prototype, property, "get").mockImplementation(
      function (this: HTMLElement) {
        return height(this);
      }
    );
  }
  for (const property of ["clientWidth", "offsetWidth"] as const) {
    vi.spyOn(HTMLElement.prototype, property, "get").mockReturnValue(600);
  }
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return isRoot(this)
        ? Number.parseFloat(
            (this.firstElementChild as HTMLElement)?.style.height
          ) || 400
        : height(this);
    }
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const root = this.closest<HTMLElement>(
        '[data-testid="chat-history-scroll-container"]'
      );
      const top =
        this.dataset.index === undefined
          ? 0
          : Number(
              this.style.transform.match(/translateY\(([-\d.]+)px\)/)?.[1] ?? 0
            ) - (root?.scrollTop ?? 0);
      return {
        top,
        bottom: top + height(this),
        height: height(this),
        left: 0,
        right: 600,
        width: 600,
        x: 0,
        y: top,
        toJSON() {},
      };
    }
  );
  vi.stubGlobal("scrollTo", vi.fn());
  const originalScrollTo = HTMLElement.prototype.scrollTo;
  HTMLElement.prototype.scrollTo = function (
    options?: ScrollToOptions | number,
    y?: number
  ) {
    const top = typeof options === "number" ? (y ?? 0) : (options?.top ?? 0);
    const next = Math.max(
      0,
      Math.min(this.scrollHeight - this.clientHeight, top)
    );
    if (next !== this.scrollTop) {
      this.scrollTop = next;
      scrollPending = true;
    }
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const flatItems = Array.from({ length: 57 }, (_, i) => ({
    chunk_id: `body-${i}`,
    type: "activity",
    event: { id: `event-${i}` },
  })) as OptimizedChatItem[];
  const counts = flatItems.map(() => 1);
  const turnIds = flatItems.map((_, i) => `turn-${i}`);
  let navigate = (_index: number) => {};
  const virtualListRef = createRef<ChatHistoryListHandle>();
  const scrollerRef = createRef<HTMLDivElement>();
  function Harness() {
    const ensureAnchorMounted = useCallback(
      (id: string) =>
        virtualListRef.current?.revealTranscriptAnchor(id) ?? false,
      []
    );
    const viewport = useTranscriptViewport({
      sessionKey: "history",
      navigationScopeKey: JSON.stringify(["history", null]),
      contentKey: "57-turns",
      itemCount: 57,
      ensureAnchorMounted,
    });
    const navigation = useChatNavigationController({
      activeId: "history",
      agentOrgOverviewAvailable: false,
      currentPageIndex: 0,
      displayGroupCounts: counts,
      displayGroupHeaders: [],
      displayGroupMeta: [],
      displaySourceGroupIndices: counts.map((_, i) => i),
      displayTotalFlatItems: 57,
      pages: [],
      setTurnPageListOpen: vi.fn(),
      setTurnPageSortAscending: vi.fn(),
      turnPageListOpen: false,
      turnPaginationEnabled: false,
      virtualListRef,
      onExplicitNavigation: viewport.beginNavigation,
    });
    useLayoutEffect(() => {
      navigate = navigation.handleConversationMinimapNavigate;
    });
    return createElement(ChatHistoryList, {
      flatItems,
      groupCounts: counts,
      turnIds,
      totalFlatItems: 57,
      footerSpacerHeight: 0,
      bottomInset: 0,
      topPaddingPx: 0,
      planningIndicatorCount: 0,
      planningVariantIndex: 0,
      planningFooterMode: "planning",
      statusTrail: HIDDEN_AGENT_STATUS_TRAIL_STATE,
      statusTrailSessionId: null,
      virtualListRef,
      virtualListDataKey: "history",
      getIsWpGeneWorking: () => false,
      renderGroupHeader: () => null,
      onAtBottomStateChange: viewport.handleScroll,
      onRangeChanged: () => {},
      onEndReached: () => {},
      isNavigating: viewport.isNavigating,
      virtualScrollerRef: scrollerRef,
      onScrollRootChange: viewport.setScrollRoot,
      onRowLayoutCommit: viewport.reconcileLayout,
    });
  }
  const scroller = () =>
    host.querySelector<HTMLElement>(
      '[data-testid="chat-history-scroll-container"]'
    )!;
  const frame = () =>
    act(() => {
      const pending = [...frames.entries()];
      frames.clear();
      pending.forEach(([id, cb]) => cb(id));
    });
  const scroll = () =>
    act(() => {
      if (scrollPending) {
        scrollPending = false;
        scroller().dispatchEvent(new Event("scroll"));
      }
    });
  const resize = () =>
    act(() => {
      for (const observer of [...observers]) {
        const entries = [...observer.nodes]
          .filter((n) => n.isConnected)
          .map(
            (node) =>
              ({
                target: node,
                borderBoxSize: [
                  { blockSize: height(node as HTMLElement), inlineSize: 600 },
                ],
                contentRect: node.getBoundingClientRect(),
              }) as unknown as ResizeObserverEntry
          );
        observer.callback(entries, observer as unknown as ResizeObserver);
      }
    });
  try {
    act(() => root.render(createElement(Harness)));
    for (let i = 0; i < 4; i++) {
      frame();
      scroll();
      resize();
    }
    expect(scroller().scrollTop).toBeGreaterThan(19000);
    expect(host.querySelector('[data-chat-group-index="0"]')).toBeNull();
    act(() => navigate(0));
    // A layout callback can precede native scroll delivery and virtual range
    // replacement: the old mounted window must never become the destination.
    resize();
    frame();
    scroll();
    heights.set(0, 620);
    heights.set(1, 180);
    for (let i = 0; i < 4; i++) {
      resize();
      scroll();
      frame();
    }
    const oldest = host.querySelector<HTMLElement>(
      '[data-chat-group-index="0"]'
    );
    expect(oldest).not.toBeNull();
    expect(oldest!.getBoundingClientRect().top).toBe(0);
    heights.set(0, 800);
    resize();
    scroll();
    frame();
    expect(oldest!.getBoundingClientRect().top).toBe(0);
    act(() => {
      navigate(20);
      navigate(35);
    });
    for (let i = 0; i < 4; i++) {
      frame();
      scroll();
      resize();
    }
    expect(
      host
        .querySelector<HTMLElement>('[data-chat-group-index="35"]')!
        .getBoundingClientRect().top
    ).toBe(0);
    act(() => navigate(0));
    act(() =>
      scroller().dispatchEvent(new WheelEvent("wheel", { deltaY: 120 }))
    );
    const userTop = scroller().scrollTop + 120;
    scroller().scrollTop = userTop;
    act(() => scroller().dispatchEvent(new Event("scroll")));
    for (let i = 0; i < 4; i++) {
      resize();
      scroll();
      frame();
    }
    expect(scroller().scrollTop).toBe(userTop);
    expect(host.querySelector('[data-chat-group-index="0"]')).toBeNull();
  } finally {
    act(() => root.unmount());
    host.remove();
    HTMLElement.prototype.scrollTo = originalScrollTo;
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});
