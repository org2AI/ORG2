// @vitest-environment jsdom
import React, { act, useEffect, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WEBVIEW_LAYOUT_CHANGED_EVENT } from "@src/hooks/platform/useInlineWebview/webviewLayoutEvents";

import { WorkstationSurface } from "./WorkstationSurface";

vi.mock("@src/features/SessionSources/SessionSourcesContent", () => ({
  SessionSourcesContent: ({ sessionId }: { sessionId: string }) =>
    React.createElement("p", { "data-sources-owner": sessionId }, sessionId),
}));

vi.mock("@src/features/SubagentTrail/SubagentTrailContent", () => ({
  SubagentTrailContent: ({ surface }: { surface: { sessionId: string } }) =>
    React.createElement(
      "p",
      { "data-subagent-owner": surface.sessionId },
      surface.sessionId
    ),
}));

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
const render = (
  floating: boolean,
  visible = true,
  appearance: "station" | "trail" = "station",
  fullscreen = false,
  headerTitle?: React.ReactNode
) =>
  act(() => {
    root.render(
      React.createElement(
        WorkstationSurface,
        {
          floating,
          visible,
          appearance,
          fullscreen,
          headerTitle,
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
      constructor(private callback: () => void) {}
      observe(element: HTMLElement) {
        if (element.hasAttribute("data-workbench-surface"))
          resizeCallback = this.callback;
      }
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

  it.each(["station", "trail"] as const)(
    "refits %s to small bounds and coalesces native position notifications",
    async (appearance) => {
      const notified = vi.fn();
      window.addEventListener(WEBVIEW_LAYOUT_CHANGED_EVENT, notified);
      render(true, true, appearance);
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
      expect(Number.parseFloat(surface().style.height)).toBeLessThanOrEqual(
        200
      );
      window.removeEventListener(WEBVIEW_LAYOUT_CHANGED_EVENT, notified);
    }
  );
});

it("keeps independent remembered geometry for Station and temporary trail content", () => {
  render(true);
  const host = surface();
  host.style.width = "710px";
  host.style.left = "50px";
  render(true, true, "trail");
  expect(surface()).toBe(host);
  host.style.width = "520px";
  host.style.left = "100px";
  render(true);
  expect(host.style.width).toBe("710px");
  expect(host.style.left).toBe("50px");
  render(true, true, "trail");
  expect(host.style.width).toBe("520px");
  expect(host.style.left).toBe("100px");
});

it("fills the existing bounds in fullscreen and restores floating geometry without remounting", () => {
  render(true, true, "trail");
  const host = surface();
  const content = container.querySelector("textarea");
  host.style.width = "520px";
  host.style.height = "440px";
  host.style.left = "180px";
  host.style.top = "140px";
  const originalGeometry = host.style.cssText;

  render(true, true, "trail", true);
  expect(surface()).toBe(host);
  expect(container.querySelector("textarea")).toBe(content);
  expect(host.style.width).toBe("100%");
  expect(host.style.height).toBe("100%");
  expect(host.style.left).toBe("0px");
  expect(host.style.top).toBe("0px");
  expect(host.style.maxHeight).toBe("none");
  expect(host.hasAttribute("data-draggable-window")).toBe(false);
  expect(container.querySelectorAll("[data-no-window-drag]")).toHaveLength(0);

  viewport = { width: 1200, height: 900 };
  act(() => resizeCallback?.());
  expect(host.style.width).toBe("100%");
  expect(host.style.height).toBe("100%");
  render(true, true, "trail");
  expect(host.style.cssText).toBe(originalGeometry);
  expect(container.querySelectorAll("[data-no-window-drag]")).toHaveLength(8);
  expect(mounts).toEqual({ started: 1, ended: 0 });
});

it("never remembers fullscreen geometry across hide, appearance switches, or docking", () => {
  render(true, true, "station");
  surface().style.width = "710px";
  render(true, true, "trail");
  surface().style.width = "520px";
  render(true, true, "trail", true);
  render(true, false, "trail", true);
  expect(frames.size).toBe(0);
  expect(disconnect).toHaveBeenCalled();
  render(true, true, "trail", true);
  expect(surface().style.width).toBe("100%");
  render(true, true, "station");
  expect(surface().style.width).toBe("710px");
  render(true, true, "trail");
  expect(surface().style.width).toBe("520px");
  render(true, true, "trail", true);
  render(false, true, "trail", true);
  expect(surface().style.cssText).toBe("");
  expect(surface().hasAttribute("data-workstation-fullscreen")).toBe(false);
  render(true, true, "trail");
  expect(surface().style.width).toBe("520px");
  expect(mounts).toEqual({ started: 1, ended: 0 });
});

it("uses the normal initial trail geometry after starting in fullscreen", () => {
  render(true, true, "trail", true);
  expect(surface().style.width).toBe("100%");
  render(true, true, "trail");
  expect(surface().style.width).toBe("640px");
});

it("lets trail detail content replace the generic header label", () => {
  render(
    true,
    true,
    "trail",
    false,
    React.createElement("span", null, "Investigate source history")
  );
  expect(container.textContent).toContain("Investigate source history");
  expect(container.textContent).not.toContain("Workstation");
  expect(surface().getAttribute("aria-label")).toBe("Workstation");
  render(true, true, "trail");
  expect(container.textContent).toContain("Workstation");
});

function mockAnimations(reducedMotion = false) {
  const animations: { cancel: ReturnType<typeof vi.fn>; finish: () => void }[] =
    [];
  const animate = vi.fn(
    (_frames: Keyframe[], _options: KeyframeAnimationOptions) => {
      let finish!: () => void;
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const cancel = vi.fn();
      animations.push({ cancel, finish });
      return { cancel, finished };
    }
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: reducedMotion }))
  );
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: animate,
  });
  return { animate, animations };
}

describe("fullscreen motion", () => {
  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, "animate");
  });

  it("animates both directions without remounting or saving intermediate geometry", async () => {
    const { animate, animations } = mockAnimations();
    render(true, true, "trail");
    const host = surface();
    const content = container.querySelector("textarea");
    host.style.width = "520px";
    host.style.left = "180px";
    expect(animate).not.toHaveBeenCalled();
    render(true, true, "trail", true);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0]?.[0][0]).toMatchObject({ width: "520px" });
    expect(animate.mock.calls[0]?.[0][0]).not.toHaveProperty("transform");
    // Initial ResizeObserver delivery does not immediately cancel the motion.
    act(() => resizeCallback?.());
    expect(animations[0]!.cancel).not.toHaveBeenCalled();
    render(true, true, "trail");
    expect(animations[0]!.cancel).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledTimes(2);
    expect(host.style.width).toBe("520px");
    expect(host.style.left).toBe("180px");
    expect(surface()).toBe(host);
    expect(container.querySelector("textarea")).toBe(content);
    await act(async () => animations[0]!.finish());
    expect(animations[1]!.cancel).not.toHaveBeenCalled();
    await act(async () => animations[1]!.finish());
    expect(animations[1]!.cancel).toHaveBeenCalledTimes(1);
    expect(mounts).toEqual({ started: 1, ended: 0 });
  });

  it("cancels on pointer interaction, hiding and docking", () => {
    const { animate, animations } = mockAnimations();
    render(true, true, "trail");
    render(true, true, "trail", true);
    surface().dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(animations[0]!.cancel).toHaveBeenCalledTimes(1);
    render(true, true, "trail");
    render(true, false, "trail");
    expect(animations[1]!.cancel).toHaveBeenCalledTimes(1);
    render(true, true, "trail");
    expect(animate).toHaveBeenCalledTimes(2);
    render(true, true, "trail", true);
    render(false, true, "trail", true);
    expect(animations[2]!.cancel).toHaveBeenCalledTimes(1);
    expect(surface().style.width).toBe("");
  });

  it("settles when the document hides or bounds resize", () => {
    const { animations } = mockAnimations();
    render(true, true, "trail");
    render(true, true, "trail", true);
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(animations[0]!.cancel).toHaveBeenCalledTimes(1);
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    render(true, true, "trail");
    viewport = { width: 300, height: 200 };
    act(() => resizeCallback?.());
    expect(animations[1]!.cancel).toHaveBeenCalledTimes(1);
    expect(Number.parseFloat(surface().style.width)).toBeLessThanOrEqual(300);
  });

  it("skips reduced-motion and initially fullscreen surfaces", () => {
    const { animate } = mockAnimations(true);
    render(true, true, "trail", true);
    render(true, true, "trail");
    render(true, true, "trail", true);
    expect(animate).not.toHaveBeenCalled();
    expect(surface().style.width).toBe("100%");
  });

  it("does not animate initial fullscreen entry and releases motion on unmount", () => {
    const { animate, animations } = mockAnimations();
    render(true, true, "trail", true);
    expect(animate).not.toHaveBeenCalled();
    render(true, true, "trail");
    expect(animate).toHaveBeenCalledTimes(1);
    act(() => root.render(null));
    expect(animations[0]!.cancel).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });
});
