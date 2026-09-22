// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { jsx } from "react/jsx-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_BUTTON_TOOLTIP_DELAY_MS } from "@src/config/tooltip";

import { TabBarTrailingIconButton } from "./TabBarTrailingIconButton";

vi.mock("@src/config/keyboard/useShortcutBindings", () => ({
  useShortcutKeys: (id: string) => (id ? "Ctrl+K" : ""),
}));

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
});

describe("TabBarTrailingIconButton tooltip ownership", () => {
  it.each([undefined, "search"])(
    "shows only the styled tooltip and keeps the accessible name (shortcut: %s)",
    (shortcutId) => {
      act(() =>
        root.render(
          jsx(TabBarTrailingIconButton, {
            title: "Search",
            shortcutId,
            children: "Icon",
          })
        )
      );
      const button = container.querySelector("button")!;
      expect(button.getAttribute("aria-label")).toBe("Search");
      expect(button.hasAttribute("title")).toBe(false);
      act(() => {
        button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      });
      act(() => vi.advanceTimersByTime(DEFAULT_BUTTON_TOOLTIP_DELAY_MS));
      expect(document.querySelectorAll(".native-tooltip")).toHaveLength(1);
      expect(document.querySelector(".native-tooltip")?.textContent).toContain(
        "Search"
      );
    }
  );

  it.each([true, false])(
    "respects native fallback opt-out when styled tooltip is disabled (%s)",
    (nativeTitle) => {
      act(() =>
        root.render(
          jsx(TabBarTrailingIconButton, {
            title: "Search",
            tooltipDisabled: true,
            nativeTitle,
            children: "Icon",
          })
        )
      );
      const button = container.querySelector("button")!;
      expect(button.getAttribute("title")).toBe(nativeTitle ? "Search" : null);
      expect(button.getAttribute("aria-label")).toBe("Search");
      act(() =>
        button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
      );
      act(() => vi.advanceTimersByTime(DEFAULT_BUTTON_TOOLTIP_DELAY_MS));
      expect(document.querySelector(".native-tooltip")).toBeNull();
    }
  );
});
