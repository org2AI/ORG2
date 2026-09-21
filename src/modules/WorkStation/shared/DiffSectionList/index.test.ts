// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DiffSectionList from ".";

vi.mock("../DiffFileSection", () => ({
  default: ({ file }: { file: { path: string } }) =>
    React.createElement(
      "div",
      { className: "sticky top-0", "data-diff-path": file.path },
      file.path
    ),
}));

vi.mock("./search/useReviewSearch", () => ({
  useReviewSearch: () => ({
    appliedQuery: "",
    card: null,
    match: null,
  }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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
      return this.hasAttribute("data-index") ? 44 : 200;
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

describe("DiffSectionList sticky headers", () => {
  it("keeps virtual row transforms from trapping file headers", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        React.createElement(DiffSectionList, {
          sections: [
            {
              key: "src/index.ts",
              file: {
                path: "src/index.ts",
                status: "modified",
                staged: false,
              },
            },
          ],
          viewMode: "unified",
          emptyTitle: "No changes",
        })
      );
    });

    const row = container.querySelector<HTMLElement>('[data-index="0"]');
    expect(row).toBeTruthy();
    expect(row?.style.top).toBe("0px");
    expect(row?.style.transform).toBe("");
    expect(row?.querySelector('[data-diff-path="src/index.ts"]')).toBeTruthy();

    act(() => root.unmount());
    container.remove();
  });
});
