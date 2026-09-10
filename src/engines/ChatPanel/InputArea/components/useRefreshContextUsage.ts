import { atom, useAtomValue, useStore } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";

import { getImportedHistorySourceBySessionId } from "@src/api/tauri/externalHistory";
import { cliSessionContextUsage } from "@src/api/tauri/session/contextUsage";
import { sessionIdAtom } from "@src/engines/SessionCore/core/atoms/metadata";
import { useSessionId } from "@src/engines/SessionCore/hooks/session";
import { getAdapterForSession } from "@src/engines/SessionCore/sync/types";
import {
  sessionContextTokensAtom,
  sessionContextUsageAtom,
} from "@src/store/session/cliSessionStatusAtom";
import { isCliSession } from "@src/util/session/sessionDispatch";

// Per-store single flight, shared by all context controls. No retained cache/timer.
const refreshingAtom = atom(false);

export function useRefreshContextUsage() {
  const { sessionId } = useSessionId();
  const store = useStore();
  const refreshing = useAtomValue(refreshingAtom);
  const [error, setError] = useState<{
    sessionId: string;
    message: string;
  } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => controller.current?.abort();
  }, [sessionId]);

  const refresh = useCallback(() => {
    if (!sessionId || store.get(refreshingAtom)) return;
    const request = new AbortController();
    controller.current = request;
    setError(null);
    refreshSessionContextUsage(store, sessionId, request.signal).catch(
      (cause: unknown) => {
        if (!request.signal.aborted)
          setError({ sessionId, message: String(cause) });
      }
    );
  }, [sessionId, store]);

  return {
    refresh,
    refreshing,
    error: error && error.sessionId === sessionId ? error.message : null,
  };
}

export async function refreshSessionContextUsage(
  store: ReturnType<typeof useStore>,
  sessionId: string,
  signal: AbortSignal
) {
  if (
    store.get(refreshingAtom) ||
    signal.aborted ||
    store.get(sessionIdAtom) !== sessionId
  )
    return;
  const adapter = getAdapterForSession(sessionId);
  if (!adapter?.postLoad) return;
  const previousUsage = store.get(sessionContextUsageAtom);
  const previousTokens = store.get(sessionContextTokensAtom);
  store.set(refreshingAtom, true);
  try {
    const source = getImportedHistorySourceBySessionId(sessionId);
    const usage = source?.loadContextUsage
      ? await source.loadContextUsage(sessionId)
      : isCliSession(sessionId)
        ? await cliSessionContextUsage(sessionId)
        : undefined;
    const result =
      usage !== undefined
        ? { contextUsage: usage, contextTokens: usage?.usedTokens ?? 0 }
        : await adapter.postLoad(sessionId, signal);
    if (
      signal.aborted ||
      store.get(sessionIdAtom) !== sessionId ||
      store.get(sessionContextUsageAtom) !== previousUsage ||
      store.get(sessionContextTokensAtom) !== previousTokens
    )
      return;
    if (result.contextTokens !== undefined)
      store.set(sessionContextTokensAtom, result.contextTokens);
    if (result.contextUsage !== undefined)
      store.set(sessionContextUsageAtom, result.contextUsage);
  } finally {
    store.set(refreshingAtom, false);
  }
}
