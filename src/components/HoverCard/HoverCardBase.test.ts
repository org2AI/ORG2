// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { jsx } from "react/jsx-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import HoverCardBase from "./HoverCardBase";
import { dismissHoverCard } from "./singletonStore";

describe("HoverCardBase action dismissal", () => {
  let container: HTMLDivElement;
  let root: Root;
  const action = vi.fn();
  const capture = vi.fn();
  const rowClick = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      }
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
      root.render(
        jsx(HoverCardBase, {
          cardId: "session",
          position: "right-start",
          mouseEnterDelay: 1000,
          renderContent: () => "Session details",
          children: createElement(
            "div",
            {
              onClick: rowClick,
              onClickCapture: capture,
              onContextMenuCapture: capture,
            },
            createElement(
              "button",
              {
                onClick: (event) => {
                  event.stopPropagation();
                  action();
                },
                onContextMenu: (event) => {
                  event.stopPropagation();
                  action();
                },
              },
              "More"
            )
          ),
        })
      )
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    dismissHoverCard();
    container.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each(["click", "contextmenu"])(
    "%s dismisses visible and pending cards despite stopped bubbling",
    (eventType) => {
      const row = container.firstElementChild!;
      const button = container.querySelector("button")!;
      for (const delay of [1000, 100]) {
        act(() =>
          row.dispatchEvent(
            new MouseEvent("mouseover", {
              bubbles: true,
              relatedTarget: document.body,
            })
          )
        );
        act(() => vi.advanceTimersByTime(delay));
        expect(document.querySelectorAll("[data-hover-card]")).toHaveLength(
          delay === 1000 ? 1 : 0
        );
        act(() =>
          button.dispatchEvent(new MouseEvent(eventType, { bubbles: true }))
        );
        expect(document.querySelector("[data-hover-card]")).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
        act(() => vi.advanceTimersByTime(2000));
        expect(document.querySelector("[data-hover-card]")).toBeNull();
        act(() =>
          row.dispatchEvent(
            new MouseEvent("mouseout", {
              bubbles: true,
              relatedTarget: document.body,
            })
          )
        );
      }
      expect(action).toHaveBeenCalledTimes(2);
      expect(capture).toHaveBeenCalledTimes(2);
      expect(rowClick).not.toHaveBeenCalled();
    }
  );
});
