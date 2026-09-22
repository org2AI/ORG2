// @vitest-environment jsdom
/**
 * Pins the two behaviours that keep this DevTools section distinct from
 * `@src/components/layout/blocks/CollapsibleSection`:
 *
 * - `collapseAllKey` / `expandAllKey` drive every section from the panel
 *   toolbar without the panel owning per-section open state, and a section
 *   stays locally toggleable in between.
 * - `rightContent` renders *inside* the toggle button, so the value badge is
 *   part of the click target. The design-system component puts `actions` in a
 *   sibling node that deliberately does not toggle.
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import { CollapsibleSection } from "./CollapsibleSection";

it("responds to collapse-all/expand-all keys and keeps rightContent in the toggle", async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  async function render(collapseAllKey: number, expandAllKey: number) {
    await act(async () =>
      root.render(
        // Required children prop must be supplied to the typed createElement call.
        // eslint-disable-next-line react/no-children-prop
        React.createElement(CollapsibleSection, {
          title: "Position",
          rightContent: "absolute",
          collapseAllKey,
          expandAllKey,
          // oxlint-disable-next-line react/no-children-prop -- typed createElement requires the component's children prop
          children: React.createElement("div", { "data-testid": "body" }, "x"),
        })
      )
    );
  }

  const isOpen = () => host.querySelector('[data-testid="body"]') !== null;
  const toggle = () => host.querySelector("button")!;

  try {
    await render(0, 0);
    expect(isOpen()).toBe(true);
    expect(toggle().querySelector('[data-icon="chevron-down"]')).not.toBeNull();
    // The value badge is inside the click target, not a sibling of it.
    expect(toggle().textContent).toContain("absolute");

    // Local toggling still works while the panel keys stand still.
    await act(async () => toggle().click());
    expect(isOpen()).toBe(false);
    expect(
      toggle().querySelector('[data-icon="chevron-right"]')
    ).not.toBeNull();
    await act(async () => toggle().click());
    expect(isOpen()).toBe(true);

    // Bumping only collapseAllKey closes an open section.
    await render(1, 0);
    expect(isOpen()).toBe(false);

    // Bumping only expandAllKey reopens it.
    await render(1, 1);
    expect(isOpen()).toBe(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});
