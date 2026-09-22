// @vitest-environment jsdom
import React, { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_PANEL,
} from "@src/components/Dropdown/tokens";

import { SessionViewMenu } from "./SessionViewMenu";
import type { SessionGroupBy } from "./sessionGrouping";

vi.mock("../platform", async () => {
  const { createBrowserMobileRemotePlatform } =
    await import("../platform/browser");
  const platform = createBrowserMobileRemotePlatform();
  return { useMobileRemotePlatform: () => platform };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("SessionViewMenu", () => {
  let host: HTMLDivElement;
  let root: Root;
  const change = vi.fn();

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    change.mockClear();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    function Harness() {
      const [groupBy, setGroupBy] = useState<SessionGroupBy>("none");
      return React.createElement(SessionViewMenu, {
        value: groupBy,
        onChange: (value) => {
          change(value);
          setGroupBy(value);
        },
      });
    }
    act(() => root.render(React.createElement(Harness)));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  const trigger = () => host.querySelector<HTMLButtonElement>("button")!;
  const option = (id: string) =>
    document.querySelector<HTMLElement>(`[data-testid=mobile-group-${id}]`)!;
  const click = async (element: HTMLElement) =>
    act(async () => {
      element.click();
      await Promise.resolve();
    });

  it("keeps the ellipsis in a circular touch-sized shared Button without a label wrapper", async () => {
    const control = trigger();
    // Real Button inline styles win over mobile CSS. Do not replace this
    // component with a mock that omits its desktop sizing or label wrapper.
    expect(control.classList.contains("button")).toBe(true);
    expect(control.type).toBe("button");
    expect(control.style.width).toBe("var(--mobile-touch-size)");
    expect(control.style.height).toBe("var(--mobile-touch-size)");
    expect(control.style.padding).toBe("0px");
    expect(control.style.borderRadius).toBe("50%");
    expect(control.querySelector(".truncate")).toBeNull();
    expect(control.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(control.textContent).toBe("");
    expect(control.getAttribute("aria-label")).toBe("sessions.viewOptions");
    expect(control.getAttribute("aria-haspopup")).toBe("listbox");
    expect(control.getAttribute("aria-expanded")).toBe("false");
    await click(control);
    expect(control.getAttribute("aria-expanded")).toBe("true");
    await click(option("time"));
    expect(change).toHaveBeenCalledWith("time");
    expect(control.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens Group by, changes the controlled selection, closes, and can return to none", async () => {
    expect(trigger().getAttribute("aria-label")).toBe("sessions.viewOptions");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    await click(trigger());
    const content = document.querySelector(
      '[data-testid="mobile-session-view-menu-panel"]'
    )!;
    const panel = content.parentElement!;
    expect(content).not.toBeNull();
    expect(panel).not.toBeNull();
    expect(panel.classList.contains("mobile-session-view-menu")).toBe(true);
    expect(host.contains(panel)).toBe(false);
    expect(panel.classList.contains(DROPDOWN_PANEL.bgClass)).toBe(true);
    expect(panel.classList.contains(DROPDOWN_PANEL.menuMinWidthClass)).toBe(
      true
    );
    expect(panel.classList.contains(DROPDOWN_PANEL.borderRadiusClass)).toBe(
      true
    );
    expect(panel.classList.contains(DROPDOWN_PANEL.shadowClass)).toBe(true);
    expect(content.querySelector(".shadow-dropdown")).toBeNull();
    expect(document.body.textContent).toContain("sessions.groupBy");
    const heading = Array.from(panel.querySelectorAll("span")).find(
      (element) => element.textContent === "sessions.groupBy"
    );
    expect(heading?.classList.contains("whitespace-nowrap")).toBe(true);
    expect(heading?.parentElement?.className).toBe(
      DROPDOWN_CLASSES.sectionLabel
    );
    expect(option("none").getAttribute("aria-selected")).toBe("true");
    expect(
      option("none").querySelector('svg[aria-hidden="true"]')
    ).not.toBeNull();
    expect(
      option("time").querySelector('svg[aria-hidden="true"]')
    ).not.toBeNull();
    expect(
      option("time")
        .querySelector('svg[aria-hidden="true"]')
        ?.getAttribute("width")
    ).toBe(String(DROPDOWN_ITEM.iconSize));
    expect(
      option("time")
        .querySelector('svg[aria-hidden="true"]')
        ?.getAttribute("height")
    ).toBe(String(DROPDOWN_ITEM.iconSize));
    const noneChildren = Array.from(option("none").children);
    expect(
      noneChildren[0]?.querySelector('svg[aria-hidden="true"]')
    ).not.toBeNull();
    expect(noneChildren[1]?.textContent).toContain("sessions.groupNone");
    await click(option("time"));
    expect(change).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledWith("time");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    await click(trigger());
    expect(option("time").getAttribute("aria-selected")).toBe("true");
    expect(
      option("workspace").querySelector('svg[aria-hidden="true"]')
    ).not.toBeNull();
    await click(option("workspace"));
    expect(change).toHaveBeenLastCalledWith("workspace");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    await click(trigger());
    expect(option("workspace").getAttribute("aria-selected")).toBe("true");
    await click(option("none"));
    expect(change).toHaveBeenLastCalledWith("none");
  });

  it("supports keyboard open and Escape without changing grouping", async () => {
    trigger().focus();
    await act(async () => {
      trigger().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      );
    });
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      trigger().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
    });
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger());
    expect(change).not.toHaveBeenCalled();
  });

  it("closes the surfaced menu on outside click without changing selection", async () => {
    await click(trigger());
    await act(async () => {
      document.body.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true })
      );
      document.body.click();
    });
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(
      document.querySelector('[data-testid="mobile-session-view-menu-panel"]')
    ).toBeNull();
    expect(change).not.toHaveBeenCalled();
  });
});
