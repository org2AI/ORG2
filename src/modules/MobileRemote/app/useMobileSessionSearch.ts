import { useCallback, useEffect, useRef, useState } from "react";

import { createLatestOnlySearchRunner } from "@src/util/latestOnlySearchRunner";

import type { MobileRpcClient } from "../connection/mobileRpcClient";
import { isSessionSearchRows } from "../connection/sessionDiscoveryContract";
import type { MobileSessionRow } from "../connection/types";

export interface MobileSearchPage {
  sessions: MobileSessionRow[];
  nextOffset: number;
  hasMore: boolean;
}

interface SearchRequest {
  query: string;
  offset: number;
}

interface SearchState extends MobileSearchPage {
  client: MobileRpcClient | null;
  phase: "idle" | "loading" | "ready" | "error";
  query: string;
  request: SearchRequest | null;
}

const emptySearch = (client: MobileRpcClient | null): SearchState => ({
  client,
  sessions: [],
  nextOffset: 0,
  hasMore: false,
  phase: "idle",
  query: "",
  request: null,
});

/** One active RPC plus the latest queued request, sharing Desktop's scheduler. */
export function useMobileSessionSearch(
  client: MobileRpcClient | null,
  online: boolean
) {
  const [result, setResult] = useState(() => emptySearch(client));
  const generation = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const runner = useRef<ReturnType<
    typeof createLatestOnlySearchRunner<SearchRequest & { token: number }>
  > | null>(null);
  const pendingRequest = useRef<(SearchRequest & { token: number }) | null>(
    null
  );
  const connection = useRef({ client, online });
  connection.current = { client, online };
  const invalidate = useCallback(() => {
    generation.current++;
    pendingRequest.current = null;
    runner.current?.clearPending();
    activeRequest.current?.abort();
    activeRequest.current = null;
  }, []);
  const cancel = useCallback(() => {
    invalidate();
    setResult(emptySearch(client));
  }, [client, invalidate]);
  useEffect(() => {
    if (online) return;
    // A relay socket can stay open while its desktop goes offline. Do not
    // keep waiting for its RPC timeout or accept its late result on reconnect.
    invalidate();
    setResult((previous) =>
      previous.phase === "loading" ? { ...previous, phase: "error" } : previous
    );
  }, [online, invalidate]);

  useEffect(() => {
    cancel();
    const scheduler = createLatestOnlySearchRunner<
      SearchRequest & { token: number }
    >(async (request) => {
      if (!client) return;
      const { query, offset, token } = request;
      const isCurrent = () =>
        generation.current === token &&
        connection.current.client === client &&
        connection.current.online;
      if (!isCurrent()) return;
      const controller = new AbortController();
      activeRequest.current = controller;
      try {
        const reply = await client.call<MobileSearchPage>(
          "session/list",
          {
            query,
            offset,
            limit: 50,
          },
          controller.signal
        );
        if (!isCurrent()) return;
        if (
          !reply ||
          !isSessionSearchRows(reply.sessions) ||
          reply.sessions.length > 50 ||
          typeof reply.hasMore !== "boolean" ||
          !Number.isSafeInteger(reply.nextOffset) ||
          reply.nextOffset < offset ||
          (reply.hasMore && reply.nextOffset <= offset)
        )
          throw new Error("Invalid search cursor");
        setResult({
          sessions: reply.sessions,
          nextOffset: reply.nextOffset,
          hasMore: reply.hasMore,
          client,
          query,
          request,
          phase: "ready",
        });
      } catch {
        if (isCurrent()) setResult((prev) => ({ ...prev, phase: "error" }));
      } finally {
        if (activeRequest.current === controller) activeRequest.current = null;
        if (generation.current === token) pendingRequest.current = null;
      }
    });
    runner.current = scheduler;
    return () => {
      invalidate();
      scheduler.dispose();
      runner.current = null;
    };
  }, [client, cancel, invalidate]);
  const requestPage = useCallback(
    (request: SearchRequest) => {
      if (!client || !online) return Promise.resolve();
      const previous = pendingRequest.current;
      if (
        previous?.query === request.query &&
        previous.offset === request.offset
      )
        return Promise.resolve();
      const token = ++generation.current;
      activeRequest.current?.abort();
      pendingRequest.current = { ...request, token };
      setResult((prev) => ({
        ...(request.offset > 0 &&
        prev.client === client &&
        prev.query === request.query
          ? prev
          : emptySearch(client)),
        query: request.query,
        request,
        phase: "loading",
      }));
      return runner.current?.submit({ ...request, token }) ?? Promise.resolve();
    },
    [client, online]
  );
  // Never expose a previous client's rows in the render before effect cleanup.
  const scoped = result.client === client ? result : emptySearch(client);
  const search = useCallback(
    (query: string) => {
      query = query.trim();
      if (!query || Array.from(query).length > 200) return Promise.resolve();
      return requestPage({ query, offset: 0 });
    },
    [requestPage]
  );
  const loadNext = () =>
    scoped.phase === "ready" && scoped.hasMore
      ? requestPage({ query: scoped.query, offset: scoped.nextOffset })
      : Promise.resolve();
  const retry = () =>
    scoped.phase === "error" && scoped.request
      ? requestPage(scoped.request)
      : Promise.resolve();
  return {
    sessions: scoped.sessions,
    query: scoped.query,
    phase: scoped.phase,
    nextOffset: scoped.nextOffset,
    hasMore: scoped.hasMore,
    search,
    loadNext,
    retry,
    cancel,
  };
}
