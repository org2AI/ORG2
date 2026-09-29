// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { AppShellContent } from "./AppShellContent";

const state = vi.hoisted(() => ({ codeMounts: 0, browserMounts: 0 }));
vi.mock("jotai", () => ({
  useAtomValue: (atom: string) =>
    (
      ({
        active: { type: "file" },
        tabs: [{ type: "file" }],
        real: true,
        browser: true,
        request: { tick: 0 },
        consumed: 0,
      }) as Record<string, unknown>
    )[atom],
}));
vi.mock("@src/store/workstation/tabs", () => ({
  activeWorkStationTabAtom: "active",
  mainPaneTabsAtom: "tabs",
}));
vi.mock("@src/store/workstation/tabHost", () => ({
  mainPaneHasRealTabsAtom: "real",
  mainPaneHasBrowserHostTabsAtom: "browser",
}));
vi.mock("@src/store/workstation/workstationTabBarAtoms", () => ({
  workstationNewBrowserSessionRequestAtom: "request",
  workstationNewBrowserSessionConsumedTickAtom: "consumed",
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/contexts/workstation/BrowserContext", () => ({
  useBrowserContextOptional: () => ({ sessions: [{}] }),
}));
vi.mock("./StartPage", () => ({ WorkStationStartPage: () => null }));
vi.mock("@src/components/Placeholder", () => ({ Placeholder: () => null }));
vi.mock("@src/scaffold/layouts/DetailPaneErrorBoundary", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../CodeEditor", () => ({
  default: function Code({ isActive }: { isActive: boolean }) {
    useEffect(() => {
      state.codeMounts++;
    }, []);
    return createElement("div", { "data-code-active": String(isActive) });
  },
}));
vi.mock("../Browser", () => ({
  default: function Browser({ isActive }: { isActive: boolean }) {
    useEffect(() => {
      state.browserMounts++;
    }, []);
    return createElement("div", { "data-browser-active": String(isActive) });
  },
}));
vi.mock("@src/engines/Simulator", () => ({
  ActivitySimulator: () => createElement("div", { "data-simulator": true }),
}));

const host = document.createElement("div");
const root = createRoot(host);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("keeps editor/browser instances across visibility changes and releases the hidden simulator", async () => {
  const render = async (
    workstationVisible: boolean,
    isBrowserMode: boolean,
    isAgentStation = false
  ) => {
    await act(async () =>
      root.render(
        createElement(AppShellContent, {
          repoPath: "/repo",
          repoName: "repo",
          pathExists: true,
          lastSeenPath: "/repo",
          workstationVisible,
          isAgentStation,
          isCodeMode: !isBrowserMode,
          isBrowserMode,
          isProjectMode: false,
          hasVisitedCode: true,
          hasVisitedBrowser: true,
          hasVisitedProject: false,
          handleSelectRepo: () => {},
        })
      )
    );
  };
  await render(true, false);
  expect(host.querySelector('[data-code-active="true"]')).not.toBeNull();
  await render(false, false);
  expect(host.querySelector('[data-code-active="false"]')).not.toBeNull();
  await render(true, true);
  expect(host.querySelector('[data-browser-active="true"]')).not.toBeNull();
  await render(false, true);
  expect(host.querySelector('[data-browser-active="false"]')).not.toBeNull();
  await render(true, true);
  expect(state.codeMounts).toBe(1);
  expect(state.browserMounts).toBe(1);
  await render(true, true, true);
  expect(host.querySelector("[data-simulator]")).not.toBeNull();
  expect(host.querySelector('[data-browser-active="false"]')).not.toBeNull();
  await render(false, true, true);
  expect(host.querySelector("[data-simulator]")).toBeNull();
});
