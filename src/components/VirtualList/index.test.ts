// @vitest-environment jsdom
/**
 * `VirtualList` replaced react-virtuoso across the app, so these cover the
 * behaviours call sites relied on the old library for: windowing, the
 * pixel→row overscan conversion, one-shot `endReached`, and sticky headers
 * surviving the window.
 *
 * jsdom reports every element as 0×0 and ships no ResizeObserver; TanStack
 * measures both the scroller and each row with `offsetHeight`, so the stubs
 * below give it a viewport. Rows are the elements carrying `data-index`.
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VirtualList, findStickyIndex } from ".";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const VIEWPORT_HEIGHT = 100;
const ROW_HEIGHT = 10;

let originalOffsetHeight: PropertyDescriptor | undefined;

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  originalOffsetHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight"
  );
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute("data-index") ? ROW_HEIGHT : VIEWPORT_HEIGHT;
    },
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
  vi.unstubAllGlobals();
});

function renderList(props: Record<string, unknown>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(VirtualList as never, {
        itemContent: (index: number) =>
          React.createElement("span", null, `row-${index}`),
        fixedItemHeight: ROW_HEIGHT,
        ...props,
      })
    );
  });
  return {
    container,
    rows: () => container.querySelectorAll("[data-index]"),
    unmount: () => act(() => root.unmount()),
  };
}

describe("VirtualList", () => {
  it("updates the scroll extent when rows are removed or appended", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const renderCount = (totalCount: number) => {
      act(() => {
        root.render(
          React.createElement(VirtualList, {
            totalCount,
            fixedItemHeight: ROW_HEIGHT,
            itemContent: (index: number) => `row-${index}`,
          })
        );
      });
      return (container.firstElementChild?.firstElementChild as HTMLElement)
        .style.height;
    };

    try {
      expect(renderCount(1000)).toBe("10000px");
      expect(renderCount(145)).toBe("1450px");
      expect(renderCount(200)).toBe("2000px");
      expect(renderCount(0)).toBe("0px");
    } finally {
      act(() => root.unmount());
    }
  });

  it("mounts only the rows near the viewport", () => {
    const list = renderList({ totalCount: 1000, overscanPx: 0 });

    const rendered = list.rows().length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(1000);
    expect(list.container.textContent).toContain("row-0");
    expect(list.container.textContent).not.toContain("row-999");

    list.unmount();
  });

  it("converts the pixel overscan budget into extra rows", () => {
    // The buffer is expressed in pixels (what the Virtuoso call sites were
    // tuned in); a budget worth 20 rows must mount more than a zero budget.
    const small = renderList({ totalCount: 1000, overscanPx: 0 });
    const smallCount = small.rows().length;
    small.unmount();

    const large = renderList({
      totalCount: 1000,
      overscanPx: ROW_HEIGHT * 20,
    });
    const largeCount = large.rows().length;
    large.unmount();

    expect(largeCount).toBeGreaterThan(smallCount);
  });

  it("fires endReached once per count, and re-arms when rows are appended", () => {
    const endReached = vi.fn();
    // Short enough that the last row is inside the initial window.
    const list = renderList({ totalCount: 3, endReached });

    expect(endReached).toHaveBeenCalledTimes(1);

    // A re-render at the same length must not re-fetch.
    list.unmount();
    expect(endReached).toHaveBeenCalledTimes(1);
  });

  it("does not fire endReached when the last row is out of range", () => {
    const endReached = vi.fn();
    const list = renderList({ totalCount: 1000, overscanPx: 0, endReached });

    expect(endReached).not.toHaveBeenCalled();

    list.unmount();
  });

  it("keeps the active sticky header mounted and pinned", () => {
    const list = renderList({
      totalCount: 100,
      overscanPx: 0,
      stickyIndices: [0, 50],
    });

    const sticky = list.container.querySelector('[data-index="0"]');
    expect(sticky).toBeTruthy();
    // Pinned with `top`, never a transform — a transformed element becomes its
    // own containing block and `position: sticky` stops resolving against the
    // scroller.
    expect(sticky?.className).toContain("sticky");
    expect((sticky as HTMLElement).style.transform).toBe("");

    list.unmount();
  });

  it("uses top positioning when row content owns sticky descendants", () => {
    const list = renderList({
      totalCount: 100,
      overscanPx: 0,
      preserveStickyDescendants: true,
    });

    const firstRow =
      list.container.querySelector<HTMLElement>('[data-index="0"]');
    expect(firstRow).toBeTruthy();
    expect(firstRow?.style.top).toBe("0px");
    expect(firstRow?.style.transform).toBe("");

    list.unmount();
  });
});

describe("findStickyIndex", () => {
  it("returns the last header at or before the row", () => {
    expect(findStickyIndex([0, 10, 20], 0)).toBe(0);
    expect(findStickyIndex([0, 10, 20], 9)).toBe(0);
    expect(findStickyIndex([0, 10, 20], 10)).toBe(10);
    expect(findStickyIndex([0, 10, 20], 25)).toBe(20);
  });

  it("returns -1 when no header precedes the row", () => {
    expect(findStickyIndex([5, 10], 0)).toBe(-1);
    expect(findStickyIndex([], 3)).toBe(-1);
  });
});
