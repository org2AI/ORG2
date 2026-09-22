// @vitest-environment jsdom
import { type RefObject, act, createElement, createRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDropdownAutoKeyboard } from "./useDropdownAutoKeyboard";

describe("useDropdownAutoKeyboard", () => {
  let container: HTMLDivElement;
  let root: Root;
  let panelRef: RefObject<HTMLDivElement | null>;
  const onActivate = vi.fn();
  const onClose = vi.fn();

  function Harness() {
    useDropdownAutoKeyboard({
      isOpen: true,
      panelRef,
      onClose,
      enabled: true,
    });

    return createElement(
      "div",
      { ref: panelRef },
      createElement("button", { type: "button", onClick: onActivate }, "Row")
    );
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    panelRef = createRef<HTMLDivElement>();
    act(() => root.render(createElement(Harness)));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    onActivate.mockClear();
    onClose.mockClear();
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("lets the activated row own whether the dropdown closes", () => {
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
      );
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      );
    });

    expect(onActivate).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("still closes on Escape", () => {
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
    });

    expect(onClose).toHaveBeenCalledOnce();
  });
});
