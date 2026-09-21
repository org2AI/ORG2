import { createStore } from "jotai/vanilla";
import { beforeEach, describe, expect, it } from "vitest";

import {
  COMPACT_COMPOSER_INPUT_STORAGE_KEY,
  compactComposerInputAtom,
} from "../compactComposerInputAtom";

beforeEach(() => {
  localStorage.removeItem(COMPACT_COMPOSER_INPUT_STORAGE_KEY);
});

function hydratedStore(): ReturnType<typeof createStore> {
  const store = createStore();
  store.sub(compactComposerInputAtom, () => undefined);
  return store;
}

describe("compactComposerInputAtom", () => {
  it("keeps the full-size composer by default", () => {
    expect(hydratedStore().get(compactComposerInputAtom)).toBe(false);
  });

  it("persists an enabled choice and hydrates it in a new store", () => {
    const firstStore = hydratedStore();
    firstStore.set(compactComposerInputAtom, true);

    expect(
      JSON.parse(
        localStorage.getItem(COMPACT_COMPOSER_INPUT_STORAGE_KEY) ?? "null"
      )
    ).toBe(true);

    expect(hydratedStore().get(compactComposerInputAtom)).toBe(true);
  });

  it("falls back to the full-size composer for malformed persisted values", () => {
    localStorage.setItem(
      COMPACT_COMPOSER_INPUT_STORAGE_KEY,
      JSON.stringify("compact")
    );

    expect(hydratedStore().get(compactComposerInputAtom)).toBe(false);
  });
});
