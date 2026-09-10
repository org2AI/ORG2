// @vitest-environment jsdom
import { type RefObject, act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useRatioResize } from "./useRatioResize";

let root: Root;
let container: HTMLDivElement;
const changed = vi.fn();
const geometryRef: RefObject<HTMLDivElement | null> = { current: null };
function Harness() {
  const { ratio, handleMouseDown } = useRatioResize(geometryRef, {
    direction: "horizontal",
    onRatioChange: changed,
  });
  return createElement("div", {
    onMouseDown: handleMouseDown,
    "data-ratio": ratio,
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
  changed.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  geometryRef.current = container;
  root = createRoot(container);
  act(() => root.render(createElement(Harness)));
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 200,
    height: 100,
  } as DOMRect);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  geometryRef.current = null;
  document.body.style.cssText = "";
  vi.restoreAllMocks();
});
it.each(["blur", "pointercancel", "hidden", "released-move", "mouseup"])(
  "stops ratio writes on %s",
  (reason) => {
    const handle = container.firstElementChild!;
    mouse(handle, "mousedown", 100);
    mouse(document, "mousemove", 120);
    expect(handle.getAttribute("data-ratio")).toBe("0.6");
    if (reason === "released-move") mouse(document, "mousemove", 150, 0);
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
    expect(handle.getAttribute("data-ratio")).toBe("0.6");
    expect(changed).toHaveBeenCalledTimes(1);
    expect(document.body.style.cursor).toBe("");
  }
);
it("has no idle movement listener and detaches after repeated drags", () => {
  const add = vi.spyOn(document, "addEventListener");
  const remove = vi.spyOn(document, "removeEventListener");
  act(() => root.render(createElement(Harness)));
  expect(add.mock.calls.filter(([type]) => type === "mousemove")).toHaveLength(
    0
  );
  for (let i = 0; i < 3; i++) {
    mouse(container.firstElementChild!, "mousedown", 100);
    mouse(document, "mousemove", 120);
    mouse(window, "mouseup", 120, 0);
  }
  const added = add.mock.calls.filter(([type]) => type === "mousemove");
  const removed = remove.mock.calls.filter(([type]) => type === "mousemove");
  expect(added).toHaveLength(3);
  expect(removed).toEqual(added);
  mouse(document, "mousemove", 180);
  expect(changed).toHaveBeenCalledTimes(3);
});
it("detaches on unmount during drag", () => {
  mouse(container.firstElementChild!, "mousedown", 100);
  act(() => root.render(null));
  mouse(document, "mousemove", 180);
  expect(changed).not.toHaveBeenCalled();
  expect(document.body.style.cursor).toBe("");
});
