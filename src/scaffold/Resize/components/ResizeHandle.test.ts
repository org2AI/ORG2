// @vitest-environment jsdom
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { DEFAULT_BUTTON_TOOLTIP_DELAY_MS } from "@src/config/tooltip";

import { ResizeHandle } from "./ResizeHandle";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("ResizeHandle indicator", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement("div");
    container.style.overflow = "hidden";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  afterAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("centers the bright segment in an unclipped layout-boundary host", () => {
    const indicatorHost = document.createElement("div");
    document.body.appendChild(indicatorHost);
    act(() => {
      root.render(
        React.createElement(ResizeHandle, {
          axis: "x",
          indicatorHost,
          onMouseDown: () => undefined,
        })
      );
    });

    const handle = container.querySelector<HTMLElement>('[role="separator"]');
    expect(handle).not.toBeNull();

    const indicator = indicatorHost.querySelector<HTMLElement>(
      "[data-resize-handle-indicator]"
    );
    expect(indicator).not.toBeNull();
    expect(handle!.contains(indicator)).toBe(false);
    expect(indicator?.className).toContain("absolute");
    expect(indicator?.className).toContain("w-[4px]");
    expect(indicator?.className).toContain("left-1/2");
    expect(indicator?.className).toContain("-translate-x-1/2");
    expect(indicator?.className).not.toContain("fixed");
    indicatorHost.remove();
  });

  it("hides the bright segment immediately while dragging", () => {
    const indicatorHost = document.createElement("div");
    document.body.appendChild(indicatorHost);
    act(() => {
      root.render(
        React.createElement(ResizeHandle, {
          axis: "x",
          indicatorHost,
          isResizing: true,
          onMouseDown: () => undefined,
        })
      );
    });

    const indicator = indicatorHost.querySelector<HTMLElement>(
      "[data-resize-handle-indicator]"
    );
    expect(indicator).not.toBeNull();
    expect(indicator?.style.opacity).toBe("0");
    expect(indicator?.style.transitionDuration).toBe("0ms");
    indicatorHost.remove();
  });

  it("shows the contextual shortcut only after the button-tooltip delay", () => {
    vi.useFakeTimers();
    act(() => {
      root.render(
        React.createElement(ResizeHandle, {
          axis: "x",
          onMouseDown: () => undefined,
          tooltipLabel: "Hide Sidebar",
          tooltipShortcut: "Cmd+B",
        })
      );
    });

    const handle = container.querySelector<HTMLElement>('[role="separator"]');
    expect(handle).not.toBeNull();

    act(() => {
      handle!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      vi.advanceTimersByTime(DEFAULT_BUTTON_TOOLTIP_DELAY_MS - 1);
    });
    expect(document.body.textContent).not.toContain("Hide Sidebar");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(
      document.body.querySelector(".native-tooltip-content-inner")?.textContent
    ).toContain("Hide Sidebar");
  });

  it("leaves the plain hint inert so it cannot swallow pointer events", () => {
    vi.useFakeTimers();
    act(() => {
      root.render(
        React.createElement(ResizeHandle, {
          axis: "x",
          onMouseDown: () => undefined,
          tooltipLabel: "Hide Sidebar",
        })
      );
    });

    const handle = container.querySelector<HTMLElement>('[role="separator"]');
    act(() => {
      handle!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      vi.advanceTimersByTime(DEFAULT_BUTTON_TOOLTIP_DELAY_MS);
    });

    expect(
      document.body.querySelector(".native-tooltip")?.className
    ).not.toContain("native-tooltip-interactive");
  });

  it("makes the hint a reachable popover when it hosts controls", () => {
    vi.useFakeTimers();
    act(() => {
      root.render(
        React.createElement(ResizeHandle, {
          axis: "x",
          onMouseDown: () => undefined,
          tooltipLabel: "Hide Sidebar",
          renderTooltipExtra: (close: () => void) =>
            React.createElement(
              "button",
              { onClick: close, type: "button" },
              "Half"
            ),
        })
      );
    });

    const handle = container.querySelector<HTMLElement>('[role="separator"]');
    act(() => {
      handle!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      vi.advanceTimersByTime(DEFAULT_BUTTON_TOOLTIP_DELAY_MS);
    });

    const panel = document.body.querySelector<HTMLElement>(".native-tooltip");
    expect(panel?.className).toContain("native-tooltip-interactive");
    const inner = document.body.querySelector(".native-tooltip-content-inner");
    expect(inner?.textContent).toContain("Hide Sidebar");
    expect(inner?.textContent).toContain("Half");

    // Acting on a hosted control slides the divider away from the cursor, so
    // the popover must dismiss itself rather than linger beside a moved edge.
    const pick = inner?.querySelector("button");
    act(() => {
      pick?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.body.querySelector(".native-tooltip")).toBeNull();
  });
});
