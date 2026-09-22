// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import type { SlashItem } from "@src/types/extensions";

import PinActionsPanel from "./PinActionsPanel";

const navigation = vi.hoisted(() => ({
  handleKeyDown: vi.fn(),
  globalListenerSetting: vi.fn(),
}));

vi.mock("@src/hooks/dropdown", () => ({
  useDropdownEngine: ({
    listNavigation,
  }: {
    listNavigation: {
      items: SlashItem[];
      onSelect: (item: SlashItem) => void;
      disableGlobalListener?: boolean;
    };
  }) => {
    navigation.globalListenerSetting(listNavigation.disableGlobalListener);
    return {
      isPositioned: true,
      panelRef: { current: null },
      panelPosition: { top: 0, left: 0 },
      keyboard: {
        selectedIndex: -1,
        handleKeyDown: navigation.handleKeyDown,
        getItemProps: (index: number) => ({
          onClick: () => listNavigation.onSelect(listNavigation.items[index]),
        }),
      },
    };
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

it("keeps pin and insert as separately focusable sibling buttons", async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onTogglePin = vi.fn(),
    onInsert = vi.fn();
  try {
    await act(async () =>
      root.render(
        React.createElement(PinActionsPanel, {
          visible: true,
          availableItems: [
            {
              name: "Summarize",
              description: "Summarize",
              category: "action",
              source: "builtin",
              acceptsArgs: false,
            },
          ],
          pinnedActions: [],
          onTogglePin,
          onInsert,
          onUnpinAll: vi.fn(),
          onClose: vi.fn(),
          loading: false,
        })
      )
    );
    const insert = document.querySelector<HTMLButtonElement>(
      '[aria-label="input.pinnedActions.insert"]'
    )!;
    const pin =
      insert.parentElement!.querySelector<HTMLButtonElement>("button")!;
    expect(navigation.globalListenerSetting).toHaveBeenLastCalledWith(true);
    expect(insert).not.toBe(pin);
    expect(pin.contains(insert)).toBe(false);
    expect(insert.tabIndex).toBe(0);
    expect(insert.type).toBe("button");
    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => insert.dispatchEvent(enter));
    expect(enter.defaultPrevented).toBe(false);
    expect(navigation.handleKeyDown).not.toHaveBeenCalled();
    await act(async () =>
      insert.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
      )
    );
    expect(navigation.handleKeyDown).toHaveBeenCalledOnce();
    await act(async () => insert.click());
    expect(onInsert).toHaveBeenCalledOnce();
    expect(onTogglePin).not.toHaveBeenCalled();
    await act(async () => pin.click());
    expect(onTogglePin).toHaveBeenCalledOnce();
    expect(onInsert).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});
