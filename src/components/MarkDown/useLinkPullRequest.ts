import { useCallback, useEffect, useRef, useState } from "react";

import { getPRLocal } from "@src/api/tauri/github";
import { parseGitHubPullRequestUrl } from "@src/util/git/githubPullRequestUrl";

import {
  createGitHubPrTabDataFromLink,
  getPrAuthor,
} from "./LinkHoverCard.helpers";

/** Owned by the mounted hover panel, never by the markdown link list. */
export function useLinkPullRequest(url: string) {
  const request = useRef<{
    url: string;
    promise: Promise<Record<string, unknown>>;
  } | null>(null);
  const [result, setResult] = useState<{
    url: string;
    detail: Record<string, unknown> | null;
  } | null>(null);
  const load = useCallback(() => {
    if (request.current?.url === url) return request.current.promise;
    const pr = parseGitHubPullRequestUrl(url);
    if (!pr) return Promise.reject(new Error("Invalid pull request URL"));
    const promise = getPRLocal(`${pr.owner}/${pr.repo}`, pr.number);
    request.current = { url, promise };
    void promise.catch(() => {
      if (request.current?.promise === promise) request.current = null;
    });
    return promise;
  }, [url]);
  useEffect(() => {
    if (!parseGitHubPullRequestUrl(url)) return;
    let active = true;
    void load().then(
      (detail) => {
        if (active) setResult({ url, detail });
      },
      () => {
        if (active) setResult({ url, detail: null });
      }
    );
    return () => {
      active = false;
    };
  }, [load, url]);
  const current = result?.url === url ? result : null;
  return {
    load,
    loading: current === null,
    filesChanged:
      typeof current?.detail?.changed_files === "number" &&
      Number.isInteger(current.detail.changed_files) &&
      current.detail.changed_files >= 0
        ? current.detail.changed_files
        : undefined,
    author: current?.detail ? getPrAuthor(current.detail) : null,
    data: current?.detail
      ? createGitHubPrTabDataFromLink({
          url,
          repoPath: "",
          detail: current.detail,
        })
      : null,
  };
}
