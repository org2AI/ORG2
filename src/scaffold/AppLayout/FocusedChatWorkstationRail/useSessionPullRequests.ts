import { useCallback, useEffect, useRef, useState } from "react";

import { getPRLocal } from "@src/api/tauri/github";
import { readSessionPullRequests } from "@src/api/tauri/session/sessionPullRequests";
import {
  type BranchCiStatus,
  resolveBranchCiStatus,
} from "@src/services/git/branchPullRequestStatus";
import {
  PULL_REQUEST_HEAD_CHECKS_REUSE_MS,
  loadPullRequestHeadChecks,
} from "@src/services/git/pullRequestHeadChecks";
import { parseGitHubPullRequestUrl } from "@src/util/git/githubPullRequestUrl";

export interface SessionPullRequest {
  url: string;
  number: number;
  repoFullName: string;
  title: string;
  state: string;
  draft: boolean;
  headBranch: string;
  ciStatus: BranchCiStatus | null;
  error: boolean;
  metadataLoading?: boolean;
}

export function canonicalPullRequestUrl(url: string): string | null {
  const pr = parseGitHubPullRequestUrl(url);
  return pr
    ? `https://github.com/${pr.owner.toLowerCase()}/${pr.repo.toLowerCase()}/pull/${pr.number}`
    : null;
}

interface State {
  sessionId: string;
  items: SessionPullRequest[];
  loading: boolean;
  error: boolean;
}
const EMPTY: SessionPullRequest[] = [];

/** Explicit conversation attachments only. No polling or additional metadata cache. */
export function useSessionPullRequests(sessionId?: string, reloadKey?: string) {
  const [state, setState] = useState<State | null>(null);
  const [revision, setRevision] = useState(0);
  const [visible, setVisible] = useState(
    () =>
      typeof document === "undefined" || document.visibilityState !== "hidden"
  );
  const retryUrls = useRef(new Set<string>());
  const previous = useRef<State | null>(null);
  useEffect(() => {
    previous.current = state;
  }, [state]);
  useEffect(() => {
    const onVisibility = () =>
      setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  const refresh = useCallback((url?: string) => {
    if (url) retryUrls.current.add(url);
    else
      previous.current?.items.forEach((item) =>
        retryUrls.current.add(item.url)
      );
    setRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!sessionId || !visible) return;
    let cancelled = false;
    const stale =
      previous.current?.sessionId === sessionId
        ? previous.current.items
        : EMPTY;
    const retry = new Set(retryUrls.current);
    retryUrls.current.clear();
    setState({ sessionId, items: stale, loading: true, error: false });
    (async () => {
      const raw = await readSessionPullRequests(sessionId);
      if (cancelled) return;
      const urls = [
        ...new Set(
          raw
            .map(canonicalPullRequestUrl)
            .filter((url): url is string => Boolean(url))
        ),
      ].slice(0, 100);
      const items = urls.map((url) => {
        const ref = parseGitHubPullRequestUrl(url)!;
        return (
          stale.find((item) => item.url === url) ?? {
            url,
            number: ref.number,
            repoFullName: `${ref.owner}/${ref.repo}`,
            title: `#${ref.number}`,
            metadataLoading: true,
            state: "unknown",
            draft: false,
            headBranch: "",
            ciStatus: null,
            error: false,
          }
        );
      });
      setState({ sessionId, items: [...items], loading: true, error: false });
      let cursor = 0;
      // Bound metadata fanout; hidden/unmounted/superseded rails stop dequeuing work.
      await Promise.all(
        Array.from({ length: Math.min(3, items.length) }, async () => {
          while (!cancelled && cursor < items.length) {
            const index = cursor++;
            const item = items[index];
            let loadedDetail: Record<string, unknown> | undefined;
            const showDetail = (detail: Record<string, unknown>) => {
              if (cancelled) return;
              loadedDetail = detail;
              const head = detail.head as { ref?: unknown } | undefined;
              items[index] = {
                ...items[index],
                metadataLoading: false,
                title:
                  typeof detail.title === "string"
                    ? detail.title
                    : items[index].title,
                state:
                  detail.merged === true || Boolean(detail.merged_at)
                    ? "merged"
                    : typeof detail.state === "string"
                      ? detail.state
                      : "unknown",
                draft: detail.draft === true,
                headBranch: typeof head?.ref === "string" ? head.ref : "",
                ciStatus: detail.state === "open" ? "checking" : null,
                error: false,
              };
              setState({
                sessionId,
                items: [...items],
                loading: true,
                error: false,
              });
            };
            try {
              const result = await loadPullRequestHeadChecks(
                item.repoFullName,
                item.number,
                {
                  onDetail: showDetail,
                  maxAgeMs: retry.has(item.url)
                    ? 0
                    : PULL_REQUEST_HEAD_CHECKS_REUSE_MS,
                }
              ).catch(async (error: unknown) => {
                if (cancelled) throw error;
                return {
                  detail:
                    loadedDetail ??
                    (await getPRLocal(item.repoFullName, item.number)),
                  checks: null,
                };
              });
              if (cancelled) return;
              const detail = result.detail;
              const lifecycle =
                detail.merged === true || Boolean(detail.merged_at)
                  ? "merged"
                  : typeof detail.state === "string"
                    ? detail.state
                    : "unknown";
              const head = detail.head as { ref?: unknown } | undefined;
              const pr = {
                number: item.number,
                url: item.url,
                title:
                  typeof detail.title === "string" ? detail.title : item.title,
                state: lifecycle,
                draft: detail.draft === true,
              };
              items[index] = {
                ...item,
                ...pr,
                metadataLoading: false,
                headBranch: typeof head?.ref === "string" ? head.ref : "",
                ciStatus:
                  lifecycle === "open"
                    ? resolveBranchCiStatus({
                        pr,
                        checks: result.checks,
                        checksUnavailable: !result.checks,
                        loading: false,
                      })
                    : null,
                error: lifecycle === "open" && !result.checks,
              };
            } catch {
              if (cancelled) return;
              items[index] = {
                ...items[index],
                metadataLoading: false,
                error: true,
              };
            }
            setState({
              sessionId,
              items: [...items],
              loading: true,
              error: false,
            });
          }
        })
      );
      if (!cancelled)
        setState({
          sessionId,
          items: [...items],
          loading: false,
          error: false,
        });
    })().catch(() => {
      if (!cancelled)
        setState({ sessionId, items: stale, loading: false, error: true });
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, reloadKey, visible, revision]);

  return {
    items: state && state.sessionId === sessionId ? state.items : EMPTY,
    loading:
      state && state.sessionId === sessionId
        ? state.loading
        : Boolean(sessionId && visible),
    error: state && state.sessionId === sessionId ? state.error : false,
    refresh,
  };
}
