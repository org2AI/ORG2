// @vitest-environment jsdom
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SessionDeviceTabs,
  type SessionDeviceTabsProps,
} from "./SessionDeviceTabs";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@src/icons", () => ({
  HugeiconsIcon: () => null,
  LaptopIcon: {},
}));

describe("SessionDeviceTabs", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onSelect = vi.fn();
  const props: SessionDeviceTabsProps = {
    items: [
      { id: "macbook", name: "MacBook Pro · Alice", presence: "online" },
      { id: "studio", name: "Mac Studio · Bob", presence: "unknown" },
    ],
    currentId: "macbook",
    onSelect,
  };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    onSelect.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function render(overrides: Partial<SessionDeviceTabsProps> = {}) {
    act(() =>
      root.render(createElement(SessionDeviceTabs, { ...props, ...overrides }))
    );
    return Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
  }

  it("reuses controlled device tabs without adding an unsupported aggregate", () => {
    const tabs = render();
    expect(tabs).toHaveLength(2);
    expect(tabs[0].dataset.active).toBe("true");
    expect(tabs[0].textContent).toContain("devices.currentDesktop");
    expect(tabs[0].textContent).toContain("devices.online");
    expect(tabs[1].textContent).toContain("devices.presenceUnknown");
    expect(tabs[1].querySelector(".bg-success-6")).toBeNull();
    expect(
      container.querySelector('[role="group"]')?.getAttribute("aria-label")
    ).toBe("devices.pairedDesktops");
  });

  it("requests another device once and waits for the authoritative selection", () => {
    const tabs = render();
    act(() => tabs[0].click());
    expect(onSelect).not.toHaveBeenCalled();
    act(() => tabs[1].click());
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith("studio");
    expect(tabs[0].dataset.active).toBe("true");
    const selectedTabs = render({ currentId: "studio" });
    expect(selectedTabs[0].dataset.active).toBe("false");
    expect(selectedTabs[1].dataset.active).toBe("true");
  });

  it("blocks duplicate switches while pending and permits retry after failure", () => {
    const pendingTabs = render({ disabled: true });
    expect(pendingTabs.every((tab) => tab.disabled)).toBe(true);
    act(() => pendingTabs[1].click());
    expect(onSelect).not.toHaveBeenCalled();
    const restoredTabs = render();
    act(() => restoredTabs[1].click());
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith("studio");
  });

  it("respects item availability without treating unknown presence as unavailable", () => {
    const tabs = render({
      items: [
        ...props.items,
        {
          id: "removed",
          name: "Unavailable",
          presence: "offline",
          disabled: true,
        },
      ],
    });
    expect(tabs[1].disabled).toBe(false);
    expect(tabs[2].disabled).toBe(true);
    act(() => tabs[2].click());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it.each([
    "MacBook Pro · A very long workstation owner name",
    "研发工作站 · 团队共享设备 · " + "长名称".repeat(32),
  ])(
    "keeps a full single-line device name in the scrolling strip: %s",
    (name) => {
      const tabs = render({
        items: [{ id: "mac", name, presence: "offline" }],
        currentId: null,
      });
      expect(tabs[0].textContent).toContain(name);
      expect(tabs[0].dataset.active).toBe("false");
      // Exercise the real TabPill. A capped button or clipped label cannot be
      // recovered by scrolling the outer strip, even with the full DOM text.
      const list = container.querySelector(
        ".mobile-session-device-tabs__list"
      )!;
      expect(list.className).not.toMatch(
        /max-w-|\[&_button[^\]]*\]:overflow-hidden/
      );
      expect(tabs[0].classList.contains("shrink-0")).toBe(true);
      expect(tabs[0].classList.contains("whitespace-nowrap")).toBe(true);
      const label = tabs[0].querySelector(".grid")!;
      expect(label.classList.contains("min-w-0")).toBe(false);
      expect(label.classList.contains("overflow-hidden")).toBe(false);
      expect(label.querySelector('[aria-hidden="true"]')?.textContent).toBe(
        name
      );
      expect(tabs[0].textContent).toContain("devices.offline");
      expect(container.querySelector(".overflow-x-auto")).not.toBeNull();
    }
  );

  it("does not invent a device when inventory is empty", () => {
    render({ items: [] });
    expect(container.innerHTML).toBe("");
    expect(onSelect).not.toHaveBeenCalled();
  });
});
