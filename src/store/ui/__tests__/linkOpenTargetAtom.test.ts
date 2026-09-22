import { createStore } from "jotai/vanilla";
import { beforeEach, describe, expect, it } from "vitest";

import {
  LINK_OPEN_TARGET_STORAGE_KEY,
  linkOpenTargetAtom,
  readLinkOpenTarget,
} from "../linkOpenTargetAtom";

beforeEach(() => {
  localStorage.removeItem(LINK_OPEN_TARGET_STORAGE_KEY);
});

function hydratedStore(): ReturnType<typeof createStore> {
  const store = createStore();
  store.sub(linkOpenTargetAtom, () => undefined);
  return store;
}

describe("linkOpenTargetAtom", () => {
  it("opens links in the workstation Browser by default", () => {
    expect(hydratedStore().get(linkOpenTargetAtom)).toBe("internal");
    expect(readLinkOpenTarget()).toBe("internal");
  });

  it("persists the external choice for click-time readers and new stores", () => {
    hydratedStore().set(linkOpenTargetAtom, "external");

    expect(
      JSON.parse(localStorage.getItem(LINK_OPEN_TARGET_STORAGE_KEY) ?? "null")
    ).toBe("external");
    expect(readLinkOpenTarget()).toBe("external");
    expect(hydratedStore().get(linkOpenTargetAtom)).toBe("external");
  });

  it("sees a choice written after the atom hydrated, as another window would", () => {
    const store = createStore();
    expect(store.get(linkOpenTargetAtom)).toBe("internal");

    localStorage.setItem(
      LINK_OPEN_TARGET_STORAGE_KEY,
      JSON.stringify("external")
    );

    expect(readLinkOpenTarget()).toBe("external");
  });

  it.each([JSON.stringify("chrome"), JSON.stringify(true), "not json"])(
    "falls back to the workstation Browser for the malformed value %s",
    (rawValue) => {
      localStorage.setItem(LINK_OPEN_TARGET_STORAGE_KEY, rawValue);

      expect(readLinkOpenTarget()).toBe("internal");
      expect(hydratedStore().get(linkOpenTargetAtom)).toBe("internal");
    }
  );
});
