import { describe, expect, it } from "vitest";

import {
  RECENT_TABS_LIMIT,
  recordRecentItem,
  recordRecentTransition,
  removeRecentTab,
} from "./recentTabs";

describe("recent tab history", () => {
  it("supports scoped identities without merging histories or mutating inputs", () => {
    const same = (
      a: { scope: string; id: string },
      b: { scope: string; id: string }
    ) => a.scope === b.scope && a.id === b.id;
    const initial = Object.freeze([
      { scope: "a", id: "1" },
      { scope: "b", id: "1" },
    ]);
    expect(recordRecentItem(initial, { scope: "b", id: "1" }, same)).toEqual([
      initial[1],
      initial[0],
    ]);
    expect(
      recordRecentTransition(
        initial,
        { scope: "a", id: "2" },
        (item) => item.scope === "b",
        () => true,
        same
      )
    ).toEqual([{ scope: "a", id: "2" }, initial[0]]);
    expect(initial).toHaveLength(2);
  });

  it("removes destinations even when leaving no item, the destination itself, or an excluded item", () => {
    const current = [{ id: "a" }, { id: "b" }];
    const destination = (item: { id: string }) => item.id === "a";
    const same = (a: { id: string }, b: { id: string }) => a.id === b.id;
    for (const previous of [null, undefined, { id: "a" }, { id: "start" }]) {
      expect(
        recordRecentTransition(
          current,
          previous,
          destination,
          (item) => item.id !== "start",
          same
        )
      ).toEqual([{ id: "b" }]);
    }
  });

  it("keeps most recently visited unique entries first and enforces the bound", () => {
    const initial = Array.from({ length: RECENT_TABS_LIMIT }, (_, index) => ({
      id: `tab-${index}`,
    }));

    expect(
      recordRecentItem(initial, { id: "tab-1" }, (a, b) => a.id === b.id).map(
        (tab) => tab.id
      )
    ).toEqual(["tab-1", "tab-0", "tab-2", "tab-3", "tab-4"]);
    expect(
      recordRecentItem(initial, { id: "tab-new" }, (a, b) => a.id === b.id).map(
        (tab) => tab.id
      )
    ).toEqual(["tab-new", "tab-0", "tab-1", "tab-2", "tab-3"]);
  });

  it("removes the tab that becomes active", () => {
    expect(
      removeRecentTab([{ id: "tab-a" }, { id: "tab-b" }], "tab-a")
    ).toEqual([{ id: "tab-b" }]);
  });
});
