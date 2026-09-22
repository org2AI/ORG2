// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { type ReactNode, act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mockAppUpdateEnabledAtom } from "@src/scaffold/AppUpdater/state";
import {
  activeDevMockScenariosAtom,
  devMockScenariosAtom,
  resetDevMockScenariosForTest,
} from "@src/store/dev/mockScenarios";

import DevMockScenarioControls from "./DevMockScenarioControls";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/components/layout/Section", () => ({
  SectionContainer: ({ children }: { children: ReactNode }) => children,
  SectionRow: ({ children }: { children: ReactNode }) => children,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => {
  resetDevMockScenariosForTest();
  vi.unstubAllEnvs();
});

describe("DevMockScenarioControls", () => {
  it("locks the scenarios newUser implies while it is on", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const store = createStore();
    const node = document.createElement("div");
    const root = createRoot(node);
    const switches = () =>
      Array.from(node.querySelectorAll<HTMLButtonElement>('[role="switch"]'));
    try {
      await act(async () =>
        root.render(
          createElement(
            Provider,
            { store },
            createElement(DevMockScenarioControls)
          )
        )
      );
      // Update switch, then one switch per scenario in registry order.
      expect(switches()).toHaveLength(5);

      const [, newUser, noKeys, noWorkingDirectories, noSessions] = switches();
      await act(async () => newUser.click());

      for (const implied of [noKeys, noWorkingDirectories, noSessions]) {
        expect(implied.getAttribute("aria-checked")).toBe("true");
        expect(implied.hasAttribute("disabled")).toBe(true);
      }
      expect(store.get(activeDevMockScenariosAtom)).toEqual({
        newUser: true,
        noKeys: true,
        noWorkingDirectories: true,
        noSessions: true,
      });

      await act(async () => switches()[1].click());
      expect(store.get(activeDevMockScenariosAtom).noKeys).toBe(false);
      expect(switches()[2].hasAttribute("disabled")).toBe(false);
    } finally {
      await act(async () => root.unmount());
    }
  });
  it("toggles one scenario without disturbing the update switch", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const store = createStore();
    const node = document.createElement("div");
    const root = createRoot(node);
    try {
      await act(async () =>
        root.render(
          createElement(
            Provider,
            { store },
            createElement(DevMockScenarioControls)
          )
        )
      );
      const switches =
        node.querySelectorAll<HTMLButtonElement>('[role="switch"]');
      await act(async () => switches[2].click());

      expect(store.get(devMockScenariosAtom).noKeys).toBe(true);
      expect(store.get(mockAppUpdateEnabledAtom)).toBe(false);
      expect(store.get(activeDevMockScenariosAtom).noSessions).toBe(false);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
