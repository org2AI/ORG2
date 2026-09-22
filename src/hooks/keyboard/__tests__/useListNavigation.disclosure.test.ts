// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { useListNavigation } from "../useListNavigation";

it("disables disclosure arrows for Spotlight in both input and global handlers, retaining Enter and listener cleanup", () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const select = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const inputRef = createRef<HTMLInputElement>();
  function Harness() {
    const { handleKeyDown } = useListNavigation({
      items: [{ data: { showDisclosureChevron: true } }],
      selectedIndex: 0,
      onSelectedIndexChange: vi.fn(),
      onSelect: select,
      onClose: vi.fn(),
      enableAutoScroll: false,
      enableGlobalListener: true,
      enableDisclosureArrowNavigation: false,
      inputRef,
    });
    return createElement("input", { ref: inputRef, onKeyDown: handleKeyDown });
  }
  function press(target: Element, key: string) {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    act(() => target.dispatchEvent(event));
    return event;
  }
  const remove = vi.spyOn(document, "removeEventListener");
  try {
    act(() => root.render(createElement(Harness)));
    const input = container.querySelector("input")!;
    expect(press(input, "ArrowRight").defaultPrevented).toBe(false);
    expect(press(document.body, "ArrowRight").defaultPrevented).toBe(false);
    expect(select).not.toHaveBeenCalled();
    press(input, "Enter");
    expect(select).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function), true);
    remove.mockRestore();
    container.remove();
  }
});
