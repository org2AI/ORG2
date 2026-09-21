import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getGitDefaultBranch } from "@src/api/http/git/branches";
import { getGitRemotes } from "@src/api/http/git/remotes";
import {
  type GitHubChecksSummary,
  findPullRequestLocal,
  getGitCredentialForRemote,
} from "@src/api/tauri/github";
import {
  type BranchCiStatus,
  type BranchPullRequestStatusSnapshot,
  buildBranchPullRequestStatusKey,
  buildGitHubCompareUrl,
  evictOtherBranchPullRequestStatusIdentities,
  getCachedBranchPullRequestStatus,
  isBranchPullRequestStatusFresh,
  loadBranchPullRequestStatusCoalesced,
  nextBranchCiPollDelayMs,
  resolveBranchCiStatus,
  setCachedBranchPullRequestStatus,
} from "@src/services/git/branchPullRequestStatus";
import { parseGithubRepoFullName } from "@src/services/git/operations/createPullRequest";
import {
  type LoadPullRequestHeadChecksOptions,
  PULL_REQUEST_HEAD_CHECKS_REUSE_MS,
  loadPullRequestHeadChecks,
  subscribePullRequestHeadChecks,
} from "@src/services/git/pullRequestHeadChecks";
import {
  BRANCH_REMOTE_MUTATION_EVENT,
  type BranchRemoteMutationDetail,
  isMatchingBranchRemoteMutation,
} from "@src/util/git/branchRemoteMutation";

const GITHUB_ENDPOINT = "https://github.com";

interface BranchPullRequestStatusState extends BranchPullRequestStatusSnapshot {
  compareUrl: string | null;
  defaultBranch: string | null;
  lastFetchedAt: number | null;
  loading: boolean;
  refreshing: boolean;
  repoFullName: string | null;
  scopeKey: string | null;
}

const EMPTY_STATE: BranchPullRequestStatusState = {
  compareUrl: null,
  defaultBranch: null,
  lastFetchedAt: null,
  pr: null,
  checks: null,
  checksUnavailable: false,
  loading: false,
  refreshing: false,
  repoFullName: null,
  scopeKey: null,
};

export interface UseBranchPullRequestStatusOptions {
  branchName?: string;
  /** Local HEAD identity; a change forces a fresh PR-head/check read. */
  headRevision?: string;
  repoId?: string;
  repoPath?: string;
  /**
   * Keep re-reading CI while checks can still change, stopping once every run
   * has reported. Off by default — only surfaces that visibly trace CI (the
   * status-bar menu) should pay for the extra requests. See
   * {@link nextBranchCiPollDelayMs} for the schedule.
   */
  poll?: boolean;
}

export interface UseBranchPullRequestStatusResult extends Omit<
  BranchPullRequestStatusState,
  "scopeKey"
> {
  ciStatus: BranchCiStatus | null;
  /** Re-reads PR + checks now, bypassing the status TTL. */
  refresh: () => void;
}

function isGitHubRemote(remoteUrl: string): boolean {
  return /(?:^|@|\/\/)github\.com(?::|\/)/i.test(remoteUrl);
}

interface BranchStatusLoadOptions {
  force?: boolean;
  /** Fired by the poll timer rather than by a person, a push or a remount. */
  scheduled?: boolean;
}

function resolveAuthScope(
  credential: {
    connection_id: string;
    source: string;
    username: string;
  } | null
): string {
  return credential
    ? `${credential.connection_id}:${credential.source}:${credential.username}`
    : "anonymous";
}

async function fetchStatusSnapshot(
  repoFullName: string,
  branchName: string,
  headChecksOptions: LoadPullRequestHeadChecksOptions
): Promise<BranchPullRequestStatusSnapshot> {
  const foundPr = await findPullRequestLocal(repoFullName, branchName);
  const pr =
    foundPr?.state.toLowerCase() === "open" && foundPr.number > 0
      ? foundPr
      : null;
  if (!pr) {
    return { pr: null, checks: null, checksUnavailable: false };
  }

  let checks: GitHubChecksSummary | null = null;
  let checksUnavailable = false;
  try {
    // The pull-request detail panel traces the same head when this branch's
    // pull request is open there; the shared reader asks GitHub once for both.
    const head = await loadPullRequestHeadChecks(
      repoFullName,
      pr.number,
      headChecksOptions
    );
    if (!head.headSha || !head.checks) {
      throw new Error("Pull request head SHA is unavailable");
    }
    checks = head.checks;
  } catch {
    checksUnavailable = true;
  }
  return { pr, checks, checksUnavailable };
}

export function useBranchPullRequestStatus({
  branchName,
  headRevision,
  repoId,
  repoPath,
  poll = false,
}: UseBranchPullRequestStatusOptions): UseBranchPullRequestStatusResult {
  const [state, setState] = useState<BranchPullRequestStatusState>(EMPTY_STATE);
  const generationRef = useRef(0);
  const loadRef = useRef<((options?: BranchStatusLoadOptions) => void) | null>(
    null
  );
  // What the last successful load traced, so an answer another surface
  // fetched for the same pull request can be recognised and landed.
  const tracedRef = useRef<{
    cacheKey: string;
    repoFullName: string;
    snapshot: BranchPullRequestStatusSnapshot;
  } | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const pollAttemptRef = useRef(0);
  const pollHeadShaRef = useRef<string | null>(null);
  const remoteMutationVersionRef = useRef(0);
  const appliedRemoteMutationVersionRef = useRef(0);
  const observedHeadRef = useRef<{
    scopeKey: string | null;
    revision?: string;
  } | null>(null);
  const scopeKey =
    repoPath && branchName
      ? `${repoId ?? "default"}|${repoPath}|${branchName}`
      : null;

  useEffect(() => {
    let disposed = false;

    const previousHead = observedHeadRef.current;
    const localHeadChanged =
      previousHead?.scopeKey === scopeKey &&
      previousHead.revision !== undefined &&
      previousHead.revision !== headRevision;
    observedHeadRef.current = { scopeKey, revision: headRevision };
    if (localHeadChanged) remoteMutationVersionRef.current += 1;

    // Names this hook's reads, so it can skip its own published answers.
    const source = {};
    tracedRef.current = null;

    const clearPollTimer = () => {
      if (pollTimerRef.current != null) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };

    // A different repo/branch is a different CI timeline — restart the backoff.
    pollAttemptRef.current = 0;
    pollHeadShaRef.current = null;

    if (!repoPath || !branchName) {
      generationRef.current += 1;
      loadRef.current = null;
      clearPollTimer();
      return;
    }

    // A new head commit restarts the backoff, so a push is picked up at the
    // fast interval instead of inheriting the previous run's cooled-off delay.
    const scheduleNextPoll = (snapshot: BranchPullRequestStatusSnapshot) => {
      clearPollTimer();
      if (!poll || disposed) return;

      const headSha = snapshot.checks?.sha ?? null;
      if (headSha !== pollHeadShaRef.current) {
        pollHeadShaRef.current = headSha;
        pollAttemptRef.current = 0;
      }

      const delay = nextBranchCiPollDelayMs({
        ...snapshot,
        attempt: pollAttemptRef.current,
      });
      if (delay == null) return;

      pollAttemptRef.current += 1;
      pollTimerRef.current = window.setTimeout(() => {
        loadRef.current?.({ force: true, scheduled: true });
      }, delay);
    };

    const load = async (options?: BranchStatusLoadOptions) => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      const force = options?.force === true;
      const mutationVersion = remoteMutationVersionRef.current;
      const generation = ++generationRef.current;
      const isCurrent = () => !disposed && generation === generationRef.current;

      const [remotes, defaultBranchResult, credentialResult] =
        await Promise.all([
          getGitRemotes({
            repo_id: repoId ?? "default",
            repo_path: repoPath,
          }).catch(() => null),
          getGitDefaultBranch({
            repo_id: repoId ?? "default",
            repo_path: repoPath,
            remote: "origin",
          }).catch(() => null),
          getGitCredentialForRemote(GITHUB_ENDPOINT).catch(() => null),
        ]);
      if (!isCurrent()) return;

      const origin = remotes?.remotes?.find(
        (remote) => remote.name === "origin"
      );
      if (!origin?.url || !isGitHubRemote(origin.url)) {
        clearPollTimer();
        setState(EMPTY_STATE);
        return;
      }

      const repoFullName = parseGithubRepoFullName(origin.url);
      if (!repoFullName) {
        clearPollTimer();
        setState(EMPTY_STATE);
        return;
      }

      const defaultBranch = defaultBranchResult?.name || "main";
      const compareUrl = buildGitHubCompareUrl(
        repoFullName,
        defaultBranch,
        branchName
      );
      const authScope = resolveAuthScope(credentialResult);
      evictOtherBranchPullRequestStatusIdentities({
        activeAuthScope: authScope,
        repoFullName,
      });
      const cacheKey = buildBranchPullRequestStatusKey({
        authScope,
        branchName,
        repoFullName,
      });
      const cached = getCachedBranchPullRequestStatus(cacheKey);
      const cachedIsFresh = !force && isBranchPullRequestStatusFresh(cached);

      setState({
        compareUrl,
        defaultBranch,
        repoFullName,
        pr: cached?.pr ?? null,
        checks: cached?.checks ?? null,
        checksUnavailable: cached?.checksUnavailable ?? false,
        lastFetchedAt: cached?.fetchedAt ?? null,
        loading: !cached,
        refreshing: Boolean(cached && !cachedIsFresh),
        scopeKey,
      });
      if (cachedIsFresh) {
        if (cached) scheduleNextPoll(cached);
        return;
      }

      try {
        // A mutation version change uses a new coalescing lane. If a push
        // lands while an older GitHub request is in flight, the forced read
        // must not join that pre-push promise and preserve stale green CI.
        const requestKey = `${cacheKey}|remote:${remoteMutationVersionRef.current}`;
        // A timer poll may take the answer another surface fetched moments
        // ago. A read someone asked for must reach GitHub, and one that
        // follows a push must not even join a request dispatched before it.
        const headChecksOptions: LoadPullRequestHeadChecksOptions =
          options?.scheduled || !force
            ? { maxAgeMs: PULL_REQUEST_HEAD_CHECKS_REUSE_MS, source }
            : {
                source,
                maxAgeMs: 0,
                bypassInFlight:
                  appliedRemoteMutationVersionRef.current !== mutationVersion,
              };
        const snapshot = await loadBranchPullRequestStatusCoalesced(
          requestKey,
          () => fetchStatusSnapshot(repoFullName, branchName, headChecksOptions)
        );
        if (!isCurrent()) return;
        const fetchedAt = Date.now();
        setCachedBranchPullRequestStatus(cacheKey, snapshot, fetchedAt);
        setState({
          compareUrl,
          defaultBranch,
          repoFullName,
          ...snapshot,
          lastFetchedAt: fetchedAt,
          loading: false,
          refreshing: false,
          scopeKey,
        });
        appliedRemoteMutationVersionRef.current = mutationVersion;
        tracedRef.current = { cacheKey, repoFullName, snapshot };
        scheduleNextPoll(snapshot);
      } catch {
        if (!isCurrent()) return;
        // Leave the poll timer cleared: a failed read is retried by an
        // explicit refresh or the next visibility return, not by a timer.
        clearPollTimer();
        setState((current) => ({
          ...current,
          loading: false,
          refreshing: false,
        }));
      }
    };

    loadRef.current = (options) => {
      void load(options);
    };

    // A pull-request detail panel on the same pull request just fetched its
    // head's checks: take that answer and restart this timer instead of
    // fetching it again when this timer would have fired.
    const unsubscribeHeadChecks = subscribePullRequestHeadChecks((event) => {
      const traced = tracedRef.current;
      if (
        disposed ||
        event.source === source ||
        !traced?.snapshot.pr ||
        traced.repoFullName !== event.repoFullName ||
        traced.snapshot.pr.number !== event.prNumber ||
        !event.snapshot.checks
      ) {
        return;
      }
      const snapshot: BranchPullRequestStatusSnapshot = {
        pr: traced.snapshot.pr,
        checks: event.snapshot.checks,
        checksUnavailable: false,
      };
      tracedRef.current = { ...traced, snapshot };
      setCachedBranchPullRequestStatus(
        traced.cacheKey,
        snapshot,
        event.snapshot.fetchedAt
      );
      setState((current) =>
        current.scopeKey === scopeKey
          ? {
              ...current,
              checks: snapshot.checks,
              checksUnavailable: false,
              lastFetchedAt: event.snapshot.fetchedAt,
            }
          : current
      );
      scheduleNextPoll(snapshot);
    });

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void load({
          force:
            appliedRemoteMutationVersionRef.current !==
            remoteMutationVersionRef.current,
        });
      } else {
        // Nothing to trace behind a hidden window; the return trip re-reads.
        clearPollTimer();
      }
    };

    const handleRemoteMutation = (event: Event) => {
      const detail = (event as CustomEvent<BranchRemoteMutationDetail>).detail;
      if (
        !isMatchingBranchRemoteMutation(detail, {
          repoId: repoId ?? "default",
          repoPath,
          branchName,
        })
      ) {
        return;
      }
      remoteMutationVersionRef.current += 1;
      pollAttemptRef.current = 0;
      pollHeadShaRef.current = null;
      loadRef.current?.({ force: true });
    };

    if (
      typeof document === "undefined" ||
      document.visibilityState !== "hidden"
    ) {
      void load({ force: localHeadChanged });
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }
    window.addEventListener(BRANCH_REMOTE_MUTATION_EVENT, handleRemoteMutation);

    return () => {
      disposed = true;
      generationRef.current += 1;
      loadRef.current = null;
      tracedRef.current = null;
      unsubscribeHeadChecks();
      clearPollTimer();
      if (typeof document !== "undefined") {
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange
        );
      }
      window.removeEventListener(
        BRANCH_REMOTE_MUTATION_EVENT,
        handleRemoteMutation
      );
    };
  }, [branchName, headRevision, poll, repoId, repoPath, scopeKey]);

  const visibleState =
    state.scopeKey === scopeKey
      ? state
      : {
          ...EMPTY_STATE,
          scopeKey,
        };

  const ciStatus = useMemo(
    () =>
      resolveBranchCiStatus({
        pr: visibleState.pr,
        checks: visibleState.checks,
        checksUnavailable: visibleState.checksUnavailable,
        loading: visibleState.loading || visibleState.refreshing,
      }),
    [
      visibleState.checks,
      visibleState.checksUnavailable,
      visibleState.loading,
      visibleState.pr,
      visibleState.refreshing,
    ]
  );

  const refresh = useCallback(() => {
    // Asking by hand is a signal of interest: drop back to the fast interval
    // instead of inheriting however far the backoff had already cooled.
    pollAttemptRef.current = 0;
    loadRef.current?.({ force: true });
  }, []);

  const { scopeKey: _scopeKey, ...result } = visibleState;
  return { ...result, ciStatus, refresh };
}
