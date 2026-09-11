// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SPOTLIGHT_STYLES } from "../styles";
import {
  SpotlightItemRow,
  type SpotlightItemRowProps,
} from "./SpotlightItemRow";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("SpotlightItemRow selectionState prop", () => {
  let container: HTMLDivElement;
  let root: Root;
  let props: SpotlightItemRowProps;
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const render = (changes: Partial<SpotlightItemRowProps> = {}) => {
    props = { ...props, ...changes };
    act(() => root.render(createElement(SpotlightItemRow, props)));
  };

  beforeEach(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    props = {
      item: { id: "row", label: "Item", type: "option" },
      index: 0,
      isSelected: true,
      isKeyboardMode: false,
      onSelect: vi.fn(),
      onHover: vi.fn(),
      searchQuery: "",
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("keeps card disclosures out of layout and hidden during keyboard selection", () => {
    const style = document.createElement("style");
    style.textContent = SPOTLIGHT_STYLES;
    document.head.append(style);
    try {
      render({
        cardHeight: 56,
        isSelected: false,
        item: { ...props.item, data: { showDisclosureChevron: true } },
      });
      const disclosure = () =>
        container.querySelector<HTMLElement>(".spotlight-disclosure-chevron")!;
      expect(getComputedStyle(disclosure()).position).toBe("absolute");
      expect(getComputedStyle(disclosure()).opacity).toBe("0");
      expect(getComputedStyle(disclosure()).transition).toBe(
        "opacity 120ms ease"
      );
      render({ isSelected: true });
      expect(getComputedStyle(disclosure()).position).toBe("absolute");
      expect(getComputedStyle(disclosure()).opacity).toBe("0");
      render({ isSelected: false });
      expect(getComputedStyle(disclosure()).position).toBe("absolute");
      render({ cardHeight: undefined });
      expect(getComputedStyle(disclosure()).width).toBe("0px");
    } finally {
      style.remove();
    }
  });

  it("keeps ordinary rows checkbox-free when the prop is omitted", () => {
    render();
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    act(() => container.querySelector<HTMLElement>(".spotlight-item")!.click());
    expect(props.onSelect).toHaveBeenCalledWith(props.item);
  });

  it.each(["input", "[data-checkbox-icon]"])(
    "toggles once from %s without activating the row",
    (target) => {
      const onToggle = vi.fn();
      render({
        selectionState: { checked: true, ariaLabel: "Select ABC-1", onToggle },
      });
      const checkbox = container.querySelector<HTMLInputElement>(
        'input[type="checkbox"]'
      )!;
      expect(checkbox.checked).toBe(true);
      expect(
        container.querySelector('[aria-label="Select ABC-1"]')
      ).not.toBeNull();
      act(() => container.querySelector<HTMLElement>(target)!.click());
      expect(onToggle).toHaveBeenCalledOnce();
      expect(props.onSelect).not.toHaveBeenCalled();
      render({
        selectionState: { checked: false, ariaLabel: "Select ABC-1", onToggle },
      });
      expect(checkbox.checked).toBe(false);
      act(() =>
        container.querySelector<HTMLElement>(".spotlight-item")!.click()
      );
      expect(props.onSelect).toHaveBeenCalledOnce();
      expect(onToggle).toHaveBeenCalledOnce();
    }
  );

  it("does not make disabled rows selectable through the checkbox", () => {
    const onToggle = vi.fn();
    render({
      item: { ...props.item, data: { disabled: true } },
      selectionState: { checked: true, onToggle },
    });
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    act(() => container.querySelector<HTMLElement>(".spotlight-item")!.click());
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
  });
});
