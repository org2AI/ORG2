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
 *  - merged and closed pull requests are not polled.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";

import { getChecksLocal, getPRLocal } from "@src/api/tauri/github";
import { createLogger } from "@src/hooks/logger";
import { nextChecksPollDelayMs } from "@src/services/git/branchPullRequestStatus";
import {
  prDetailKey,
  updateCachedPrDetail,
} from "@src/services/git/githubListCache";
import {
  type PrIdentity,
  workstationSelectedPrAtomFamily,
} from "@src/store/workstation/codeEditor/workstationSelectedPrAtom";
import { resolvePullRequestDetailStatus } from "@src/util/git/pr/prLevelActions";

import { readString } from "./workstationPrDetailFetch";

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

  const runPoll = useCallback((): Promise<void> => {
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
        const detail = await getPRLocal(repoFullName, identity.number);
        if (!isCurrent() || isSuperseded()) return;

        const shown = latestRef.current.state;
        const headSha = readString(detail, ["head", "sha"]);
        const statusMoved =
          resolvePullRequestDetailStatus(detail, identity.status) !==
          resolvePullRequestDetailStatus(shown.detail, identity.status);
        if (!headSha || headSha !== shown.headSha || statusMoved) {
          // Commits, files and the timeline moved with it — not a checks patch.
          latestRef.current.reconcile(identity);
          return;
        }

        const checks = await getChecksLocal(repoFullName, headSha);
        if (!isCurrent() || isSuperseded()) return;

        const keepDetail = latestRef.current.prActionPending;
        setSelectedPr((prev) => ({
          ...prev,
          checks,
          detail: keepDetail ? prev.detail : detail,
        }));
        updateCachedPrDetail(pollKey, () =>
          keepDetail ? { checks } : { checks, detail }
        );
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
  }, [mountedRef, pollKey, repoFullName, requestIdsRef, setSelectedPr]);

  /** Asking by hand is a signal of interest: back to the fast interval. */
  const refreshChecks = useCallback((): Promise<void> => {
    attemptRef.current = 0;
    return runPoll();
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
      void runPoll();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [checks, headSha, pollTick, pollable, runPoll, visibilityRef]);

  useEffect(() => {
    if (!pollable || typeof document === "undefined") return undefined;
    const handleVisibilityChange = () => {
      if (isWindowHidden() || !dueWhileHiddenRef.current) return;
      dueWhileHiddenRef.current = false;
      attemptRef.current = 0;
      void runPoll();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [pollable, runPoll]);

  return { refreshChecks };
}
