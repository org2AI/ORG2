import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { MobileRpcClient } from "../connection/mobileRpcClient";
import type { MobileSessionRow } from "../connection/types";

/** Owns roster pagination and invalidation, not the transport lifetime. */
export function useMobileSessionList(
  clientRef: RefObject<MobileRpcClient | null>
) {
  const [sessions, setSessions] = useState<MobileSessionRow[]>([]);
  const [sessionsHasMore, setSessionsHasMore] = useState(false);
  const sessionNextOffsetRef = useRef(0);
  const sessionListGenerationRef = useRef(0);
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
      const targetOffset = append
        ? sessionNextOffsetRef.current + 50
        : Math.max(50, sessionNextOffsetRef.current);
      let offset = append ? sessionNextOffsetRef.current : 0;
      let list: {
        sessions?: MobileSessionRow[];
        nextOffset?: number;
        hasMore?: boolean;
      } = {};
      const rows: MobileSessionRow[] = [];
      do {
        list = await client.call<typeof list>("session/list", { offset });
        if (
          requestGeneration !== sessionListGenerationRef.current ||
          clientRef.current !== client
        )
          return;
        rows.push(...(list.sessions ?? []));
        const next = list.nextOffset;
        if (!Number.isSafeInteger(next) || next! <= offset) {
          list.hasMore = false;
          break;
        }
        offset = next!;
      } while (list.hasMore && offset < targetOffset);
      if (
        requestGeneration !== sessionListGenerationRef.current ||
        clientRef.current !== client
      ) {
        return;
      }
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
    [clientRef]
  );

  const requestSessionList = useCallback(
    (client: MobileRpcClient, append = false): Promise<void> => {
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
      flight.promise = Promise.resolve().then(async () => {
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
              if (!flight.refresh && !flight.append) throw error;
            }
          }
        } finally {
          if (flightRef.current === flight) flightRef.current = null;
        }
      });
      return flight.promise;
    },
    [clientRef, readPage]
  );
  useEffect(
    () => () => {
      sessionListGenerationRef.current += 1;
      flightRef.current = null;
    },
    []
  );

  const resetSessions = useCallback((rows: MobileSessionRow[] = []) => {
    sessionListGenerationRef.current += 1;
    flightRef.current = null;
    sessionNextOffsetRef.current = 0;
    setSessionsHasMore(false);
    setSessions(rows);
  }, []);
  return { sessions, sessionsHasMore, requestSessionList, resetSessions };
}
