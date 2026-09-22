/**
 * useWebviewLoadFailure
 *
 * Decides whether an embedded browser pane actually failed to load, from the
 * native page-load phases reported by `browser::inline`.
 *
 * wry exposes no navigation-failure callback, so the only evidence available is
 * the absence of a `finished` phase for the navigation in progress: a webview
 * that started one (or was never created at all) and has not finished it after a
 * grace period is a pane the user is staring at with nothing in it.
 *
 * This replaces a hostname allowlist plus a 3s timer, which fired on every visit
 * to github.com / google.com whether or not the page rendered.
 */
import { useCallback, useEffect, useState } from "react";

import type { BrowserWebviewLoadState } from "@src/store/workstation/browser/webviewLoadStateAtom";

/**
 * Grace period before an unfinished load counts as failed.
 *
 * Long on purpose. The previous heuristic had to fire early because it was
 * guessing; this one waits on real evidence, so the only cost of waiting is a
 * later notice on a page that genuinely never loads.
 */
export const WEBVIEW_LOAD_FAILURE_TIMEOUT_MS = 8000;

interface UseWebviewLoadFailureOptions {
  /** Session whose pane is on screen. Failure is tracked per session + URL. */
  sessionId: string | undefined;
  /** URL the session points at; undefined or blank disables the check. */
  url: string | undefined;
  /** Latest native load state for this session's webview, if one was observed. */
  loadState: BrowserWebviewLoadState | undefined;
  /**
   * False whenever the pane cannot be judged — tab inactive, host hidden, or the
   * webview parked behind an overlay. Time spent unwatched never accrues toward
   * the grace period, so opening a menu cannot manufacture a failure.
   */
  isWatching: boolean;
  timeoutMs?: number;
}

export interface WebviewLoadFailure {
  /** The current URL started (or never started) loading and never finished. */
  hasFailed: boolean;
  /** Suppress the notice for this exact session + URL. */
  dismiss: () => void;
  /** Clear the failure and its dismissal — for an explicit reload. */
  reset: () => void;
}

/** Cannot appear in a session id or a URL, so the join stays unambiguous. */
const KEY_SEPARATOR = "\u0000";

function failureKey(
  sessionId: string | undefined,
  url: string | undefined
): string | null {
  if (!sessionId || !url) return null;
  return `${sessionId}${KEY_SEPARATOR}${url}`;
}

export function useWebviewLoadFailure({
  sessionId,
  url,
  loadState,
  isWatching,
  timeoutMs = WEBVIEW_LOAD_FAILURE_TIMEOUT_MS,
}: UseWebviewLoadFailureOptions): WebviewLoadFailure {
  const key = failureKey(sessionId, url);

  /**
   * What was already known when this tab last navigated in place, so evidence
   * from before that navigation can be told apart from evidence about it.
   *
   * WKWebView reports `started` from `didCommitNavigation`, so a navigation that
   * fails before it commits (DNS failure, refused connection, TLS error) emits
   * no phase at all and leaves the previous page's `finished` standing. Evidence
   * recorded before the navigation was requested therefore proves nothing about
   * the URL now in the address bar.
   *
   * Only in-place navigation records a stamp. Switching tabs must not, or every
   * switch back to an already-loaded page would discard its real evidence.
   */
  const [navigation, setNavigation] = useState<{
    sessionId: string | undefined;
    url: string | undefined;
    /**
     * The `at` stamp of the evidence that was already on record when this tab
     * navigated. Evidence still carrying it predates the navigation, so no new
     * phase has been reported since.
     */
    stampBefore: number | null;
  }>({ sessionId, url, stampBefore: null });
  if (navigation.sessionId !== sessionId || navigation.url !== url) {
    const isSameTabNavigation =
      navigation.sessionId === sessionId && !!navigation.url && !!url;
    setNavigation({
      sessionId,
      url,
      stampBefore: isSameTabNavigation ? (loadState?.at ?? null) : null,
    });
  }

  const hasFinishedCurrentNavigation =
    loadState?.phase === "finished" &&
    (navigation.stampBefore === null ||
      loadState.at !== navigation.stampBefore);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  // Bumped by `reset` so reloading the same URL re-arms the grace period.
  // Without it a reload leaves the effect's inputs unchanged, and the notice
  // could never come back for a page that fails a second time.
  const [attempt, setAttempt] = useState(0);

  // Identity of the load attempt being judged. Any change — a new URL, evidence
  // that this navigation finished, an explicit reload — retires the previous
  // verdict, so a stale failure is never re-applied to a load that moved on.
  const watchId = [
    key ?? "",
    String(hasFinishedCurrentNavigation),
    attempt,
  ].join(KEY_SEPARATOR);

  // Derived-from-previous-render state: clear the verdict during render rather
  // than writing it back from an effect.
  const [verdict, setVerdict] = useState<{ watchId: string; failed: boolean }>({
    watchId,
    failed: false,
  });
  if (verdict.watchId !== watchId) setVerdict({ watchId, failed: false });

  useEffect(() => {
    // A `finished` for this navigation is the one thing that proves the pane
    // has content; everything else is judged by the grace period.
    if (!key || !isWatching || hasFinishedCurrentNavigation) return;

    const timer = window.setTimeout(
      () => setVerdict({ watchId, failed: true }),
      timeoutMs
    );
    return () => window.clearTimeout(timer);
  }, [hasFinishedCurrentNavigation, isWatching, key, timeoutMs, watchId]);

  const dismiss = useCallback(() => {
    if (key) setDismissedKey(key);
  }, [key]);

  const reset = useCallback(() => {
    setDismissedKey(null);
    setAttempt((current) => current + 1);
  }, []);

  return {
    hasFailed:
      key !== null &&
      verdict.watchId === watchId &&
      verdict.failed &&
      dismissedKey !== key,
    dismiss,
    reset,
  };
}
