/**
 * Pull-request status cache for session list rows.
 *
 * The sidebar wants a real open / draft / merged / closed state per session
 * branch, but a per-session lookup would be one API round trip per row. This
 * cache is keyed by REPO instead: two list calls (`open` + `closed`, both
 * sorted by recency) cover every branch in that repo at once, so a sidebar
 * showing 200 sessions across 3 repos costs 6 requests, not 200.
 *
 * Memory is bounded on three axes so a long-lived window cannot grow without
 * limit: at most {@link PR_STATUS_CACHE_CONFIG.MAX_REPOS} repos are tracked
 * (least-recently-fetched evicted first), at most
 * {@link PR_STATUS_CACHE_CONFIG.MAX_BRANCHES_PER_REPO} branches are retained
 * per repo, and each entry stores four scalars — never the raw PR payload.
 */
import { atom } from "jotai";

import type { OpenPRItem } from "@src/api/tauri/github/pullRequests";
import { normalizePrStatus } from "@src/util/git/pr/prStatus";

export const PR_STATUS_CACHE_CONFIG = {
  /** Refetch a repo once its snapshot is older than this. */
  TTL_MS: 5 * 60 * 1000,
  /** Distinct repos held in memory at once. */
  MAX_REPOS: 8,
  /** Branch entries retained per repo, newest-updated first. */
  MAX_BRANCHES_PER_REPO: 200,
  /** Page size for each of the two list calls per repo. */
  PAGE_SIZE: 100,
  /** Backoff after a failed fetch, so an unauthenticated repo is not hammered. */
  ERROR_RETRY_MS: 10 * 60 * 1000,
} as const;

/** Everything a row needs from a PR — deliberately not the whole payload. */
export interface BranchPrSnapshot {
  /** Normalized: `open` | `draft` | `merged` | `closed`. */
  status: string;
  number: number;
  url: string;
  title: string;
}

export interface RepoPrSnapshot {
  fetchedAt: number;
  /** Head branch → its newest PR. Empty on a failed fetch. */
  byBranch: Map<string, BranchPrSnapshot>;
  /** Set when the last fetch failed; suppresses refetch until `retryAt`. */
  error?: boolean;
  retryAt?: number;
}

/** repoFullName (`owner/repo`) → snapshot. */
export const repoPrStatusCacheAtom = atom<Map<string, RepoPrSnapshot>>(
  new Map()
);
repoPrStatusCacheAtom.debugLabel = "repoPrStatusCacheAtom";

export function isRepoPrStatusStale(
  cached: RepoPrSnapshot | undefined,
  now: number = Date.now()
): boolean {
  if (!cached) return true;
  if (cached.error) return now >= (cached.retryAt ?? 0);
  return now - cached.fetchedAt >= PR_STATUS_CACHE_CONFIG.TTL_MS;
}

/**
 * Fold the two list responses into one branch → PR map.
 *
 * `open` is applied last so a branch that has both a stale closed PR and a
 * live open one resolves to the open one. Within a single response the API's
 * `sort=updated&direction=desc` ordering means the first entry for a branch is
 * its newest PR, so later duplicates are dropped.
 */
export function buildRepoPrSnapshot(
  responses: { open: OpenPRItem[]; closed: OpenPRItem[] },
  now: number = Date.now()
): RepoPrSnapshot {
  const byBranch = new Map<string, BranchPrSnapshot>();
  for (const items of [responses.closed, responses.open]) {
    // Scoped per pass: within one response the first entry for a branch is
    // its newest PR and wins, but the open pass must still overwrite whatever
    // the closed pass left behind.
    const claimed = new Set<string>();
    for (const item of items) {
      const branch = item.head_branch?.trim();
      if (!branch || claimed.has(branch)) continue;
      if (
        byBranch.size >= PR_STATUS_CACHE_CONFIG.MAX_BRANCHES_PER_REPO &&
        !byBranch.has(branch)
      ) {
        continue;
      }
      claimed.add(branch);
      byBranch.set(branch, {
        // The Rust command already rewrites a merged PR's state, but draft
        // only ever arrives as a separate boolean.
        status: normalizePrStatus({ state: item.state, draft: item.draft }),
        number: item.number,
        url: item.url,
        title: item.title,
      });
    }
  }
  return { fetchedAt: now, byBranch };
}

/**
 * Drop repos that are no longer on screen, then evict the least recently
 * fetched until the cache is back under the repo cap. `activeRepos` is the
 * set the sidebar currently cares about — anything outside it is free to go
 * even if it is still fresh.
 */
export function pruneRepoPrStatusCache(
  cache: Map<string, RepoPrSnapshot>,
  activeRepos: ReadonlySet<string>
): Map<string, RepoPrSnapshot> {
  const retained = new Map(
    [...cache].filter(([repoFullName]) => activeRepos.has(repoFullName))
  );
  if (retained.size <= PR_STATUS_CACHE_CONFIG.MAX_REPOS) return retained;

  const byAge = [...retained].sort(
    ([, left], [, right]) => right.fetchedAt - left.fetchedAt
  );
  return new Map(byAge.slice(0, PR_STATUS_CACHE_CONFIG.MAX_REPOS));
}
