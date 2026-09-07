/**
 * Centralized Repo Store
 *
 * Single source of truth for repo data across the application.
 * Prevents duplicate API calls and ensures consistent state.
 *
 * ## Structure
 *
 * ```
 * repo/
 * ├── types.ts       - Type definitions (Repo, Branch, CachedRepo, etc.)
 * ├── atoms.ts       - Core and persisted atoms
 * ├── derived.ts     - Derived/computed atoms
 * ├── branchCache.ts - Branch cache LRU helpers
 * ├── storage.ts     - Storage keys, persistence, reset
 * └── index.ts       - Re-exports (this file)
 * ```
 *
 * ## Usage
 *
 * ```tsx
 * import {
 *   // Types
 *   type Repo, type Branch,
 *   // Core atoms
 *   reposAtom, selectedRepoIdAtom,
 *   // Derived atoms
 *   selectedRepoAtom, selectedRepoPathAtom, repoMapAtom,
 *   // Cache helpers
 *   isBranchCacheFresh, setBranchCacheWithLRU,
 *   // Storage
 *   resetRepoStore,
 * } from '@src/store/repo';
 * ```
 */

// ============================================
// Types
// ============================================

export type { Repo, Branch, CachedRepo } from "./types";

export { REPO_KIND } from "./types";

// ============================================
// Core Atoms
// ============================================

export {
  // Repo atoms
  reposAtom,
  validRepoIdsAtom,
  // Persisted atoms (window-scoped)
  selectedRepoIdAtom,
  selectedBranchAtom,
  // Persisted atoms (global)
  lastUsedRepoAtom,
  cachedReposAtom,
  // Branch atoms
  currentBranchAtom,
  branchesAtom,
  branchCacheAtom,
  branchLoadingRepoIdsAtom,
  // Loading states
  repoLoadingAtom,
  branchLoadingAtom,
  // Search
  repoFilterAtom,
} from "./atoms";

// ============================================
// Derived Atoms
// ============================================

export {
  // Lookups
  repoMapAtom,
  selectedRepoAtom,
  selectedRepoPathAtom,
  // Filtered & search
  filteredReposAtom,
  // Session repo hint
  sessionRepoHintAtom,
} from "./derived";

// ============================================
// Cache Helpers
// ============================================

export {
  updateCachedRepos,
  isBranchCacheFresh,
  getBranchesFromCache,
  setBranchCacheWithLRU,
} from "./branchCache";

// ============================================
// Storage
// ============================================

export {
  REPO_STORAGE_KEYS,
  isValidUUID,
  resetRepoStore,
  // Window tracking
  getWindowIdsForRepo,
  registerOpenedRepo,
  unregisterWindow,
  clearAllOpenedRepos,
  isMainAppWindowLabel,
} from "./storage";
