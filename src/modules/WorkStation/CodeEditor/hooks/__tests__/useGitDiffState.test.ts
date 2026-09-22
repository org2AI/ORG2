/**
 * Tests for the `useGitDiffState` reducer's scope-aware bulk replace.
 *
 * Pins the fix from commit d814e55200 — a host-repo refresh
 * (`SET_FILES(scope=host)`) must NOT wipe entries contributed by a
 * worktree pane (`repoRoot=worktreePath`), and incoming files without a
 * `repoRoot` should inherit the reporting scope so downstream consumers
 * (GitAllChangesContent, batch-diff fetch grouping) can route them to
 * the right repo.
 */
import { describe, expect, it } from "vitest";

import {
  type GitDiffAction,
  gitDiffReducer,
  initialGitDiffState,
} from "@src/modules/WorkStation/CodeEditor/hooks/useGitDiffState";
import type { GitFile } from "@src/types/git/types";

const HOST = "/repos/yorg_frontend";
const WT_A = "/worktrees/wt-a";
const WT_B = "/worktrees/wt-b";

const file = (overrides: Partial<GitFile> & { path: string }): GitFile => ({
  id: overrides.path,
  status: "modified",
  additions: 0,
  deletions: 0,
  staged: false,
  ...overrides,
});

const fileMap = (...files: GitFile[]): Map<string, GitFile> =>
  new Map(files.map((f) => [f.path, f]));

describe("gitDiffReducer / SET_FILES scope-aware merge", () => {
  it("replaces the whole map when no scope is provided (legacy behaviour)", () => {
    const seeded = gitDiffReducer(initialGitDiffState, {
      type: "SET_FILES",
      files: fileMap(
        file({ path: `${HOST}/old.ts` }),
        file({ path: `${WT_A}/wt.ts`, repoRoot: WT_A })
      ),
    } as GitDiffAction);

    const next = gitDiffReducer(seeded, {
      type: "SET_FILES",
      files: fileMap(file({ path: `${HOST}/new.ts` })),
    } as GitDiffAction);

    expect(Array.from(next.filesByPath.keys())).toEqual([`${HOST}/new.ts`]);
  });

  it("preserves sibling-scope entries when scope is provided", () => {
    const seeded = gitDiffReducer(initialGitDiffState, {
      type: "SET_FILE",
      path: `${WT_A}/wt.ts`,
      file: file({ path: `${WT_A}/wt.ts`, repoRoot: WT_A }),
    } as GitDiffAction);

    // Host repo refresh — should NOT wipe the worktree file.
    const afterHostRefresh = gitDiffReducer(seeded, {
      type: "SET_FILES",
      files: fileMap(file({ path: `${HOST}/host.ts`, repoRoot: HOST })),
      scopeRepoRoot: HOST,
    } as GitDiffAction);

    expect(afterHostRefresh.filesByPath.get(`${WT_A}/wt.ts`)?.repoRoot).toBe(
      WT_A
    );
    expect(afterHostRefresh.filesByPath.get(`${HOST}/host.ts`)?.repoRoot).toBe(
      HOST
    );
  });

  it("replaces files in the same scope and stamps repoRoot on incoming files lacking one", () => {
    const seeded = gitDiffReducer(initialGitDiffState, {
      type: "SET_FILES",
      files: fileMap(
        file({ path: `${HOST}/a.ts` }),
        file({ path: `${HOST}/b.ts` })
      ),
      scopeRepoRoot: HOST,
    } as GitDiffAction);

    const next = gitDiffReducer(seeded, {
      type: "SET_FILES",
      files: fileMap(file({ path: `${HOST}/c.ts` })),
      scopeRepoRoot: HOST,
    } as GitDiffAction);

    expect(Array.from(next.filesByPath.keys()).sort()).toEqual([
      `${HOST}/c.ts`,
    ]);
    expect(next.filesByPath.get(`${HOST}/c.ts`)?.repoRoot).toBe(HOST);
  });

  it("keeps multiple worktree scopes independent", () => {
    let state = gitDiffReducer(initialGitDiffState, {
      type: "SET_FILES",
      files: fileMap(file({ path: `${WT_A}/a.ts` })),
      scopeRepoRoot: WT_A,
    } as GitDiffAction);

    state = gitDiffReducer(state, {
      type: "SET_FILES",
      files: fileMap(file({ path: `${WT_B}/b.ts` })),
      scopeRepoRoot: WT_B,
    } as GitDiffAction);

    state = gitDiffReducer(state, {
      type: "SET_FILES",
      files: fileMap(file({ path: `${HOST}/h.ts` })),
      scopeRepoRoot: HOST,
    } as GitDiffAction);

    // Worktree A refresh — only its own file replaced.
    state = gitDiffReducer(state, {
      type: "SET_FILES",
      files: fileMap(file({ path: `${WT_A}/a2.ts` })),
      scopeRepoRoot: WT_A,
    } as GitDiffAction);

    expect(Array.from(state.filesByPath.keys()).sort()).toEqual([
      `${HOST}/h.ts`,
      `${WT_A}/a2.ts`,
      `${WT_B}/b.ts`,
    ]);
    expect(state.filesByPath.get(`${HOST}/h.ts`)?.repoRoot).toBe(HOST);
    expect(state.filesByPath.get(`${WT_A}/a2.ts`)?.repoRoot).toBe(WT_A);
    expect(state.filesByPath.get(`${WT_B}/b.ts`)?.repoRoot).toBe(WT_B);
  });

  it("merges old/new content across SET_FILES updates within the same scope", () => {
    const seeded = gitDiffReducer(initialGitDiffState, {
      type: "SET_FILES",
      files: fileMap(
        file({
          path: `${HOST}/a.ts`,
          oldContent: "before",
          newContent: "after",
        })
      ),
      scopeRepoRoot: HOST,
    } as GitDiffAction);

    // Refresh from `git status` — content fields are typically undefined.
    const refreshed = gitDiffReducer(seeded, {
      type: "SET_FILES",
      files: fileMap(file({ path: `${HOST}/a.ts` })),
      scopeRepoRoot: HOST,
    } as GitDiffAction);

    expect(refreshed.filesByPath.get(`${HOST}/a.ts`)?.oldContent).toBe(
      "before"
    );
    expect(refreshed.filesByPath.get(`${HOST}/a.ts`)?.newContent).toBe("after");
  });
});

/**
 * Repo switch: the sidebar's file report (a child effect) is dispatched
 * *before* the editor's switch-clear (a parent effect) in the same commit, and
 * the sidebar only re-reports when its file array changes identity. An unkeyed
 * clear therefore wiped the new repo's list for good, and All Changes showed
 * only the files later injected one at a time by row clicks.
 */
describe("gitDiffReducer / repo-keyed switch", () => {
  const OTHER = "/repos/other";
  const KEY_HOST = JSON.stringify(["repo-host", HOST]);
  const KEY_OTHER = JSON.stringify(["repo-other", OTHER]);

  const report = (
    repoKey: string,
    scope: string,
    ...files: GitFile[]
  ): GitDiffAction => ({
    type: "SET_FILES",
    files: fileMap(...files),
    scopeRepoRoot: scope,
    repoKey,
  });

  it("keeps the new repo's report when the switch-clear is dispatched after it", () => {
    let state = gitDiffReducer(
      initialGitDiffState,
      report(KEY_HOST, HOST, file({ path: "a.ts" }))
    );

    state = gitDiffReducer(
      state,
      report(KEY_OTHER, OTHER, file({ path: "b.ts" }), file({ path: "c.ts" }))
    );
    state = gitDiffReducer(state, { type: "CLEAR_FILES", repoKey: KEY_OTHER });

    expect(Array.from(state.filesByPath.keys()).sort()).toEqual([
      "b.ts",
      "c.ts",
    ]);
    expect(state.repoKey).toBe(KEY_OTHER);
  });

  it("still ends with the new repo's files when the clear is dispatched first", () => {
    let state = gitDiffReducer(
      initialGitDiffState,
      report(KEY_HOST, HOST, file({ path: "a.ts" }))
    );

    state = gitDiffReducer(state, { type: "CLEAR_FILES", repoKey: KEY_OTHER });
    expect(state.filesByPath.size).toBe(0);

    state = gitDiffReducer(
      state,
      report(KEY_OTHER, OTHER, file({ path: "b.ts" }))
    );
    expect(Array.from(state.filesByPath.keys())).toEqual(["b.ts"]);
  });

  it("drops every entry of the previous repo, including its worktree scopes", () => {
    let state = gitDiffReducer(
      initialGitDiffState,
      report(KEY_HOST, HOST, file({ path: "a.ts" }))
    );
    state = gitDiffReducer(
      state,
      report(KEY_HOST, WT_A, file({ path: `${WT_A}/wt.ts` }))
    );

    state = gitDiffReducer(
      state,
      report(KEY_OTHER, OTHER, file({ path: "b.ts" }))
    );

    expect(Array.from(state.filesByPath.keys())).toEqual(["b.ts"]);
    expect(state.filesByPath.get("b.ts")?.repoRoot).toBe(OTHER);
  });

  it("does not inherit cached content from a same-path file in the previous repo", () => {
    let state = gitDiffReducer(
      initialGitDiffState,
      report(
        KEY_HOST,
        HOST,
        file({ path: "a.ts", oldContent: "host-old", newContent: "host-new" })
      )
    );

    state = gitDiffReducer(
      state,
      report(KEY_OTHER, OTHER, file({ path: "a.ts" }))
    );

    expect(state.filesByPath.get("a.ts")?.oldContent).toBeUndefined();
    expect(state.filesByPath.get("a.ts")?.repoRoot).toBe(OTHER);
  });

  it("keeps sibling worktree scopes across reports for the same repo", () => {
    let state = gitDiffReducer(
      initialGitDiffState,
      report(KEY_HOST, WT_A, file({ path: `${WT_A}/wt.ts` }))
    );
    state = gitDiffReducer(
      state,
      report(KEY_HOST, HOST, file({ path: "a.ts" }))
    );

    expect(Array.from(state.filesByPath.keys()).sort()).toEqual([
      `${WT_A}/wt.ts`,
      "a.ts",
    ]);
  });

  it("returns the same state for a repeat clear of the current repo", () => {
    const state = gitDiffReducer(
      initialGitDiffState,
      report(KEY_HOST, HOST, file({ path: "a.ts" }))
    );

    expect(
      gitDiffReducer(state, { type: "CLEAR_FILES", repoKey: KEY_HOST })
    ).toBe(state);
  });

  it("empties the map and forgets the repo on an unkeyed clear", () => {
    let state = gitDiffReducer(
      initialGitDiffState,
      report(KEY_HOST, HOST, file({ path: "a.ts" }))
    );
    state = gitDiffReducer(state, { type: "CLEAR_FILES" });

    expect(state.filesByPath.size).toBe(0);
    expect(state.repoKey).toBeNull();
  });
});
