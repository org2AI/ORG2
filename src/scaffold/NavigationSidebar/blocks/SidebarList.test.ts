// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SidebarList from "./SidebarList";

vi.mock("@src/components/Placeholder", () => ({
  Placeholder: () => null,
}));

const observers: {
  notify: () => void;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}[] = [];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(notify: () => void) {
        observers.push({
          notify,
          observe: this.observe,
          disconnect: this.disconnect,
        });
      }
    }
  );
});

afterEach(() => {
  observers.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SidebarList scroll edges", () => {
  it("tracks overflow, both ends, content resize, and preserves the reveal ref", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const ref = createRef<HTMLDivElement>();
    const props = {
      scrollContainerRef: ref,
      children: createElement("div", null, "Rows"),
    };
    act(() => root.render(createElement(SidebarList, props)));
    const scroller = ref.current!;
    const viewport = scroller.parentElement!;
    const observer = observers[0];
    expect(observer.observe.mock.calls.map(([node]) => node)).toEqual([
      scroller,
      scroller.firstElementChild,
    ]);
    expect(viewport.dataset.scrollTop).toBe("false");
    expect(viewport.dataset.scrollBottom).toBe("false");
    Object.defineProperty(scroller, "clientHeight", {
      configurable: true,
      value: 100,
    });
    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      value: 300,
    });
    observer.notify();
    expect(viewport.dataset.scrollTop).toBe("false");
    expect(viewport.dataset.scrollBottom).toBe("true");
    scroller.scrollTop = 50;
    scroller.dispatchEvent(new Event("scroll"));
    expect(viewport.dataset.scrollTop).toBe("true");
    expect(viewport.dataset.scrollBottom).toBe("true");
    scroller.scrollTop = 200;
    scroller.dispatchEvent(new Event("scroll"));
    expect(viewport.dataset.scrollBottom).toBe("false");
    scroller.scrollTop = 0;
    Object.defineProperty(scroller, "scrollHeight", { value: 100 });
    observer.notify();
    expect(viewport.dataset.scrollTop).toBe("false");
    expect(viewport.dataset.scrollBottom).toBe("false");
    const remove = vi.spyOn(scroller, "removeEventListener");
    act(() => root.unmount());
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
    expect(ref.current).toBeNull();
  });

  it("attaches after loading and disposes across repeated loading cycles", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const render = (isLoading: boolean) => {
      const props = { isLoading, children: "Rows" };
      act(() => root.render(createElement(SidebarList, props)));
    };
    render(true);
    expect(observers).toHaveLength(0);
    render(false);
    expect(observers).toHaveLength(1);
    render(true);
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    render(false);
    expect(observers).toHaveLength(2);
    act(() => root.unmount());
    expect(observers[1].disconnect).toHaveBeenCalledOnce();
  });
});
