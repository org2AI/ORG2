// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { useReviewViewport } from "./useReviewViewport";

let dispose: (() => Promise<void>) | undefined;
afterEach(async () => {
  await dispose?.();
  vi.unstubAllGlobals();
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = false;
});

it("records resize geometry without render churn and disconnects both observers on disposal", async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  let intersect!: (entries: { isIntersecting: boolean }[]) => void;
  let resize!: () => void;
  const disconnectIntersection = vi.fn();
  const disconnectResize = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: typeof intersect) {
        intersect = callback;
      }
      observe() {}
      disconnect = disconnectIntersection;
    }
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: typeof resize) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnectResize;
    }
  );
  const host = document.createElement("div");
  const element = document.createElement("section");
  const root = createRoot(host);
  let measured = 200;
  vi.spyOn(element, "getBoundingClientRect").mockImplementation(
    () => ({ height: measured }) as DOMRect
  );
  let renders = 0;
  function Probe() {
    renders++;
    const value = useReviewViewport(element, true);
    return React.createElement(
      "output",
      null,
      `${value.onScreen}:${value.retainedHeight}`
    );
  }
  dispose = async () => {
    await act(async () => root.unmount());
  };
  await act(async () => root.render(React.createElement(Probe)));
  await act(async () => intersect([{ isIntersecting: true }]));
  const before = renders;
  await act(async () => {
    for (let i = 0; i < 30; i++) {
      measured++;
      resize();
    }
  });
  expect(renders).toBe(before);
  await act(async () => intersect([{ isIntersecting: false }]));
  expect(host.textContent).toBe("false:230");
  await act(async () => root.render(null));
  expect(disconnectIntersection).toHaveBeenCalledTimes(1);
  expect(disconnectResize).toHaveBeenCalledTimes(1);
  const after = renders;
  await act(async () => {
    resize();
    intersect([{ isIntersecting: true }]);
  });
  expect(renders).toBe(after);
});
