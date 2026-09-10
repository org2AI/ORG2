import { describe, expect, it, vi } from "vitest";

import type { Repo } from "@src/store/repo";
import type { WorkspaceFolder } from "@src/types/workspace";

import { resolveRecentDefinitions } from "../recentSpotlightActions";
import { buildStaticActionItems } from "../spotlightItemBuilders";
import { buildSearchModeItems } from "../spotlightSearchBuilder";
import { buildWorkingDirectoryActions } from "../spotlightWorkingDirectoryActions";

const repos: Repo[] = [
  { id: "a", name: "Frontend", path: "/repos/front", kind: "git" },
  { id: "b", name: "Backend", path: "/repos/back", kind: "git" },
  { id: "c", name: "Notes", path: "/repos/notes", kind: "folder" },
];
const folders: WorkspaceFolder[] = repos.map((repo) => ({
  id: `folder-${repo.id}`,
  name: repo.name,
  path: repo.path!,
  uri: `file://${repo.path}`,
  repoId: repo.id,
  kind: repo.kind,
  isPrimary: repo.id === "a",
}));
const translate = (key: string, values?: Record<string, string>) =>
  values?.repoName ? `Switch the branch of ${values.repoName}` : key;
const branchActions = (workspaceActive: boolean, selectedRepoId = "a") =>
  buildWorkingDirectoryActions(
    repos,
    selectedRepoId,
    folders,
    workspaceActive
  ).filter((action) => action.id.startsWith("switch-branch:"));

describe("working-directory branch commands", () => {
  it("names and targets the selected repo in single-repo mode", () => {
    const actions = branchActions(false, "b");
    const select = vi.fn();
    const items = buildStaticActionItems(actions, select, translate);
    expect(items.map((item) => item.label)).toEqual([
      "Switch the branch of Backend",
    ]);
    items[0].action?.();
    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { repoId: "b" } })
    );
  });

  it("expands all workspace Git repos in folder order with unique identities", () => {
    expect(
      branchActions(true).map((action) => [action.id, action.payload])
    ).toEqual([
      ["switch-branch:a", { repoId: "a" }],
      ["switch-branch:b", { repoId: "b" }],
    ]);
  });

  it("resolves path-only roots and deduplicates repeated repo references", () => {
    const actions = buildWorkingDirectoryActions(
      repos,
      "a",
      [{ ...folders[1], repoId: undefined }, folders[1], folders[0]],
      true
    );
    expect(
      actions.filter((a) => a.id.startsWith("switch-branch:")).map((a) => a.id)
    ).toEqual(["switch-branch:b", "switch-branch:a"]);
  });

  it("does not invent a branch target for plain folders or missing repositories", () => {
    expect(branchActions(false, "c")).toEqual([]);
    expect(branchActions(false, "missing")).toEqual([]);
    expect(
      buildWorkingDirectoryActions(repos, "a", [], true).some((a) =>
        a.id.startsWith("switch-branch")
      )
    ).toBe(false);
  });

  it("searches repo names and preserves repo identity in recent commands", () => {
    const actions = buildWorkingDirectoryActions(repos, "a", folders, true);
    const select = vi.fn();
    const items = buildSearchModeItems({
      searchQuery: "Backend",
      isEditorRoute: false,
      staticCommandActions: actions,
      onSelectAction: vi.fn(),
      onSelectStaticAction: select,
      onSelectEditorAction: vi.fn(),
      onSelectPath: vi.fn(),
      translate,
    });
    const branch = items.find((item) => item.id === "switch-branch:b");
    expect(branch?.label).toBe("Switch the branch of Backend");
    branch?.action?.();
    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { repoId: "b" } })
    );
    expect(resolveRecentDefinitions(["switch-branch:b"], actions)).toHaveLength(
      1
    );
    expect(
      resolveRecentDefinitions(
        ["switch-branch:b"],
        buildWorkingDirectoryActions(repos, "a", [], false)
      )
    ).toEqual([]);
  });
});
