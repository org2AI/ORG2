/**
 * useChatViewOrgtrackSummary
 *
 * Fetches the orgtrack-core session summary (commit/file-change rollups)
 * for a session. Each result is tagged with the session it was read for, so
 * a session switch never shows the previous session's numbers while the new
 * read is in flight. `reloadKey` re-reads the same session (a round ended,
 * the agent went idle) and keeps the last value until the fresh one lands.
 */
import { useEffect, useState } from "react";

import {
  type CoreSessionSummary,
  getOrgtrackSessionSummary,
} from "@src/api/tauri/lineage";
import { createLogger } from "@src/hooks/logger";

const logger = createLogger("ChatView");

interface LoadedSummary {
  sessionId: string;
  summary: CoreSessionSummary | null;
}

export function useChatViewOrgtrackSummary(
  sessionId: string,
  reloadKey?: string
): CoreSessionSummary | null {
  const [loaded, setLoaded] = useState<LoadedSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    getOrgtrackSessionSummary(sessionId)
      .then((summary) => {
        if (!cancelled) setLoaded({ sessionId, summary });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        logger.warn("failed to load orgtrack session summary", error);
        // A failed re-read keeps this session's last good summary.
        setLoaded((previous) =>
          previous?.sessionId === sessionId
            ? previous
            : { sessionId, summary: null }
        );
      });
    return () => {
      cancelled = true;
    };
    // reloadKey is a pure refetch signal for the same session.
  }, [sessionId, reloadKey]);

  return loaded?.sessionId === sessionId ? loaded.summary : null;
}
