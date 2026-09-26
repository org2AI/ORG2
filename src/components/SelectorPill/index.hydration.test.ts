// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import SelectorPill from ".";

it("preserves the trigger and focus when tooltip availability changes", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const store = createStore();
  const click = vi.fn();
  const render = (tooltip?: string) =>
    act(() =>
      root.render(
        React.createElement(
          Provider,
          { store },
          React.createElement(SelectorPill, {
            icon: null,
            label: "Workspace",
            tooltip,
            onClick: click,
          })
        )
      )
    );
  try {
    render();
    const button = host.querySelector("button")!;
    act(() => button.focus());
    for (const tooltip of ["Workspace details", undefined, "Updated details"]) {
      render(tooltip);
      expect(host.querySelector("button")).toBe(button);
      expect(document.activeElement).toBe(button);
    }
    act(() => button.click());
    expect(click).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    host.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});
