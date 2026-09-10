// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { useStrokeDraw } from "./useStrokeDraw";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("stops drawing and cancels delayed shape mutations on hide and unmount", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("SVGGeometryElement", SVGElement);
  vi.useFakeTimers();
  let hidden = false;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
    hidden ? "hidden" : "visible"
  );
  const measure = vi.fn(() => 10);
  Object.defineProperty(SVGElement.prototype, "getTotalLength", {
    configurable: true,
    value: measure,
  });
  const host = document.createElement("div");
  const root = createRoot(host);
  function Probe() {
    const ref = useStrokeDraw(true);
    return createElement(
      "div",
      { ref },
      createElement("svg", null, createElement("path"))
    );
  }
  try {
    await act(async () => root.render(createElement(Probe)));
    expect(measure).toHaveBeenCalled();
    await act(async () => {
      hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const measurements = measure.mock.calls.length;
    expect(vi.getTimerCount()).toBe(0);
    expect(host.querySelector("path")?.hasAttribute("stroke-dasharray")).toBe(
      false
    );
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(measure).toHaveBeenCalledTimes(measurements);
    await act(async () => {
      hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(measure).toHaveBeenCalledTimes(measurements + 1);
  } finally {
    await act(async () => root.unmount());
    Reflect.deleteProperty(SVGElement.prototype, "getTotalLength");
  }
  expect(vi.getTimerCount()).toBe(0);
});
