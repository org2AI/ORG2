// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import SplitViewLayout from "./SplitViewLayout";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("SplitViewLayout toggle_sidebar shortcut", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  beforeAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  });

  // The app-wide handler deliberately lets toggle_sidebar through while a
  // text field has focus. The split view must not treat that keystroke as
  // "collapse my list pane": there is no control to bring the list back.
  it("keeps the list pane when Cmd/Ctrl+B is pressed in a text field", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        createElement(SplitViewLayout, {
          listContent: createElement("input", { "data-testid": "search" }),
          mainContent: createElement("div", null, "Detail content"),
        })
      );
    });

    const input = host.querySelector<HTMLInputElement>(
      '[data-testid="search"]'
    )!;
    input.focus();
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
      const event = new KeyboardEvent("keydown", {
        key: "b",
        code: "KeyB",
        bubbles: true,
        cancelable: true,
        ...modifier,
      });
      act(() => {
        input.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(false);
    }

    expect(host.querySelector('[data-testid="search"]')).not.toBeNull();
    expect(host.querySelector('[role="separator"]')).not.toBeNull();
  });
});
