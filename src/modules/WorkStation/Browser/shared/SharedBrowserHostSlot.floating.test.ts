// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { dispatchWebviewFloatingLayoutChanged } from "@src/hooks/platform/useInlineWebview/webviewLayoutEvents";

import { SharedBrowserHostSlot } from "./SharedBrowserHostSlot";
import {
  SHARED_BROWSER_HOST,
  sharedBrowserHostRegistryAtom,
} from "./sharedBrowserHostAtoms";

it("publishes position-only floating moves, withdraws when hidden, and cleans up", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  let x = 30;
  const measure = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(
      () => ({ x, y: 20, width: 600, height: 400 }) as DOMRect
    );
  const store = createStore();
  const root = createRoot(document.createElement("div"));
  const render = async (active: boolean) => {
    await act(async () =>
      root.render(
        createElement(
          Provider,
          { store },
          createElement(SharedBrowserHostSlot, {
            hostId: SHARED_BROWSER_HOST.MY_STATION,
            active,
          })
        )
      )
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
  };
  const record = () =>
    store.get(sharedBrowserHostRegistryAtom)[SHARED_BROWSER_HOST.MY_STATION];
  try {
    await render(true);
    expect(record().rect?.x).toBe(30);
    x = 230;
    await act(async () => {
      for (let i = 0; i < 10; i++) dispatchWebviewFloatingLayoutChanged();
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(record().rect?.x).toBe(230);
    expect(measure).toHaveBeenCalledTimes(2);
    await render(false);
    expect(record().rect).toBeNull();
    await render(true);
    expect(record().rect?.x).toBe(230);
  } finally {
    await act(async () => root.unmount());
    expect(record().active).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
