// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { devModeEnabledAtom } from "@src/store/platform/devModeAtom";

import WikiHost from "./WikiHost";
import { WIKI_OPEN_EVENT } from "./wikiEvents";

vi.mock("./WikiModal", () => ({
  default: ({
    open,
    showTutorials,
  }: {
    open: boolean;
    showTutorials: boolean;
  }) =>
    open
      ? React.createElement(
          "div",
          { role: "dialog", "data-tutorials": String(showTutorials) },
          "Wiki"
        )
      : null,
}));

it("opens for every user and only offers the tours in dev mode", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const store = createStore();
  store.set(devModeEnabledAtom, false);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const open = () =>
    act(() => {
      window.dispatchEvent(new CustomEvent(WIKI_OPEN_EVENT));
    });
  try {
    act(() =>
      root.render(
        React.createElement(Provider, { store }, React.createElement(WikiHost))
      )
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    open();
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("data-tutorials")).toBe("false");
    act(() => store.set(devModeEnabledAtom, true));
    expect(
      container.querySelector('[role="dialog"]')?.getAttribute("data-tutorials")
    ).toBe("true");
  } finally {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});
