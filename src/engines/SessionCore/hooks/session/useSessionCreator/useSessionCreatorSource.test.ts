// @vitest-environment jsdom
import type { TFunction } from "i18next";
import { Provider, createStore, useAtomValue } from "jotai";
import { createElement, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  currentBranchAtom,
  reposAtom,
  selectedRepoIdAtom,
} from "@src/store/repo";
import {
  type SessionSource,
  sessionSourceAtom,
} from "@src/store/session/creatorStateAtom";
import {
  activeWorkspaceIdAtom,
  workspaceFoldersAtom,
} from "@src/store/ui/workspaceFoldersAtom";
import { activeWorktreeByRepoAtom } from "@src/store/workspace/derived";
import {
  type SmokeRoot,
  createSmokeRoot,
  dispatch,
  expectQuiescent,
} from "@src/test/reactSmokeHarness";

import { useSessionCreatorSource } from "./useSessionCreatorSource";
import { buildSessionLaunchPayload } from "./useSessionLaunch/launchPayload";

const t = ((key: string) => key) as TFunction;
const source: SessionSource = {
  type: "local",
  repoId: "repo-a",
  repoName: "A",
  repoPath: "/repos/a",
  branch: "old-branch",
};

describe("useSessionCreatorSource live branch ownership", () => {
  let store: ReturnType<typeof createStore>;
  let root: SmokeRoot;
  let latest: ReturnType<typeof useSessionCreatorSource>;
  let renders: number;

  function Harness({ os = false }: { os?: boolean }) {
    const result = useSessionCreatorSource({ isOSMode: os, t });
    const statusBarBranch = useAtomValue(currentBranchAtom);
    useEffect(() => {
      latest = result;
      renders += 1;
    });
    return createElement(
      "output",
      null,
      `${result.effectiveSource?.branch ?? ""}|${statusBarBranch}`
    );
  }
  const mount = (os = false) =>
    root.render(
      createElement(Provider, { store }, createElement(Harness, { os }))
    );

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    sessionStorage.clear();
    store = createStore();
    store.set(reposAtom, [
      { id: "repo-a", name: "A", path: "/repos/a", kind: "git" },
      { id: "repo-b", name: "B", path: "/repos/b", kind: "git" },
    ]);
    store.set(selectedRepoIdAtom, "repo-a");
    store.set(currentBranchAtom, "develop");
    store.set(sessionSourceAtom, null);
    store.set(activeWorkspaceIdAtom, "workspace");
    store.set(workspaceFoldersAtom, []);
    store.set(activeWorkspaceIdAtom, null);
    store.set(activeWorktreeByRepoAtom, {});
    root = createSmokeRoot();
    renders = 0;
  });
  afterEach(async () => {
    await root.unmount();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("repairs a saved branch in the launch source and follows repeated live switches without draft writes", async () => {
    store.set(sessionSourceAtom, source);
    const saved = localStorage.getItem("orgii:sessionCreatorState");
    const writes = vi.spyOn(Storage.prototype, "setItem");
    await mount();
    expect(latest.effectiveSource).toEqual({ ...source, branch: "develop" });
    for (const branch of ["feature/one", "feature/two", "develop"]) {
      await dispatch(() => store.set(currentBranchAtom, branch));
      expect(latest.effectiveSource?.branch).toBe(branch);
      expect(root.container.textContent).toBe(`${branch}|${branch}`);
    }
    expect(store.get(sessionSourceAtom)).toEqual(source);
    expect(localStorage.getItem("orgii:sessionCreatorState")).toBe(saved);
    expect(writes).not.toHaveBeenCalled();
    await expectQuiescent(() => renders, 60_000);
  });

  it.each(["local", "worktree"] as const)(
    "passes the live branch to %s launch while preserving an explicit worktree base",
    async (runningLocation) => {
      store.set(sessionSourceAtom, source);
      await mount();
      await dispatch(() => store.set(currentBranchAtom, "feature/current"));
      const { launchParams } = buildSessionLaunchPayload({
        agentExecMode: "build",
        agentInput: "hello",
        advancedConfig: {},
        dispatchCategory: "rust_agent",
        effectiveSource: latest.effectiveSource,
        adeContext: undefined,
        imageDataUrls: undefined,
        isBackgroundLaunch: false,
        resolvedKeys: {
          accountId: "account-1",
          keySource: "own_key",
          model: "model-1",
          cliAgentType: undefined,
          nativeHarnessType: undefined,
          branch: undefined,
        },
        runningLocation,
        selectedAgentDefId: "builtin:sde",
        selectedAgentOrgId: null,
        sessionName: "Test",
        targetKind: "agent",
        workspaceFolders: [],
        worktreeLaunchSelection: {
          repoKey: "id:repo-a",
          source: {
            kind: "branch",
            label: "release",
            baseBranch: "release",
            sourceRef: "branch:release",
          },
        },
      });
      expect(launchParams.branch).toBe("feature/current");
      expect(launchParams.worktreeBaseRef).toBe(
        runningLocation === "worktree" ? "release" : undefined
      );
    }
  );

  it("keeps a default source live without materializing a saved draft, including remount", async () => {
    await mount();
    expect(latest.effectiveSource?.branch).toBe("develop");
    await dispatch(() => store.set(currentBranchAtom, "new-branch"));
    expect(latest.effectiveSource?.branch).toBe("new-branch");
    expect(store.get(sessionSourceAtom)).toBeNull();
    await root.unmount();
    root = createSmokeRoot();
    await mount();
    expect(latest.effectiveSource?.branch).toBe("new-branch");
    expect(store.get(sessionSourceAtom)).toBeNull();
  });

  it("does not revive saved branch metadata while live HEAD is unresolved", async () => {
    store.set(sessionSourceAtom, source);
    store.set(currentBranchAtom, "");
    await mount();
    expect(latest.effectiveSource?.branch).toBeUndefined();
    await dispatch(() => store.set(currentBranchAtom, "new-head"));
    expect(latest.effectiveSource?.branch).toBe("new-head");
  });

  it.each([
    { ...source, repoId: "repo-b", repoPath: "/repos/b" },
    { ...source, repoPath: "/worktrees/a" },
    { ...source, repoPath: undefined },
    { ...source, type: "github" as const },
    { ...source, type: "system_path" as const },
  ])(
    "preserves independent source scope: $type $repoId $repoPath",
    async (draft) => {
      store.set(sessionSourceAtom, draft);
      await mount();
      await dispatch(() => store.set(currentBranchAtom, "another-branch"));
      expect(latest.effectiveSource).toEqual(draft);
      await dispatch(() => latest.setDraftBranch("explicit-ref"));
      expect(latest.effectiveSource?.branch).toBe("explicit-ref");
    }
  );

  it("recognizes file URIs for the same checkout", async () => {
    store.set(sessionSourceAtom, { ...source, repoPath: "file:///repos/a/" });
    await mount();
    expect(latest.effectiveSource?.branch).toBe("develop");
  });

  it("matches the active worktree path, never the same repo's other checkout", async () => {
    store.set(activeWorktreeByRepoAtom, {
      "repo-a": {
        repoId: "repo-a",
        path: "/worktrees/a",
        branch: "cached-worktree-branch",
        isMain: false,
      },
    });
    store.set(sessionSourceAtom, source);
    await mount();
    expect(latest.effectiveSource?.branch).toBe("old-branch");
    await dispatch(() =>
      store.set(sessionSourceAtom, { ...source, repoPath: "/worktrees/a" })
    );
    expect(latest.effectiveSource?.branch).toBe("develop");
    await dispatch(() => store.set(currentBranchAtom, "new-worktree-head"));
    expect(latest.effectiveSource?.branch).toBe("new-worktree-head");
  });

  it("clears a different-repo draft on workspace switch and waits for the new branch", async () => {
    store.set(sessionSourceAtom, source);
    await mount();
    await dispatch(() => {
      store.set(currentBranchAtom, "");
      store.set(selectedRepoIdAtom, "repo-b");
    });
    expect(store.get(sessionSourceAtom)).toBeNull();
    expect(latest.effectiveSource).toMatchObject({
      repoId: "repo-b",
      repoPath: "/repos/b",
      branch: undefined,
    });
    await dispatch(() => store.set(currentBranchAtom, "branch-b"));
    expect(latest.effectiveSource?.branch).toBe("branch-b");
  });

  it("does not pair a multi-root primary folder with another folder's live branch", async () => {
    store.set(activeWorkspaceIdAtom, "workspace");
    store.set(workspaceFoldersAtom, [
      {
        id: "b",
        repoId: "repo-b",
        name: "B",
        path: "/repos/b",
        uri: "file:///repos/b",
        isPrimary: true,
      },
      {
        id: "a",
        repoId: "repo-a",
        name: "A",
        path: "/repos/a",
        uri: "file:///repos/a",
        isPrimary: false,
      },
    ]);
    await mount();
    expect(latest.effectiveSource).toMatchObject({
      repoId: "repo-b",
      repoPath: "/repos/b",
    });
    expect(latest.effectiveSource?.branch).toBeUndefined();
  });

  it("keeps plain folders branchless", async () => {
    store.set(reposAtom, [
      { id: "repo-a", name: "A", path: "/repos/a", kind: "folder" },
    ]);
    store.set(sessionSourceAtom, source);
    await mount();
    expect(latest.effectiveSource?.branch).toBeUndefined();
  });

  it("preserves the OS home default", async () => {
    await mount(true);
    expect(latest.effectiveSource).toMatchObject({
      type: "system_path",
      systemPathId: "home",
    });
    expect(latest.effectiveSource?.branch).toBeUndefined();
  });
});
