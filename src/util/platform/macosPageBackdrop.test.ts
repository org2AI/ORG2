// @vitest-environment jsdom
/**
 * The native page backdrop is revealed under the page whenever the window
 * resizes, so what the frontend sends must be exactly the opaque page region:
 * a stale inset would put the opaque layer under the translucent sidebar, and
 * a translucent colour would show through the surface it mirrors. These tests
 * pin the measurement and the push contract; the native layer is exercised
 * against an AppKit harness.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  registerMacosPageBackdropSurface,
  resetMacosPageBackdropForTests,
  resolvePageBackdrop,
  settleMacosPageBackdropForTests,
  syncMacosPageBackdrop,
} from "./macosPageBackdrop";

const { invoke, hasMacWindowChrome } = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>(),
  hasMacWindowChrome: vi.fn(() => true),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@src/config/windowChromeRadius", () => ({ hasMacWindowChrome }));

const VIEWPORT = { width: 1200, height: 800 };

function rect(left: number, top: number, right: number, bottom: number) {
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

describe("resolvePageBackdrop", () => {
  it("measures the insets from each viewport edge", () => {
    expect(
      resolvePageBackdrop(rect(240, 0, 1200, 800), VIEWPORT, "rgb(20, 20, 20)")
    ).toEqual({
      insets: [0, 0, 0, 240],
      color: [20 / 255, 20 / 255, 20 / 255, 1],
    });
    expect(
      resolvePageBackdrop(rect(8, 36, 1190, 780), VIEWPORT, "color(srgb 1 1 1)")
        ?.insets
    ).toEqual([36, 10, 20, 8]);
  });

  it("clamps a surface that overhangs the viewport to zero insets", () => {
    expect(
      resolvePageBackdrop(rect(-4, -2, 1210, 805), VIEWPORT, "rgb(0, 0, 0)")
        ?.insets
    ).toEqual([0, 0, 0, 0]);
  });

  it("does not mirror a translucent or unreadable surface", () => {
    const page = rect(240, 0, 1200, 800);
    expect(
      resolvePageBackdrop(page, VIEWPORT, "rgba(255, 255, 255, 0.85)")
    ).toBeNull();
    expect(resolvePageBackdrop(page, VIEWPORT, "transparent")).toBeNull();
    expect(
      resolvePageBackdrop(page, VIEWPORT, "color(display-p3 1 1 1)")
    ).toBeNull();
  });

  it("does not mirror a surface without area", () => {
    expect(
      resolvePageBackdrop(rect(0, 0, 0, 0), VIEWPORT, "rgb(20, 20, 20)")
    ).toBeNull();
  });
});

describe("registerMacosPageBackdropSurface", () => {
  let observerCallbacks: Array<() => void>;
  let observed: Element[];

  class FakeResizeObserver {
    constructor(callback: () => void) {
      observerCallbacks.push(callback);
    }
    observe(element: Element) {
      observed.push(element);
    }
    unobserve(element: Element) {
      observed = observed.filter((entry) => entry !== element);
    }
    disconnect() {
      observed = [];
    }
  }

  function notifyResize() {
    for (const callback of observerCallbacks) callback();
  }

  function surface(bounds: ReturnType<typeof rect>, color: string) {
    const element = document.createElement("div");
    element.style.backgroundColor = color;
    element.getBoundingClientRect = () => bounds as DOMRect;
    document.body.appendChild(element);
    return element;
  }

  /** Re-measure, as a theme change does, and wait for the push to land. */
  async function sync() {
    syncMacosPageBackdrop();
    await settleMacosPageBackdropForTests();
  }

  function lastPush() {
    return invoke.mock.calls.at(-1)?.[1];
  }

  beforeEach(() => {
    resetMacosPageBackdropForTests();
    observerCallbacks = [];
    observed = [];
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    hasMacWindowChrome.mockReturnValue(true);
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    vi.stubGlobal("innerWidth", VIEWPORT.width);
    vi.stubGlobal("innerHeight", VIEWPORT.height);
  });

  afterEach(() => {
    resetMacosPageBackdropForTests();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("sends the surface once layout reports it, then only on change", async () => {
    let bounds = rect(240, 0, 1200, 800);
    const page = surface(bounds, "rgb(20, 20, 20)");
    page.getBoundingClientRect = () => bounds as DOMRect;

    registerMacosPageBackdropSurface(page);
    expect(observed).toEqual([page]);
    notifyResize();
    await sync();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toBe("set_window_page_backdrop");
    expect(lastPush()).toEqual({
      insets: [0, 0, 0, 240],
      color: [20 / 255, 20 / 255, 20 / 255, 1],
    });

    // A window resize changes the surface's size but not its insets.
    bounds = rect(240, 0, 1400, 900);
    vi.stubGlobal("innerWidth", 1400);
    vi.stubGlobal("innerHeight", 900);
    notifyResize();
    await sync();
    expect(invoke).toHaveBeenCalledTimes(1);

    // The sidebar collapsing moves the page's leading edge.
    bounds = rect(0, 0, 1400, 900);
    notifyResize();
    await sync();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(lastPush()).toMatchObject({ insets: [0, 0, 0, 0] });
  });

  it("re-reads the colour when a theme change recolours the surface", async () => {
    const page = surface(rect(240, 0, 1200, 800), "rgb(20, 20, 20)");
    registerMacosPageBackdropSurface(page);
    notifyResize();
    await sync();

    page.style.backgroundColor = "rgb(255, 255, 255)";
    await sync();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(lastPush()).toMatchObject({ color: [1, 1, 1, 1] });
  });

  it("removes the native layer when the surface goes translucent or unmounts", async () => {
    const page = surface(rect(240, 0, 1200, 800), "rgb(20, 20, 20)");
    const unregister = registerMacosPageBackdropSurface(page);
    notifyResize();
    await sync();

    page.style.backgroundColor = "rgba(20, 20, 20, 0.5)";
    await sync();
    expect(lastPush()).toEqual({ insets: null, color: null });

    page.style.backgroundColor = "rgb(20, 20, 20)";
    await sync();
    unregister();
    await sync();

    expect(lastPush()).toEqual({ insets: null, color: null });
    expect(observed).toEqual([]);
  });

  it("follows the latest surface with area and falls back to an earlier one", async () => {
    const main = surface(rect(240, 0, 1200, 800), "rgb(20, 20, 20)");
    const settings = surface(rect(0, 0, 1200, 800), "rgb(255, 255, 255)");
    registerMacosPageBackdropSurface(main);
    const unregisterSettings = registerMacosPageBackdropSurface(settings);
    notifyResize();
    await sync();
    expect(lastPush()).toMatchObject({ insets: [0, 0, 0, 0] });

    settings.getBoundingClientRect = () => rect(0, 0, 0, 0) as DOMRect;
    notifyResize();
    await sync();
    expect(lastPush()).toMatchObject({ insets: [0, 0, 0, 240] });

    unregisterSettings();
    await sync();
    expect(lastPush()).toMatchObject({ insets: [0, 0, 0, 240] });
  });

  it("coalesces changes made while a push is in flight into the final state", async () => {
    let bounds = rect(240, 0, 1200, 800);
    const page = surface(bounds, "rgb(20, 20, 20)");
    page.getBoundingClientRect = () => bounds as DOMRect;
    let release: () => void = () => {};
    invoke.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );

    registerMacosPageBackdropSurface(page);
    notifyResize();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    for (const left of [260, 280, 300]) {
      bounds = rect(left, 0, 1200, 800);
      notifyResize();
    }
    release();
    await sync();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(lastPush()).toMatchObject({ insets: [0, 0, 0, 300] });
  });

  it("sends again after a failed push", async () => {
    const page = surface(rect(240, 0, 1200, 800), "rgb(20, 20, 20)");
    invoke.mockRejectedValueOnce(new Error("window closing"));

    registerMacosPageBackdropSurface(page);
    notifyResize();
    await sync();
    await sync();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(lastPush()).toMatchObject({ insets: [0, 0, 0, 240] });
  });

  it("clears a layer left by a previous page load on the first sync", async () => {
    await sync();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(lastPush()).toEqual({ insets: null, color: null });
  });

  it("is a no-op outside a macOS window", async () => {
    hasMacWindowChrome.mockReturnValue(false);
    const page = surface(rect(240, 0, 1200, 800), "rgb(20, 20, 20)");

    registerMacosPageBackdropSurface(page)();
    await sync();

    expect(observed).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });
});
