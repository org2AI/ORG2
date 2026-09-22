import type { Update } from "@tauri-apps/plugin-updater";
import { createStore } from "jotai";
import { afterEach, expect, it, vi } from "vitest";

import {
  appUpdateInstallPromptAtom,
  appUpdaterStateAtom,
  availableAppUpdateAtom,
  mockAppUpdateEnabledAtom,
} from "./state";

afterEach(() => vi.unstubAllEnvs());

it("overlays real updates, clears mock prompts on disable, and isolates stores", () => {
  vi.stubEnv("NODE_ENV", "development");
  const store = createStore();
  const other = createStore();
  const real = { available: true, version: "3.0.0" } as Update;
  store.set(appUpdaterStateAtom, {
    ...store.get(appUpdaterStateAtom),
    update: real,
  });
  store.set(mockAppUpdateEnabledAtom, true);
  expect(store.get(availableAppUpdateAtom)).toMatchObject({
    version: "99.0.0",
    mock: true,
  });
  expect(other.get(availableAppUpdateAtom)).toBeNull();
  store.set(appUpdateInstallPromptAtom, true);
  store.set(mockAppUpdateEnabledAtom, false);
  expect(store.get(availableAppUpdateAtom)).toBe(real);
  expect(store.get(appUpdateInstallPromptAtom)).toBe(false);
  store.set(mockAppUpdateEnabledAtom, true);
  expect(store.get(appUpdateInstallPromptAtom)).toBe(false);
});

it("cannot enable the mock in production", () => {
  vi.stubEnv("NODE_ENV", "production");
  const store = createStore();
  store.set(mockAppUpdateEnabledAtom, true);
  expect(store.get(mockAppUpdateEnabledAtom)).toBe(false);
  expect(store.get(availableAppUpdateAtom)).toBeNull();
});
