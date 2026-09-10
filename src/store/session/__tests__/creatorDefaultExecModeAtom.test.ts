import { createStore } from "jotai/vanilla";
import { beforeEach, describe, expect, it } from "vitest";

import { creatorDefaultExecModeAtom } from "../creatorDefaultExecModeAtom";

const STORAGE_KEY = "orgii:agentExecMode";

/**
 * `atomWithStorage` re-reads persisted bytes per store in `onMount`, which
 * only fires once the atom is SUBSCRIBED — a bare `store.get` would return
 * the module-init snapshot instead.
 */
function hydratedStore() {
  const store = createStore();
  store.sub(creatorDefaultExecModeAtom, () => undefined);
  return store;
}

beforeEach(() => {
  localStorage.removeItem(STORAGE_KEY);
});

describe("creatorDefaultExecModeAtom", () => {
  it("persists under the legacy storage key", () => {
    const store = hydratedStore();
    store.set(creatorDefaultExecModeAtom, "plan");

    expect(localStorage.getItem(STORAGE_KEY)).toBe('"plan"');
  });

  it("migrates the legacy explore value to ask", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify("explore"));

    expect(hydratedStore().get(creatorDefaultExecModeAtom)).toBe("ask");
  });

  it("reads back every wire value, not only the picker entries", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify("wingman"));

    expect(hydratedStore().get(creatorDefaultExecModeAtom)).toBe("wingman");
  });

  it("falls back to build for corrupt JSON", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");

    expect(hydratedStore().get(creatorDefaultExecModeAtom)).toBe("build");
  });

  it("falls back to build for unknown or non-string values", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify("turbo"));
    expect(hydratedStore().get(creatorDefaultExecModeAtom)).toBe("build");

    localStorage.setItem(STORAGE_KEY, JSON.stringify(42));
    expect(hydratedStore().get(creatorDefaultExecModeAtom)).toBe("build");
  });
});
