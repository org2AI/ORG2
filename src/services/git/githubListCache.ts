/**
 * In-memory, repo-keyed LRU cache for GitHub list data (issues + PRs).
 *
 * Lives at module scope so it survives workspace switches within the same
 * app session. Stale-while-revalidate: callers receive cached data instantly
 * and kick off a background refresh when the TTL has expired.
 *
 * Limits (chosen to bound memory while covering a small set of recent
 * workspaces):
 *   MAX_REPOS   — 4  (LRU eviction — oldest-accessed repo is dropped)
 *   MAX_ISSUES  — 200 per repo per section (open / closed)
 *   MAX_PR_LISTS — 8 repo/state combinations
 *   MAX_PRS      — 100 per repo/state list
 *   TTL          — 10 minutes
 */
import type {
  GitHubChecksSummary,
  GitHubIssue,
  GitHubIssueComment,
  GitHubPrReview,
  GitHubReviewComment,
  OpenPRItem,
  PrFile,
} from "@src/api/tauri/github";
import { BoundedMap } from "@src/util/collections/BoundedMap";
import {
  BROWSER_CACHE_STORAGE_KEYS,
  estimateBrowserStorageEntryBytes,
  setBrowserStorageItemWithRecovery,
} from "@src/util/core/storage/quotaRecovery";

const MAX_REPOS = 4;
const MAX_ISSUES_PER_SECTION = 200;
const MAX_PRS = 100;
const MAX_PR_LISTS = 8;
/** Distinct PR detail snapshots retained (LRU across all repos). */
const MAX_PR_DETAILS = 4;
const MAX_PERSISTED_ISSUES_PER_SECTION = 50;
const MAX_PERSISTED_PRS = 50;
export const GITHUB_ISSUES_PERSISTED_BUDGET_BYTES = 512 * 1024;
export const GITHUB_PRS_PERSISTED_BUDGET_BYTES = 256 * 1024;
export const GITHUB_LIST_CACHE_TTL_MS = 10 * 60 * 1000;

export interface CachedIssues {
  openIssues: GitHubIssue[];
  closedIssues: GitHubIssue[];
  openCachedAt: number | null;
  closedCachedAt: number | null;
}

export interface CachedPrs {
  prs: OpenPRItem[];
  cachedAt: number;
}

/** Full PR-detail snapshot for the tabbed detail view (Conversation/Commits/
 * Checks/Changes). Keyed by `${repoFullName}#${prNumber}`. */
export interface CachedPrDetail {
  detail: Record<string, unknown> | null;
  headSha: string | null;
  baseRef: string | null;
  conversation: GitHubIssueComment[];
  reviews: GitHubPrReview[];
  reviewComments: GitHubReviewComment[];
  commits: Record<string, unknown>[];
  files: PrFile[];
  checks: GitHubChecksSummary | null;
  cachedAt: number;
}

// `BoundedMap.get` promotes the key to most-recently-used and evicts the
// least-recently-touched entry once `maxSize` is reached; `peek` reads
// without touching, which the staleness checks rely on.
const issueCache = new BoundedMap<string, CachedIssues>({
  maxSize: MAX_REPOS,
  name: "githubListCache.issues",
});
const prCache = new BoundedMap<string, CachedPrs>({
  maxSize: MAX_PR_LISTS,
  name: "githubListCache.prs",
});
const inFlightListRequests = new Map<string, Promise<unknown>>();

/**
 * Reuses an in-flight list request across remounts and removes it on settle.
 * This prevents rapid tab switches from duplicating GitHub calls without
 * retaining completed promises or installing a cleanup timer.
 */
export function coalesceGitHubListRequest<T>(
  key: string,
  requestFactory: () => Promise<T>
): Promise<T> {
  const existing = inFlightListRequests.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const request = requestFactory().finally(() => {
    if (inFlightListRequests.get(key) === request) {
      inFlightListRequests.delete(key);
    }
  });
  inFlightListRequests.set(key, request);
  return request;
}

// ── Disk persistence (survive app restart) ──────────────────────────────────
//
// The list caches (issues + PRs) are persisted to the webview's localStorage so
// a cold start paints the last-seen lists instantly, then revalidates. The
// revalidation is cheap because the Rust client sends `If-None-Match` and gets
// a `304 Not Modified` back when nothing changed. Only the bounded list caches
// are persisted (not the heavier per-PR detail cache).

const STORAGE_KEY_ISSUES = BROWSER_CACHE_STORAGE_KEYS.githubIssues;
// v4 adds CI status to every PR list item. A key bump prevents older entries
// from rendering a missing wire field as an unknown table state.
const STORAGE_KEY_PRS = BROWSER_CACHE_STORAGE_KEYS.githubPullRequests;

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function hydrate<T>(storageKey: string, cache: BoundedMap<string, T>): void {
  const store = safeLocalStorage();
  if (!store) return;
  try {
    const raw = store.getItem(storageKey);
    if (!raw) return;
    const entries = JSON.parse(raw) as [string, T][];
    if (!Array.isArray(entries)) return;
    for (const [key, value] of entries) {
      cache.set(key, value);
    }
  } catch {
    // Corrupt/legacy payload — ignore and start fresh.
  }
}

function serializeCacheWithinBudget<T>(
  cache: BoundedMap<string, T>,
  budgetBytes: number,
  compact: (value: T) => T
): string {
  const entries = Array.from(cache.entries(), ([key, value]) => [
    key,
    compact(value),
  ]) as [string, T][];

  // Map order is least-recently-used first. Drop the oldest repo/list until
  // the UTF-16 payload fits the explicit localStorage budget.
  while (entries.length > 0) {
    const serialized = JSON.stringify(entries);
    if (estimateBrowserStorageEntryBytes("", serialized) <= budgetBytes) {
      return serialized;
    }
    entries.shift();
  }
  return "[]";
}

function compactIssuesForPersistence(value: CachedIssues): CachedIssues {
  return {
    ...value,
    openIssues: value.openIssues.slice(0, MAX_PERSISTED_ISSUES_PER_SECTION),
    closedIssues: value.closedIssues.slice(0, MAX_PERSISTED_ISSUES_PER_SECTION),
  };
}

function compactPrsForPersistence(value: CachedPrs): CachedPrs {
  return { ...value, prs: value.prs.slice(0, MAX_PERSISTED_PRS) };
}

function persist(storageKey: string, serialize: () => string): void {
  try {
    setBrowserStorageItemWithRecovery(storageKey, serialize());
  } catch {
    // Quota exceeded or serialization failure — the in-memory cache still works.
  }
}

const pendingPersistence = new Map<string, () => string>();
let persistenceTimer: ReturnType<typeof setTimeout> | null = null;

function flushPendingPersistence(): void {
  if (persistenceTimer) {
    clearTimeout(persistenceTimer);
    persistenceTimer = null;
  }
  for (const [storageKey, serialize] of pendingPersistence) {
    persist(storageKey, serialize);
  }
  pendingPersistence.clear();
}

function schedulePersist(storageKey: string, serialize: () => string): void {
  pendingPersistence.set(storageKey, serialize);
  if (persistenceTimer) return;
  persistenceTimer = setTimeout(flushPendingPersistence, 100);
}

export function flushGitHubListCachePersistence(): void {
  flushPendingPersistence();
}

hydrate(STORAGE_KEY_ISSUES, issueCache);
hydrate(STORAGE_KEY_PRS, prCache);

// ── Issues ────────────────────────────────────────────────────────────────────

export function getCachedIssues(repoKey: string): CachedIssues | null {
  return issueCache.get(repoKey) ?? null;
}

export type CachedIssueState = "open" | "closed";

export function isIssueCacheStale(
  repoKey: string,
  state: CachedIssueState = "open"
): boolean {
  const entry = issueCache.peek(repoKey);
  if (!entry) return true;
  const cachedAt = state === "open" ? entry.openCachedAt : entry.closedCachedAt;
  return (
    typeof cachedAt !== "number" ||
    Date.now() - cachedAt > GITHUB_LIST_CACHE_TTL_MS
  );
}

export function updateCachedOpenIssues(
  repoKey: string,
  openIssues: GitHubIssue[]
) {
  const existing = issueCache.get(repoKey);
  issueCache.set(repoKey, {
    openIssues: openIssues.slice(0, MAX_ISSUES_PER_SECTION),
    closedIssues: existing?.closedIssues ?? [],
    openCachedAt: Date.now(),
    closedCachedAt: existing?.closedCachedAt ?? null,
  });
  schedulePersist(STORAGE_KEY_ISSUES, () =>
    serializeCacheWithinBudget(
      issueCache,
      GITHUB_ISSUES_PERSISTED_BUDGET_BYTES,
      compactIssuesForPersistence
    )
  );
}

export function updateCachedClosedIssues(
  repoKey: string,
  closedIssues: GitHubIssue[]
) {
  const existing = issueCache.get(repoKey);
  issueCache.set(repoKey, {
    openIssues: existing?.openIssues ?? [],
    closedIssues: closedIssues.slice(0, MAX_ISSUES_PER_SECTION),
    openCachedAt: existing?.openCachedAt ?? null,
    closedCachedAt: Date.now(),
  });
  schedulePersist(STORAGE_KEY_ISSUES, () =>
    serializeCacheWithinBudget(
      issueCache,
      GITHUB_ISSUES_PERSISTED_BUDGET_BYTES,
      compactIssuesForPersistence
    )
  );
}

// ── Pull Requests ─────────────────────────────────────────────────────────────

export type CachedPrState = "open" | "closed";

function prCacheKey(repoKey: string, state: CachedPrState): string {
  return state === "open" ? repoKey : `${repoKey}:closed`;
}

export function getCachedPrs(
  repoKey: string,
  state: CachedPrState = "open"
): CachedPrs | null {
  return prCache.get(prCacheKey(repoKey, state)) ?? null;
}

export function isPrCacheStale(
  repoKey: string,
  state: CachedPrState = "open"
): boolean {
  const entry = prCache.peek(prCacheKey(repoKey, state));
  if (!entry) return true;
  return Date.now() - entry.cachedAt > GITHUB_LIST_CACHE_TTL_MS;
}

export function setCachedPrs(
  repoKey: string,
  prs: OpenPRItem[],
  state: CachedPrState = "open"
) {
  prCache.set(prCacheKey(repoKey, state), {
    prs: prs.slice(0, MAX_PRS),
    cachedAt: Date.now(),
  });
  schedulePersist(STORAGE_KEY_PRS, () =>
    serializeCacheWithinBudget(
      prCache,
      GITHUB_PRS_PERSISTED_BUDGET_BYTES,
      compactPrsForPersistence
    )
  );
}

// ── Pull Request detail ─────────────────────────────────────────────────────

const prDetailCache = new BoundedMap<string, CachedPrDetail>({
  maxSize: MAX_PR_DETAILS,
  name: "githubListCache.prDetails",
});

/** Cache key for a PR detail snapshot. */
export function prDetailKey(repoFullName: string, prNumber: number): string {
  return `${repoFullName}#${prNumber}`;
}

export function getCachedPrDetail(key: string): CachedPrDetail | null {
  return prDetailCache.get(key) ?? null;
}

export function isPrDetailStale(key: string): boolean {
  const entry = prDetailCache.peek(key);
  if (!entry) return true;
  return Date.now() - entry.cachedAt > GITHUB_LIST_CACHE_TTL_MS;
}

export function setCachedPrDetail(
  key: string,
  detail: Omit<CachedPrDetail, "cachedAt">
) {
  prDetailCache.set(key, { ...detail, cachedAt: Date.now() });
}

/**
 * Apply a successful GitHub mutation to an existing detail snapshot without
 * extending the snapshot's freshness window. Preserving `cachedAt` matters:
 * changing one conversation field must not make commits/checks/files look
 * freshly fetched for another ten minutes.
 */
export function updateCachedPrDetail(
  key: string,
  update: (current: CachedPrDetail) => Partial<Omit<CachedPrDetail, "cachedAt">>
): boolean {
  const current = prDetailCache.peek(key);
  if (!current) return false;
  prDetailCache.set(key, {
    ...current,
    ...update(current),
    cachedAt: current.cachedAt,
  });
  return true;
}
