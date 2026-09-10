import { createStore } from "jotai/vanilla";
import { beforeEach, describe, expect, it } from "vitest";

import { creatorDefaultProductModeAtom } from "../creatorDefaultProductModeAtom";

const STORAGE_KEY = "orgii:creatorProductMode";

function hydratedStore() {
  const store = createStore();
  store.sub(creatorDefaultProductModeAtom, () => undefined);
  return store;
}

beforeEach(() => {
  localStorage.removeItem(STORAGE_KEY);
});

describe("creatorDefaultProductModeAtom", () => {
  it("persists under the existing storage key", () => {
    const store = hydratedStore();
    store.set(creatorDefaultProductModeAtom, "project");

    expect(localStorage.getItem(STORAGE_KEY)).toBe('"project"');
  });

  it("reads back the project selection and an explicit null", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify("project"));
    expect(hydratedStore().get(creatorDefaultProductModeAtom)).toBe("project");

    localStorage.setItem(STORAGE_KEY, JSON.stringify(null));
    expect(hydratedStore().get(creatorDefaultProductModeAtom)).toBeNull();
  });

  it("falls back to null for corrupt JSON or any other value", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(hydratedStore().get(creatorDefaultProductModeAtom)).toBeNull();

    localStorage.setItem(STORAGE_KEY, JSON.stringify("build"));
    expect(hydratedStore().get(creatorDefaultProductModeAtom)).toBeNull();
  });
});
