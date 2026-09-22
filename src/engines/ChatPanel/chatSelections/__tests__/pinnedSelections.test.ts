import { beforeEach, describe, expect, it } from "vitest";

import {
  PINNED_SELECTIONS_PER_SESSION,
  PINNED_SELECTION_TEXT_LIMIT,
  appendPinnedSelection,
  createPinnedSelection,
  derivePinnedSelectionLabel,
  normalizePinnedSelectionText,
  pinnedSelectionsStorageKey,
  readPinnedSelections,
  removePinnedSelection,
  writePinnedSelections,
} from "../pinnedSelections";

function pin(id: string, text: string) {
  return { id, text, createdAt: 1 };
}

describe("derivePinnedSelectionLabel", () => {
  it("collapses a multi-line passage into one row label", () => {
    expect(derivePinnedSelectionLabel("first line\n\n  second   line ")).toBe(
      "first line second line"
    );
  });

  it("truncates with an ellipsis instead of clipping mid-row", () => {
    const label = derivePinnedSelectionLabel("x".repeat(400));
    expect(label).toHaveLength(120);
    expect(label.endsWith("…")).toBe(true);
  });
});

describe("normalizePinnedSelectionText", () => {
  it("caps the stored passage", () => {
    expect(normalizePinnedSelectionText("y".repeat(5000))).toHaveLength(
      PINNED_SELECTION_TEXT_LIMIT
    );
  });

  it("refuses a whitespace-only selection", () => {
    expect(createPinnedSelection("   \n ")).toBeNull();
  });
});

describe("appendPinnedSelection", () => {
  it("puts a new pin first", () => {
    const next = appendPinnedSelection([pin("a", "one")], pin("b", "two"));
    expect(next.map((entry) => entry.id)).toEqual(["b", "a"]);
  });

  it("moves a re-pinned passage up instead of duplicating it", () => {
    const next = appendPinnedSelection(
      [pin("a", "one"), pin("b", "two")],
      pin("c", "one")
    );
    expect(next.map((entry) => entry.id)).toEqual(["c", "b"]);
  });

  it("drops the oldest pin past the per-session cap", () => {
    const full = Array.from({ length: PINNED_SELECTIONS_PER_SESSION }, (_, i) =>
      pin(`p${i}`, `text ${i}`)
    );
    const next = appendPinnedSelection(full, pin("new", "fresh"));
    expect(next).toHaveLength(PINNED_SELECTIONS_PER_SESSION);
    expect(next[0].id).toBe("new");
    expect(next.at(-1)?.id).toBe(`p${PINNED_SELECTIONS_PER_SESSION - 2}`);
  });
});

describe("removePinnedSelection", () => {
  it("removes only the named pin", () => {
    expect(
      removePinnedSelection([pin("a", "one"), pin("b", "two")], "a")
    ).toEqual([pin("b", "two")]);
  });
});

describe("pin storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips a session's pins", () => {
    writePinnedSelections("session-1", [pin("a", "one")]);
    expect(readPinnedSelections("session-1")).toEqual([pin("a", "one")]);
  });

  it("keeps sessions apart", () => {
    writePinnedSelections("session-1", [pin("a", "one")]);
    expect(readPinnedSelections("session-2")).toEqual([]);
  });

  it("clears the key when the last pin goes", () => {
    writePinnedSelections("session-1", [pin("a", "one")]);
    writePinnedSelections("session-1", []);
    expect(
      localStorage.getItem(pinnedSelectionsStorageKey("session-1"))
    ).toBeNull();
  });

  it("reads corrupt storage as no pins", () => {
    localStorage.setItem(pinnedSelectionsStorageKey("session-1"), "{not json");
    expect(readPinnedSelections("session-1")).toEqual([]);
  });

  it("drops entries that are not pins", () => {
    localStorage.setItem(
      pinnedSelectionsStorageKey("session-1"),
      JSON.stringify([pin("a", "one"), { id: "b" }, null])
    );
    expect(readPinnedSelections("session-1")).toEqual([pin("a", "one")]);
  });
});
