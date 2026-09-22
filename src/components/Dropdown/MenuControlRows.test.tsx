// @vitest-environment jsdom
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MenuControlRow,
  MenuSegmentedRow,
  MenuSwitchRow,
} from "./MenuControlRows";
import { DROPDOWN_CLASSES } from "./tokens";

vi.mock("@src/util/ui/theme/themeUtils", () => ({
  useCurrentTheme: () => ({ isDark: false }),
}));

describe("MenuControlRows", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  const render = (node: React.ReactNode) => act(() => root.render(node));

  it("renders a control row with a truncating label and the trailing control", () => {
    render(
      <MenuControlRow label="Send with">
        <button type="button" data-testid="control" />
      </MenuControlRow>
    );

    const row = container.firstElementChild as HTMLElement;
    expect(row.className).toBe(DROPDOWN_CLASSES.menuControlItem);
    expect(row.children[0].className).toBe("min-w-0 flex-1 truncate");
    expect(row.children[0].textContent).toBe("Send with");
    expect(row.children[1].getAttribute("data-testid")).toBe("control");
  });

  it("labels the switch with the row label and forwards toggles", () => {
    const onCheckedChange = vi.fn();
    render(
      <MenuSwitchRow
        label="Dim background"
        checked={false}
        onCheckedChange={onCheckedChange}
        dataTestId="dim-toggle"
      />
    );

    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="dim-toggle"]'
    )!;
    expect(toggle.getAttribute("role")).toBe("switch");
    expect(toggle.getAttribute("aria-label")).toBe("Dim background");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.parentElement?.className).toBe(
      DROPDOWN_CLASSES.menuControlItem
    );

    act(() => toggle.click());
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything());
  });

  it("renders a small segmented pill labelled by the row", () => {
    const onChange = vi.fn();
    render(
      <MenuSegmentedRow
        label="Placement"
        value="top"
        options={[
          { value: "top", label: "Top" },
          { value: "center", label: "Center" },
        ]}
        onChange={onChange}
        dataTestId="placement"
      />
    );

    const group = container.querySelector<HTMLElement>(
      '[data-testid="placement"]'
    )!;
    expect(group.getAttribute("role")).toBe("group");
    expect(group.getAttribute("aria-label")).toBe("Placement");
    expect(group.classList.contains("h-6")).toBe(true);
    const buttons = group.querySelectorAll<HTMLButtonElement>("button");
    expect(
      [...buttons].map((button) => button.getAttribute("aria-pressed"))
    ).toEqual(["true", "false"]);

    act(() => buttons[1].click());
    expect(onChange).toHaveBeenCalledWith("center");
  });
});
