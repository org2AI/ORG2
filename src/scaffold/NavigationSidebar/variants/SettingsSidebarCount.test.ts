// @vitest-environment jsdom
import type { Update } from "@tauri-apps/plugin-updater";
import { Provider, createStore } from "jotai";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import {
  appUpdaterStateAtom,
  mockAppUpdateEnabledAtom,
} from "@src/scaffold/AppUpdater/state";

import SettingsSidebarCount from "./SettingsSidebarCount";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => vi.unstubAllEnvs());

it("shows both counts for a mock, restores real update count, and hides zero", async () => {
  vi.stubEnv("NODE_ENV", "development");
  const store = createStore();
  const node = document.createElement("div");
  const root = createRoot(node);
  const badge = (section: string) =>
    node.querySelector(`[data-testid="settings-${section}-count"]`);
  try {
    await act(async () =>
      root.render(
        createElement(
          Provider,
          { store },
          createElement(SettingsSidebarCount, { section: "general" }),
          createElement(SettingsSidebarCount, { section: "development" })
        )
      )
    );
    expect(node.textContent).toBe("");
    await act(async () => store.set(mockAppUpdateEnabledAtom, true));
    expect(badge("development")?.textContent).toBe("1");
    expect(badge("general")?.textContent).toBe("1");
    await act(async () =>
      store.set(appUpdaterStateAtom, {
        ...store.get(appUpdaterStateAtom),
        update: { available: true, version: "3.0.0" } as Update,
      })
    );
    await act(async () => store.set(mockAppUpdateEnabledAtom, false));
    expect(badge("development")).toBeNull();
    expect(badge("general")?.textContent).toBe("1");
    await act(async () =>
      store.set(appUpdaterStateAtom, {
        ...store.get(appUpdaterStateAtom),
        update: null,
      })
    );
    expect(badge("general")).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
