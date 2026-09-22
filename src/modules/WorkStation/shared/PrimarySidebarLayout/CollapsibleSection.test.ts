// @vitest-environment jsdom
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import Button from "@src/components/Button";

import CollapsibleSection from "./CollapsibleSection";
import { SectionHeaderActions } from "./SectionHeaderActions";

vi.mock("@src/scaffold/Resize", () => ({ HorizontalResizeHandle: () => null }));

it("keeps body-owned actions in the header and disposes them on collapse", async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const refresh = vi.fn();
  const toggle = vi.fn();
  const mount = vi.fn();
  const dispose = vi.fn();
  function Body() {
    useEffect(() => {
      mount();
      return dispose;
    }, []);
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(
        SectionHeaderActions,
        null,
        React.createElement(
          Button,
          { onClick: refresh, "aria-label": "Refresh" },
          "Refresh"
        )
      ),
      React.createElement("div", { "data-testid": "body" }, "Empty history")
    );
  }
  async function render(collapsed: boolean) {
    await act(async () =>
      root.render(
        // Required children prop must be supplied to the typed createElement call.
        // eslint-disable-next-line react/no-children-prop
        React.createElement(CollapsibleSection, {
          title: "Agent Timeline",
          collapsed,
          onCollapseChange: toggle,
          headerTestId: "toggle",
          // oxlint-disable-next-line react/no-children-prop -- typed createElement requires the component's children prop
          children: React.createElement(Body),
        })
      )
    );
  }
  try {
    await render(true);
    expect(mount).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="Refresh"]')).toBeNull();
    await render(false);
    expect(mount).toHaveBeenCalledTimes(1);
    const header = host.querySelector('[data-testid="toggle"]')!.parentElement!;
    const action = header.querySelector<HTMLButtonElement>(
      '[aria-label="Refresh"]'
    )!;
    expect(action).not.toBeNull();
    expect(host.querySelector('[data-testid="body"]')!.contains(action)).toBe(
      false
    );
    await act(async () => action.click());
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(toggle).not.toHaveBeenCalled();
    await render(true);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[aria-label="Refresh"]')).toBeNull();
    await render(false);
    expect(mount).toHaveBeenCalledTimes(2);
    expect(host.querySelectorAll('[aria-label="Refresh"]')).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});
