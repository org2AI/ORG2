import { createStore } from "jotai/vanilla";
import { beforeEach, describe, expect, it } from "vitest";

import {
  CREATOR_LAUNCHPAD_SEARCH_VISIBLE_STORAGE_KEY,
  creatorLaunchpadSearchVisibleAtom,
} from "../creatorLaunchpadSearchVisibleAtom";

beforeEach(() => {
  localStorage.removeItem(CREATOR_LAUNCHPAD_SEARCH_VISIBLE_STORAGE_KEY);
});

function hydratedStore(): ReturnType<typeof createStore> {
  const store = createStore();
  store.sub(creatorLaunchpadSearchVisibleAtom, () => undefined);
  return store;
}

describe("creatorLaunchpadSearchVisibleAtom", () => {
  it("shows the launchpad Spotlight trigger by default", () => {
    expect(hydratedStore().get(creatorLaunchpadSearchVisibleAtom)).toBe(true);
  });

  it("persists a hidden choice and hydrates it in a new store", () => {
    const firstStore = hydratedStore();
    firstStore.set(creatorLaunchpadSearchVisibleAtom, false);

    expect(
      JSON.parse(
        localStorage.getItem(CREATOR_LAUNCHPAD_SEARCH_VISIBLE_STORAGE_KEY) ??
          "null"
      )
    ).toBe(false);
    expect(hydratedStore().get(creatorLaunchpadSearchVisibleAtom)).toBe(false);
  });

  it("falls back to visible for malformed persisted values", () => {
    localStorage.setItem(
      CREATOR_LAUNCHPAD_SEARCH_VISIBLE_STORAGE_KEY,
      JSON.stringify("hidden")
    );

    expect(hydratedStore().get(creatorLaunchpadSearchVisibleAtom)).toBe(true);
  });
});
