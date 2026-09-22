import { expect, it } from "vitest";

import {
  isWithinWorktree,
  registerBranchSwitchEditor,
  switchEditors,
} from "../branchSwitchEditors";

it("scopes files by directory boundaries and Windows casing", () => {
  expect(isWithinWorktree("/repo-two/file", "/repo")).toBe(false);
  expect(isWithinWorktree("/repo/file", "/repo/")).toBe(true);
  expect(isWithinWorktree("C:\\Repo\\file", "c:/repo")).toBe(true);
});
it("unregisters every mounted editor and keeps other worktrees separate", () => {
  const editor = {
    path: "/repo/file",
    dirty: () => true,
    save: async () => {},
  };
  const remove = registerBranchSwitchEditor(editor);
  expect(switchEditors("/repo")).toEqual([editor]);
  expect(switchEditors("/other")).toEqual([]);
  remove();
  remove();
  expect(switchEditors("/repo")).toEqual([]);
});
