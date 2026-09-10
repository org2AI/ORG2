// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

import { useKeyboardMouseMode } from "../useKeyboardMouseMode";

let root: Root;
let container: HTMLDivElement;
function Harness() {
  const { handleMouseMove, dataKeyboardMode } = useKeyboardMouseMode();
  return createElement("div", {
    onMouseMove: handleMouseMove,
    "data-mode": dataKeyboardMode,
  });
}
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(Harness)));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
function move(x: number) {
  act(() =>
    container.firstElementChild!.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: x })
    )
  );
}
it("returns to mouse mode after slow accumulated movement", () => {
  for (let x = 0; x <= 12; x += 2) move(x);
  expect(container.firstElementChild?.getAttribute("data-mode")).toBe("false");
});
it("keeps keyboard priority for jitter and establishes a fresh keyboard anchor", () => {
  move(0);
  move(20);
  expect(container.firstElementChild?.getAttribute("data-mode")).toBe("false");
  move(100);
  act(() =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }))
  );
  move(100);
  move(102);
  move(99);
  expect(container.firstElementChild?.getAttribute("data-mode")).toBe("true");
  move(110);
  expect(container.firstElementChild?.getAttribute("data-mode")).toBe("false");
});
