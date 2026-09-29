// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { workstationTabHeaderAtomByHost } from "@src/store/workstation";
import {
  type WorkStationTab,
  workstationTabsStateAtom,
} from "@src/store/workstation/tabs";
import { createSessionSourcesTab } from "@src/store/workstation/tabs/factories/sessionSources";
import { emptyWorkstationTabsState } from "@src/store/workstation/tabs/storage";

import WorkstationTabHeader from "./WorkstationTabHeader";

vi.mock("@src/components/Tooltip", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("./CodeSidebarHeaderActions", () => ({
  CodeSidebarHeaderActions: () => "sidebar-search-shortcut",
}));
vi.mock("./SourceControlHeaderActions", () => ({
  SourceControlHeaderActions: () => null,
}));

let host: HTMLDivElement;
let root: Root;
let store: ReturnType<typeof createStore>;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  store = createStore();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

it("hides the complete shared toolbar only while Sources is active and restores it on tab switches", () => {
  const file: WorkStationTab = {
    id: "file:/workspace/readme.md",
    type: "file",
    title: "readme.md",
    data: { path: "/workspace/readme.md" },
  };
  const sources = createSessionSourcesTab("session-1", "Sources");
  const browser: WorkStationTab = {
    id: "browser-session:1",
    type: "browser-session",
    title: "Browser",
    data: {},
  };
  const state = emptyWorkstationTabsState();
  state.globalWorkspace = {
    tabs: [file, sources, browser],
    activeTabRef: { partition: "workspace", tabId: file.id },
    tabOrder: [file, sources, browser].map((tab) => ({
      partition: "workspace",
      tabId: tab.id,
    })),
  };
  store.set(workstationTabsStateAtom, state);
  store.set(workstationTabHeaderAtomByHost.code, {
    content: React.createElement("span", null, "file-breadcrumb"),
  });
  store.set(workstationTabHeaderAtomByHost.browser, {
    content: React.createElement("span", null, "browser-url"),
  });
  act(() => {
    root.render(
      React.createElement(
        Provider,
        { store },
        React.createElement(WorkstationTabHeader)
      )
    );
  });
  function select(tab: WorkStationTab) {
    act(() => {
      store.set(workstationTabsStateAtom, (previous) => ({
        ...previous,
        globalWorkspace: {
          ...previous.globalWorkspace,
          activeTabRef: { partition: "workspace", tabId: tab.id },
        },
      }));
    });
  }
  expect(host.textContent).toContain("file-breadcrumb");
  expect(host.textContent).toContain("sidebar-search-shortcut");
  select(sources);
  expect(host.innerHTML).toBe("");
  select(file);
  expect(host.querySelector("[data-workstation-tab-header]")).not.toBeNull();
  expect(host.textContent).toContain("file-breadcrumb");
  expect(host.textContent).toContain("sidebar-search-shortcut");
  select(sources);
  expect(host.innerHTML).toBe("");
  select(browser);
  expect(host.querySelector("[data-workstation-tab-header]")).not.toBeNull();
  expect(host.textContent).toContain("browser-url");
});
