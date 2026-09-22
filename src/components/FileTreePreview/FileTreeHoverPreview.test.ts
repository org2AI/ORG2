// @vitest-environment jsdom
import { type ComponentProps, act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import FileTreeHoverPreview from "./FileTreeHoverPreview";

vi.mock("./index", () => ({
  default: ({ path }: { path: string }) =>
    createElement("div", { "data-testid": "file-tree-preview" }, path),
}));

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      createElement(
        FileTreeHoverPreview,
        {
          path: "src/components/FindCard/index.tsx",
        } as ComponentProps<typeof FileTreeHoverPreview>,
        createElement("button", null, "index.tsx")
      )
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT");
});

function hover(enter: boolean) {
  act(() => {
    container.querySelector("button")!.dispatchEvent(
      new MouseEvent(enter ? "mouseover" : "mouseout", {
        bubbles: true,
        relatedTarget: document.body,
      })
    );
  });
}

function advance(ms: number) {
  act(() => vi.advanceTimersByTime(ms));
}

function preview() {
  return document.querySelector('[data-testid="file-tree-preview"]');
}

describe("FileTreeHoverPreview delay", () => {
  it("mounts the path card only after 500 ms of continuous hover", () => {
    expect(vi.getTimerCount()).toBe(0);
    hover(true);
    advance(499);
    expect(preview()).toBeNull();
    advance(1);
    expect(preview()?.textContent).toBe("src/components/FindCard/index.tsx");
    expect(vi.getTimerCount()).toBe(0);
    hover(false);
    advance(150);
    expect(preview()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a brief hover and requires a fresh 500 ms on re-entry", () => {
    hover(true);
    advance(400);
    hover(false);
    advance(500);
    expect(preview()).toBeNull();
    hover(true);
    advance(499);
    expect(preview()).toBeNull();
    advance(1);
    expect(preview()).not.toBeNull();
  });

  it.each([false, true])(
    "clears pending timers on removal (open: %s)",
    (open) => {
      hover(true);
      if (open) {
        advance(500);
        hover(false);
      }
      act(() => root.render(null));
      expect(vi.getTimerCount()).toBe(0);
      advance(1000);
      expect(preview()).toBeNull();
    }
  );
});
