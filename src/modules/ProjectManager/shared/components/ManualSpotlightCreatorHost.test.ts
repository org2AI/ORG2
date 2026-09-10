// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { manualCreatorAtom } from "@src/store/ui/manualCreatorAtom";

import { ManualSpotlightCreatorHost } from "./ManualSpotlightCreatorHost";

const lifecycle = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn() }));
vi.mock("./ManualSpotlightCreator", () => ({
  default: function MockCreator() {
    useEffect(() => {
      lifecycle.mount();
      return () => lifecycle.unmount();
    }, []);
    return React.createElement("div", { "data-testid": "spotlight" });
  },
}));

it("mounts only on demand and disposes every closed spotlight creator", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const store = createStore();
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        React.createElement(
          Provider,
          { store },
          React.createElement(ManualSpotlightCreatorHost)
        )
      )
    );
    expect(lifecycle.mount).not.toHaveBeenCalled();
    for (let cycle = 1; cycle <= 3; cycle++) {
      await act(async () =>
        store.set(manualCreatorAtom, { target: "workItem" })
      );
      expect(host.children).toHaveLength(1);
      expect(lifecycle.mount).toHaveBeenCalledTimes(cycle);
      await act(async () => store.set(manualCreatorAtom, null));
      expect(host.children).toHaveLength(0);
      expect(lifecycle.unmount).toHaveBeenCalledTimes(cycle);
    }
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
