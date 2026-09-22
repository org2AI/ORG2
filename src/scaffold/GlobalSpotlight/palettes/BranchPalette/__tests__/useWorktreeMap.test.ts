// @vitest-environment jsdom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import type { GitWorktreeEntry } from "@src/api/http/git";
import { createSmokeRoot, dispatch } from "@src/test/reactSmokeHarness";

import {
  refreshWorktreeMap,
  revalidateWorktreeMap,
  useWorktreeEntries,
} from "../useWorktreeMap";

const api = vi.hoisted(() => ({ getGitWorktrees: vi.fn() }));
vi.mock("@src/api/http/git", () => ({ gitApi: api }));
function deferred() {
  let resolve!: (entries: GitWorktreeEntry[]) => void;
  const promise = new Promise<GitWorktreeEntry[]>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const entries = (branch: string): GitWorktreeEntry[] => [
  {
    path: `/repo/${branch}`,
    branch,
    is_main: false,
    head_sha: "abc",
  },
];

describe("worktree mutation invalidation", () => {
  it.each(["create", "remove"])(
    "rejects a pre-%s result even when it settles after refresh",
    async (mutation) => {
      api.getGitWorktrees.mockReset();
      const old = deferred(),
        fresh = deferred();
      api.getGitWorktrees
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(fresh.promise);
      const repoId = `race-${mutation}`;
      const before = revalidateWorktreeMap(repoId, "/repo");
      const after = refreshWorktreeMap(repoId, "/repo");
      expect(api.getGitWorktrees).toHaveBeenCalledTimes(2);
      fresh.resolve(entries("new"));
      await after;
      old.resolve(entries("old"));
      await before;
      function View() {
        const rows = useWorktreeEntries({
          enabled: true,
          repoId,
          repoPath: "/repo",
          isLocalRepo: true,
        });
        return createElement(
          "div",
          null,
          rows.map((row) => row.branch).join(",")
        );
      }
      const root = createSmokeRoot();
      try {
        await root.render(createElement(View));
        expect(root.container.textContent).toBe("new");
        expect(api.getGitWorktrees).toHaveBeenCalledTimes(2);
      } finally {
        await root.unmount();
      }
    }
  );

  it("an old completion cannot clear a newer in-flight request", async () => {
    api.getGitWorktrees.mockReset();
    const old = deferred(),
      fresh = deferred();
    api.getGitWorktrees
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise);
    const before = revalidateWorktreeMap("race-inflight", "/repo");
    const after = refreshWorktreeMap("race-inflight", "/repo");
    old.resolve(entries("old"));
    await before;
    const peer = revalidateWorktreeMap("race-inflight", "/repo");
    expect(api.getGitWorktrees).toHaveBeenCalledTimes(2);
    await dispatch(() => fresh.resolve(entries("new")));
    expect(await after).toEqual(await peer);
  });
});
