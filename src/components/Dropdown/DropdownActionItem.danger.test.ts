// @vitest-environment jsdom
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DropdownActionItem from "./DropdownActionItem";
import DropdownItem from "./DropdownItem";
import { DROPDOWN_CLASSES } from "./tokens";

describe("dropdown danger actions", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });
  it.each(["action", "item"])(
    "styles %s label/icon and preserves disabled activation",
    (kind) => {
      const onClick = vi.fn();
      const render = (disabled: boolean, danger: boolean) =>
        act(() => {
          const common = {
            danger,
            disabled,
            onClick,
            role: "menuitem",
            icon: React.createElement("svg", { "data-icon": "delete" }),
            children: "Delete",
          };
          root.render(
            kind === "action"
              ? React.createElement(DropdownActionItem, common)
              : React.createElement(DropdownItem, { ...common, tabIndex: 0 })
          );
        });
      render(false, true);
      let item = container.querySelector<HTMLElement>('[role="menuitem"]')!;
      expect(item.className).toContain(DROPDOWN_CLASSES.itemDanger);
      expect(item.className).toContain(DROPDOWN_CLASSES.itemDangerHover);
      expect(
        item.querySelector('[data-icon="delete"]')?.parentElement?.className
      ).toContain(DROPDOWN_CLASSES.itemDangerIcon);
      expect(item.hasAttribute("danger")).toBe(false);
      act(() => item.click());
      expect(onClick).toHaveBeenCalledOnce();
      render(true, true);
      item = container.querySelector<HTMLElement>('[role="menuitem"]')!;
      expect(item.className).not.toContain(DROPDOWN_CLASSES.itemDanger);
      act(() => item.click());
      expect(onClick).toHaveBeenCalledOnce();
      render(false, false);
      item = container.querySelector<HTMLElement>('[role="menuitem"]')!;
      expect(item.className).not.toContain(DROPDOWN_CLASSES.itemDanger);
    }
  );
  it("keeps hoverable=false on a danger DropdownItem", () => {
    const props = { danger: true, hoverable: false, children: "Delete" };
    act(() => root.render(React.createElement(DropdownItem, props)));
    const item = container.querySelector('[role="option"]')!;
    expect(item.className).toContain(DROPDOWN_CLASSES.itemDanger);
    expect(item.className).not.toContain("hover:bg-");
  });
});
