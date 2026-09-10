// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AppGlobalRecovery } from "../AppGlobalRecovery";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(AppGlobalRecovery)));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.style.cssText = "";
  document.body.classList.remove("resize-active");
  vi.useRealTimers();
});
it("does not let a previous release reset a new drag", () => {
  document.body.style.cursor = "col-resize";
  window.dispatchEvent(new MouseEvent("mouseup"));
  window.dispatchEvent(new MouseEvent("mousedown", { buttons: 1 }));
  vi.advanceTimersByTime(200);
  expect(document.body.style.cursor).toBe("col-resize");
});
it("observes recovery even when a child stops movement propagation", () => {
  document.body.style.cursor = "col-resize";
  container.addEventListener("mousemove", (event) => event.stopPropagation());
  container.dispatchEvent(
    new MouseEvent("mousemove", { bubbles: true, buttons: 0 })
  );
  expect(document.body.style.cursor).toBe("");
});
it("does not schedule timers for ordinary idle releases", () => {
  window.dispatchEvent(new MouseEvent("mouseup"));
  expect(vi.getTimerCount()).toBe(0);
});
it("recovers on pointer cancellation", () => {
  document.body.style.cursor = "col-resize";
  window.dispatchEvent(new Event("pointercancel"));
  expect(document.body.style.cursor).toBe("");
});
it("preserves active movement and disposes a pending fallback on unmount", () => {
  document.body.style.cursor = "col-resize";
  window.dispatchEvent(new MouseEvent("mousemove", { buttons: 1 }));
  expect(document.body.style.cursor).toBe("col-resize");
  window.dispatchEvent(new MouseEvent("mouseup"));
  expect(vi.getTimerCount()).toBe(1);
  act(() => root.render(null));
  expect(vi.getTimerCount()).toBe(0);
});
