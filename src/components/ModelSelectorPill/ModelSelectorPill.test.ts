// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act, createRef, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@src/i18n/locales/en/common.json";
import sessionMessages from "@src/i18n/locales/en/sessions.json";
import { activeOverlayCountAtom } from "@src/store/ui/overlayLayerAtom";
import { buildVariantEditOptions } from "@src/util/variantEditOptions";

import ModelSelectorPill from ".";

const fixture = vi.hoisted(() => ({ models: [] as string[] }));
vi.mock("@src/components/ModelIcon", () => ({
  default: () => React.createElement("svg", { "data-icon": "model" }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      const leaf = key.split(".").at(-1)!;
      // `sessions:creator.*` is last so it never shadows a common-namespace
      // leaf; the menu reaches into it only for the switch-model label.
      const creator = (sessionMessages.creator as Record<string, unknown>)[
        leaf
      ];
      return (
        (messages.selectors.modelProperties as Record<string, string>)[leaf] ??
        (messages.actions as Record<string, string>)[leaf] ??
        (typeof creator === "string" ? creator : undefined) ??
        options?.defaultValue ??
        key
      );
    },
  }),
}));
vi.mock("@src/hooks/models", () => ({
  useModelAccountLookup: () => ({ accounts: [] }),
  resolveModelDisplaySelection: (selection: unknown) => selection,
  useModelPillLabel: (selection: unknown, defaultLabel: string) => ({
    label: selection ? "GPT 5.6 Sol" : defaultLabel,
    title: "GPT 5.6 Sol",
    displayParts: { label: "GPT 5.6 Sol" },
  }),
  useModelEffortSegment: ({
    selection,
    onApply,
  }: {
    selection: { model: string } | null;
    onApply?: (model: string) => void;
  }) => ({
    editable: fixture.models.length > 1 && Boolean(onApply),
    effortLabel: "Extra High",
    effortAriaLabel: "Effort",
    modelId: selection?.model,
    variantOptions: buildVariantEditOptions(fixture.models),
    handleApply: onApply,
  }),
}));

describe("ModelSelectorPill combined settings", () => {
  let container: HTMLDivElement;
  let root: Root;
  let store: ReturnType<typeof createStore>;
  const openModel = vi.fn();
  const apply = vi.fn();
  const anchor = createRef<HTMLButtonElement>();

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    fixture.models = ["low", "medium", "high", "xhigh", "max", "ultra"].flatMap(
      (level) => [`gpt-5.6-sol-${level}`, `gpt-5.6-sol-${level}-fast`]
    );
    openModel.mockClear();
    apply.mockClear();
    store = createStore();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    // jsdom queues selectionchange at zero delay when focus moves.
    act(() => vi.advanceTimersByTime(0));
    act(() => root.unmount());
    expect(store.get(activeOverlayCountAtom)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    container.remove();
    vi.useRealTimers();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("disables model and effort selection while explaining the prerequisite on focus", () => {
    act(() =>
      root.render(
        React.createElement(
          Provider,
          { store },
          React.createElement(ModelSelectorPill, {
            selection: null,
            defaultLabel: "Select model",
            active: false,
            onClick: openModel,
            onVariantApply: apply,
            disabled: true,
            disabledTooltip: "Select agent first",
            dataTestId: "model-pill",
          })
        )
      )
    );
    const button = element("model-pill") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Select model");
    act(() => button.click());
    expect(openModel).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-testid="chat-model-pill-effort"]')
    ).toBeNull();
    const explanation = container.querySelector<HTMLElement>(
      '[tabindex="0"][aria-disabled="true"]'
    )!;
    act(() => explanation.focus());
    act(() => vi.advanceTimersByTime(500));
    expect(document.body.textContent).toContain("Select agent first");
    act(() => explanation.blur());
    act(() => vi.runOnlyPendingTimers());
  });

  function render(
    initial = "gpt-5.6-sol-xhigh",
    editable = true,
    defaultAdvanced = false
  ) {
    function Harness() {
      const [model, setModel] = useState(initial);
      return React.createElement(ModelSelectorPill, {
        ref: anchor,
        selection: { model },
        defaultLabel: "Model",
        active: false,
        onClick: openModel,
        onVariantApply: editable
          ? (next) => {
              apply(next);
              setModel(next);
            }
          : undefined,
        settingsMenuDefaultAdvanced: defaultAdvanced,
        dataTestId: "model-pill",
        effortDataTestId: "effort-pill",
      });
    }
    act(() =>
      root.render(
        React.createElement(Provider, { store }, React.createElement(Harness))
      )
    );
  }
  function element(id: string) {
    const node = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!node) throw new Error(`Missing ${id}`);
    return node;
  }
  function click(id: string) {
    act(() => element(id).click());
  }
  function openCompact() {
    click("model-pill");
    act(() => vi.advanceTimersByTime(32));
  }
  function open() {
    openCompact();
  }
  function key(value: string) {
    act(() =>
      (document.activeElement ?? document).dispatchEvent(
        new KeyboardEvent("keydown", {
          key: value,
          bubbles: true,
          cancelable: true,
        })
      )
    );
    if (value === "Enter")
      act(() =>
        document.activeElement?.dispatchEvent(
          new KeyboardEvent("keyup", { key: value, bubbles: true })
        )
      );
  }

  it("renders one transparent pill and opens the model picker directly", () => {
    render();
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(element("model-pill").textContent).toBe("GPT 5.6 SolExtra High");
    expect(document.querySelector('[data-testid="effort-pill"]')).toBeNull();
    expect(element("model-pill").className).not.toMatch(/(?:^|\s)!?bg-/);
    expect(anchor.current).toBe(element("model-pill"));
    const leadingIcon = element("model-pill").querySelector(
      '[data-icon="model"]'
    )!;
    expect(leadingIcon.parentElement?.className).toContain(
      "group-hover/pill:hidden"
    );
    expect(
      leadingIcon.parentElement?.parentElement?.querySelector(
        '[data-icon="chevron-down"]'
      )
    ).not.toBeNull();
    openCompact();
    click("model-settings-switch-model");
    expect(openModel).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it("renders single-line, untitled submenus and marks the model row as a search", () => {
    render("gpt-5.6-sol-xhigh", true, true);
    open();

    const modelRow = element("model-settings-model");
    expect(modelRow.querySelector('[data-icon="search"]')).not.toBeNull();
    expect(modelRow.querySelectorAll("svg")).toHaveLength(1);

    click("model-settings-speed");
    const speedPanel = element("model-settings-speed-panel");
    // No leading title row, and each choice is just its label.
    expect(speedPanel.textContent).toBe("StandardFast");
    expect(speedPanel.firstElementChild).toBe(
      element("model-settings-speed-standard")
    );
    expect(speedPanel.getAttribute("aria-label")).toBe("Speed");

    click("model-settings-effort");
    const effortPanel = element("model-settings-effort-panel");
    expect(effortPanel.firstElementChild?.getAttribute("data-testid")).toBe(
      "model-settings-effort-low"
    );
    expect(element("model-settings-effort-max").textContent).toBe("Max");
    expect(element("model-settings-effort-ultra").textContent).toBe("Ultra");
    expect(effortPanel.getAttribute("aria-label")).toBe("Effort");

    key("Escape");
    key("Escape");
  });

  it("opens the compact slider by default and updates Fast without dismissing it", () => {
    render();
    openCompact();
    const panel = document.querySelector('[role="dialog"]')!;
    const slider = panel.querySelector('input[type="range"]')!;
    expect(slider.getAttribute("aria-valuetext")).toBe("Extra High");
    expect(panel.textContent).toBe("Switch model");
    // Tertiary: borderless and quieter than the outlined secondary default.
    const switchModel = element("model-settings-switch-model").className;
    expect(switchModel).toContain("border-0");
    expect(switchModel).toContain("bg-transparent");
    expect(switchModel).toContain("text-text-2");
    // The Fast toggle sits beside it at the same 28px height; both corners
    // must read as one control pair (Button renders an 8px radius).
    expect(element("model-settings-fast-toggle").className).toContain(
      "rounded-lg"
    );
    expect(document.querySelector('[role="menu"]')).toBeNull();
    const arrow = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    });
    act(() => slider.dispatchEvent(arrow));
    expect(arrow.defaultPrevented).toBe(false);
    click("model-settings-fast-toggle");
    expect(apply).toHaveBeenCalledWith("gpt-5.6-sol-xhigh-fast");
    expect(
      element("model-settings-fast-toggle").getAttribute("aria-pressed")
    ).toBe("true");
    expect(document.querySelector('[role="dialog"]')).toBe(panel);
    click("model-settings-switch-model");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(openModel).toHaveBeenCalledOnce();
    key("Escape");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(apply).toHaveBeenCalledOnce();
  });

  it("tracks the drag on the pill and highlights the level while open", () => {
    render();
    // Muted at rest so the model name leads.
    expect(
      element("model-pill").querySelector(".text-text-3")?.textContent
    ).toBe("Extra High");

    openCompact();
    // Open: the level is the value being edited, so it steps up to primary.
    expect(
      element("model-pill").querySelector(".text-primary-6")?.textContent
    ).toBe("Extra High");

    const slider = document
      .querySelector('[role="dialog"]')!
      .querySelector<HTMLInputElement>('input[type="range"]')!;
    const setRangeValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )!.set!;

    act(() => {
      slider.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      setRangeValue.call(slider, "0");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Mid-drag: the pill reports the level under the thumb, uncommitted.
    expect(element("model-pill").textContent).toBe("GPT 5.6 SolLight");
    expect(apply).not.toHaveBeenCalled();

    act(() => {
      slider.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    });
    expect(apply).toHaveBeenCalledWith("gpt-5.6-sol-low");
    expect(element("model-pill").textContent).toBe("GPT 5.6 SolLight");

    key("Escape");
  });

  it("applies Max, Ultra, and speed to the same pill immediately", () => {
    render("gpt-5.6-sol-xhigh", true, true);
    open();
    click("model-settings-effort");
    click("model-settings-effort-max");
    expect(apply).toHaveBeenLastCalledWith("gpt-5.6-sol-max");
    expect(element("model-pill").textContent).toContain("Max");
    click("model-settings-effort-ultra");
    expect(apply).toHaveBeenLastCalledWith("gpt-5.6-sol-ultra");
    expect(element("model-pill").textContent).toContain("Ultra");
    expect(
      element("model-pill").querySelector(".text-purple-6")
    ).not.toBeNull();
    click("model-settings-speed");
    click("model-settings-speed-fast");
    expect(apply).toHaveBeenLastCalledWith("gpt-5.6-sol-ultra-fast");
    expect(
      element("model-pill").querySelector('[data-icon="fast"]')
    ).not.toBeNull();
    expect(
      element("model-settings-speed-fast").getAttribute("aria-checked")
    ).toBe("true");
    click("model-settings-speed-fast");
    expect(apply).toHaveBeenCalledTimes(3);
    key("Escape");
    key("Escape");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(element("model-pill").textContent).toContain("Ultra");
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });

  it("clears unavailable Fast when effort changes and disables the unavailable speed", () => {
    fixture.models = [
      "gpt-5.6-sol-high",
      "gpt-5.6-sol-high-fast",
      "gpt-5.6-sol-ultra",
    ];
    render("gpt-5.6-sol-high-fast", true, true);
    open();
    click("model-settings-effort");
    click("model-settings-effort-ultra");
    expect(apply).toHaveBeenCalledWith("gpt-5.6-sol-ultra");
    click("model-settings-speed");
    expect(
      element("model-settings-speed-fast").getAttribute("aria-disabled")
    ).toBe("true");
    click("model-settings-speed-fast");
    expect(apply).toHaveBeenCalledOnce();
  });

  it("keeps Max selectable after moving between Max and Ultra", () => {
    render("gpt-5.6-sol-max", true, true);
    open();
    click("model-settings-effort");
    expect(
      element("model-settings-effort-max").getAttribute("aria-checked")
    ).toBe("true");
    expect(apply).not.toHaveBeenCalled();
    click("model-settings-effort-ultra");
    expect(
      element("model-settings-effort-max").getAttribute("aria-checked")
    ).toBe("false");
    expect(apply).toHaveBeenCalledWith("gpt-5.6-sol-ultra");
  });

  it("uses keyboard submenus and restores focus without saving on dismissal", () => {
    render("gpt-5.6-sol-xhigh", true, true);
    open();
    key("ArrowDown");
    key("ArrowDown");
    expect(document.activeElement).toBe(element("model-settings-effort"));
    key("ArrowRight");
    expect(document.activeElement).toBe(element("model-settings-effort-low"));
    key("End");
    key("Enter");
    expect(apply).toHaveBeenCalledWith("gpt-5.6-sol-ultra");
    key("Escape");
    expect(document.activeElement).toBe(element("model-settings-effort"));
    key("Escape");
    expect(document.activeElement).toBe(element("model-pill"));
    expect(apply).toHaveBeenCalledOnce();
  });

  it("returns from mobile advanced settings to the compact model switcher", () => {
    render("gpt-5.6-sol-xhigh", true, true);
    open();
    click("model-settings-advanced");
    expect(
      document.querySelector('[data-testid="model-settings-effort"]')
    ).toBeNull();
    expect(apply).not.toHaveBeenCalled();
    click("model-settings-switch-model");
    expect(openModel).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("releases menu listeners and overlays across repeated view changes", () => {
    render();
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    for (let cycle = 0; cycle < 3; cycle++) {
      openCompact();
      expect(store.get(activeOverlayCountAtom)).toBe(1);
      click("model-settings-switch-model");
      act(() => vi.advanceTimersByTime(32));
      expect(store.get(activeOverlayCountAtom)).toBe(0);
    }
    for (const [event, callback, options] of add.mock.calls) {
      if (["keydown", "pointerdown", "visibilitychange"].includes(event)) {
        expect(
          remove.mock.calls.some(
            ([removedEvent, removedCallback, removedOptions]) =>
              event === removedEvent &&
              callback === removedCallback &&
              options === removedOptions
          )
        ).toBe(true);
      }
    }
    expect(apply).not.toHaveBeenCalled();
    add.mockRestore();
    remove.mockRestore();
  });

  it.each([false, true])(
    "keeps the existing model-only control when levels cannot be picked (editable=%s)",
    (editable) => {
      if (editable) fixture.models = ["gpt-5.6-sol"];
      render(editable ? "gpt-5.6-sol" : "gpt-5.6-sol-xhigh", editable);
      click("model-pill");
      expect(openModel).toHaveBeenCalledOnce();
      expect(document.querySelector('[role="menu"]')).toBeNull();
      expect(container.querySelectorAll("button")).toHaveLength(1);
    }
  );

  it("keeps the existing speed-only control when there are no selectable effort levels", () => {
    fixture.models = ["composer-2.5", "composer-2.5-fast"];
    render("composer-2.5");
    expect(element("effort-pill")).not.toBeNull();
    click("model-pill");
    expect(openModel).toHaveBeenCalledOnce();
  });
});
