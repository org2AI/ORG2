import { describe, expect, it } from "vitest";

import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";

import { filterWebSessionMenuItems } from "../filterWebSessionMenuItems";

const items: NavigationMenuItem[] = [
  { id: "separator-mine", key: "mine", label: "My sessions" },
  { id: "one", key: "one", label: "Database migration" },
  { id: "separator-team", key: "team", label: "Team sessions" },
  {
    id: "parent",
    key: "parent",
    label: "Frontend",
    children: [{ id: "child", key: "child", label: "Fix migration UI" }],
  },
];

describe("browser session search", () => {
  it("retains matching descendants and their section without changing the roster", () => {
    const result = filterWebSessionMenuItems(items, "migration ui");
    expect(result.map((item) => item.id)).toEqual(["separator-team", "parent"]);
    expect(result[1]?.children?.map((item) => item.id)).toEqual(["child"]);
    expect(items).toHaveLength(4);
  });

  it("removes empty sections and restores every row when the search is cleared", () => {
    expect(filterWebSessionMenuItems(items, "missing")).toEqual([]);
    expect(filterWebSessionMenuItems(items, "")).toEqual(items);
  });
});
