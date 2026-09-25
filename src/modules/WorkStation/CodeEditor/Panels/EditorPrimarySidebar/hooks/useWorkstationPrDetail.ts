/**
 * useWorkstationPrDetail
 *
 * Loads the full detail for the selected Pull Request — the data behind the
 * GitHub-style Conversation / Commits / Checks / Changes tabs — and publishes
 * it into `workstationSelectedPrAtom` plus action callbacks into
 * `workstationPrDetailCallbackAtom`.
 *
 * Design mirrors `useWorkstationIssues` (repo resolution, cache-seed-then-
 * revalidate, atom publishing, unmount reset). All detail sources are fetched
 * in parallel (see `workstationPrDetailFetch`); a small per-PR snapshot cache
 * provides stale-while-revalidate behavior after a PR is explicitly opened.
 * In-flight requests are de-duplicated by PR.
 */
import { useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getGitRemotes } from "@src/api/http/git/remotes";
import type { GitHubIssueUser } from "@src/api/tauri/github";
import { useMountedCleanup } from "@src/hooks/lifecycle/useMounted";
import {
  getCachedPrDetail,
  isPrDetailStale,
  prDetailKey,
  setCachedPrDetail,
  updateCachedPrListItem,
} from "@src/services/git/githubListCache";
import { parseGithubRepoFullName } from "@src/services/git/operations/createPullRequest";
import { invalidatePullRequestHeadChecks } from "@src/services/git/pullRequestHeadChecks";
import {
  workstationAllOpenPrsAtomFamily,
  workstationRepoScopeKey,
} from "@src/store/workstation/codeEditor/workstationPrAtom";
import {
  type PrIdentity,
  initialSelectedPrState,
  retainWorkstationPrDetailScope,
  workstationPrDetailCallbackAtomFamily,
  workstationPrScopeKey,
  workstationSelectedPrAtomFamily,
} from "@src/store/workstation/codeEditor/workstationSelectedPrAtom";
import { parseGitHubPullRequestUrl } from "@src/util/git/githubPullRequestUrl";
import { readRequestedReviewers } from "@src/util/git/pr/prLevelActions";

import { useWorkstationPrChecksPolling } from "./useWorkstationPrChecksPolling";
import { useWorkstationPrMutations } from "./useWorkstationPrMutations";
import { useWorkstationPrPickerCandidates } from "./useWorkstationPrPickerCandidates";
import {
  type PrDetailBundle,
  loadBundleDeduped,
  readString,
} from "./workstationPrDetailFetch";
import { bumpRequestId } from "./workstationPrHelpers";

export interface UseWorkstationPrDetailOptions {
  repoPath: string;
  repoId?: string;
  /** The PR selected in the sidebar, or null when nothing is selected. */
  pr: PrIdentity | null;
  /** The panel's root element; CI polling pauses while it is not rendered. */
  visibilityRef?: React.RefObject<HTMLElement | null>;
}

export function useWorkstationPrDetail({
  repoPath,
  repoId,
  pr,
  visibilityRef,
}: UseWorkstationPrDetailOptions) {
  const scopeKey = workstationPrScopeKey(repoId, repoPath, pr?.number, pr?.url);
  const setSelectedPr = useSetAtom(workstationSelectedPrAtomFamily(scopeKey));
  const setOpenPrs = useSetAtom(
    workstationAllOpenPrsAtomFamily(workstationRepoScopeKey(repoId, repoPath))
  );
  const setCallbacks = useSetAtom(
    workstationPrDetailCallbackAtomFamily(scopeKey)
  );

  // Mark this scope as in use so the LRU forgets older PRs' atoms instead of
  // pinning one set per pull request ever opened.
  useEffect(() => {
    retainWorkstationPrDetailScope(scopeKey);
  }, [scopeKey]);

  const mountedRef = useRef(true);
  useMountedCleanup(mountedRef);

  // Freshest PR head SHA, kept in a ref so inline-comment creation can read it
  // without re-subscribing its callback on every atom write.
  const latestHeadShaRef = useRef<string | null>(null);
  const latestRequestedReviewersRef = useRef<GitHubIssueUser[]>([]);
  const latestAuthorLoginRef = useRef<string | null>(null);

  const onMetadataUpdated = useCallback(
    (prNumber: number, changes: { title?: string; base?: string }) => {
      const patch = {
        ...(changes.title !== undefined ? { title: changes.title } : {}),
        ...(changes.base !== undefined ? { base_branch: changes.base } : {}),
      };
      if (!repoPath) return;
      setOpenPrs((current) =>
        current.map((item) =>
          item.number === prNumber ? { ...item, ...patch } : item
        )
      );
      updateCachedPrListItem(repoPath, prNumber, patch);
    },
    [repoPath, setOpenPrs]
  );

  // The PR URL is authoritative; local remote lookup is only a legacy fallback.
  const urlRef = pr?.url ? parseGitHubPullRequestUrl(pr.url) : null;
  const urlRepo =
    urlRef && urlRef.number === pr?.number
      ? `${urlRef.owner}/${urlRef.repo}`
      : null;
  const localKey = JSON.stringify([repoId, repoPath]);
  const [localRepo, setLocalRepo] = useState<{
    key: string;
    name: string | null;
  } | null>(null);
  const repoFullName =
    urlRepo ?? (localRepo?.key === localKey ? localRepo.name : null);
  useEffect(() => {
    if (urlRepo || !repoPath) return;
    let cancelled = false;
    void getGitRemotes({ repo_id: repoId ?? "default", repo_path: repoPath })
      .then((remotes) => {
        const origin = remotes?.remotes?.find(
          (remote) => remote.name === "origin"
        );
        const name = origin?.url ? parseGithubRepoFullName(origin.url) : null;
        if (!cancelled) setLocalRepo({ key: localKey, name });
      })
      .catch(() => {
        if (!cancelled) setLocalRepo({ key: localKey, name: null });
      });
    return () => {
      cancelled = true;
    };
  }, [urlRepo, repoPath, repoId, localKey]);

  const {
    reviewerCandidates,
    assigneeCandidates,
    loadingReviewerCandidates,
    reviewerCandidatesError,
    loadReviewerCandidates,
    labelCandidates,
    loadingLabelCandidates,
    labelCandidatesError,
    loadLabelCandidates,
  } = useWorkstationPrPickerCandidates({ repoFullName, latestAuthorLoginRef });

  // Per-PR request-id counters — see `bumpRequestId` for why this is a Map
  // keyed by PR rather than a single instance-wide counter.
  const requestIdsRef = useRef(new Map<string, number>());

  const applyBundle = useCallback(
    (identity: PrIdentity, bundle: PrDetailBundle) => {
      latestHeadShaRef.current = bundle.headSha;
      latestRequestedReviewersRef.current = readRequestedReviewers(
        bundle.detail
      );
      latestAuthorLoginRef.current = readString(bundle.detail, [
        "user",
        "login",
      ]);
      setSelectedPr((prev) => ({
        ...prev,
        identity,
        detail: bundle.detail,
        headSha: bundle.headSha,
        baseRef: bundle.baseRef ?? identity.baseBranch ?? null,
        conversation: bundle.conversation,
        reviews: bundle.reviews,
        reviewComments: bundle.reviewComments,
        commits: bundle.commits,
        files: bundle.files,
        checks: bundle.checks,
        deployments: bundle.deployments,
        timeline: bundle.timeline,
        loading: false,
        refreshing: false,
        error: null,
      }));
    },
    [setSelectedPr]
  );

  const loadDetail = useCallback(
    (
      identity: PrIdentity,
      opts?: {
        force?: boolean;
        /**
         * Post-mutation reconciliation: a successful mutation already
         * applied its own optimistic patch, so this always uses the
         * lightweight `refreshing` indicator (never the full-page loading
         * skeleton) and always issues a fresh network request — an
         * in-flight fetch that might be de-duped onto could have been
         * dispatched before the mutation landed server-side.
         */
        reconcile?: boolean;
      }
    ) => {
      if (!repoFullName) return;
      const key = prDetailKey(repoFullName, identity.number);
      const requestId = bumpRequestId(requestIdsRef.current, key);
      const isCurrent = () => requestIdsRef.current.get(key) === requestId;

      // A reconcile follows a mutation and a forced load is an explicit
      // refresh: either way, what any CI poller read before now is out of
      // date for every surface sharing it, not just this panel.
      if (opts?.reconcile || opts?.force) {
        invalidatePullRequestHeadChecks(repoFullName, identity.number);
      }

      if (opts?.reconcile) {
        setSelectedPr((prev) => ({ ...prev, refreshing: true }));
      } else {
        const cached = getCachedPrDetail(key);
        if (cached && !opts?.force) {
          applyBundle(identity, cached);
          if (!isPrDetailStale(key)) return;
          setSelectedPr((prev) => ({ ...prev, refreshing: true }));
        } else {
          setSelectedPr((prev) => ({
            ...prev,
            ...initialSelectedPrState,
            identity,
            baseRef: identity.baseBranch ?? null,
            loading: true,
          }));
        }
      }

      void (async () => {
        try {
          const bundle = await loadBundleDeduped(
            repoFullName,
            identity.number,
            {
              bypassDedup: opts?.reconcile,
            }
          );
          if (!mountedRef.current || !isCurrent()) return;
          setCachedPrDetail(key, bundle);
          applyBundle(identity, bundle);
        } catch (err) {
          if (!mountedRef.current || !isCurrent()) return;
          setSelectedPr((prev) => ({
            ...prev,
            loading: false,
            refreshing: false,
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      })();
    },
    [repoFullName, applyBundle, setSelectedPr]
  );

  // Load whenever the selected PR (or resolved repo) changes.
  useEffect(() => {
    if (!pr || !repoFullName) return;
    loadDetail(pr);
  }, [pr, repoFullName, loadDetail]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const {
    addComment,
    submitReview,
    addInlineComment,
    replyInlineComment,
    mergePullRequest,
    setPullRequestAutoMerge,
    updatePullRequestState,
    updatePullRequestDraft,
    updatePullRequest,
    updateRequestedReviewers,
    updateAssignees,
    updateLabels,
    prActionPending,
  } = useWorkstationPrMutations({
    repoFullName,
    pr,
    setSelectedPr,
    loadDetail,
    mountedRef,
    requestIdsRef,
    latestHeadShaRef,
    latestRequestedReviewersRef,
    reviewerCandidates,
    assigneeCandidates,
    labelCandidates,
    onMetadataUpdated,
  });

  const refresh = useCallback(() => {
    if (pr) loadDetail(pr, { force: true });
  }, [pr, loadDetail]);

  // ── Live CI status ────────────────────────────────────────────────────────

  const reconcile = useCallback(
    (identity: PrIdentity) => loadDetail(identity, { reconcile: true }),
    [loadDetail]
  );
  const { refreshChecks } = useWorkstationPrChecksPolling({
    repoFullName,
    pr,
    scopeKey,
    mountedRef,
    requestIdsRef,
    prActionPending,
    reconcile,
    visibilityRef,
  });

  // Publish callbacks.
  useEffect(() => {
    setCallbacks({
      addComment,
      submitReview,
      addInlineComment,
      replyInlineComment,
      mergePullRequest,
      setPullRequestAutoMerge,
      updatePullRequestDraft,
      updatePullRequest,
      updatePullRequestState,
      updateRequestedReviewers,
      updateAssignees,
      updateLabels,
      refresh,
    });
  }, [
    addComment,
    submitReview,
    addInlineComment,
    replyInlineComment,
    mergePullRequest,
    setPullRequestAutoMerge,
    updatePullRequestDraft,
    updatePullRequest,
    updatePullRequestState,
    updateRequestedReviewers,
    updateAssignees,
    updateLabels,
    refresh,
    setCallbacks,
  ]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      setSelectedPr((current) => ({
        ...initialSelectedPrState,
        viewState: current.viewState,
      }));
      setCallbacks({
        addComment: null,
        submitReview: null,
        addInlineComment: null,
        replyInlineComment: null,
        mergePullRequest: null,
        setPullRequestAutoMerge: null,
        updatePullRequestDraft: null,
        updatePullRequest: null,
        updatePullRequestState: null,
        updateRequestedReviewers: null,
        updateAssignees: null,
        updateLabels: null,
        refresh: null,
      });
    };
  }, [setSelectedPr, setCallbacks]);

  return useMemo(
    () => ({
      repoFullName,
      addComment,
      submitReview,
      addInlineComment,
      replyInlineComment,
      mergePullRequest,
      setPullRequestAutoMerge,
      updatePullRequestDraft,
      updatePullRequest,
      updatePullRequestState,
      updateRequestedReviewers,
      updateAssignees,
      updateLabels,
      loadReviewerCandidates,
      reviewerCandidates,
      assigneeCandidates,
      loadingReviewerCandidates,
      reviewerCandidatesError,
      loadLabelCandidates,
      labelCandidates,
      loadingLabelCandidates,
      labelCandidatesError,
      prActionPending,
      refresh,
      refreshChecks,
      latestHeadShaRef,
    }),
    [
      repoFullName,
      addComment,
      submitReview,
      addInlineComment,
      replyInlineComment,
      mergePullRequest,
      setPullRequestAutoMerge,
      updatePullRequestDraft,
      updatePullRequest,
      updatePullRequestState,
      updateRequestedReviewers,
      updateAssignees,
      updateLabels,
      loadReviewerCandidates,
      reviewerCandidates,
      assigneeCandidates,
      loadingReviewerCandidates,
      reviewerCandidatesError,
      loadLabelCandidates,
      labelCandidates,
      loadingLabelCandidates,
      labelCandidatesError,
      prActionPending,
      refresh,
      refreshChecks,
    ]
  );
}
