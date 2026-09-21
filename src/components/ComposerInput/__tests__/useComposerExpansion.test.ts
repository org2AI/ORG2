// @vitest-environment jsdom
import { act, createElement, useRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ComposerExpandToggle from "../ComposerExpandToggle";
import {
  COMPOSER_EXPANDED_CLASS,
  useComposerExpansion,
} from "../useComposerExpansion";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const resizeCallbacks: Array<() => void> = [];

/**
 * Stand-in for a composer: a capped scroller around the document host, plus
 * the toggle rendered outside it the way the toolbar does.
 */
function Harness({ enabled }: { enabled: boolean }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const expansion = useComposerExpansion(frameRef, enabled);
  return createElement(
    "div",
    // eslint-disable-next-line react-hooks/refs -- createElement is required because Vitest only includes `.test.ts`; this is a normal React ref prop.
    { ref: frameRef, className: "relative" },
    createElement(
      "div",
      {
        "data-testid": "scroller",
        className: `composer-input ${expansion.editorClassName}`,
      },
      createElement("div", {
        "data-testid": "host",
        className: "composer-input-content",
        contentEditable: true,
      })
    ),
    expansion.showToggle &&
      createElement(ComposerExpandToggle, {
        expanded: expansion.expanded,
        onToggle: expansion.toggle,
      })
  );
}

describe("useComposerExpansion", () => {
  let container: HTMLDivElement;
  let root: Root;
  let scrollHeight = 60;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resizeCallbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      }
    );
    scrollHeight = 60;
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
      () => scrollHeight
    );
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(140);
    // jsdom has no layout, so Range lacks getBoundingClientRect entirely.
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(),
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    resizeCallbacks.length = 0;
    Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const render = (enabled = true) =>
    act(() => root.render(createElement(Harness, { enabled })));
  const query = (testId: string) =>
    container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  const toggle = () => query("composer-expand-toggle");
  const overflow = (height: number) => {
    scrollHeight = height;
    act(() => resizeCallbacks.forEach((callback) => callback()));
  };

  it("offers the toggle only once the document overflows the cap", () => {
    render();
    expect(toggle()).toBeNull();

    overflow(160);

    expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
    expect(query("scroller")?.className).not.toContain(COMPOSER_EXPANDED_CLASS);
  });

  it("expands in place and keeps the toggle while the tall box fits", () => {
    render();
    overflow(300);

    act(() => toggle()?.click());

    expect(query("scroller")?.className).toContain(COMPOSER_EXPANDED_CLASS);
    expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(query("host"));

    // The expanded box now holds the whole document.
    overflow(100);
    expect(toggle()?.getAttribute("aria-expanded")).toBe("true");

    act(() => toggle()?.click());
    expect(query("scroller")?.className).not.toContain(COMPOSER_EXPANDED_CLASS);
    expect(toggle()).toBeNull();
  });

  it("collapses when the document is cleared, as after a send", async () => {
    render();
    overflow(300);
    act(() => toggle()?.click());
    expect(query("scroller")?.className).toContain(COMPOSER_EXPANDED_CLASS);

    scrollHeight = 60;
    await act(async () => {
      query("host")?.classList.add("is-empty");
      // MutationObserver callbacks run as microtasks.
      await Promise.resolve();
    });

    expect(query("scroller")?.className).not.toContain(COMPOSER_EXPANDED_CLASS);
    expect(toggle()).toBeNull();
  });

  it("never offers the toggle while disabled", () => {
    render(false);
    overflow(300);
    expect(toggle()).toBeNull();
    expect(resizeCallbacks).toHaveLength(0);
  });
});
