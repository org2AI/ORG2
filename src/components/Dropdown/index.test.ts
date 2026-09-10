// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { activeOverlayCountAtom } from "@src/store/ui/overlayLayerAtom";

import Dropdown from ".";

describe("Dropdown", () => {
  let container: HTMLDivElement;
  let root: Root;
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  afterAll(() => {
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it.each([
    { label: "options", options: [{ value: "one", label: "One" }] },
    { label: "empty", options: [] },
    { label: "loading", options: [], loading: true },
    { label: "search", options: [], showSearch: true },
  ])(
    "provides a themed surface for $label without caller styling",
    (scenario) => {
      const props: React.ComponentProps<typeof Dropdown> = {
        ...scenario,
        defaultPopupVisible: true,
        children: React.createElement("button", null, "Open"),
      };
      const markup = renderToStaticMarkup(React.createElement(Dropdown, props));
      container.innerHTML = markup;
      const surface = container.querySelector(".bg-bg-2");
      expect(surface).not.toBeNull();
      for (const token of [
        "border",
        "border-border-2",
        "rounded-lg",
        "shadow-dropdown",
      ]) {
        expect(surface!.classList.contains(token)).toBe(true);
      }
    }
  );

  it("keeps the same surface node when callers supply panel classes in a portal", async () => {
    const props: React.ComponentProps<typeof Dropdown> = {
      defaultPopupVisible: true,
      options: [{ value: "one", label: "One" }],
      className: "bg-bg-2 border shadow-dropdown w-64",
      getPopupContainer: () => document.body,
      children: React.createElement("button", null, "Open"),
    };
    await act(async () => root.render(React.createElement(Dropdown, props)));
    const surfaces = document.body.querySelectorAll(".bg-bg-2");
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0].classList.contains("w-64")).toBe(true);
    expect(surfaces[0].querySelector('[role="listbox"]')).not.toBeNull();
  });

  it("leaves custom droplist surface ownership with the caller", () => {
    const props: React.ComponentProps<typeof Dropdown> = {
      defaultPopupVisible: true,
      droplist: React.createElement(
        "div",
        { className: "custom-panel" },
        "Menu"
      ),
      children: React.createElement("button", null, "Open"),
    };
    const markup = renderToStaticMarkup(React.createElement(Dropdown, props));
    expect(markup).toContain("custom-panel");
    expect(markup).not.toContain("bg-bg-2");
  });

  it("right-aligns the menu by default", () => {
    const props: React.ComponentProps<typeof Dropdown> = {
      defaultPopupVisible: true,
      droplist: React.createElement("div", null, "Menu"),
      children: React.createElement("button", { type: "button" }, "Open"),
    };
    const markup = renderToStaticMarkup(React.createElement(Dropdown, props));

    expect(markup).toContain("top-full right-0 mt-2");
    expect(markup).not.toContain("top-full left-0 mt-2");
  });

  it("styles a caller-supplied empty state like the built-in one", () => {
    const props: React.ComponentProps<typeof Dropdown> = {
      defaultPopupVisible: true,
      options: [],
      emptyContent: "No reviewers available",
      children: React.createElement("button", { type: "button" }, "Open"),
    };
    const markup = renderToStaticMarkup(React.createElement(Dropdown, props));

    // Custom empty content used to render raw, so it inherited the panel's
    // default type instead of the dropdown's own scale.
    expect(markup).toContain("No reviewers available");
    const emptyShell = markup.slice(
      0,
      markup.indexOf("No reviewers available")
    );
    expect(emptyShell).toContain("text-[13px]");
    expect(emptyShell).toContain("text-text-3");
  });

  it("registers a visible controlled menu as a webview-blocking overlay", async () => {
    const store = createStore();
    const renderDropdown = (popupVisible: boolean) => {
      const props: React.ComponentProps<typeof Dropdown> = {
        popupVisible,
        droplist: React.createElement("div", null, "Menu"),
        children: React.createElement("button", { type: "button" }, "Open"),
      };

      return React.createElement(
        Provider,
        { store },
        React.createElement(Dropdown, props)
      );
    };
    const renderVisibleState = async (popupVisible: boolean) => {
      await act(async () => {
        root.render(renderDropdown(popupVisible));
        await Promise.resolve();
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve())
        );
      });
    };

    await renderVisibleState(false);
    expect(store.get(activeOverlayCountAtom)).toBe(0);

    await renderVisibleState(true);
    expect(store.get(activeOverlayCountAtom)).toBe(1);

    await renderVisibleState(false);
    expect(store.get(activeOverlayCountAtom)).toBe(0);
  });

  it("keeps options-mode keyboard navigation working from a portaled search input", async () => {
    const props: React.ComponentProps<typeof Dropdown> = {
      defaultPopupVisible: true,
      showSearch: true,
      options: [
        {
          label: "One",
          value: "one",
          dataTestId: "dropdown-option-one",
        },
        {
          label: "Two",
          value: "two",
          dataTestId: "dropdown-option-two",
        },
      ],
      getPopupContainer: () => document.body,
      children: React.createElement("button", { type: "button" }, "Open"),
    };
    await act(async () => {
      root.render(React.createElement(Dropdown, props));
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });

    const searchInput =
      document.body.querySelector<HTMLInputElement>('input[type="text"]');
    expect(searchInput).not.toBeNull();
    act(() => searchInput?.focus());
    expect(document.activeElement).toBe(searchInput);

    act(() => {
      searchInput?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
      );
    });

    const secondOption = document.body.querySelector<HTMLElement>(
      '[data-testid="dropdown-option-two"]'
    );
    expect(secondOption?.classList.contains("bg-fill-2")).toBe(true);
  });
});
