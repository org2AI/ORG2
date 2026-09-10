// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { type ComponentProps, act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { activeOverlayCountAtom } from "@src/store/ui/overlayLayerAtom";

import KeySelectionModal from "./KeySelectionModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../config", () => ({
  useProviderConfig: () => ({ config: undefined }),
  findEndpointByBaseUrl: () => null,
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("uses a named dialog, keeps selection validation, and disposes focus/overlay ownership", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const schedule = vi.spyOn(globalThis, "setTimeout");
  const cancelTimer = vi.spyOn(globalThis, "clearTimeout");
  const store = createStore();
  const opener = document.createElement("button");
  const container = document.createElement("div");
  document.body.append(opener, container);
  opener.focus();
  const root = createRoot(container);
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  const onSelectIndex = vi.fn();
  const props: ComponentProps<typeof KeySelectionModal> = {
    keys: [
      {
        id: "valid",
        name: "Validated",
        auth_method: "api_key",
        validated: true,
      },
      {
        id: "invalid",
        name: "Invalid",
        auth_method: "api_key",
        validated: false,
      },
    ],
    agentType: "openai_api",
    selectedIndex: 0,
    onClose,
    onConfirm,
    onSelectIndex,
  };
  const render = (open: boolean) =>
    act(() =>
      root.render(
        createElement(
          Provider,
          { store },
          open ? createElement(KeySelectionModal, props) : null
        )
      )
    );
  try {
    render(true);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-label")).toBe(
      "keyVault.quickActions.multipleKeysFound"
    );
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(store.get(activeOverlayCountAtom)).toBe(1);
    act(() => vi.advanceTimersByTime(150));
    expect(dialog.contains(document.activeElement)).toBe(true);
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>("button")];
    const invalid = buttons.find((b) =>
      b.textContent?.includes("keyVault.quickActions.invalid")
    )!;
    const valid = buttons.find((b) =>
      b.textContent?.includes("keyVault.quickActions.valid")
    )!;
    act(() => {
      invalid.click();
      valid.click();
    });
    expect(onSelectIndex).toHaveBeenCalledOnce();
    expect(onSelectIndex).toHaveBeenCalledWith(0);
    const confirm = buttons.find(
      (b) => b.textContent === "keyVault.quickActions.useSelected"
    )!;
    act(() => {
      confirm.focus();
      confirm.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        })
      );
    });
    expect(document.activeElement).toBe(buttons[0]);
    act(() => confirm.click());
    expect(onConfirm).toHaveBeenCalledOnce();
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    );
    expect(onClose).toHaveBeenCalledOnce();
    render(false);
    expect(document.activeElement).toBe(opener);
    expect(store.get(activeOverlayCountAtom)).toBe(0);
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    );
    expect(onClose).toHaveBeenCalledOnce();

    render(true);
    expect(store.get(activeOverlayCountAtom)).toBe(1);
    const focusTimerIndex = schedule.mock.calls
      .map((call) => call[1])
      .lastIndexOf(100);
    expect(focusTimerIndex).toBeGreaterThanOrEqual(0);
    const focusTimer = schedule.mock.results[focusTimerIndex].value;
    render(false);
    expect(cancelTimer).toHaveBeenCalledWith(focusTimer);
    expect(store.get(activeOverlayCountAtom)).toBe(0);
  } finally {
    act(() => root.unmount());
    container.remove();
    opener.remove();
  }
});
