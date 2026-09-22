// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHAT_LIVE_WIDTH_CSS_VAR, CHAT_WIDTH_CSS_VAR } from "../config";
import { useChatPanelResize } from "./useChatPanelResize";

const reactEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

function Harness() {
  const { panelRef, handleMouseDown } = useChatPanelResize({
    position: "right",
  });
  return createElement(
    "div",
    { "data-fullmode-chat-wrapper": "", "data-testid": "slot" },
    createElement("div", {
      "data-testid": "handle",
      onMouseDown: handleMouseDown,
    }),
    createElement("div", { ref: panelRef, "data-testid": "pane" })
  );
}

describe("useChatPanelResize", () => {
  let host: HTMLDivElement;
  let root: Root;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;
  let originalInnerWidth: number;

  const element = (testId: string) =>
    host.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!;
  const rootWidth = () =>
    document.documentElement.style.getPropertyValue(CHAT_WIDTH_CSS_VAR);
  const liveWidth = (testId: string) =>
    element(testId).style.getPropertyValue(CHAT_LIVE_WIDTH_CSS_VAR);
  const flushFrames = () => {
    const pending = Array.from(frames.values());
    frames.clear();
    for (const callback of pending) callback(performance.now());
  };
  const startDrag = (clientX: number) =>
    act(() => {
      element("handle").dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0, clientX })
      );
    });
  const moveTo = (clientX: number) =>
    act(() => {
      document.dispatchEvent(
        new MouseEvent("mousemove", { bubbles: true, clientX })
      );
    });

  beforeEach(() => {
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(10_000);
    frames = new Map();
    nextFrameId = 1;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.delete(id);
    });
    originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 2_000,
    });
    document.documentElement.style.setProperty(CHAT_WIDTH_CSS_VAR, "520px");

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(createElement(Harness)));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.documentElement.style.removeProperty(CHAT_WIDTH_CSS_VAR);
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalInnerWidth,
    });
    vi.unstubAllGlobals();
    vi.useRealTimers();
    reactEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("drags on the pane and its slot, leaving the inherited root width untouched until release", () => {
    startDrag(1_000);
    moveTo(900);
    act(flushFrames);

    expect(liveWidth("pane")).toBe("620px");
    expect(liveWidth("slot")).toBe("620px");
    expect(rootWidth()).toBe("520px");

    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    expect(rootWidth()).toBe("620px");
    expect(liveWidth("pane")).toBe("");
    expect(liveWidth("slot")).toBe("");
  });

  it("drops a queued frame when the window blurs mid-drag so no live override outlives the commit", () => {
    startDrag(1_000);
    moveTo(880);
    expect(frames.size).toBe(1);

    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    act(flushFrames);

    expect(rootWidth()).toBe("640px");
    expect(liveWidth("pane")).toBe("");
    expect(liveWidth("slot")).toBe("");
  });
});
