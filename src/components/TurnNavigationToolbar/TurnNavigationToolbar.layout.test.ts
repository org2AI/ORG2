// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import TurnNavigationToolbar, {
  type TurnNavigationToolbarProps,
} from "./TurnNavigationToolbar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function renderToolbar(overrides: Partial<TurnNavigationToolbarProps> = {}) {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    React.createElement(TurnNavigationToolbar, {
      ready: true,
      listOpen: false,
      sortAscending: false,
      onToggleList: vi.fn(),
      onToggleSort: vi.fn(),
      onCloseList: vi.fn(),
      currentLabel: "Round 100",
      currentTimeLabel: "17:17 ~ 20:18",
      currentIndex: 99,
      pageCount: 102,
      onPrevious: vi.fn(),
      onNext: vi.fn(),
      onLatest: vi.fn(),
      statusAnnotation: "Recent rounds only · Content truncated",
      ...overrides,
    })
  );
  return container;
}

describe("TurnNavigationToolbar layout", () => {
  it("keeps mobile metadata out of the nonshrinking controls group", () => {
    const container = renderToolbar({ variant: "mobile" });
    const nav = container.querySelector("nav")!;
    const info = nav.querySelector("[data-turn-navigation-info]")!;
    const controls = nav.querySelector("[data-turn-navigation-controls]")!;
    expect(info.querySelector("[data-turn-navigation-time]")?.textContent).toBe(
      "17:17 ~ 20:18"
    );
    expect(controls.querySelector("[data-turn-navigation-time]")).toBeNull();
    expect(controls.querySelectorAll("button")).toHaveLength(3);
    expect(
      nav.querySelector("[data-turn-navigation-status]")?.parentElement
    ).toBe(nav);
    expect(info.querySelector("[data-turn-navigation-status]")).toBeNull();
    expect(nav.classList.contains("turn-navigation-toolbar-mobile")).toBe(true);
  });

  it("preserves Desktop's inline timestamp and status layout by default", () => {
    const container = renderToolbar();
    const nav = container.querySelector("nav")!;
    const info = nav.querySelector("[data-turn-navigation-info]")!;
    const controls = nav.querySelector("[data-turn-navigation-controls]")!;
    expect(info.querySelector("[data-turn-navigation-status]")).not.toBeNull();
    expect(
      controls.querySelector("[data-turn-navigation-time]")?.textContent
    ).toBe("17:17 ~ 20:18");
    expect(nav.classList.contains("turn-navigation-toolbar-mobile")).toBe(
      false
    );
  });

  it("does not leave an empty mobile warning row after complete data arrives", () => {
    const container = renderToolbar({
      variant: "mobile",
      statusAnnotation: undefined,
    });
    expect(container.querySelector("[data-turn-navigation-status]")).toBeNull();
    expect(
      container.querySelector("[data-turn-navigation-time]")
    ).not.toBeNull();
  });

  it("preserves the loading gate without dropping the full round label", () => {
    const container = renderToolbar({ variant: "mobile", ready: false });
    const selector = container.querySelector<HTMLButtonElement>(
      '[data-testid="turn-pagination-current-round"]'
    )!;
    expect(selector.disabled).toBe(true);
    expect(selector.title).toBe("Round 100");
    expect(selector.textContent).toBe("Round 100");
    expect(container.querySelectorAll("button:disabled")).toHaveLength(4);
  });
});
