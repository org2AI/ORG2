// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TranscriptNavigationTarget } from "../transcriptNavigation";
import {
  type UseTranscriptViewportReturn,
  useTranscriptViewport,
} from "../useTranscriptViewport";

const reactEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("useTranscriptViewport", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let viewport: UseTranscriptViewportReturn;
  let scrollRoot: HTMLDivElement;
  let clientHeight: number;
  let scrollHeight: number;
  let firstAnchorTop: number;
  let nextFrameId: number;
  let frames: Map<number, FrameRequestCallback>;
  let scrollTo: ReturnType<
    typeof vi.fn<(options?: ScrollToOptions | number, y?: number) => void>
  >;
  let onExplicitFollow: ReturnType<typeof vi.fn<() => void>>;
  let triggerResize: () => void;
  let resizeDisconnect: ReturnType<typeof vi.fn<() => void>>;
  let visibilityState: DocumentVisibilityState;

  function Harness({
    sessionKey,
    contentKey,
    localSubmitKey,
    navigationScopeKey,
  }: {
    sessionKey: string;
    contentKey: string;
    localSubmitKey?: string | null;
    navigationScopeKey?: string;
  }) {
    const value = useTranscriptViewport({
      sessionKey,
      navigationScopeKey,
      contentKey,
      itemCount: 2,
      localSubmitKey,
      onExplicitFollow,
    });
    useLayoutEffect(() => {
      viewport = value;
    }, [value]);
    return null;
  }

  const render = (
    sessionKey: string,
    contentKey: string,
    localSubmitKey?: string | null,
    navigationScopeKey?: string
  ) => {
    act(() =>
      root.render(
        createElement(Harness, {
          sessionKey,
          contentKey,
          localSubmitKey,
          navigationScopeKey,
        })
      )
    );
  };

  const flushFrames = () => {
    while (frames.size > 0) {
      const pending = Array.from(frames.entries());
      frames.clear();
      for (const [id, callback] of pending) callback(id);
    }
  };

  beforeEach(() => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    frames = new Map();
    nextFrameId = 1;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.delete(id);
    });
    resizeDisconnect = vi.fn();
    onExplicitFollow = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserverMock {
        constructor(callback: ResizeObserverCallback) {
          triggerResize = () => callback([], this as unknown as ResizeObserver);
        }
        observe = vi.fn();
        disconnect = resizeDisconnect;
      }
    );
    visibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibilityState
    );

    clientHeight = 400;
    scrollHeight = 1_000;
    firstAnchorTop = 100;
    scrollRoot = document.createElement("div");
    Object.defineProperties(scrollRoot, {
      clientHeight: { get: () => clientHeight },
      scrollHeight: { get: () => scrollHeight },
      offsetWidth: { value: 500 },
      clientWidth: { value: 488 },
    });
    scrollRoot.getBoundingClientRect = () =>
      ({ top: 0, right: 500 }) as DOMRect;
    scrollTo = vi.fn<(options?: ScrollToOptions | number, y?: number) => void>(
      (options?: ScrollToOptions | number, y?: number) => {
        scrollRoot.scrollTop =
          typeof options === "number"
            ? Number(y ?? 0)
            : Number(options?.top ?? 0);
      }
    );
    scrollRoot.scrollTo = scrollTo;

    const firstAnchor = document.createElement("div");
    firstAnchor.setAttribute("data-transcript-anchor-id", "turn-a");
    firstAnchor.getBoundingClientRect = () =>
      ({
        top: firstAnchorTop - scrollRoot.scrollTop,
        bottom: firstAnchorTop + 200 - scrollRoot.scrollTop,
      }) as DOMRect;
    const secondAnchor = document.createElement("div");
    secondAnchor.setAttribute("data-transcript-anchor-id", "turn-b");
    secondAnchor.getBoundingClientRect = () =>
      ({
        top: 500 - scrollRoot.scrollTop,
        bottom: 700 - scrollRoot.scrollTop,
      }) as DOMRect;
    scrollRoot.append(firstAnchor, secondAnchor);

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    render("session-a", "content-1");
    act(() => viewport.setScrollRoot(scrollRoot));
    act(flushFrames);
    scrollTo.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("coalesces streaming and resize-shaped content changes into one frame", () => {
    render("session-a", "content-2");
    render("session-a", "content-3");
    render("session-a", "content-4");

    expect(frames).toHaveLength(1);
    act(flushFrames);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollRoot.scrollTop).toBe(600);
  });

  it("preserves a stable item and pixel offset while detached", () => {
    scrollRoot.scrollTop = 200;
    act(() => {
      scrollRoot.dispatchEvent(new WheelEvent("wheel", { deltaY: -120 }));
    });
    expect(viewport.mode).toBe("detached_reading");
    act(() => viewport.handleScroll(false));

    firstAnchorTop = 150;
    render("session-a", "content-streamed");
    act(flushFrames);

    expect(scrollRoot.scrollTop).toBe(250);
    expect(scrollTo).not.toHaveBeenCalledWith(
      expect.objectContaining({ top: 600 })
    );
    act(() => viewport.handleScroll(false));
    expect(viewport.mode).toBe("detached_reading");
  });

  it("does not write scrollTop when only content below the anchor changes", () => {
    scrollRoot.scrollTop = 200;
    act(() => {
      scrollRoot.dispatchEvent(new WheelEvent("wheel", { deltaY: -120 }));
      viewport.handleScroll(false);
    });

    render("session-a", "tail-append-and-stream");
    act(flushFrames);

    expect(scrollRoot.scrollTop).toBe(200);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("owns keyboard scrolling and detaches before Page Up moves the reader", () => {
    scrollRoot.scrollTop = 600;
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "PageUp",
    });

    act(() => scrollRoot.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(scrollRoot.scrollTop).toBe(240);
    expect(viewport.mode).toBe("detached_reading");
  });

  it.each(["button", "summary", "a"])(
    "leaves keyboard interaction on a focused %s to the control",
    (tag) => {
      const control = document.createElement(tag);
      if (tag === "a") control.setAttribute("href", "#message");
      const child = document.createElement("span");
      control.append(child);
      scrollRoot.append(control);
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: " ",
      });

      act(() => child.dispatchEvent(event));

      expect(event.defaultPrevented).toBe(false);
      expect(scrollTo).not.toHaveBeenCalled();
      expect(viewport.mode).toBe("following_tail");
    }
  );

  it("restores the reading anchor inside the resize callback, before paint", () => {
    scrollRoot.scrollTop = 200;
    act(() => {
      scrollRoot.dispatchEvent(new WheelEvent("wheel", { deltaY: -120 }));
      viewport.handleScroll(false);
    });

    // A frame requested from the observer would run only after this frame
    // painted the reflowed rows at the stale offset.
    firstAnchorTop = 130;
    act(() => {
      triggerResize();
      expect(scrollRoot.scrollTop).toBe(230);
      triggerResize();
      triggerResize();
    });

    expect(frames).toHaveLength(0);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollRoot.scrollTop).toBe(230);
    expect(viewport.mode).toBe("detached_reading");
  });

  it("keeps the tail pinned inside the resize callback while a pane resize reflows the transcript", () => {
    scrollHeight = 1_300;
    act(() => {
      triggerResize();
      expect(scrollRoot.scrollTop).toBe(900);
    });
    expect(frames).toHaveLength(0);

    scrollHeight = 1_100;
    act(() => triggerResize());
    expect(scrollRoot.scrollTop).toBe(700);
    expect(viewport.mode).toBe("following_tail");
  });

  it("reconciles a content owner's synchronous layout commit and drops the pending frame", () => {
    render("session-a", "streamed-row");
    expect(frames).toHaveLength(1);

    scrollHeight = 1_250;
    act(() => {
      viewport.reconcileLayout();
      expect(scrollRoot.scrollTop).toBe(850);
    });
    expect(frames).toHaveLength(0);
  });

  it("captures an anchor before a user-triggered collapse changes layout", () => {
    scrollRoot.scrollTop = 200;
    act(() => viewport.preserveForLayoutMutation());
    expect(viewport.mode).toBe("detached_reading");

    firstAnchorTop = 160;
    act(flushFrames);
    expect(scrollRoot.scrollTop).toBe(260);
  });

  it("detaches before an expand resize and ignores later streaming until the reader follows again", () => {
    // Geometry can transiently report away from the tail while the controller
    // is still following. An explicit Expand must nevertheless freeze the
    // current reading position before its height change is observed.
    scrollRoot.scrollTop = 200;
    act(() => viewport.preserveForLayoutMutation());
    expect(viewport.mode).toBe("detached_reading");

    scrollHeight = 1_400;
    act(() => triggerResize());
    act(flushFrames);
    expect(scrollRoot.scrollTop).toBe(200);
    expect(scrollTo).not.toHaveBeenCalledWith(
      expect.objectContaining({ top: 1_000 })
    );

    scrollHeight = 1_600;
    render("session-a", "stream-after-expand");
    act(flushFrames);
    expect(viewport.mode).toBe("detached_reading");
    expect(scrollRoot.scrollTop).toBe(200);

    act(() => viewport.followTail());
    act(flushFrames);
    expect(viewport.mode).toBe("following_tail");
    expect(scrollRoot.scrollTop).toBe(1_200);
  });

  it("reattaches when the reader actively scrolls back to the tail", () => {
    scrollRoot.scrollTop = 200;
    act(() => viewport.preserveForLayoutMutation());
    expect(viewport.mode).toBe("detached_reading");

    scrollRoot.scrollTop = 600;
    act(() => {
      scrollRoot.dispatchEvent(new WheelEvent("wheel", { deltaY: 120 }));
      viewport.handleScroll(true);
    });
    expect(viewport.mode).toBe("following_tail");

    scrollHeight = 1_200;
    render("session-a", "stream-after-user-returned-to-tail");
    act(flushFrames);
    expect(scrollRoot.scrollTop).toBe(800);
  });

  it("resets session intent and cancels stale session frames", () => {
    scrollRoot.scrollTop = 200;
    act(() => {
      scrollRoot.dispatchEvent(new WheelEvent("wheel", { deltaY: -120 }));
      viewport.handleScroll(false);
    });
    firstAnchorTop = 150;

    render("session-a", "pending-a-frame");
    expect(frames).toHaveLength(1);
    render("session-b", "content-b");
    expect(frames).toHaveLength(1);
    act(flushFrames);
    expect(scrollRoot.scrollTop).toBe(600);

    scrollTo.mockClear();
    render("session-a", "content-a-reopened");
    act(flushFrames);
    expect(viewport.mode).toBe("following_tail");
    expect(scrollRoot.scrollTop).toBe(600);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("explicit submit and jump-to-latest reattach tail following", () => {
    scrollRoot.scrollTop = 200;
    act(() => {
      scrollRoot.dispatchEvent(new WheelEvent("wheel", { deltaY: -120 }));
      viewport.handleScroll(false);
    });
    render("session-a", "content-with-submit", "new-submit-a");
    act(flushFrames);
    expect(viewport.mode).toBe("following_tail");
    expect(scrollRoot.scrollTop).toBe(600);

    scrollRoot.scrollTop = 200;
    act(() => {
      scrollRoot.dispatchEvent(new WheelEvent("wheel", { deltaY: -120 }));
      viewport.handleScroll(false);
      viewport.followTail();
    });
    act(flushFrames);
    expect(viewport.mode).toBe("following_tail");
    expect(scrollRoot.scrollTop).toBe(600);
    expect(onExplicitFollow).toHaveBeenCalledTimes(2);
  });

  it.each([
    { top: 200, overflow: "auto", containment: "auto", mode: "following_tail" },
    { top: 0, overflow: "auto", containment: "auto", mode: "detached_reading" },
    {
      top: 0,
      overflow: "scroll",
      containment: "contain",
      mode: "following_tail",
    },
    {
      top: 200,
      overflow: "hidden",
      containment: "auto",
      mode: "detached_reading",
    },
  ])(
    "routes nested wheel intent with $top/$overflow/$containment",
    ({ top, overflow, containment, mode }) => {
      const codeScroller = document.createElement("div");
      codeScroller.style.overflowY = overflow;
      codeScroller.style.overscrollBehaviorY = containment;
      Object.defineProperties(codeScroller, {
        clientHeight: { value: 100 },
        scrollHeight: { value: 500 },
      });
      codeScroller.scrollTop = top;
      const codeLine = document.createElement("span");
      codeScroller.append(codeLine);
      scrollRoot.append(codeScroller);
      act(() =>
        codeLine.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            deltaY: -40,
          })
        )
      );
      expect(viewport.mode).toBe(mode);
    }
  );

  it("leaves prevented wheel events with their existing owner", () => {
    const event = new WheelEvent("wheel", { deltaY: -40, cancelable: true });
    event.preventDefault();
    act(() => scrollRoot.dispatchEvent(event));
    expect(viewport.mode).toBe("following_tail");
  });

  it("does no frame work while hidden and reconciles once on visibility return", () => {
    visibilityState = "hidden";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    render("session-a", "hidden-update");
    expect(frames).toHaveLength(0);
    expect(scrollTo).not.toHaveBeenCalled();

    visibilityState = "visible";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(frames).toHaveLength(1);
    act(flushFrames);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("owns one listener set and cancels observer/frame work on unmount", () => {
    const removeListener = vi.spyOn(scrollRoot, "removeEventListener");
    render("session-a", "pending-unmount");
    expect(frames).toHaveLength(1);
    act(() => root.unmount());
    expect(frames).toHaveLength(0);
    expect(resizeDisconnect).toHaveBeenCalledOnce();
    for (const eventName of [
      "wheel",
      "touchstart",
      "touchmove",
      "touchend",
      "touchcancel",
      "pointerdown",
      "keydown",
    ]) {
      expect(
        removeListener.mock.calls.filter(([type]) => type === eventName)
      ).toHaveLength(1);
    }
    root = createRoot(host);
  });

  it("returns listener, observer, and frame counts to baseline across ten remounts", () => {
    const addListener = vi.spyOn(scrollRoot, "addEventListener");
    const removeListener = vi.spyOn(scrollRoot, "removeEventListener");

    for (let cycle = 0; cycle < 10; cycle++) {
      act(() => root.unmount());
      expect(frames).toHaveLength(0);
      root = createRoot(host);
      render(`session-cycle-${cycle}`, `content-cycle-${cycle}`);
      act(() => viewport.setScrollRoot(scrollRoot));
      act(flushFrames);
    }

    expect(
      addListener.mock.calls.filter(([type]) => type === "wheel")
    ).toHaveLength(10);
    expect(
      removeListener.mock.calls.filter(([type]) => type === "wheel")
    ).toHaveLength(10);
    expect(resizeDisconnect).toHaveBeenCalledTimes(10);
    expect(frames).toHaveLength(0);
  });
  const navigationTarget = (
    id = "turn-a",
    top = 100
  ): TranscriptNavigationTarget => ({
    id,
    scopeKey: "session-a",
    onEnd: vi.fn(),
    readGeometry: vi.fn(() => ({
      status: "measured" as const,
      revision: 1,
      scrollTop: top,
      anchor: { itemId: id, offsetFromViewportTop: 0 },
    })),
  });

  it("does not capture intermediate rows while mounting; measured target becomes the reading anchor", () => {
    const target = navigationTarget();
    let measured = false;
    target.readGeometry = () =>
      measured
        ? {
            status: "measured",
            revision: 2,
            scrollTop: 100,
            anchor: { itemId: "turn-a", offsetFromViewportTop: 0 },
          }
        : { status: "pending", scrollTop: 300 };
    act(() => viewport.beginNavigation(target));
    act(flushFrames);
    act(() => viewport.handleScroll(false));
    act(triggerResize);
    expect(viewport.isNavigating()).toBe(true);
    expect(scrollRoot.scrollTop).toBe(300);
    expect(target.onEnd).not.toHaveBeenCalled();
    measured = true;
    act(triggerResize);
    act(flushFrames);
    expect(scrollRoot.scrollTop).toBe(100);
    expect(target.onEnd).toHaveBeenCalledExactlyOnceWith("settled");
    firstAnchorTop = 175;
    act(triggerResize);
    expect(scrollRoot.scrollTop).toBe(175);
  });

  it("rejects an old scheduled frame after a newer destination takes ownership", () => {
    const first = navigationTarget();
    const second = navigationTarget("turn-b", 500);
    let firstGeneration = 0;
    act(() => {
      firstGeneration = viewport.beginNavigation(first);
    });
    const staleFrame = [...frames.values()][0];
    act(() => {
      expect(viewport.beginNavigation(second)).toBeGreaterThan(firstGeneration);
    });
    act(() => staleFrame(0));
    expect(first.readGeometry).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);
    act(flushFrames);
    expect(first.onEnd).toHaveBeenCalledExactlyOnceWith("superseded");
    expect(second.onEnd).toHaveBeenCalledExactlyOnceWith("settled");
    expect(scrollRoot.scrollTop).toBe(500);
  });

  it.each(["wheel", "touchstart", "keydown", "pointerdown"])(
    "lets %s take over before the next native scroll",
    (kind) => {
      const target = navigationTarget();
      act(() => viewport.beginNavigation(target));
      const event =
        kind === "wheel"
          ? new WheelEvent(kind, { deltaY: 120 })
          : kind === "keydown"
            ? new KeyboardEvent(kind, { key: "ArrowUp" })
            : kind === "pointerdown"
              ? new MouseEvent(kind, { button: 0, clientX: 499 })
              : new Event(kind);
      act(() => scrollRoot.dispatchEvent(event));
      expect(target.onEnd).toHaveBeenCalledExactlyOnceWith("user");
      scrollRoot.scrollTop = 250;
      act(() => viewport.handleScroll(false));
      firstAnchorTop += 40;
      act(triggerResize);
      act(flushFrames);
      expect(scrollRoot.scrollTop).toBe(290);
      expect(viewport.isNavigating()).toBe(false);
    }
  );

  it("waits for an intentional destination page and cancels a different page selection", () => {
    render("session-a", "content", null, "page-0");
    act(flushFrames);
    const target = { ...navigationTarget(), scopeKey: "page-1" };
    act(() => viewport.beginNavigation(target));
    act(flushFrames);
    expect(target.readGeometry).not.toHaveBeenCalled();
    render("session-a", "expanded", null, "page-1");
    act(flushFrames);
    expect(target.onEnd).toHaveBeenCalledExactlyOnceWith("settled");
    const next = { ...navigationTarget(), scopeKey: "page-2" };
    act(() => viewport.beginNavigation(next));
    render("session-a", "content", null, "page-3");
    act(flushFrames);
    expect(next.onEnd).toHaveBeenCalledExactlyOnceWith("scope");
    expect(next.readGeometry).not.toHaveBeenCalled();
  });

  it("cancels session changes and invalidates already queued work", () => {
    const target = navigationTarget();
    act(() => viewport.beginNavigation(target));
    const staleFrame = [...frames.values()][0];
    render("session-b", "content");
    act(() => staleFrame(0));
    act(flushFrames);
    expect(target.onEnd).toHaveBeenCalledExactlyOnceWith("scope");
    expect(target.readGeometry).not.toHaveBeenCalled();
  });

  it("leaves the current position when the target disappears", () => {
    const target = navigationTarget();
    target.readGeometry = () => ({ status: "missing" });
    act(() => viewport.beginNavigation(target));
    act(flushFrames);
    expect(target.onEnd).toHaveBeenCalledExactlyOnceWith("missing");
    expect(scrollRoot.scrollTop).toBe(600);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("does no navigation work while hidden and revalidates once on return", () => {
    const target = navigationTarget();
    act(() => viewport.beginNavigation(target));
    visibilityState = "hidden";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    act(triggerResize);
    act(flushFrames);
    expect(frames).toHaveLength(0);
    expect(target.readGeometry).not.toHaveBeenCalled();
    visibilityState = "visible";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    act(flushFrames);
    expect(target.onEnd).toHaveBeenCalledExactlyOnceWith("settled");
    expect(frames).toHaveLength(0);
  });

  it("returns pending navigation and callbacks to baseline when unmounted", () => {
    const target = navigationTarget();
    act(() => viewport.beginNavigation(target));
    act(() => root.render(null));
    expect(target.onEnd).toHaveBeenCalledExactlyOnceWith("unmount");
    expect(frames).toHaveLength(0);
  });
  it("does not retry a refused browser scroll every frame", () => {
    scrollTo.mockImplementation(() => {});
    act(() => viewport.beginNavigation(navigationTarget()));
    act(flushFrames);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(0);
    expect(viewport.isNavigating()).toBe(true);
  });
});
