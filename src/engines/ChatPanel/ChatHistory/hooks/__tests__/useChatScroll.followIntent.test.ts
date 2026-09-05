// @vitest-environment jsdom
import { act, createElement, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useChatScroll } from "../useChatScroll";
import { useChatScrollPin } from "../useChatScrollPin";

describe("useChatScroll tail-follow intent", () => {
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  afterEach(() => {
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("recovers from layout jumps but preserves an explicit manual pause", () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const scrollTo = vi.fn();
    const scrollRoot = document.createElement("div");
    Object.defineProperties(scrollRoot, {
      clientHeight: { value: 600 },
      scrollHeight: { value: 4_000 },
      scrollTo: { value: scrollTo },
    });
    const scrollerRef = { current: scrollRoot };
    const manualScrollAtRef = { current: 0 };

    vi.spyOn(performance, "now").mockReturnValue(1_000);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserverMock {
        observe = vi.fn();
        disconnect = vi.fn();
      }
    );

    function Harness({
      reportNotAtBottom,
      tailFollowKey,
    }: {
      reportNotAtBottom: boolean;
      tailFollowKey: string;
    }) {
      const visibleRangeEndRef = useRef(50);
      const pinLastGroupRef = useRef(false);
      const programmaticScrollAtRef = useRef(0);
      const turnCollapseInteractionAtRef = useRef(0);
      const contentOverflowingRef = useRef(true);
      const pendingCancelRef = useRef(false);
      const { handleAtBottomStateChange } = useChatScroll({
        optimizedChatHistoryLength: 50,
        virtuosoScrollerRef: scrollerRef,
        atBottom: true,
        setAtBottom: vi.fn(),
        setIsChatScrolledToBottom: vi.fn(),
        isPendingCancelRef: pendingCancelRef,
        visibleRangeEndRef,
        pinLastGroupRef,
        manualScrollAtRef,
        programmaticScrollAtRef,
        turnCollapseInteractionAtRef,
        isContentOverflowingRef: contentOverflowingRef,
        activeSessionId: "session-1",
        footerSpacerHeight: 0,
        bottomInset: 0,
        tailFollowKey,
      });
      useEffect(() => {
        if (reportNotAtBottom) handleAtBottomStateChange(false);
      }, [handleAtBottomStateChange, reportNotAtBottom]);
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        createElement(Harness, {
          reportNotAtBottom: true,
          tailFollowKey: "tail-1",
        })
      )
    );
    scrollTo.mockClear();

    act(() =>
      root.render(
        createElement(Harness, {
          reportNotAtBottom: true,
          tailFollowKey: "tail-2",
        })
      )
    );
    expect(scrollTo).toHaveBeenCalled();

    scrollTo.mockClear();
    manualScrollAtRef.current = 500;
    act(() =>
      root.render(
        createElement(Harness, {
          reportNotAtBottom: true,
          tailFollowKey: "tail-3",
        })
      )
    );
    expect(scrollTo).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });

  it("pauses tail follow for keyboard scrolling outside editable controls", () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    const scrollRoot = document.createElement("div");
    const textarea = document.createElement("textarea");
    scrollRoot.appendChild(textarea);
    const scrollerRef = { current: scrollRoot };
    const manualScrollAtRef = { current: 0 };
    const onPinToTopChange = vi.fn();

    vi.spyOn(performance, "now").mockReturnValue(1_000);

    function Harness() {
      const pinLastGroupRef = useRef(true);
      const programmaticScrollAtRef = useRef(0);
      const pendingCancelRef = useRef(false);
      const contentOverflowingRef = useRef(true);
      useChatScrollPin({
        activeId: "session-1",
        groupCounts: [],
        totalFlatItems: 0,
        footerSpacerHeight: 0,
        bottomInset: 0,
        sessionLoadStatus: "loaded",
        virtuosoScrollerRef: scrollerRef,
        atBottom: true,
        isPendingCancelRef: pendingCancelRef,
        isContentOverflowingRef: contentOverflowingRef,
        optimizedChatHistoryLength: 0,
        pinLastGroupRef,
        manualScrollAtRef,
        programmaticScrollAtRef,
        onPinToTopChange,
      });
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(createElement(Harness)));

    act(() => {
      scrollRoot.dispatchEvent(
        new KeyboardEvent("keydown", { key: "PageUp", bubbles: true })
      );
    });
    expect(manualScrollAtRef.current).toBe(1_000);
    expect(onPinToTopChange).toHaveBeenCalledWith(false);

    manualScrollAtRef.current = 0;
    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })
      );
    });
    expect(manualScrollAtRef.current).toBe(0);

    act(() => root.unmount());
    container.remove();
  });
});
