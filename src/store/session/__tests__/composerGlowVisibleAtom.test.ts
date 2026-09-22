import { createStore } from "jotai/vanilla";
import { beforeEach, describe, expect, it } from "vitest";

import {
  COMPOSER_GLOW_VISIBLE_STORAGE_KEY,
  composerGlowVisibleAtom,
} from "../composerGlowVisibleAtom";

beforeEach(() => {
  localStorage.removeItem(COMPOSER_GLOW_VISIBLE_STORAGE_KEY);
});

function hydratedStore(): ReturnType<typeof createStore> {
  const store = createStore();
  store.sub(composerGlowVisibleAtom, () => undefined);
  return store;
}

describe("composerGlowVisibleAtom", () => {
  it("shows the composer glow by default", () => {
    expect(hydratedStore().get(composerGlowVisibleAtom)).toBe(true);
  });

  it("persists a hidden choice and hydrates it in a new store", () => {
    const firstStore = hydratedStore();
    firstStore.set(composerGlowVisibleAtom, false);

    expect(
      JSON.parse(
        localStorage.getItem(COMPOSER_GLOW_VISIBLE_STORAGE_KEY) ?? "null"
      )
    ).toBe(false);
    expect(hydratedStore().get(composerGlowVisibleAtom)).toBe(false);
  });

  it("falls back to visible for malformed persisted values", () => {
    localStorage.setItem(
      COMPOSER_GLOW_VISIBLE_STORAGE_KEY,
      JSON.stringify("hidden")
    );

    expect(hydratedStore().get(composerGlowVisibleAtom)).toBe(true);
  });
});
