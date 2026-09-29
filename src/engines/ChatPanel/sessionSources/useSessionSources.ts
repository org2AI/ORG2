/**
 * useSessionSources — explicit resources and completed tool activity in one session.
 *
 * Read from the session's stored history, not from the event store: the
 * store keeps only previews of turns that are not on screen (imported text is
 * cut, image lists are capped), so it cannot represent all resources and activity in a long
 * session. The result is component state tagged with the session it was
 * read for — only pending reads are shared, so loaded data goes away with its view
 * and never outlives the session's own data. `reloadKey` re-reads the same
 * session and keeps the last list until the fresh one lands.
 */
import { useCallback, useEffect, useState } from "react";

import { readSessionSourceMessages } from "@src/api/tauri/session/sessionSources";
import { createLogger } from "@src/hooks/logger";

import {
  type SessionSource,
  extractSessionSources,
} from "./extractSessionSources";

const logger = createLogger("SessionSources");

const EMPTY_SOURCES: SessionSource[] = [];

interface LoadedSources {
  sessionId: string;
  sources: SessionSource[];
  requestKey: string;
  error: boolean;
}

function sameSources(
  left: readonly SessionSource[],
  right: readonly SessionSource[]
): boolean {
  return (
    left.length === right.length &&
    left.every((source, index) => {
      const other = right[index];
      if (source.key !== other.key || source.kind !== other.kind) return false;
      if (
        source.messageId !== other.messageId ||
        source.origin !== other.origin ||
        source.toolName !== other.toolName ||
        source.origins?.join() !== other.origins?.join()
      )
        return false;
      if (source.kind === "tool-group")
        return (
          other.kind === "tool-group" &&
          source.group === other.group &&
          JSON.stringify(source.operations) === JSON.stringify(other.operations)
        );
      if (source.kind === "link") {
        return (
          other.kind === "link" &&
          source.label === other.label &&
          source.url === other.url
        );
      }
      if (source.kind === "file") {
        return (
          other.kind === "file" &&
          source.path === other.path &&
          source.fileName === other.fileName &&
          source.title === other.title &&
          source.isDirectory === other.isDirectory
        );
      }
      return (
        other.kind === "image" &&
        source.ref === other.ref &&
        source.fileName === other.fileName
      );
    })
  );
}

// Only in-flight reads are shared. Settled results belong to mounted consumers,
// and the map deletes both successful and failed reads immediately.
const pendingReads = new Map<
  string,
  {
    promise: ReturnType<typeof readSessionSourceMessages>;
    consumers: number;
  }
>();
function acquireSources(
  sessionId: string,
  reloadKey: string | undefined,
  retryKey: number,
  visibilityVersion: number
) {
  const requestKey = JSON.stringify([
    sessionId,
    reloadKey ?? null,
    retryKey,
    visibilityVersion,
  ]);
  let entry = pendingReads.get(requestKey);
  if (!entry) {
    entry = { promise: readSessionSourceMessages(sessionId), consumers: 0 };
    pendingReads.set(requestKey, entry);
    const current = entry;
    void entry.promise
      .finally(() => {
        if (pendingReads.get(requestKey) === current)
          pendingReads.delete(requestKey);
      })
      .catch(() => {});
  }
  entry.consumers += 1;
  const current = entry;
  return {
    promise: current.promise,
    release: () => {
      current.consumers -= 1;
      // Unmounted sessions retain no registry entries, even if IPC is still pending.
      if (current.consumers === 0 && pendingReads.get(requestKey) === current) {
        pendingReads.delete(requestKey);
      }
    },
  };
}

export function useSessionSourcesState(
  sessionId: string | null | undefined,
  reloadKey?: string
) {
  // No scan starts in a hidden window. Coalesce every hidden invalidation
  // into one read of the latest session/reload key when visibility returns.
  const [visibility, setVisibility] = useState(() => ({
    visible: typeof document === "undefined" || !document.hidden,
    version: 0,
  }));
  useEffect(() => {
    const onVisibilityChange = () => {
      const visible = !document.hidden;
      setVisibility((previous) =>
        previous.visible === visible
          ? previous
          : {
              visible,
              version: previous.version + (visible ? 1 : 0),
            }
      );
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);
  const [retryKey, setRetryKey] = useState(0);
  const retry = useCallback(() => setRetryKey((value) => value + 1), []);
  const [loaded, setLoaded] = useState<LoadedSources | null>(null);
  const requestKey = JSON.stringify([
    sessionId,
    reloadKey ?? null,
    retryKey,
    visibility.version,
  ]);

  useEffect(() => {
    if (!sessionId || !visibility.visible) return;
    let cancelled = false;
    const read = acquireSources(
      sessionId,
      reloadKey,
      retryKey,
      visibility.version
    );
    read.promise
      .then((messages) => {
        if (cancelled) return;
        const sources = extractSessionSources(messages);
        // Most re-reads find nothing new; keep the same list so the rail
        // does not rebuild its rows.
        setLoaded((previous) =>
          previous?.sessionId === sessionId &&
          sameSources(previous.sources, sources)
            ? { ...previous, requestKey, error: false }
            : { sessionId, sources, requestKey, error: false }
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        logger.warn("failed to read session sources", error);
        // A failed re-read keeps this session's last good list.
        setLoaded((previous) =>
          previous?.sessionId === sessionId
            ? { ...previous, requestKey, error: true }
            : { sessionId, sources: EMPTY_SOURCES, requestKey, error: true }
        );
      });
    return () => {
      cancelled = true;
      read.release();
    };
    // reloadKey is a pure refetch signal for the same session.
  }, [
    sessionId,
    reloadKey,
    retryKey,
    requestKey,
    visibility.visible,
    visibility.version,
  ]);

  const current = loaded?.sessionId === sessionId ? loaded : null;
  return {
    sources: current?.sources ?? EMPTY_SOURCES,
    loading:
      visibility.visible && !!sessionId && current?.requestKey !== requestKey,
    error:
      !!current &&
      (!visibility.visible || current.requestKey === requestKey) &&
      current.error,
    retry,
  };
}

/** Rail callers that only need rows retain their existing API. */
export function useSessionSources(
  sessionId: string | null | undefined,
  reloadKey?: string
): SessionSource[] {
  return useSessionSourcesState(sessionId, reloadKey).sources;
}
