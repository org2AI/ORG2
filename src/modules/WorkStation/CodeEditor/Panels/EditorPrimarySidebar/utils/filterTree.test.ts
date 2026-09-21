import { describe, expect, it } from "vitest";

import type { TreePanelNode } from "@src/components/TreePanelSidebar/types";

import { buildTreeFromSearchResults, filterTree } from "./filterTree";

const result = (path: string) => ({
  path,
  filename: path.split("/").at(-1)!,
  type: "file" as const,
  score: 1,
});

const file: TreePanelNode = {
  id: "/repo/.archive/src/search.ts",
  path: "/repo/.archive/src/search.ts",
  name: "search.ts",
  type: "file",
};
const child: TreePanelNode = {
  id: "/repo/.archive/src",
  path: "/repo/.archive/src",
  name: "src",
  type: "directory",
  children: [file],
  expanded: false,
};
const parent: TreePanelNode = {
  id: "/repo/.archive",
  path: "/repo/.archive",
  name: ".archive",
  type: "directory",
  children: [child],
  expanded: false,
};

describe("compact explorer search folders", () => {
  it("compacts server results while preserving branching and file rows", () => {
    const tree = buildTreeFromSearchResults(
      [
        result("/repo/.archive/src/modules/Browser/search.ts"),
        result("/repo/.archive/src/modules/shared/search.ts"),
      ],
      "/repo"
    );
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({
      compactName: ".archive/src/modules",
      name: "modules",
      id: "/repo/.archive/src/modules",
      path: "/repo/.archive/src/modules",
    });
    expect(tree[0].children?.map((node) => node.name)).toEqual([
      "Browser",
      "shared",
    ]);
    expect(tree[0].children?.[0].children?.[0]).toMatchObject({
      name: "search.ts",
      type: "file",
      path: "/repo/.archive/src/modules/Browser/search.ts",
    });
  });

  it("compacts local fallback results without changing action names or source data", () => {
    const before = structuredClone(parent);
    const filtered = filterTree([parent], { query: "search" });
    expect(filtered.filteredTree[0]).toMatchObject({
      compactName: ".archive/src",
      name: "src",
      id: child.id,
      path: child.path,
      expanded: true,
      children: [file],
    });
    expect(filtered.matchingPaths.has(file.path)).toBe(true);
    expect(filtered.matchCount).toBe(1);
    expect(parent).toEqual(before);
  });

  it("leaves the normal unfiltered explorer unchanged", () => {
    const tree = [parent];
    expect(filterTree(tree, { query: "  " }).filteredTree).toBe(tree);
  });

  it("does not cross symlink boundaries or merge files into folder labels", () => {
    const tree = [{ ...parent, children: [{ ...child, isSymlink: true }] }];
    const filtered = filterTree(tree, { query: "search" }).filteredTree;
    expect(filtered[0].compactName).toBeUndefined();
    expect(filtered[0].children?.[0].compactName).toBeUndefined();
    expect(filtered[0].children?.[0].children?.[0]).toEqual(file);
  });
});
