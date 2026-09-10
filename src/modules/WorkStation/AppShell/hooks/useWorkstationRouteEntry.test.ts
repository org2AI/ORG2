// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { StrictMode, act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { expect, it, vi } from "vitest";

import { ROUTES } from "@src/config/routes";
import { activeHostAtom } from "@src/store/workstation/tabHost";
import {
  createExplorerTab,
  openTab,
  workstationLayoutAtom,
} from "@src/store/workstation/tabs";

import { useWorkstationRouteEntry } from "./useWorkstationRouteEntry";

it("allows tab switches without route changes and reapplies repeated navigation", async () => {
  localStorage.clear();
  const store = createStore();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  function Entry() {
    const navigate = useNavigate();
    useWorkstationRouteEntry();
    return createElement(
      "button",
      { onClick: () => navigate(ROUTES.workStation.project.path) },
      "Projects"
    );
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(
            Provider,
            { store },
            createElement(
              MemoryRouter,
              {
                initialEntries: [ROUTES.workStation.project.path],
              },
              createElement(Entry)
            )
          )
        )
      )
    );
    expect(store.get(activeHostAtom)).toBe("project");
    await act(async () => {
      const layout = store.get(workstationLayoutAtom);
      store.set(workstationLayoutAtom, {
        ...layout,
        mainPane: openTab(layout.mainPane, createExplorerTab()),
      });
    });
    expect(store.get(activeHostAtom)).toBe("code");
    await act(async () => container.querySelector("button")?.click());
    expect(store.get(activeHostAtom)).toBe("project");
    expect(
      store
        .get(workstationLayoutAtom)
        .mainPane.tabs.filter((tab) => tab.type === "project-dashboard")
    ).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
