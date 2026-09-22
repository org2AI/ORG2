import { createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NEW_USER_IMPLIED_SCENARIO_IDS,
  activeDevMockScenariosAtom,
  devMockScenariosAtom,
  getActiveDevMockScenarios,
  resetDevMockScenariosForTest,
  resolveDevMockScenarios,
  subscribeDevMockScenarios,
} from "./mockScenarios";

afterEach(() => {
  resetDevMockScenariosForTest();
  vi.unstubAllEnvs();
});

describe("devMockScenariosAtom", () => {
  it("toggles a single scenario without touching the others", () => {
    vi.stubEnv("NODE_ENV", "development");
    const store = createStore();

    store.set(devMockScenariosAtom, { id: "noKeys", enabled: true });

    expect(store.get(activeDevMockScenariosAtom)).toEqual({
      newUser: false,
      noKeys: true,
      noWorkingDirectories: false,
      noSessions: false,
    });

    store.set(devMockScenariosAtom, { id: "noKeys", enabled: false });
    expect(store.get(activeDevMockScenariosAtom).noKeys).toBe(false);
  });

  it("folds newUser into every scenario it implies, leaving the raw switches alone", () => {
    vi.stubEnv("NODE_ENV", "development");
    const store = createStore();

    store.set(devMockScenariosAtom, { id: "newUser", enabled: true });

    const active = store.get(activeDevMockScenariosAtom);
    for (const id of NEW_USER_IMPLIED_SCENARIO_IDS) {
      expect(active[id]).toBe(true);
      // The switch position itself stays off so turning newUser back off
      // restores exactly what the developer had picked.
      expect(store.get(devMockScenariosAtom)[id]).toBe(false);
    }

    store.set(devMockScenariosAtom, { id: "newUser", enabled: false });
    expect(store.get(activeDevMockScenariosAtom).noSessions).toBe(false);
  });

  it("keeps an explicitly enabled scenario on after newUser is turned off", () => {
    vi.stubEnv("NODE_ENV", "development");
    const store = createStore();

    store.set(devMockScenariosAtom, { id: "noSessions", enabled: true });
    store.set(devMockScenariosAtom, { id: "newUser", enabled: true });
    store.set(devMockScenariosAtom, { id: "newUser", enabled: false });

    expect(store.get(activeDevMockScenariosAtom)).toMatchObject({
      noSessions: true,
      noKeys: false,
      noWorkingDirectories: false,
    });
  });

  it("publishes effective flags to non-Jotai subscribers and the module mirror", () => {
    vi.stubEnv("NODE_ENV", "development");
    const store = createStore();
    const seen: boolean[] = [];
    const unsubscribe = subscribeDevMockScenarios((scenarios) =>
      seen.push(scenarios.noKeys)
    );

    store.set(devMockScenariosAtom, { id: "newUser", enabled: true });
    expect(seen).toEqual([true]);
    expect(getActiveDevMockScenarios().noKeys).toBe(true);

    unsubscribe();
    store.set(devMockScenariosAtom, { id: "newUser", enabled: false });
    expect(seen).toEqual([true]);
    expect(getActiveDevMockScenarios().noKeys).toBe(false);
  });

  it("is inert outside a development build", () => {
    vi.stubEnv("NODE_ENV", "production");
    const store = createStore();
    const seen: unknown[] = [];
    subscribeDevMockScenarios((scenarios) => seen.push(scenarios));

    store.set(devMockScenariosAtom, { id: "newUser", enabled: true });

    expect(store.get(devMockScenariosAtom).newUser).toBe(false);
    expect(store.get(activeDevMockScenariosAtom).noKeys).toBe(false);
    expect(getActiveDevMockScenarios().noKeys).toBe(false);
    expect(seen).toEqual([]);
  });

  it("leaves a production read at false even if a dev-build write landed first", () => {
    vi.stubEnv("NODE_ENV", "development");
    const store = createStore();
    store.set(devMockScenariosAtom, { id: "newUser", enabled: true });

    vi.stubEnv("NODE_ENV", "production");
    expect(store.get(activeDevMockScenariosAtom).noKeys).toBe(false);
    expect(getActiveDevMockScenarios().noKeys).toBe(false);
  });
});

describe("resolveDevMockScenarios", () => {
  it("returns the same object when newUser is off", () => {
    const state = {
      newUser: false,
      noKeys: true,
      noWorkingDirectories: false,
      noSessions: false,
    };
    expect(resolveDevMockScenarios(state)).toBe(state);
  });
});
