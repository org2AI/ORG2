/**
 * One reader for "this pull request's head commit and the checks on it".
 *
 * Several surfaces trace the same CI run at once: the status bar follows the
 * checked-out branch's pull request, and every mounted pull-request detail
 * panel follows the one it shows — the same one, when the viewed pull request
 * is the checked-out branch or is open in two panes. Each used to issue its
 * own `get PR` + `get checks` pair on its own timer.
 *
 * Callers still own their schedules and lifecycles; this module only makes
 * sure that however many of them ask, GitHub is asked once:
 *  - concurrent callers join the request already in flight;
 *  - a scheduled poll passes `maxAgeMs` and takes an answer another surface
 *    fetched moments ago instead of fetching again;
 *  - a read that must not see older data (manual refresh, after a push or a
 *    mutation) passes `maxAgeMs: 0`, and `bypassInFlight` when even a request
 *    already on the wire may predate the change;
 *  - every accepted answer is published, so the other surfaces apply it and
 *    restart their timers instead of fetching it again a few seconds later;
 *  - `invalidate` makes a change visible to everyone: the cached answer is
 *    dropped and a request dispatched before it can no longer be joined or
 *    cached.
 */
import {
  type GitHubChecksSummary,
  getChecksLocal,
  getPRLocal,
} from "@src/api/tauri/github";
import { BoundedMap } from "@src/util/collections/BoundedMap";

import { BRANCH_CI_POLL_BASE_MS } from "./branchPullRequestStatus";

/** Reuse window for scheduled polls: half the fastest poll interval. */
export const PULL_REQUEST_HEAD_CHECKS_REUSE_MS = BRANCH_CI_POLL_BASE_MS / 2;

const MAX_TRACKED_PULL_REQUESTS = 32;

export interface PullRequestHeadChecks {
  /** Raw `github_get_pr` payload. */
  detail: Record<string, unknown>;
  headSha: string | null;
  /** Null when the pull request reported no head commit to read checks for. */
  checks: GitHubChecksSummary | null;
  fetchedAt: number;
}

export interface LoadPullRequestHeadChecksOptions {
  /** Accept an answer fetched at most this long ago. Default 0: always ask. */
  maxAgeMs?: number;
  /** Do not join a request already in flight; it may predate a change. */
  bypassInFlight?: boolean;
  /** Identifies the reader in the event its answer is published with. */
  source?: unknown;
}

/** `order` ranks answers by when they were asked for, not when they landed. */
type RecentEntry = PullRequestHeadChecks & { order: number };
let nextOrder = 0;

export interface PullRequestHeadChecksEvent {
  repoFullName: string;
  prNumber: number;
  snapshot: PullRequestHeadChecks;
  /** Whatever the reader passed as `source`, so it can skip its own answer. */
  source: unknown;
}
type Listener = (event: PullRequestHeadChecksEvent) => void;
const listeners = new Set<Listener>();

function publish(event: PullRequestHeadChecksEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch {
      // One surface failing to apply an answer must not cost the reader, or
      // the other surfaces, theirs.
    }
  }
}

const recent = new BoundedMap<string, RecentEntry>({
  maxSize: MAX_TRACKED_PULL_REQUESTS,
  name: "pullRequestHeadChecks.recent",
});
/** Bumped by `invalidate`; a request remembers the epoch it started in. */
const epochs = new BoundedMap<string, number>({
  maxSize: MAX_TRACKED_PULL_REQUESTS,
  name: "pullRequestHeadChecks.epochs",
});
const inFlight = new Map<
  string,
  { epoch: number; request: Promise<PullRequestHeadChecks> }
>();

function keyOf(repoFullName: string, prNumber: number): string {
  return `${repoFullName}#${prNumber}`;
}

function readHeadSha(detail: Record<string, unknown>): string | null {
  const head = detail.head;
  if (!head || typeof head !== "object") return null;
  const sha = (head as Record<string, unknown>).sha;
  return typeof sha === "string" && sha ? sha : null;
}

async function fetchHeadChecks(
  repoFullName: string,
  prNumber: number
): Promise<PullRequestHeadChecks> {
  const detail = await getPRLocal(repoFullName, prNumber);
  const headSha = readHeadSha(detail);
  const checks = headSha ? await getChecksLocal(repoFullName, headSha) : null;
  return { detail, headSha, checks, fetchedAt: Date.now() };
}

export function loadPullRequestHeadChecks(
  repoFullName: string,
  prNumber: number,
  {
    maxAgeMs = 0,
    bypassInFlight = false,
    source,
  }: LoadPullRequestHeadChecksOptions = {}
): Promise<PullRequestHeadChecks> {
  const key = keyOf(repoFullName, prNumber);
  const epoch = epochs.get(key) ?? 0;

  if (maxAgeMs > 0) {
    const cached = recent.get(key);
    if (cached && Date.now() - cached.fetchedAt <= maxAgeMs) {
      return Promise.resolve(cached);
    }
  }

  const pending = inFlight.get(key);
  if (pending && pending.epoch === epoch && !bypassInFlight) {
    return pending.request;
  }

  const order = (nextOrder += 1);
  const request = fetchHeadChecks(repoFullName, prNumber)
    .then((result) => {
      // Invalidated while on the wire: hand the answer to whoever asked, but
      // never let anyone else take it for current. Likewise a slow request
      // must not replace the answer to one that was asked after it.
      const newer = recent.peek(key);
      if ((epochs.get(key) ?? 0) === epoch && (!newer || newer.order < order)) {
        recent.set(key, { ...result, order });
        publish({ repoFullName, prNumber, snapshot: result, source });
      }
      return result;
    })
    .finally(() => {
      if (inFlight.get(key)?.request === request) inFlight.delete(key);
    });
  inFlight.set(key, { epoch, request });
  return request;
}

/** Something changed the pull request: forget what was read before it. */
export function invalidatePullRequestHeadChecks(
  repoFullName: string,
  prNumber: number
): void {
  const key = keyOf(repoFullName, prNumber);
  epochs.set(key, (epochs.get(key) ?? 0) + 1);
  recent.delete(key);
}

/** Capture before a read that will later be offered through `prime`. */
export function pullRequestHeadChecksEpoch(
  repoFullName: string,
  prNumber: number
): number {
  return epochs.get(keyOf(repoFullName, prNumber)) ?? 0;
}

/**
 * A full detail load already read both halves; share them — unless the pull
 * request was invalidated after that load was dispatched (`epoch` is what
 * `pullRequestHeadChecksEpoch` returned at dispatch).
 */
export function primePullRequestHeadChecks(
  repoFullName: string,
  prNumber: number,
  snapshot: Omit<PullRequestHeadChecks, "fetchedAt">,
  epoch: number
): void {
  const key = keyOf(repoFullName, prNumber);
  if ((epochs.get(key) ?? 0) !== epoch) return;
  const result = { ...snapshot, fetchedAt: Date.now() };
  recent.set(key, { ...result, order: (nextOrder += 1) });
  publish({ repoFullName, prNumber, snapshot: result, source: undefined });
}

/**
 * Hear every accepted answer, whoever asked. A surface that applies it and
 * restarts its own timer never has to fetch what a neighbour just fetched —
 * which is what turns N pollers on one pull request into one request per
 * interval, with no surface showing older data than another.
 */
export function subscribePullRequestHeadChecks(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearPullRequestHeadChecks(): void {
  recent.clear();
  epochs.clear();
  inFlight.clear();
}
