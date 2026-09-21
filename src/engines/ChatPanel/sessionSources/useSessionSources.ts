/**
 * useSessionSources — the images and links the user sent in one session.
 *
 * Read from the session's stored history, not from the event store: the
 * store keeps only previews of turns that are not on screen (imported text is
 * cut, image lists are capped), so it cannot list everything a long session
 * was given. The result is component state tagged with the session it was
 * read for — nothing is cached per session, so it goes away with the rail
 * and never outlives the session's own data. `reloadKey` re-reads the same
 * session and keeps the last list until the fresh one lands.
 */
import { useEffect, useState } from "react";

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
      return source.kind === "link"
        ? other.kind === "link" && source.label === other.label
        : other.kind === "image" && source.ref === other.ref;
    })
  );
}

export function useSessionSources(
  sessionId: string | null | undefined,
  reloadKey?: string
): SessionSource[] {
  const [loaded, setLoaded] = useState<LoadedSources | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    readSessionSourceMessages(sessionId)
      .then((messages) => {
        if (cancelled) return;
        const sources = extractSessionSources(messages);
        // Most re-reads find nothing new; keep the same list so the rail
        // does not rebuild its rows.
        setLoaded((previous) =>
          previous?.sessionId === sessionId &&
          sameSources(previous.sources, sources)
            ? previous
            : { sessionId, sources }
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        logger.warn("failed to read session sources", error);
        // A failed re-read keeps this session's last good list.
        setLoaded((previous) =>
          previous?.sessionId === sessionId
            ? previous
            : { sessionId, sources: EMPTY_SOURCES }
        );
      });
    return () => {
      cancelled = true;
    };
    // reloadKey is a pure refetch signal for the same session.
  }, [sessionId, reloadKey]);

  return loaded && loaded.sessionId === sessionId
    ? loaded.sources
    : EMPTY_SOURCES;
}
