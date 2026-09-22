import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { MobileRpcClient } from "../connection/mobileRpcClient";
import { hasValidSessionPresentation } from "../connection/sessionDiscoveryContract";
import type { MobileSessionRow } from "../connection/types";
import type { MobileRemoteRuntimePort } from "../platform/types";

export type MobileRosterPhase = "idle" | "loading" | "ready" | "error";
const RETRY_DELAYS = [1000, 2000, 4000];
class InvalidRosterError extends Error {}
function canRetryRoster(error: unknown) {
  if (error instanceof InvalidRosterError) return false;
  // Protocol and permission failures need an explicit user retry after repair.
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  return ![
    -32600, -32601, -32602, -32001, -32002, -32003, -32005, 401, 403,
  ].includes(code as number);
}

interface SessionListPage {
  sessions: MobileSessionRow[];
  nextOffset?: number;
  hasMore?: boolean;
}

function isSessionListPage(
  value: unknown,
  offset: number
): value is SessionListPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const page = value as Record<string, unknown>;
  // Both desktop list sources always send sessions, including a genuine empty
  // array. Missing data is a protocol failure, never an authoritative empty list.
  if (
    !Array.isArray(page.sessions) ||
    !page.sessions.every(hasValidSessionPresentation)
  )
    return false;
  if (page.hasMore !== undefined && typeof page.hasMore !== "boolean")
    return false;
  const next = page.nextOffset;
  if (
    next !== undefined &&
    (!Number.isSafeInteger(next) || (next as number) < offset)
  )
    return false;
  // Old peers may omit pagination altogether. A continuing page, however,
  // must carry a cursor that advances, or the roster would be silently truncated.
  return page.hasMore !== true || (typeof next === "number" && next > offset);
}

/** Owns roster pagination and invalidation, not the transport lifetime. */
export function useMobileSessionList(
  clientRef: RefObject<MobileRpcClient | null>,
  prepareSessions?: (
    client: MobileRpcClient,
    sessions: readonly MobileSessionRow[],
    isCurrent: () => boolean
  ) => void | Promise<void>,
  runtime?: MobileRemoteRuntimePort
) {
  const [sessions, setSessions] = useState<MobileSessionRow[]>([]);
  const [sessionsHasMore, setSessionsHasMore] = useState(false);
  const [rosterPhase, setRosterPhase] = useState<MobileRosterPhase>("idle");
  const retryTimerRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);
  const clearRetry = useCallback(() => {
    if (retryTimerRef.current !== null)
      runtime?.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }, [runtime]);
  const sessionNextOffsetRef = useRef(0);
  const sessionListGenerationRef = useRef(0);
  const snapshotRevisionRef = useRef(0);
  const flightRef = useRef<{
    client: MobileRpcClient;
    generation: number;
    promise: Promise<void>;
    refresh: boolean;
    append: boolean;
  } | null>(null);
  const readPage = useCallback(
    async (
      client: MobileRpcClient,
      append: boolean,
      requestGeneration: number
    ) => {
      const snapshotRevision = snapshotRevisionRef.current;
      const isCurrent = () =>
        requestGeneration === sessionListGenerationRef.current &&
        snapshotRevision === snapshotRevisionRef.current &&
        clientRef.current === client;
      const targetOffset = append
        ? sessionNextOffsetRef.current + 50
        : Math.max(50, sessionNextOffsetRef.current);
      let offset = append ? sessionNextOffsetRef.current : 0;
      let list: SessionListPage = { sessions: [] };
      const rows: MobileSessionRow[] = [];
      do {
        const response = await client.call<unknown>("session/list", {
          offset,
          limit: 200,
        });
        if (!isCurrent()) return;
        if (!isSessionListPage(response, offset)) {
          throw new InvalidRosterError("Invalid session list response");
        }
        list = response;
        rows.push(...list.sessions);
        const next = list.nextOffset;
        if (!Number.isSafeInteger(next) || next! <= offset) {
          list.hasMore = false;
          break;
        }
        offset = next!;
      } while (list.hasMore && offset < targetOffset);
      if (!isCurrent()) return;
      // Preparation may start connection-owned background work, but roster
      // publication stays on the successful session/list critical path.
      try {
        void Promise.resolve(prepareSessions?.(client, rows, isCurrent)).catch(
          () => undefined
        );
      } catch {
        // Best-effort preparation never changes a valid roster response.
      }
      retryAttemptRef.current = 0;
      setRosterPhase("ready");
      sessionNextOffsetRef.current = offset;
      setSessionsHasMore(
        list.hasMore === true &&
          Number.isSafeInteger(list.nextOffset) &&
          offset < 1000
      );
      setSessions((previous) =>
        append
          ? [
              ...new Map(
                [...previous, ...rows].map((row) => [row.id, row])
              ).values(),
            ]
          : rows
      );
    },
    [clientRef, prepareSessions]
  );

  const requestSessionList = useCallback(
    function request(
      client: MobileRpcClient,
      append = false,
      restartRetry = false
    ): Promise<void> {
      if (clientRef.current !== client || runtime?.isHidden())
        return Promise.resolve();
      clearRetry();
      if (restartRetry) retryAttemptRef.current = 0;
      // Every full refresh supersedes roster preparation started by the
      // preceding snapshot, including work whose list flight already ended.
      if (!append) snapshotRevisionRef.current += 1;
      const current = flightRef.current;
      if (
        current?.client === client &&
        current.generation === sessionListGenerationRef.current
      ) {
        if (append) current.append = true;
        else current.refresh = true;
        return current.promise;
      }
      const flight = {
        client,
        generation: sessionListGenerationRef.current,
        promise: Promise.resolve(),
        refresh: !append,
        append,
      };
      flightRef.current = flight;
      setRosterPhase("loading");
      flight.promise = (async () => {
        try {
          while (
            flightRef.current === flight &&
            clientRef.current === client &&
            flight.generation === sessionListGenerationRef.current &&
            (flight.refresh || flight.append)
          ) {
            const appendPage = !flight.refresh;
            if (appendPage) flight.append = false;
            else flight.refresh = false;
            try {
              await readPage(client, appendPage, flight.generation);
            } catch (error) {
              // A queued invalidation may recover a failed read. With no queued
              // work, propagate the failure to the manual refresh/load-more UI.
              if (!flight.refresh && !flight.append) {
                if (
                  flightRef.current === flight &&
                  clientRef.current === client &&
                  flight.generation === sessionListGenerationRef.current
                ) {
                  setRosterPhase("error");
                  const delay = RETRY_DELAYS[retryAttemptRef.current];
                  if (
                    runtime &&
                    !runtime.isHidden() &&
                    delay !== undefined &&
                    canRetryRoster(error)
                  ) {
                    retryAttemptRef.current += 1;
                    retryTimerRef.current = runtime.setTimeout(() => {
                      retryTimerRef.current = null;
                      if (
                        clientRef.current === client &&
                        flight.generation ===
                          sessionListGenerationRef.current &&
                        !runtime.isHidden()
                      ) {
                        void request(client, appendPage).catch(() => undefined);
                      }
                    }, delay);
                  }
                }
                throw error;
              }
            }
          }
        } finally {
          if (flightRef.current === flight) flightRef.current = null;
        }
      })();
      return flight.promise;
    },
    [clientRef, readPage, runtime, clearRetry]
  );
  // Release transport-owned work without erasing the same desktop's last good rows.
  const suspendSessionList = useCallback(() => {
    clearRetry();
    sessionListGenerationRef.current += 1;
    flightRef.current = null;
  }, [clearRetry]);
  useEffect(() => suspendSessionList, [suspendSessionList]);

  const resetSessions = useCallback(
    (rows?: MobileSessionRow[]) => {
      suspendSessionList();
      retryAttemptRef.current = 0;
      sessionNextOffsetRef.current = 0;
      setSessionsHasMore(false);
      setSessions(rows ?? []);
      setRosterPhase(rows ? "ready" : "idle");
    },
    [suspendSessionList]
  );
  return {
    sessions,
    sessionsHasMore,
    rosterPhase,
    requestSessionList,
    resetSessions,
    suspendSessionList,
  };
}
