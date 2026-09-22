// @vitest-environment jsdom
/**
 * The masking contract from `mockScenarios.ts`: a dev scenario hides data from
 * READS only. Writes keep resolving against the real value, and nothing masked
 * is allowed to reach disk.
 */
import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cachedReposAtom,
  reposAtom,
  selectedRepoIdAtom,
} from "@src/store/repo/atoms";
import { selectedRepoAtom } from "@src/store/repo/derived";
import { REPO_STORAGE_KEYS } from "@src/store/repo/storage";
import type { CachedRepo, Repo } from "@src/store/repo/types";
import { sessionsAtom } from "@src/store/session/sessionAtom/atoms";
import {
  loadPersistedSessions,
  persistSessions,
} from "@src/store/session/sessionAtom/persistence";
import type { Session } from "@src/store/session/sessionAtom/types";
import {
  addWorkspaceFolderAtom,
  workspaceFoldersAtom,
} from "@src/store/ui/workspaceFoldersAtom";

import {
  devMockScenariosAtom,
  resetDevMockScenariosForTest,
} from "./mockScenarios";

const REPO: Repo = {
  id: "repo-1",
  name: "orgii",
  path: "/Users/dev/orgii",
  fs_uri: "/Users/dev/orgii",
  kind: "git",
} as Repo;

const CACHED_REPO: CachedRepo = {
  id: "repo-1",
  name: "orgii",
  path: "/Users/dev/orgii",
} as CachedRepo;

const SESSION: Session = {
  session_id: "session-1",
  status: "idle",
  created_at: "2026-09-22T00:00:00Z",
  updated_at: "2026-09-22T00:00:00Z",
};

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  resetDevMockScenariosForTest();
  vi.unstubAllEnvs();
});

describe("noWorkingDirectories", () => {
  it("empties the repo list for readers while writes still see the real one", () => {
    const store = createStore();
    store.set(reposAtom, [REPO]);

    store.set(devMockScenariosAtom, {
      id: "noWorkingDirectories",
      enabled: true,
    });
    expect(store.get(reposAtom)).toEqual([]);

    let observedByWriter: Repo[] | undefined;
    store.set(reposAtom, (previous) => {
      observedByWriter = previous;
      return previous;
    });
    expect(observedByWriter).toEqual([REPO]);

    store.set(devMockScenariosAtom, {
      id: "noWorkingDirectories",
      enabled: false,
    });
    expect(store.get(reposAtom)).toEqual([REPO]);
  });

  it("also masks the cached-repo fallback so no repo stays selected", () => {
    const store = createStore();
    store.set(cachedReposAtom, [CACHED_REPO]);
    store.set(selectedRepoIdAtom, REPO.id);
    expect(store.get(selectedRepoAtom)?.id).toBe(REPO.id);

    store.set(devMockScenariosAtom, {
      id: "noWorkingDirectories",
      enabled: true,
    });

    expect(store.get(cachedReposAtom)).toEqual([]);
    expect(store.get(selectedRepoAtom)).toBeUndefined();
    // The real cache is untouched on disk.
    expect(
      JSON.parse(localStorage.getItem(REPO_STORAGE_KEYS.cachedRepos) ?? "[]")
    ).toEqual([CACHED_REPO]);
  });

  it("does not let a masked folder list truncate the real workspace", () => {
    const store = createStore();
    store.set(workspaceFoldersAtom, [
      {
        id: "folder-1",
        name: "orgii",
        path: "/Users/dev/orgii",
        uri: "file:///Users/dev/orgii",
        isPrimary: true,
      },
    ]);

    store.set(devMockScenariosAtom, {
      id: "noWorkingDirectories",
      enabled: true,
    });
    expect(store.get(workspaceFoldersAtom)).toEqual([]);

    store.set(addWorkspaceFolderAtom, { path: "/Users/dev/other" });

    store.set(devMockScenariosAtom, {
      id: "noWorkingDirectories",
      enabled: false,
    });
    expect(store.get(workspaceFoldersAtom).map((f) => f.path)).toEqual([
      "/Users/dev/orgii",
      "/Users/dev/other",
    ]);
  });
});

describe("noSessions", () => {
  it("empties the session list for readers while merges still see the real one", () => {
    const store = createStore();
    store.set(sessionsAtom, [SESSION]);

    store.set(devMockScenariosAtom, { id: "noSessions", enabled: true });
    expect(store.get(sessionsAtom)).toEqual([]);

    let observedByWriter: Session[] | undefined;
    store.set(sessionsAtom, (previous) => {
      observedByWriter = previous;
      return previous;
    });
    expect(observedByWriter).toEqual([SESSION]);

    store.set(devMockScenariosAtom, { id: "noSessions", enabled: false });
    expect(store.get(sessionsAtom)).toEqual([SESSION]);
  });

  it("refuses to persist while the mask is on, so the cold-start cache survives", () => {
    const store = createStore();
    persistSessions([SESSION]);
    expect(loadPersistedSessions()).toEqual([SESSION]);

    store.set(devMockScenariosAtom, { id: "noSessions", enabled: true });
    persistSessions(store.get(sessionsAtom));

    expect(loadPersistedSessions()).toEqual([SESSION]);
  });
});

describe("newUser", () => {
  it("masks repos and sessions together", () => {
    const store = createStore();
    store.set(reposAtom, [REPO]);
    store.set(sessionsAtom, [SESSION]);

    store.set(devMockScenariosAtom, { id: "newUser", enabled: true });

    expect(store.get(reposAtom)).toEqual([]);
    expect(store.get(sessionsAtom)).toEqual([]);
  });
});
