// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { useTranscriptViewport } from "../../viewport/useTranscriptViewport";
import { useChatNavigationController } from "../useChatNavigationController";

it("aligns an already mounted turn and preserves it through resize", () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  let resize = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    }
  );
  const flushFrames = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  };
  const scroller = document.createElement("div");
  Object.defineProperties(scroller, {
    clientHeight: { value: 400 },
    scrollHeight: { value: 2000 },
  });
  scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  let animationTarget: number | null = null;
  scroller.scrollTo = (value) => {
    const target = typeof value === "object" ? (value.top ?? 0) : 0;
    if (typeof value === "object" && value.behavior === "smooth") {
      animationTarget = target;
    } else {
      animationTarget = null;
      scroller.scrollTop = target;
    }
  };
  for (const [id, top] of [
    ["older", 0],
    ["latest", 1600],
  ] as const) {
    const anchor = document.createElement("div");
    anchor.dataset.transcriptAnchorId = id;
    anchor.getBoundingClientRect = () =>
      ({
        top: top - scroller.scrollTop,
        bottom: top + 400 - scroller.scrollTop,
      }) as DOMRect;
    scroller.append(anchor);
  }
  let navigate: (index: number) => void = () => {};
  function Harness() {
    const viewport = useTranscriptViewport({
      sessionKey: "private-history",
      navigationScopeKey: JSON.stringify(["private-history", null]),
      contentKey: "two-turns",
      itemCount: 2,
    });
    const { setScrollRoot } = viewport;
    useLayoutEffect(() => setScrollRoot(scroller), [setScrollRoot]);
    const navigation = useChatNavigationController({
      activeId: "private-history",
      agentOrgOverviewAvailable: false,
      currentPageIndex: 0,
      displayGroupCounts: [1, 1],
      displayGroupHeaders: [],
      displayGroupMeta: [],
      displaySourceGroupIndices: [0, 1],
      displayTotalFlatItems: 2,
      pages: [],
      setTurnPageListOpen: vi.fn(),
      setTurnPageSortAscending: vi.fn(),
      turnPageListOpen: false,
      turnPaginationEnabled: false,
      virtualListRef: {
        current: {
          getGroupAnchorId: () => "older",
          readNavigationGeometry: () => ({
            status: "measured",
            revision: 1,
            scrollTop: 0,
            anchor: { itemId: "older", offsetFromViewportTop: 0 },
          }),
          revealTranscriptAnchor: () => true,
        },
      },
      onExplicitNavigation: viewport.beginNavigation,
    });
    useLayoutEffect(() => {
      navigate = navigation.handleConversationMinimapNavigate;
    }, [navigation.handleConversationMinimapNavigate]);
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    act(() => root.render(createElement(Harness)));
    act(flushFrames);
    expect(scroller.scrollTop).toBe(1600);
    act(() => navigate(0));
    act(flushFrames);
    if (animationTarget !== null) {
      // A virtual row is measured during the first native animation frame,
      // before WebKit delivers the corresponding scroll event.
      scroller.scrollTop = 1200;
      act(resize);
      if (animationTarget !== null) scroller.scrollTop = animationTarget;
    }
    act(resize);
    expect(scroller.scrollTop).toBe(0);
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});
