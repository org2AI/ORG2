import { useEffect, useState } from "react";

import type { MobileRpcClient } from "../../connection/mobileRpcClient";
import { useMobileRemotePlatform } from "../../platform";

export type ChangeScope = "turn" | "session" | "workspace";
export interface ChangeFile {
  path: string;
  additions: number | null;
  deletions: number | null;
  patches: string[];
  before: string | null;
  after: string | null;
  availability: string;
}
export interface Review {
  files: ChangeFile[];
  complete: boolean;
}
export function validateReview(value: unknown): Review {
  const result = value as Review;
  if (
    !result ||
    typeof result.complete !== "boolean" ||
    !Array.isArray(result.files) ||
    result.files.length > 500 ||
    !result.files.every(
      (f) =>
        f &&
        typeof f.path === "string" &&
        f.path.length > 0 &&
        [f.additions, f.deletions].every(
          (n) => n === null || (Number.isSafeInteger(n) && n >= 0)
        ) &&
        [f.before, f.after].every(
          (s) => s === null || (typeof s === "string" && s.length <= 524288)
        ) &&
        Array.isArray(f.patches) &&
        f.patches.every((p) => typeof p === "string") &&
        typeof f.availability === "string"
    ) ||
    JSON.stringify(value).length > 3 * 1024 * 1024
  )
    throw new Error("Invalid change review");
  return result;
}

export function useChangeReview(
  client: MobileRpcClient | null,
  sessionId: string,
  roundId: string | null,
  scope: ChangeScope,
  enabled: boolean,
  revision: string,
  filePath?: string
) {
  // Tool/status revisions refresh this resource; they must not replace its reader.
  const key = JSON.stringify([sessionId, roundId, scope, filePath]);
  const { runtime } = useMobileRemotePlatform();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    client: MobileRpcClient;
    key: string;
    attempt: number;
    revision: string;
    value?: Review;
    error?: boolean;
  } | null>(null);
  // File viewers leave the viewport or collapse; do not retain their large
  // snapshots for the lifetime of the entire review panel.
  if (
    state !== null &&
    (!enabled || state.client !== client || state.key !== key)
  )
    setState(null);
  useEffect(() => {
    if (!client || !enabled) return;
    const controller = new AbortController();
    const timer = runtime.setTimeout(() => {
      void client
        .call(
          "session/changes",
          { sessionId, roundId, scope, filePath },
          controller.signal
        )
        .then(validateReview)
        .then((value) => {
          if (!controller.signal.aborted)
            setState({ client, key, attempt, revision, value });
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setState((previous) => ({
              client,
              key,
              attempt,
              revision,
              value:
                previous?.client === client && previous.key === key
                  ? previous.value
                  : undefined,
              error: true,
            }));
        });
    }, 250);
    return () => {
      runtime.clearTimeout(timer);
      controller.abort();
    };
  }, [
    client,
    enabled,
    key,
    sessionId,
    roundId,
    scope,
    filePath,
    attempt,
    revision,
    runtime,
  ]);
  const current =
    enabled && state?.client === client && state.key === key ? state : null;
  const settled = current?.revision === revision && current.attempt === attempt;
  const error = settled ? current?.error : undefined;
  return {
    refreshing: !!current?.value && !settled,
    value: current?.value,
    error,
    retry: () => {
      if (!client || !enabled || !error) return;
      // Invalidate the failed result immediately. Repeated taps from the same
      // render may enqueue updates together; only the first starts a retry.
      setAttempt((pendingAttempt) =>
        pendingAttempt === attempt ? attempt + 1 : pendingAttempt
      );
    },
  };
}
