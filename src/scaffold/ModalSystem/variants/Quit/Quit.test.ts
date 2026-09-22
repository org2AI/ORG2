// @vitest-environment jsdom
import { Provider } from "jotai";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { quitConfirmationModalOpenAtom } from "@src/store/ui/overlayAtom";
import {
  createInstrumentedStore,
  resetInstrumentedStore,
} from "@src/util/core/state/instrumentedStore";

import QuitConfirmationModal from "./index";

const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("Quit modal shortcuts", () => {
  let host: HTMLDivElement;
  let root: Root;
  let store: ReturnType<typeof createInstrumentedStore>;

  beforeEach(() => {
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    invoke.mockClear();
    resetInstrumentedStore();
    store = createInstrumentedStore();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    store.set(quitConfirmationModalOpenAtom, true);
    act(() =>
      root.render(
        createElement(Provider, { store }, createElement(QuitConfirmationModal))
      )
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    resetInstrumentedStore();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("displays shortcut hints on both actions with accessible key bindings", () => {
    const quit = document.querySelector('button[aria-keyshortcuts="Enter"]')!;
    const cancel = document.querySelector(
      'button[aria-keyshortcuts="Escape"]'
    )!;
    expect(quit.textContent).toContain("quitConfirmation.confirm");
    expect(quit.querySelector("kbd")).not.toBeNull();
    expect(cancel.textContent).toContain("quitConfirmation.cancel");
    expect(cancel.querySelector("kbd")?.textContent).toBe("Esc");
  });

  it.each([
    ["Enter", "confirm_quit_app"],
    ["Escape", "cancel_quit_confirmation"],
  ])(
    "handles %s once and removes shortcuts after closing",
    async (key, command) => {
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => document.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(true);
      expect(store.get(quitConfirmationModalOpenAtom)).toBe(false);
      expect(invoke).toHaveBeenCalledExactlyOnceWith(command);
      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
        );
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
        );
      });
      expect(invoke).toHaveBeenCalledTimes(1);
    }
  );

  it("ignores composition and unrelated keys", async () => {
    await act(async () => {
      for (const key of ["Enter", "Escape"]) {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            isComposing: true,
            bubbles: true,
          })
        );
      }
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "q", bubbles: true })
      );
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(store.get(quitConfirmationModalOpenAtom)).toBe(true);
  });

  it("does not accumulate handlers across reopen or retain them after unmount", async () => {
    for (let cycle = 0; cycle < 3; cycle++) {
      act(() => store.set(quitConfirmationModalOpenAtom, true));
      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
        );
      });
      expect(invoke).toHaveBeenCalledTimes(cycle + 1);
    }
    act(() => store.set(quitConfirmationModalOpenAtom, true));
    act(() => root.render(null));
    invoke.mockClear();
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      );
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
    });
    expect(invoke).not.toHaveBeenCalled();
  });
});
