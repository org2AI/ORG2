// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { activeOverlayCountAtom } from "@src/store/ui/overlayLayerAtom";
import { useTestTranslation } from "@src/test/i18nTestTranslate";
import { buildVariantEditOptions } from "@src/util/variantEditOptions";

import ModelPropertiesDropdown from ".";

vi.mock("react-i18next", () => ({
  useTranslation: (...args: Parameters<typeof useTestTranslation>) =>
    useTestTranslation(...args),
}));

const MODELS = ["low", "medium", "high", "xhigh", "max", "ultra"].flatMap(
  (effort) => [`gpt-5.6-sol-${effort}`, `gpt-5.6-sol-${effort}-fast`]
);

describe("ModelPropertiesDropdown immediate changes", () => {
  let container: HTMLDivElement;
  let root: Root;
  let store: ReturnType<typeof createStore>;
  const save = vi.fn();
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterAll(() => {
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });
  beforeEach(() => {
    vi.useFakeTimers();
    save.mockClear();
    store = createStore();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  function render(value: string, models = MODELS, confirmChanges = false) {
    const options = buildVariantEditOptions(models);
    act(() =>
      root.render(
        React.createElement(
          Provider,
          { store },
          React.createElement(ModelPropertiesDropdown, {
            value,
            variantOptions: options,
            confirmChanges,
            onChange: (modelId) => {
              save(modelId);
              render(modelId, models, confirmChanges);
            },
            renderTrigger: ({ ref, onClick, ariaExpanded }) =>
              React.createElement(
                "button",
                {
                  ref,
                  onClick,
                  "aria-expanded": ariaExpanded,
                  "data-testid": "trigger",
                },
                value
              ),
          })
        )
      )
    );
  }
  function trigger() {
    return container.querySelector<HTMLButtonElement>("button")!;
  }
  function open() {
    act(() => trigger().click());
    act(() => vi.advanceTimersByTime(32));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  }
  function range() {
    const input = document.querySelector<HTMLInputElement>(
      'input[type="range"]'
    );
    if (!input) throw new Error("Effort range is missing");
    return input;
  }
  function changeRange(value: string) {
    const input = range();
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  function effortTab(label: string) {
    const button = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[role="group"][aria-label="Effort"] button'
      )
    ).find((candidate) => candidate.textContent === label);
    if (!button) throw new Error(`${label} effort tab is missing`);
    return button;
  }
  function toggle(label: string) {
    const button = document.querySelector<HTMLButtonElement>(
      `[role="switch"][aria-label="${label}"]`
    );
    if (!button) throw new Error(`${label} switch is missing`);
    act(() => button.click());
  }
  function escape() {
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  }

  it("shows only concrete efforts for a bare family selection", () => {
    render("gpt-5.6-sol", ["gpt-5.6-sol", ...MODELS]);
    open();
    expect(range().max).toBe("5");
    expect(range().getAttribute("aria-valuetext")).toBe("Medium");
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toMatch(
      /Baseline|Default/
    );
    expect(save).not.toHaveBeenCalled();
    changeRange("0");
    expect(save).toHaveBeenLastCalledWith("gpt-5.6-sol-low");
  });

  it("shows Fast without a Default effort row for speed-only models", () => {
    render("composer-2.5", ["composer-2.5", "composer-2.5-fast"]);
    open();
    expect(document.querySelector('input[type="range"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toMatch(
      /Effort|Baseline|Default/
    );
    toggle("Fast");
    expect(save).toHaveBeenLastCalledWith("composer-2.5-fast");
  });

  it("saves valid effort and Fast changes without a footer, and stays open", () => {
    render("gpt-5.6-sol-high-fast");
    open();
    expect(save).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toMatch(
      /Cancel|Apply/
    );
    changeRange("5");
    expect(save).toHaveBeenLastCalledWith("gpt-5.6-sol-ultra-fast");
    expect(range().getAttribute("aria-valuetext")).toBe("Ultra");
    toggle("Fast");
    expect(save).toHaveBeenLastCalledWith("gpt-5.6-sol-ultra");
    expect(save).toHaveBeenCalledTimes(2);
    escape();
    expect(save).toHaveBeenCalledTimes(2);
    open();
    expect(range().getAttribute("aria-valuetext")).toBe("Ultra");
    expect(trigger().textContent).toBe("gpt-5.6-sol-ultra");
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("clears unsupported Fast before saving the next effort", () => {
    render("gpt-5.6-sol-high-fast", [
      "gpt-5.6-sol-high",
      "gpt-5.6-sol-high-fast",
      "gpt-5.6-sol-ultra",
    ]);
    open();
    act(() => effortTab("Ultra").click());
    expect(effortTab("Ultra").getAttribute("aria-pressed")).toBe("true");
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith("gpt-5.6-sol-ultra");
    expect(
      document.querySelector('[role="switch"][aria-label="Fast"]')
    ).toBeNull();
  });

  it("applies Thinking changes and ignores unavailable combinations", () => {
    const models = [
      "claude-opus-4-7-low",
      "claude-opus-4-7-high",
      "claude-opus-4-7-thinking-low",
    ];
    render("claude-opus-4-7-low", models);
    open();
    toggle("Thinking");
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith("claude-opus-4-7-thinking-low");
    act(() => effortTab("High").click());
    expect(save).toHaveBeenCalledTimes(1);
    expect(effortTab("Light").getAttribute("aria-pressed")).toBe("true");
    expect(effortTab("High").getAttribute("aria-pressed")).toBe("false");
  });

  it("uses refreshed values without writing and closes outside without reverting", () => {
    render("gpt-5.6-sol-max");
    open();
    expect(range().getAttribute("aria-valuetext")).toBe("Max");
    render("gpt-5.6-sol-medium");
    expect(range().getAttribute("aria-valuetext")).toBe("Medium");
    expect(save).not.toHaveBeenCalled();
    act(() =>
      document.body.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true })
      )
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(store.get(activeOverlayCountAtom)).toBe(0);
    open();
    expect(range().getAttribute("aria-valuetext")).toBe("Medium");
    expect(save).not.toHaveBeenCalled();
  });

  function clickTestId(id: string) {
    const button = document.querySelector<HTMLButtonElement>(
      `[data-testid="${id}"]`
    );
    if (!button) throw new Error(`${id} is missing`);
    act(() => button.click());
  }

  it("stages confirmed edits until Apply and separates groups with the menu rule", () => {
    render("gpt-5.6-sol-high", MODELS, true);
    open();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelectorAll('[role="separator"]')).toHaveLength(2);
    changeRange("5");
    toggle("Fast");
    expect(save).not.toHaveBeenCalled();
    expect(range().getAttribute("aria-valuetext")).toBe("Ultra");

    // Neither an outside press nor a host close request dismisses it.
    act(() =>
      document.body.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true })
      )
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent("model-properties-dropdown-close", {
          detail: { hoveredElement: document.body.firstElementChild },
        })
      );
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    clickTestId("model-properties-apply");
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith("gpt-5.6-sol-ultra-fast");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(store.get(activeOverlayCountAtom)).toBe(0);
  });

  it("drops confirmed edits on Cancel and Escape", () => {
    render("gpt-5.6-sol-high", MODELS, true);
    open();
    changeRange("5");
    clickTestId("model-properties-cancel");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    open();
    expect(range().getAttribute("aria-valuetext")).toBe("High");
    changeRange("0");
    escape();
    open();
    expect(range().getAttribute("aria-valuetext")).toBe("High");
    expect(save).not.toHaveBeenCalled();
    clickTestId("model-properties-apply");
    expect(save).not.toHaveBeenCalled();
  });

  it("leaves native range keys unhandled and saves once on key release", () => {
    render("gpt-5.6-sol-high");
    open();
    const down = new KeyboardEvent("keydown", {
      key: "ArrowUp",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      range().focus();
      range().dispatchEvent(down);
    });
    expect(down.defaultPrevented).toBe(false);
    changeRange("4");
    changeRange("5");
    expect(save).not.toHaveBeenCalled();
    act(() =>
      range().dispatchEvent(
        new KeyboardEvent("keyup", { key: "ArrowUp", bubbles: true })
      )
    );
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith("gpt-5.6-sol-ultra");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.activeElement).toBe(range());
  });
});
