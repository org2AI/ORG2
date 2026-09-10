// @vitest-environment jsdom
import { act, createElement, useEffect, useSyncExternalStore } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useForceVisibleSidebar } from "@src/scaffold/NavigationSidebar/contexts/ForceVisibleContext";
import { createSmokeRoot } from "@src/test/reactSmokeHarness";

import { FloatingSidebar } from "./FloatingSidebar";
import { SidebarSelector } from "./SidebarSelector";

const state = vi.hoisted(() => ({
  layoutType: "session" as "session" | "settings" | "standard",
  events: [] as string[],
  listeners: new Set<() => void>(),
}));
vi.mock("../../hooks", () => ({
  useRouteLayoutType: () =>
    useSyncExternalStore(
      (listener) => {
        state.listeners.add(listener);
        return () => {
          state.listeners.delete(listener);
        };
      },
      () => state.layoutType
    ),
}));
function Body({ name }: { name: string }) {
  const floating = useForceVisibleSidebar();
  useEffect(() => {
    state.events.push(`mount:${name}`);
    return () => {
      state.events.push(`unmount:${name}`);
    };
  }, [name]);
  return createElement("div", { "data-body": name, "data-floating": floating });
}
vi.mock("@src/scaffold/NavigationSidebar/connectors", () => ({
  WorkstationSidebarConnector: () => createElement(Body, { name: "session" }),
}));
vi.mock("@src/scaffold/NavigationSidebar/variants/SettingsSidebar", () => ({
  default: () => createElement(Body, { name: "settings" }),
}));
let root: ReturnType<typeof createSmokeRoot>;
afterEach(async () => {
  await root.unmount();
});

describe.each([
  ["docked", SidebarSelector, false],
  ["hover", FloatingSidebar, true],
] as const)("%s sidebar route ownership", (_name, Component, floating) => {
  it("mounts only the current body and preserves presentation context across route switches", async () => {
    root = createSmokeRoot();
    state.events = [];
    state.layoutType = "session";
    await root.render(createElement(Component));
    expect(root.container.querySelectorAll("[data-body]")).toHaveLength(1);
    expect(
      root.container.querySelector("[data-body]")?.getAttribute("data-floating")
    ).toBe(String(floating));
    await act(async () => {
      state.layoutType = "settings";
      state.listeners.forEach((listener) => listener());
    });
    expect(root.container.querySelector('[data-body="session"]')).toBeNull();
    expect(
      root.container
        .querySelector('[data-body="settings"]')
        ?.getAttribute("data-floating")
    ).toBe(String(floating));
    expect(state.events).toEqual([
      "mount:session",
      "unmount:session",
      "mount:settings",
    ]);
    await act(async () => {
      state.layoutType = "standard";
      state.listeners.forEach((listener) => listener());
    });
    expect(root.container.childElementCount).toBe(0);
    expect(state.events.at(-1)).toBe("unmount:settings");
  });
});
