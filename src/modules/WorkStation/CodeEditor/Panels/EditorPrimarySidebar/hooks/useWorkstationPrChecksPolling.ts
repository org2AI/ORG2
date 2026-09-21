/**
 * useWorkstationPrChecksPolling
 *
 * Keeps the open pull request's CI verdict live. The detail bundle is loaded
 * once per visit, so without this a check that was running when the panel
 * opened stays "running" until the panel is reopened.
 *
 * A re-poll reads two things: the pull request (head commit, merge state) and
 * the checks on that head. It deliberately does not reload the conversation,
 * commits or files — when the head moved or the pull request changed state the
 * poll hands over to the ordinary full reconcile instead of patching around it.
 *
 * Lifecycle, in the order things can go wrong:
 *  - one request at a time: a click during a scheduled poll joins it;
 *  - a result is dropped when the panel unmounted, the selection moved to
 *    another pull request, or a full load / mutation reconcile started after
 *    the poll was dispatched (that load carries fresher data);
 *  - an optimistic mutation in flight keeps its `detail`; only checks land;
 *  - nothing is fetched while the window is hidden or the panel is not
 *    rendered (a retained background tab). A hidden window resumes with one
 *    immediate poll when it returns; a background tab keeps a timer but makes
 *    no request until it is on screen again;
 *  - the schedule is `nextChecksPollDelayMs`, shared with the status-bar CI
 *    menu: fast while something can still change, bounded retries while CI has
 *    not registered, a five-minute safety refresh once everything reported.
 *    A new head commit or a manual refresh restarts the fast interval;
 *  - merged and closed pull requests are not polled;
 *  - reads go through `pullRequestHeadChecks`, shared with the status bar and
 *    any other panel on the same pull request: concurrent reads are one
 *    request, and an answer anyone fetched is applied here and restarts this
 *    timer, so N surfaces cost one request per interval, not N.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";

import { createLogger } from "@src/hooks/logger";
import { nextChecksPollDelayMs } from "@src/services/git/branchPullRequestStatus";
import {
  prDetailKey,
  updateCachedPrDetail,
} from "@src/services/git/githubListCache";
import {
  PULL_REQUEST_HEAD_CHECKS_REUSE_MS,
  type PullRequestHeadChecks,
  loadPullRequestHeadChecks,
  subscribePullRequestHeadChecks,
} from "@src/services/git/pullRequestHeadChecks";
import {
  type PrIdentity,
  workstationSelectedPrAtomFamily,
} from "@src/store/workstation/codeEditor/workstationSelectedPrAtom";
import { resolvePullRequestDetailStatus } from "@src/util/git/pr/prLevelActions";

const logger = createLogger("WorkstationPrChecksPolling");

export interface UseWorkstationPrChecksPollingOptions {
  repoFullName: string | null;
  pr: PrIdentity | null;
  scopeKey: string;
  mountedRef: React.RefObject<boolean>;
  /** Per-PR load counters owned by `useWorkstationPrDetail`. */
  requestIdsRef: React.RefObject<Map<string, number>>;
  /** A PR-level mutation is applying its optimistic patch. */
  prActionPending: boolean;
  /** The guarded full reload, for when a poll finds more than checks moved. */
  reconcile: (pr: PrIdentity) => void;
  /** The panel's root; polls are skipped while it is not rendered. */
  visibilityRef?: React.RefObject<HTMLElement | null>;
}

function isRendered(element: HTMLElement | null | undefined): boolean {
  // Not attached yet (loading skeleton) counts as rendered: nothing is polled
  // while loading anyway, and a missing probe must never silence polling.
  if (!element) return true;
  if (typeof element.checkVisibility !== "function") return true;
  return element.checkVisibility();
}

function isWindowHidden(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

export function useWorkstationPrChecksPolling({
  repoFullName,
  pr,
  scopeKey,
  mountedRef,
  requestIdsRef,
  prActionPending,
  reconcile,
  visibilityRef,
}: UseWorkstationPrChecksPollingOptions): {
  refreshChecks: () => Promise<void>;
} {
  const state = useAtomValue(workstationSelectedPrAtomFamily(scopeKey));
  const setSelectedPr = useSetAtom(workstationSelectedPrAtomFamily(scopeKey));

  const prNumber = pr?.number ?? null;
  const pollKey =
    repoFullName && prNumber !== null
      ? prDetailKey(repoFullName, prNumber)
      : null;

  // Latest values for the async body, so its identity does not churn with
  // every atom write and restart the timer.
  const latestRef = useRef({ pr, state, prActionPending, reconcile });
  useEffect(() => {
    latestRef.current = { pr, state, prActionPending, reconcile };
  }, [pr, state, prActionPending, reconcile]);

  const generationRef = useRef(0);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const attemptRef = useRef(0);
  const polledHeadShaRef = useRef<string | null>(null);
  const dueWhileHiddenRef = useRef(false);
  // Bumped after every finished poll (and every skipped one) so the schedule
  // effect re-arms even when the poll failed and wrote no new checks.
  const [pollTick, setPollTick] = useState(0);

  // A different pull request is a different CI timeline: orphan whatever is in
  // flight and start the backoff over.
  useEffect(() => {
    return () => {
      generationRef.current += 1;
      inFlightRef.current = null;
      attemptRef.current = 0;
      polledHeadShaRef.current = null;
      dueWhileHiddenRef.current = false;
    };
  }, [pollKey]);

  // Names this panel in the answers it fetches, so it can tell its own from a
  // neighbour's when they are published.
  const sourceRef = useRef({});

  /** Land one answer — this panel's own or one another surface fetched. */
  const applySnapshot = useCallback(
    (identity: PrIdentity, key: string, snapshot: PullRequestHeadChecks) => {
      const { detail, headSha, checks } = snapshot;
      const shown = latestRef.current.state;
      const statusMoved =
        resolvePullRequestDetailStatus(detail, identity.status) !==
        resolvePullRequestDetailStatus(shown.detail, identity.status);
      if (!headSha || !checks || headSha !== shown.headSha || statusMoved) {
        // Commits, files and the timeline moved with it — not a checks patch.
        latestRef.current.reconcile(identity);
        return;
      }

      const keepDetail = latestRef.current.prActionPending;
      setSelectedPr((prev) => ({
        ...prev,
        checks,
        detail: keepDetail ? prev.detail : detail,
      }));
      updateCachedPrDetail(key, () =>
        keepDetail ? { checks } : { checks, detail }
      );
    },
    [setSelectedPr]
  );

  const runPoll = useCallback(
    (maxAgeMs: number): Promise<void> => {
      const current = latestRef.current;
      if (!repoFullName || !pollKey || !current.pr) return Promise.resolve();
      if (inFlightRef.current) return inFlightRef.current;

      const identity = current.pr;
      const generation = generationRef.current;
      const requestIdAtDispatch = requestIdsRef.current.get(pollKey);
      const isCurrent = () =>
        mountedRef.current && generationRef.current === generation;
      const isSuperseded = () =>
        requestIdsRef.current.get(pollKey) !== requestIdAtDispatch;

      setSelectedPr((prev) => ({ ...prev, refreshingChecks: true }));

      const poll = (async () => {
        try {
          // Shared with the status bar and any other panel on this pull
          // request: whoever asks first fetches, the rest take that answer.
          const snapshot = await loadPullRequestHeadChecks(
            repoFullName,
            identity.number,
            { maxAgeMs, source: sourceRef.current }
          );
          if (!isCurrent() || isSuperseded()) return;
          applySnapshot(identity, pollKey, snapshot);
        } catch (error) {
          // A failed poll keeps the last good verdict; the schedule retries.
          logger.warn("checks poll failed", error);
        } finally {
          // Single flight per generation: an unchanged generation means the
          // slot still holds this poll. A changed one already cleared it, and
          // may have handed it to the next pull request's poll.
          if (generationRef.current === generation) inFlightRef.current = null;
          if (isCurrent()) {
            setSelectedPr((prev) => ({ ...prev, refreshingChecks: false }));
            setPollTick((tick) => tick + 1);
          }
        }
      })();
      inFlightRef.current = poll;
      return poll;
    },
    [
      applySnapshot,
      mountedRef,
      pollKey,
      repoFullName,
      requestIdsRef,
      setSelectedPr,
    ]
  );

  // Timers and event listeners cannot await. `runPoll` settles its own
  // failures, so this handler only exists to leave no promise unobserved.
  const startPoll = useCallback(
    (maxAgeMs: number): void => {
      runPoll(maxAgeMs).catch((error: unknown) => {
        logger.warn("checks poll failed", error);
      });
    },
    [runPoll]
  );

  /** Asking by hand is a signal of interest: back to the fast interval. */
  const refreshChecks = useCallback((): Promise<void> => {
    attemptRef.current = 0;
    // A click wants GitHub's answer, not one another surface fetched earlier.
    return runPoll(0);
  }, [runPoll]);

  const status = resolvePullRequestDetailStatus(state.detail, pr?.status ?? "");
  const pollable =
    pollKey !== null &&
    !state.loading &&
    state.headSha !== null &&
    (status === "open" || status === "draft");
  const { headSha, checks } = state;

  useEffect(() => {
    if (!pollable) return undefined;

    if (polledHeadShaRef.current !== headSha) {
      polledHeadShaRef.current = headSha;
      attemptRef.current = 0;
    }

    const delay = nextChecksPollDelayMs({
      attempt: attemptRef.current,
      checks,
    });
    const timer = window.setTimeout(() => {
      if (isWindowHidden()) {
        // No timers while hidden; `visibilitychange` resumes with one poll.
        dueWhileHiddenRef.current = true;
        return;
      }
      if (!isRendered(visibilityRef?.current)) {
        // A retained background tab has no "shown" event to wait for, so keep
        // the (network-free) timer and look again at the same interval.
        setPollTick((tick) => tick + 1);
        return;
      }
      attemptRef.current += 1;
      startPoll(PULL_REQUEST_HEAD_CHECKS_REUSE_MS);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [checks, headSha, pollTick, pollable, startPoll, visibilityRef]);

  // Another surface on this pull request — the status bar, a second panel —
  // just fetched: take its answer now and restart this timer, rather than
  // fetch the same thing again when this timer would have fired.
  useEffect(() => {
    if (!pollable || !repoFullName || prNumber === null || !pollKey) {
      return undefined;
    }
    return subscribePullRequestHeadChecks((event) => {
      if (
        event.source === sourceRef.current ||
        event.repoFullName !== repoFullName ||
        event.prNumber !== prNumber
      ) {
        return;
      }
      const identity = latestRef.current.pr;
      // A poll of this panel's own is in flight: it lands the same or newer.
      if (!identity || !mountedRef.current || inFlightRef.current) return;
      applySnapshot(identity, pollKey, event.snapshot);
      setPollTick((tick) => tick + 1);
    });
  }, [applySnapshot, mountedRef, pollKey, pollable, prNumber, repoFullName]);

  useEffect(() => {
    if (!pollable || typeof document === "undefined") return undefined;
    const handleVisibilityChange = () => {
      if (isWindowHidden() || !dueWhileHiddenRef.current) return;
      dueWhileHiddenRef.current = false;
      attemptRef.current = 0;
      startPoll(PULL_REQUEST_HEAD_CHECKS_REUSE_MS);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [pollable, startPoll]);

  return { refreshChecks };
}
