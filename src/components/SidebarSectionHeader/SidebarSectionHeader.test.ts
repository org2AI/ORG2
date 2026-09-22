// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import Button from "@src/components/Button";

import { SidebarSectionHeader } from ".";

it("keeps panel titles plain, group headers inset, and actions independent of collapse", async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const toggle = vi.fn();
  const refresh = vi.fn();
  try {
    for (const surface of ["panel", "group"] as const) {
      await act(async () =>
        root.render(
          React.createElement(SidebarSectionHeader, {
            title: "History",
            surface,
            expanded: true,
            onToggle: toggle,
            toggleTestId: "toggle",
            actionsAlwaysVisible: true,
            badge: React.createElement("span", { "data-testid": "count" }, "7"),
            actions: React.createElement(
              Button,
              {
                onClick: refresh,
                "aria-label": "Refresh",
                variant: "tertiary",
              },
              "Refresh"
            ),
          })
        )
      );
      const disclosure = host.querySelector<HTMLButtonElement>(
        '[data-testid="toggle"]'
      )!;
      const container = disclosure.parentElement!;
      expect(container.classList.contains("mx-1")).toBe(surface === "group");
      expect(container.classList.contains("rounded-md")).toBe(
        surface === "group"
      );
      expect(disclosure.getAttribute("aria-expanded")).toBe("true");
      expect(disclosure.querySelector("button")).toBeNull();
      expect(host.querySelector('[data-testid="count"]')!.textContent).toBe(
        "7"
      );
      await act(async () =>
        host.querySelector<HTMLButtonElement>('[aria-label="Refresh"]')!.click()
      );
      expect(toggle).toHaveBeenCalledTimes(surface === "panel" ? 0 : 1);
      await act(async () => disclosure.click());
    }
    expect(toggle).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(2);
    await act(async () =>
      root.render(
        React.createElement(SidebarSectionHeader, {
          title: "Static",
          surface: "panel",
        })
      )
    );
    expect(host.querySelector("button")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});
