/**
 * Repo Store Atoms
 *
 * Core and persisted atoms for repo state management.
 *
 * ARCHITECTURE (Feb 2, 2026):
 * - selectedRepoIdAtom uses WINDOW-SCOPED sessionStorage
 * - This enables true multi-window isolation (each window tracks its own repo)
 * - sessionStorage is naturally scoped per browser tab/window
 * - lastUsedRepoAtom provides global fallback for new windows
 * - All git operations use Rust backend (Python backend removed)
 */
import { type Getter, type SetStateAction, atom } from "jotai";
import { atomWithStorage, createJSONStorage } from "jotai/utils";

import { activeDevMockScenariosAtom } from "@src/store/dev/mockScenarios";
import { getWindowId } from "@src/util/core/state/windowId";

import { REPO_STORAGE_KEYS } from "./storage";
import type { Branch, BranchCacheEntry, CachedRepo, Repo } from "./types";

// ============================================
// Core Atoms
// ============================================

const NO_REPOS: Repo[] = [];
const NO_CACHED_REPOS: CachedRepo[] = [];

/** True while the `noWorkingDirectories` dev mock scenario is masking repos. */
function workingDirectoriesMasked(get: Getter): boolean {
  return get(activeDevMockScenariosAtom).noWorkingDirectories;
}

const repoListAtom = atom<Repo[]>([]);
repoListAtom.debugLabel = "repoListAtom";

/**
 * Core repo list.
 *
 * Reads are masked to an empty list by the `noWorkingDirectories` dev mock
 * scenario so the "no working directory" empty states can be inspected
 * without detaching real folders. Writes — including functional updates —
 * always resolve against the real list, so the mask is purely cosmetic and
 * reversible. See `@src/store/dev/mockScenarios`.
 */
export const reposAtom = atom(
  (get): Repo[] =>
    workingDirectoriesMasked(get) ? NO_REPOS : get(repoListAtom),
  (get, set, update: SetStateAction<Repo[]>) => {
    const previous = get(repoListAtom);
    set(repoListAtom, typeof update === "function" ? update(previous) : update);
  }
);
reposAtom.debugLabel = "reposAtom";

/** Valid repo IDs (for validation before API calls) */
export const validRepoIdsAtom = atom<Set<string>>(new Set<string>());
validRepoIdsAtom.debugLabel = "validRepoIdsAtom";

// ============================================
// Window-Scoped Persisted Atoms (sessionStorage)
// ============================================

/**
 * Get window-scoped storage key
 * sessionStorage is naturally scoped per tab/window, so we just need consistent keys
 */
function getWindowScopedKey(baseKey: string): string {
  // sessionStorage is already window-scoped, but we include window ID
  // for clarity and to handle edge cases (e.g., same-origin iframes)
  return `${baseKey}:${getWindowId()}`;
}

/**
 * Last used repo ID - persisted to localStorage (GLOBAL)
 *
 * This is a global fallback for when a new window opens without a selected repo.
 * When a user selects a repo in any window, it's also saved here so new windows
 * can default to the last used repo.
 */
export const lastUsedRepoAtom = atomWithStorage<string>(
  REPO_STORAGE_KEYS.lastUsedRepo,
  "",
  createJSONStorage(() => localStorage),
  { getOnInit: true }
);
lastUsedRepoAtom.debugLabel = "lastUsedRepoAtom";

/**
 * Selected repo ID - persisted to sessionStorage (WINDOW-SCOPED)
 *
 * Uses atomWithStorage with sessionStorage for window isolation:
 * - Each window/tab has its own selected repo
 * - Changing repo in one window does NOT affect other windows
 * - sessionStorage persists across page refreshes within the same tab
 * - sessionStorage is cleared when the tab is closed
 *
 * On app restart (Tauri closes the webview), sessionStorage is wiped.
 * The custom storage adapter falls back to lastUsedRepo in localStorage
 * so the user doesn't have to re-select a repo every launch.
 */
export const selectedRepoIdAtom = atomWithStorage<string>(
  getWindowScopedKey(REPO_STORAGE_KEYS.selectedRepo),
  "",
  {
    getItem: (key, initialValue) => {
      try {
        const stored = sessionStorage.getItem(key);
        if (stored !== null) {
          return JSON.parse(stored) as string;
        }
        // Fallback: restore from global lastUsedRepo on app restart
        const lastUsed = localStorage.getItem(REPO_STORAGE_KEYS.lastUsedRepo);
        if (lastUsed) {
          const parsed = JSON.parse(lastUsed) as string;
          if (parsed) {
            sessionStorage.setItem(key, JSON.stringify(parsed));
            return parsed;
          }
        }
        return initialValue;
      } catch {
        return initialValue;
      }
    },
    setItem: (key, value) => {
      sessionStorage.setItem(key, JSON.stringify(value));
    },
    removeItem: (key) => {
      sessionStorage.removeItem(key);
    },
  },
  { getOnInit: true }
);
selectedRepoIdAtom.debugLabel = "selectedRepoIdAtom";

/**
 * Cached repos - persisted to localStorage
 *
 * Stores the 3 most recently used repos with minimal data (id, name, path).
 * This allows immediate availability of repo info after hot reload/restart,
 * even before the full repos list is fetched from the API.
 *
 * Used as a fallback in GitStatusModal and other components.
 */
const cachedRepoStorageAtom = atomWithStorage<CachedRepo[]>(
  REPO_STORAGE_KEYS.cachedRepos,
  [],
  createJSONStorage(() => localStorage),
  { getOnInit: true }
);
cachedRepoStorageAtom.debugLabel = "cachedRepoStorageAtom";

/**
 * Masked the same way as {@link reposAtom}: without this, `selectedRepoAtom`
 * would still resolve a repo from the cache and the empty state would never
 * appear. Writes reach localStorage unmasked.
 */
export const cachedReposAtom = atom(
  (get): CachedRepo[] =>
    workingDirectoriesMasked(get)
      ? NO_CACHED_REPOS
      : get(cachedRepoStorageAtom),
  (get, set, update: SetStateAction<CachedRepo[]>) => {
    const previous = get(cachedRepoStorageAtom);
    set(
      cachedRepoStorageAtom,
      typeof update === "function" ? update(previous) : update
    );
  }
);
cachedReposAtom.debugLabel = "cachedReposAtom";

// ============================================
// Branch Atoms
// ============================================

/** Current branch (from git) */
export const currentBranchAtom = atom<string>("");
currentBranchAtom.debugLabel = "currentBranchAtom";

/** Branch list (for currently selected repo) */
export const branchesAtom = atom<Branch[]>([]);
branchesAtom.debugLabel = "branchesAtom";

/** Branch cache: Map of repoId -> branch data */
export const branchCacheAtom = atom<Map<string, BranchCacheEntry>>(new Map());
branchCacheAtom.debugLabel = "branchCacheAtom";

/** Set of repo IDs currently being fetched (prevents duplicate calls) */
export const branchLoadingRepoIdsAtom = atom<Set<string>>(new Set<string>());
branchLoadingRepoIdsAtom.debugLabel = "branchLoadingRepoIdsAtom";

// ============================================
// Loading & Search States
// ============================================

/** Repo loading state */
export const repoLoadingAtom = atom<boolean>(false);
repoLoadingAtom.debugLabel = "repoLoadingAtom";

/** Branch loading state */
export const branchLoadingAtom = atom<boolean>(false);
branchLoadingAtom.debugLabel = "branchLoadingAtom";

/** Filter string for repo search */
export const repoFilterAtom = atom<string>("");
repoFilterAtom.debugLabel = "repoFilterAtom";
