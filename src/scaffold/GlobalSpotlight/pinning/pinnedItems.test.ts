import { describe, expect, it, vi } from "vitest";

import type { SpotlightItem } from "../types";
import {
  MAX_SPOTLIGHT_PINS,
  buildPinnedItems,
  togglePinnedId,
} from "./pinnedItems";

const header = (id: string): SpotlightItem => ({
  id,
  label: id,
  data: { isHeader: true },
});
const row = (id: string, pinId = id): SpotlightItem => ({
  id,
  label: id,
  type: "action",
  data: { pinId },
  action: vi.fn(),
});
const canPin = (item: SpotlightItem) => item.type === "action";

describe("Spotlight pins", () => {
  it("bounds persisted pins without evicting user choices and still allows unpinning", () => {
    const ids = Array.from({ length: MAX_SPOTLIGHT_PINS }, (_, index) =>
      String(index)
    );
    expect(togglePinnedId(ids, "extra")).toEqual(ids);
    expect(togglePinnedId(ids, "0")).toHaveLength(MAX_SPOTLIGHT_PINS - 1);
    const items = buildPinnedItems(
      [row("0"), row("extra")],
      ids,
      vi.fn(),
      "Pinned",
      canPin
    );
    expect(
      items.find((item) => item.id === "extra")?.data?.pinState?.disabled
    ).toBe(true);
    expect(
      items.find((item) => item.id === "0")?.data?.pinState?.disabled
    ).toBe(false);
  });
  it("moves duplicate recent commands once, drops empty headers, and preserves the action", () => {
    const recent = row("recent-open", "open");
    const toggle = vi.fn();
    const result = buildPinnedItems(
      [
        header("recent"),
        recent,
        header("main"),
        row("main-open", "open"),
        row("other"),
      ],
      ["open"],
      toggle,
      "Pinned",
      canPin
    );
    expect(result.map((item) => item.id)).toEqual([
      "section-user-pinned",
      "recent-open",
      "main",
      "other",
    ]);
    expect(result[1].action).toBe(recent.action);
    result[1].data?.pinState?.onToggle();
    expect(toggle).toHaveBeenCalledWith("open");
  });

  it("only pins live search matches and keeps unpinnable path actions intact", () => {
    const path: SpotlightItem = { id: "path", label: "Import", type: "hint" };
    const result = buildPinnedItems(
      [path, row("matching")],
      ["missing"],
      vi.fn(),
      "Pinned",
      canPin
    );
    expect(result.map((item) => item.id)).toEqual(["path", "matching"]);
    expect(result[0].data?.pinState).toBeUndefined();
    expect(result[1].data?.pinState?.pinned).toBe(false);
  });

  it("retains pin order and restores original groups when unpinned", () => {
    const source = [header("main"), row("one"), row("two")];
    const ids = togglePinnedId(togglePinnedId([], "two"), "one");
    expect(
      buildPinnedItems(source, ids, vi.fn(), "Pinned", canPin).map(
        (item) => item.id
      )
    ).toEqual(["section-user-pinned", "two", "one"]);
    expect(
      buildPinnedItems(
        source,
        togglePinnedId(togglePinnedId(ids, "one"), "two"),
        vi.fn(),
        "Pinned",
        canPin
      ).map((item) => item.id)
    ).toEqual(["main", "one", "two"]);
    expect(ids).toEqual(["two", "one"]);
  });
});
