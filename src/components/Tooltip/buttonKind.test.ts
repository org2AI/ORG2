// @vitest-environment jsdom
import { type ComponentProps, act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Tooltip from ".";
import type { ButtonTooltipTiming } from "./useButtonTooltipTiming";

const timing = vi.hoisted<{ current: ButtonTooltipTiming }>(() => ({
  current: { enabled: true, delayMs: 500 },
}));

vi.mock("./useButtonTooltipTiming", () => ({
  useButtonTooltipTiming: () => timing.current,
}));

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  timing.current = { enabled: true, delayMs: 500 };
  Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT");
});

function renderAndHover(props: {
  kind?: "button" | "info";
  mouseEnterDelay?: number;
}): void {
  act(() => {
    root.render(
      createElement(
        Tooltip,
        { content: "Label", ...props } as ComponentProps<typeof Tooltip>,
        createElement("button", { type: "button" }, "trigger")
      )
    );
  });
  act(() => {
    container
      .querySelector("button")!
      .dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
}

const tooltipCount = () => document.querySelectorAll(".native-tooltip").length;

describe('Tooltip kind="button"', () => {
  it("uses the global delay and ignores the per-site mouseEnterDelay", () => {
    timing.current = { enabled: true, delayMs: 750 };
    renderAndHover({ kind: "button", mouseEnterDelay: 50 });

    act(() => vi.advanceTimersByTime(749));
    expect(tooltipCount()).toBe(0);
    act(() => vi.advanceTimersByTime(1));
    expect(tooltipCount()).toBe(1);
  });

  it("shows on the next tick when the delay is immediate", () => {
    timing.current = { enabled: true, delayMs: 0 };
    renderAndHover({ kind: "button" });

    act(() => vi.advanceTimersByTime(0));
    expect(tooltipCount()).toBe(1);
  });

  it("never shows when button tooltips are turned off", () => {
    timing.current = { enabled: false, delayMs: 0 };
    renderAndHover({ kind: "button" });

    act(() => vi.advanceTimersByTime(5000));
    expect(tooltipCount()).toBe(0);
  });

  it("leaves info tooltips on their own timing when button tooltips are off", () => {
    timing.current = { enabled: false, delayMs: 1000 };
    renderAndHover({ mouseEnterDelay: 100 });

    act(() => vi.advanceTimersByTime(100));
    expect(tooltipCount()).toBe(1);
  });
});
