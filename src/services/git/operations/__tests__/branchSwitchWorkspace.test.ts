import { beforeEach, expect, it, vi } from "vitest";

import { registerBranchSwitchEditor } from "../branchSwitchEditors";
import { ensureSwitchWorkspaceReady } from "../branchSwitchWorkspace";

const mocks = vi.hoisted(() => ({
  question: vi.fn(),
  sessions: [] as unknown[],
  tabs: [] as unknown[],
  cached: [] as string[],
  diffs: [] as string[],
  saveCached: vi.fn(),
  saveDiff: vi.fn(),
}));
vi.mock("@src/features/GitDialogs/BranchSwitchQuestion", () => ({
  branchSwitchQuestion: mocks.question,
}));
vi.mock("@src/i18n", () => ({
  default: { t: (_key: string, fallback: string) => fallback },
}));
vi.mock("@src/store/workstation/tabs/atoms", () => ({
  workstationTabsStateAtom: "tabs",
}));
vi.mock("@src/store/session/sessionAtom/atoms", () => ({
  sessionsAtom: "sessions",
}));
vi.mock("@src/util/core/state/instrumentedStore", () => ({
  getInstrumentedStore: () => ({
    get: (atom: string) =>
      atom === "tabs"
        ? {
            shared: { tabs: mocks.tabs },
            globalWorkspace: { tabs: [] },
            sessionWorkspaces: {},
          }
        : mocks.sessions,
  }),
}));
vi.mock("@src/modules/WorkStation/CodeEditor/hooks/fileContent/cache", () => ({
  getDirtyCachedPaths: () => mocks.cached,
  saveCachedBufferForSwitch: mocks.saveCached,
}));
vi.mock("@src/store/workstation/codeEditor/gitDiffEditDrafts", () => ({
  getGitDiffDraftPaths: () => mocks.diffs,
  saveGitDiffDraftForSwitch: mocks.saveDiff,
}));
const scope = { repoId: "repo", repoPath: "/repo" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.sessions = [];
  mocks.tabs = [];
  mocks.cached = [];
  mocks.diffs = [];
  mocks.question.mockResolvedValue(true);
});
it("asks once before switching under a running task", async () => {
  mocks.sessions = [{ status: "running", repoPath: "/repo" }];
  expect(
    await ensureSwitchWorkspaceReady(scope, { confirmActiveTask: true })
  ).toBe(true);
  expect(mocks.question).toHaveBeenCalledExactlyOnceWith(
    "A task is running in this worktree",
    expect.any(String),
    "Switch anyway"
  );
});
it("cancelling the running-task warning stops the switch", async () => {
  mocks.sessions = [{ status: "running", repoPath: "/repo" }];
  mocks.question.mockResolvedValue(false);
  mocks.cached = ["/repo/file"];
  expect(
    await ensureSwitchWorkspaceReady(scope, { confirmActiveTask: true })
  ).toBe(false);
  expect(mocks.saveCached).not.toHaveBeenCalled();
});
it("does not repeat the running-task warning on later checks", async () => {
  mocks.sessions = [{ status: "running", repoPath: "/repo" }];
  expect(await ensureSwitchWorkspaceReady(scope)).toBe(true);
  expect(mocks.question).not.toHaveBeenCalled();
});
it("does not warn for a task in a sibling worktree", async () => {
  mocks.sessions = [{ status: "running", repoPath: "/repo-other" }];
  expect(
    await ensureSwitchWorkspaceReady(scope, { confirmActiveTask: true })
  ).toBe(true);
  expect(mocks.question).not.toHaveBeenCalled();
});
it("awaits a mounted editor save before allowing checkout", async () => {
  let dirty = true;
  let finish!: () => void;
  const save = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = () => {
          dirty = false;
          resolve();
        };
      })
  );
  const remove = registerBranchSwitchEditor({
    path: "/repo/file",
    dirty: () => dirty,
    save,
  });
  try {
    let settled = false;
    const pending = ensureSwitchWorkspaceReady(scope).then((v) => {
      settled = true;
      return v;
    });
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    finish();
    expect(await pending).toBe(true);
  } finally {
    remove();
  }
});
it("cancelling unsaved-file confirmation leaves all buffers alone", async () => {
  mocks.cached = ["/repo/file"];
  mocks.question.mockResolvedValue(false);
  expect(await ensureSwitchWorkspaceReady(scope)).toBe(false);
  expect(mocks.saveCached).not.toHaveBeenCalled();
});
it("saves inactive buffers only in the captured worktree", async () => {
  mocks.cached = ["/repo/file", "/other/file"];
  mocks.saveCached.mockImplementation(async () => {
    mocks.cached = ["/other/file"];
  });
  expect(await ensureSwitchWorkspaceReady(scope)).toBe(true);
  expect(mocks.saveCached).toHaveBeenCalledExactlyOnceWith("/repo/file");
});
it("refuses to overwrite two different editor buffers for the same path", async () => {
  mocks.cached = ["/repo/file"];
  mocks.diffs = ["/repo/file"];
  expect(await ensureSwitchWorkspaceReady(scope)).toBe(false);
  expect(mocks.saveCached).not.toHaveBeenCalled();
  expect(mocks.saveDiff).not.toHaveBeenCalled();
});
it("does not proceed when fresh edits appear during saving", async () => {
  mocks.cached = ["/repo/file"];
  mocks.saveCached.mockImplementation(async () => {
    mocks.cached = ["/repo/new-file"];
  });
  expect(await ensureSwitchWorkspaceReady(scope)).toBe(false);
});

it("requires structured editor saves before any text-buffer mutation", async () => {
  mocks.tabs = [
    { hasUnsavedChanges: true, data: { filePath: "/repo/data.csv" } },
  ];
  expect(await ensureSwitchWorkspaceReady(scope)).toBe(false);
  expect(mocks.saveCached).not.toHaveBeenCalled();
});
