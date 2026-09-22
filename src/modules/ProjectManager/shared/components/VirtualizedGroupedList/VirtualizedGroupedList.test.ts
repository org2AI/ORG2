// @vitest-environment jsdom
/**
 * The grouped list windows rows through `@src/components/VirtualList`
 * (TanStack). jsdom reports every element as 0×0 and ships no ResizeObserver,
 * so a virtualizer left alone here measures a zero-height viewport and renders
 * nothing. The stubs below exist only to give it a viewport.
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import VirtualizedGroupedList, { type VirtualizedGroup } from ".";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const VIEWPORT_HEIGHT = 60;
const ROW_HEIGHT = 20;

let originalOffsetHeight: PropertyDescriptor | undefined;
let originalOffsetWidth: PropertyDescriptor | undefined;

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );

  // TanStack measures BOTH the scroll element and each row with `offsetHeight`
  // (virtual-core `elementRect` / default `measureElement`), which jsdom always
  // reports as 0. Rows are the elements carrying `data-index`; everything else
  // in the tree is the scroller, which needs the viewport height.
  originalOffsetHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight"
  );
  originalOffsetWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetWidth"
  );
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute("data-index") ? ROW_HEIGHT : VIEWPORT_HEIGHT;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get: () => 100,
  });
});

afterEach(() => {
  if (originalOffsetHeight) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetHeight",
      originalOffsetHeight
    );
  }
  if (originalOffsetWidth) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetWidth",
      originalOffsetWidth
    );
  }
  vi.unstubAllGlobals();
});

describe("VirtualizedGroupedList", () => {
  it("keeps collapsed headers interactive without mounting their rows", () => {
    const groups = [
      { key: "open", group: "Open group", items: ["item-a", "item-b"] },
      { key: "closed", group: "Closed group", items: ["item-d"] },
    ];

    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(
          VirtualizedGroupedList<VirtualizedGroup<string, string>>,
          {
            groups,
            defaultExpanded: (group) => group.key === "open",
            getItemKey: (value) => value,
            renderGroupHeader: (group, expanded, onExpandedChange) =>
              React.createElement(
                "button",
                { onClick: () => onExpandedChange(!expanded) },
                group
              ),
            renderItem: (value) => React.createElement("div", null, value),
          }
        )
      );
    });

    expect(container.textContent).toContain("Open group");
    expect(container.textContent).toContain("Closed group");
    expect(container.textContent).toContain("item-a");
    expect(container.textContent).not.toContain("item-d");

    const closedGroupButton = Array.from(
      container.querySelectorAll("button")
    ).find((button) => button.textContent === "Closed group");
    expect(closedGroupButton).toBeTruthy();
    act(() => closedGroupButton?.click());
    expect(container.textContent).toContain("item-d");

    act(() => root.unmount());
  });

  it("mounts only the viewport window for a large expanded group", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const items = Array.from({ length: 100 }, (_, index) => `row-${index}`);

    act(() => {
      root.render(
        React.createElement(
          VirtualizedGroupedList<VirtualizedGroup<string, string>>,
          {
            groups: [{ key: "all", group: "All", items }],
            defaultExpanded: () => true,
            getItemKey: (value) => value,
            renderGroupHeader: (group) =>
              React.createElement("h2", null, group),
            renderItem: (value) => React.createElement("div", null, value),
            testId: "grouped-list",
          }
        )
      );
    });

    expect(container.textContent).toContain("row-0");
    expect(container.textContent).not.toContain("row-99");
    expect(container.querySelectorAll("[data-index]").length).toBeLessThan(
      items.length
    );

    act(() => root.unmount());
  });
});
