// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { createSessionTab } from "@src/store/chatPanel/chatPanelTabFactories";
import { chatPanelTabsAtom } from "@src/store/chatPanel/chatPanelTabsState";
import { activeOverlayCountAtom } from "@src/store/ui/overlayLayerAtom";
import {
  openSessionTrailSurfaceAtom,
  sessionTrailSurfaceAtom,
} from "@src/store/workstation/sessionTrailSurfaceAtom";

import { SessionTrailOverlay } from "./SessionTrailOverlay";

const lifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("./WorkstationSurface", () => ({
  WorkstationSurface: ({
    header,
    headerTitle,
    children,
  }: React.PropsWithChildren<{
    header: React.ReactNode;
    headerTitle: React.ReactNode;
  }>) => React.createElement("section", null, headerTitle, header, children),
}));
vi.mock("@src/features/SubagentTrail/SubagentTrailHeader", () => ({
  SubagentTrailHeader: () => React.createElement("span", null, "Child title"),
}));
vi.mock("@src/features/SubagentTrail/SubagentTrailContent", () => ({
  SubagentTrailContent: () => {
    useEffect(() => {
      lifecycle.mounts++;
      return () => {
        lifecycle.unmounts++;
      };
    }, []);
    return React.createElement("p", null, "Selected child history");
  },
}));

it("keeps history mounted through fullscreen, releases overlays on close and scope switch", async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  lifecycle.mounts = lifecycle.unmounts = 0;
  const host = document.createElement("div");
  const root = createRoot(host);
  const store = createStore();
  const a = createSessionTab({ sessionId: "parent" });
  const b = createSessionTab({ sessionId: "other" });
  store.set(chatPanelTabsAtom, { tabs: [a, b], activeTabId: a.id });
  const open = () =>
    store.set(openSessionTrailSurfaceAtom, {
      kind: "subagents",
      sessionId: "parent",
      title: "Subagents",
      childSessionId: "child",
    });
  const click = (label: string) =>
    host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click();
  try {
    open();
    await act(async () => {
      root.render(
        React.createElement(
          Provider,
          { store },
          React.createElement(SessionTrailOverlay)
        )
      );
    });
    expect(host.textContent).toContain("Child title");
    expect(lifecycle.mounts).toBe(1);
    expect(store.get(activeOverlayCountAtom)).toBe(1);
    act(() => click("sessions:simulator.replay.canvas.tooltipFullscreen"));
    expect(store.get(sessionTrailSurfaceAtom)).toMatchObject({
      fullscreen: true,
      childSessionId: "child",
    });
    act(() => click("sessions:simulator.replay.canvas.tooltipExitFullscreen"));
    expect(lifecycle.mounts).toBe(1);
    act(() => click("common:actions.close"));
    expect(store.get(activeOverlayCountAtom)).toBe(0);
    expect(lifecycle.unmounts).toBe(1);
    await act(async () => open());
    expect(lifecycle.mounts).toBe(2);
    act(() =>
      store.set(chatPanelTabsAtom, { tabs: [a, b], activeTabId: b.id })
    );
    expect(host.querySelector("section")).toBeNull();
    expect(store.get(activeOverlayCountAtom)).toBe(0);
    expect(lifecycle.unmounts).toBe(2);
  } finally {
    act(() => root.unmount());
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});
