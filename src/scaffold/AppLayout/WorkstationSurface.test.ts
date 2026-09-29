// @vitest-environment jsdom
import React, { act, useEffect, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WEBVIEW_FLOATING_LAYOUT_CHANGED_EVENT } from "@src/hooks/platform/useInlineWebview/webviewLayoutEvents";

import { WorkstationSurface } from "./WorkstationSurface";

const mounts = { started: 0, ended: 0 };
function StatefulContent() {
  const [draft, setDraft] = useState("unsaved draft");
  useEffect(() => {
    mounts.started += 1;
    return () => {
      mounts.ended += 1;
    };
  }, []);
  return React.createElement("textarea", {
    value: draft,
    onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
      setDraft(event.target.value),
  });
}

let root: Root;
let container: HTMLDivElement;
let resizeCallback: (() => void) | undefined;
let disconnect: ReturnType<typeof vi.fn>;
let viewport = { width: 1000, height: 800 };
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
const render = (floating: boolean, visible = true) =>
  act(() => {
    root.render(
      React.createElement(
        WorkstationSurface,
        {
          floating,
          visible,
          dockStyle: { flex: 1 },
          dockClassName: "dock",
          label: "Workstation",
          header: null,
        },
        React.createElement(StatefulContent)
      )
    );
  });
const surface = () =>
  container.querySelector<HTMLElement>("[data-workstation-surface]")!;
function flushFrames() {
  const pending = [...frames.values()];
  frames.clear();
  act(() => pending.forEach((callback) => callback(0)));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mounts.started = 0;
  mounts.ended = 0;
  viewport = { width: 1000, height: 800 };
  disconnect = vi.fn();
  frames = new Map();
  nextFrame = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resizeCallback = callback;
      }
      observe() {}
      disconnect = disconnect;
    }
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const isSurface = this.hasAttribute("data-workstation-surface");
      const width = isSurface
        ? Number.parseFloat(this.style.width) || 700
        : viewport.width;
      const height = isSurface
        ? Number.parseFloat(this.style.height) || 500
        : viewport.height;
      const x = isSurface ? Number.parseFloat(this.style.left) || 100 : 0;
      const y = isSurface ? Number.parseFloat(this.style.top) || 100 : 0;
      return {
        x,
        y,
        left: x,
        top: y,
        width,
        height,
        right: x + width,
        bottom: y + height,
        toJSON() {},
      };
    }
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

describe("WorkstationSurface stable owner", () => {
  it("retains the exact content and draft through float, hide, dock and reopen", () => {
    render(false);
    const content = container.querySelector("textarea");
    const host = surface();
    for (const [floating, visible] of [
      [true, true],
      [true, false],
      [true, true],
      [false, true],
      [true, true],
    ]) {
      render(floating!, visible!);
      expect(surface()).toBe(host);
      expect(container.querySelector("textarea")).toBe(content);
      expect(content?.value).toBe("unsaved draft");
      expect(mounts).toEqual({ started: 1, ended: 0 });
    }
  });

  it("clears floating geometry when docked and restores it on reopening", () => {
    render(true);
    surface().style.width = "620px";
    surface().style.left = "180px";
    render(false);
    expect(surface().style.width).toBe("");
    expect(surface().dataset.fwPinned).toBeUndefined();
    render(true);
    expect(surface().style.width).toBe("620px");
    expect(surface().style.left).toBe("180px");
  });

  it("makes hidden content inert and removes drag/resize resources", () => {
    render(true);
    expect(container.querySelectorAll("[data-no-window-drag]")).toHaveLength(8);
    render(true, false);
    expect(
      container.querySelector("[data-workbench-surface]")?.hasAttribute("inert")
    ).toBe(true);
    expect(container.querySelectorAll("[data-no-window-drag]")).toHaveLength(0);
    expect(disconnect).toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it("refits to small bounds and coalesces native position notifications", async () => {
    const notified = vi.fn();
    window.addEventListener(WEBVIEW_FLOATING_LAYOUT_CHANGED_EVENT, notified);
    render(true);
    flushFrames();
    notified.mockClear();
    surface().style.left = "250px";
    surface().style.top = "200px";
    await act(async () => {
      await Promise.resolve();
    });
    expect(frames.size).toBe(1);
    flushFrames();
    expect(notified).toHaveBeenCalledTimes(1);
    viewport = { width: 300, height: 200 };
    act(() => resizeCallback?.());
    expect(Number.parseFloat(surface().style.width)).toBeLessThanOrEqual(300);
    expect(Number.parseFloat(surface().style.height)).toBeLessThanOrEqual(200);
    window.removeEventListener(WEBVIEW_FLOATING_LAYOUT_CHANGED_EVENT, notified);
  });
});
