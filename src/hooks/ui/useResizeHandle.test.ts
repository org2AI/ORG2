// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useResizeHandle } from "./useResizeHandle";

let root: Root;
let container: HTMLDivElement;
const ended = vi.fn();
function Harness() {
  const [size, setSize] = useState(200);
  const { handleMouseDown, isResizing } = useResizeHandle(size, setSize, {
    direction: "horizontal",
    minSize: 100,
    maxSize: 500,
    onResizeEnd: ended,
  });
  return createElement("div", {
    onMouseDown: handleMouseDown,
    "data-size": size,
    "data-resizing": isResizing,
  });
}
function mouse(target: EventTarget, type: string, x: number, buttons = 1) {
  act(() =>
    target.dispatchEvent(
      new MouseEvent(type, { bubbles: true, clientX: x, buttons })
    )
  );
}
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  ended.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(Harness)));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.style.cssText = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it.each(["blur", "pointercancel", "hidden", "released-move"])(
  "ends the owning resize on %s and prevents later writes",
  (reason) => {
    const handle = container.firstElementChild!;
    mouse(handle, "mousedown", 0);
    mouse(document, "mousemove", 30);
    act(() => vi.advanceTimersByTime(20));
    expect(handle.getAttribute("data-size")).toBe("230");
    if (reason === "released-move") mouse(document, "mousemove", 100, 0);
    else
      act(() => {
        if (reason === "hidden") {
          vi.spyOn(document, "visibilityState", "get").mockReturnValue(
            "hidden"
          );
          document.dispatchEvent(new Event("visibilitychange"));
        } else window.dispatchEvent(new Event(reason));
      });
    mouse(document, "mousemove", 180, 0);
    act(() => vi.advanceTimersByTime(30));
    expect(handle.getAttribute("data-size")).toBe("230");
    expect(handle.getAttribute("data-resizing")).toBe("false");
    expect(document.body.style.cursor).toBe("");
    expect(ended).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  }
);
it("cancels pending work on unmount", () => {
  mouse(container.firstElementChild!, "mousedown", 0);
  mouse(document, "mousemove", 30);
  act(() => root.render(null));
  expect(vi.getTimerCount()).toBe(0);
  mouse(document, "mousemove", 100);
  expect(vi.getTimerCount()).toBe(0);
});
it("observes a release stopped by a child and starts the next drag cleanly", () => {
  const handle = container.firstElementChild!;
  handle.addEventListener("mouseup", (event) => event.stopPropagation());
  for (let i = 0; i < 3; i++) {
    mouse(handle, "mousedown", 0);
    mouse(handle, "mousemove", 10);
    act(() => vi.advanceTimersByTime(20));
    mouse(handle, "mouseup", 10, 0);
  }
  expect(handle.getAttribute("data-size")).toBe("230");
  expect(ended).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});
it("does not retain duplicate sessions after another press", () => {
  const handle = container.firstElementChild!;
  mouse(handle, "mousedown", 0);
  mouse(document, "mousemove", 10);
  mouse(handle, "mousedown", 50);
  mouse(document, "mousemove", 60);
  act(() => vi.advanceTimersByTime(20));
  mouse(window, "mouseup", 60, 0);
  expect(handle.getAttribute("data-size")).toBe("210");
  expect(ended).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
