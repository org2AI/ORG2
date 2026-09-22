import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GitFile } from "@src/types/git/types";

import { loadReviewFile } from "./loadReviewFile";

const mocks = vi.hoisted(() => ({ load: vi.fn(), read: vi.fn() }));
vi.mock("@src/services/git/workingTreeDiffResource", () => ({
  loadWorkingTreeDiff: mocks.load,
}));
vi.mock("@tauri-apps/plugin-fs", () => ({ readTextFile: mocks.read }));
beforeEach(() => vi.resetAllMocks());
describe("review search content loading", () => {
  it("keeps staged, renamed and repository identity in the shared request", async () => {
    const file = {
      path: "new.ts",
      original_path: "old.ts",
      staged: true,
      status: "renamed",
      repoRoot: "/worktree",
    } as GitFile;
    mocks.load.mockResolvedValue({
      oldContent: "old",
      newContent: "new",
      binary: false,
    });
    expect(await loadReviewFile(file, "/main", "repo")).toEqual({
      path: "new.ts",
      oldContent: "old",
      newContent: "new",
      isBinary: false,
    });
    expect(mocks.load).toHaveBeenCalledWith({
      repoId: "repo",
      repoPath: "/worktree",
      file,
    });
  });
  it("reads untracked text only when the shared diff has no payload", async () => {
    mocks.load.mockResolvedValue(null);
    mocks.read.mockResolvedValue("new text");
    expect(
      await loadReviewFile(
        { path: "new.ts", status: "added" } as GitFile,
        "/repo"
      )
    ).toEqual({ path: "new.ts", oldContent: "", newContent: "new text" });
    expect(mocks.read).toHaveBeenCalledWith("/repo/new.ts");
  });
  it("preserves binary detection and reports missing historical payloads", async () => {
    mocks.load
      .mockResolvedValueOnce({ oldContent: "", newContent: "", binary: true })
      .mockResolvedValueOnce(null);
    expect(
      (
        await loadReviewFile(
          { path: "image", status: "modified" } as GitFile,
          "/repo"
        )
      )?.isBinary
    ).toBe(true);
    expect(
      await loadReviewFile(
        { path: "gone", status: "deleted" } as GitFile,
        "/repo"
      )
    ).toBeNull();
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
