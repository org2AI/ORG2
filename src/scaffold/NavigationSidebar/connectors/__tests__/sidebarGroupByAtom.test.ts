// @vitest-environment jsdom
import { type Atom, createStore } from "jotai";
import { beforeEach, describe, expect, it } from "vitest";

import {
  sidebarGroupByAtom,
  sidebarGroupVisibleCountAtom,
  sidebarHiddenWorkspacesAtom,
  sidebarIncludeExternalAtom,
} from "../sidebarGroupByAtom";

const STORAGE_KEY = "orgii:sidebarGroupVisibleCount";
const GROUP_BY_KEY = "orgii:sidebarGroupBy";
const INCLUDE_EXTERNAL_KEY = "orgii:sidebarIncludeExternal";
const HIDDEN_WORKSPACES_KEY = "orgii:sidebarHiddenWorkspaces";

/**
 * `atomWithStorage` re-reads persisted bytes per store in `onMount`, which
 * only fires once the atom is SUBSCRIBED — a bare `store.get` would return
 * the module-init snapshot instead.
 */
function hydratedStore(atom: Atom<unknown>) {
  const store = createStore();
  store.sub(atom, () => undefined);
  return store;
}

function readStored<T>(key: string, atom: Atom<T>, raw: string): T {
  window.localStorage.setItem(key, raw);
  return hydratedStore(atom).get(atom);
}

describe("sidebarGroupVisibleCountAtom", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to 10 and persists supported choices", () => {
    const store = createStore();

    expect(store.get(sidebarGroupVisibleCountAtom)).toBe(10);
    store.set(sidebarGroupVisibleCountAtom, 5);

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("5");
  });

  it("reads back a supported persisted choice", () => {
    expect(readStored(STORAGE_KEY, sidebarGroupVisibleCountAtom, "5")).toBe(5);
  });

  it("rejects unsupported persisted values at the storage boundary", () => {
    expect(readStored(STORAGE_KEY, sidebarGroupVisibleCountAtom, "7")).toBe(10);
    expect(
      readStored(STORAGE_KEY, sidebarGroupVisibleCountAtom, "{corrupt")
    ).toBe(10);
  });
});

describe("sidebar group-by preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists under the existing storage keys", () => {
    const store = createStore();
    store.set(sidebarGroupByAtom, "byWorkspace");
    store.set(sidebarIncludeExternalAtom, false);
    store.set(sidebarHiddenWorkspacesAtom, ["/repo/a"]);

    expect(window.localStorage.getItem(GROUP_BY_KEY)).toBe('"byWorkspace"');
    expect(window.localStorage.getItem(INCLUDE_EXTERNAL_KEY)).toBe("false");
    expect(window.localStorage.getItem(HIDDEN_WORKSPACES_KEY)).toBe(
      '["/repo/a"]'
    );
  });

  it("reads back valid stored values", () => {
    expect(readStored(GROUP_BY_KEY, sidebarGroupByAtom, '"byAgent"')).toBe(
      "byAgent"
    );
    expect(
      readStored(INCLUDE_EXTERNAL_KEY, sidebarIncludeExternalAtom, "false")
    ).toBe(false);
    expect(
      readStored(
        HIDDEN_WORKSPACES_KEY,
        sidebarHiddenWorkspacesAtom,
        JSON.stringify(["/repo/a", "", 3, "/repo/a", "/repo/b"])
      )
    ).toEqual(["/repo/a", "/repo/b"]);
  });

  it("falls back to defaults for corrupt JSON or unknown values", () => {
    expect(readStored(GROUP_BY_KEY, sidebarGroupByAtom, "{corrupt")).toBe(
      "byTime"
    );
    expect(readStored(GROUP_BY_KEY, sidebarGroupByAtom, '"byMood"')).toBe(
      "byTime"
    );
    expect(
      readStored(INCLUDE_EXTERNAL_KEY, sidebarIncludeExternalAtom, '"yes"')
    ).toBe(true);
    expect(
      readStored(HIDDEN_WORKSPACES_KEY, sidebarHiddenWorkspacesAtom, "{corrupt")
    ).toEqual([]);
  });
});
