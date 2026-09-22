/**
 * SessionHoverCardContent — backend-sourced rows.
 *
 * Loads the orgtrack impact summary, the native transcript location, and
 * the bound native CLI id for the hovered session. Each fetch is cancelled
 * on session change so a stale response never lands on a different card.
 */
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";

import {
  type CoreSessionSummary,
  getOrgtrackSessionSummary,
} from "@src/api/tauri/lineage";
import { createLogger } from "@src/hooks/logger";
import { isCliSession } from "@src/util/session/sessionDispatch";

import {
  type CliAgentStatusPayload,
  type CliTranscriptLocation,
  getImportedRawSessionId,
} from "./sessionHoverCardContentHelpers";

const logger = createLogger("SessionHoverCard");

interface UseSessionHoverCardSourcesOptions {
  sessionId: string;
  cliAgentType: string | null | undefined;
}

export function useSessionHoverCardSources({
  sessionId,
  cliAgentType,
}: UseSessionHoverCardSourcesOptions) {
  const [orgtrackSummary, setOrgtrackSummary] =
    useState<CoreSessionSummary | null>(null);
  const [transcriptLocationState, setTranscriptLocationState] = useState<{
    sessionId: string;
    location: CliTranscriptLocation;
  } | null>(null);
  const [boundCliIdState, setBoundCliIdState] = useState<{
    sessionId: string;
    cliSessionId: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    getOrgtrackSessionSummary(sessionId)
      .then((summary) => {
        if (!cancelled) setOrgtrackSummary(summary);
      })
      .catch((error: unknown) => {
        logger.warn("failed to load orgtrack session summary", {
          error,
          sessionId,
        });
        if (!cancelled) setOrgtrackSummary(null);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Native-transcript sessions keep their transcript in the CLI's own
  // store, not sessions.db — resolve the real location for the storage row.
  useEffect(() => {
    let cancelled = false;
    if (!cliAgentType) return undefined;

    invoke<CliTranscriptLocation>("cli_agent_transcript_path", { sessionId })
      .then((location) => {
        if (!cancelled) setTranscriptLocationState({ sessionId, location });
      })
      .catch((error: unknown) => {
        logger.warn("failed to resolve session transcript path", {
          error,
          sessionId,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [cliAgentType, sessionId]);

  // Managed CLI sessions (`cliagent-*`): the bound native CLI id lives on
  // the `code_sessions` row already returned by `cli_agent_status` — no
  // new backend surface needed.
  useEffect(() => {
    let cancelled = false;
    if (!isCliSession(sessionId)) return undefined;

    invoke<CliAgentStatusPayload | null>("cli_agent_status", { sessionId })
      .then((status) => {
        if (!cancelled) {
          setBoundCliIdState({
            sessionId,
            cliSessionId: status?.cliSessionId ?? null,
          });
        }
      })
      .catch((error: unknown) => {
        logger.warn("failed to load bound cli session id", {
          error,
          sessionId,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const transcriptLocation =
    transcriptLocationState?.sessionId === sessionId
      ? transcriptLocationState.location
      : null;

  // The session's underlying id in its source store, for non-org2-native
  // sessions: imported external rows expose the prefix-stripped raw id;
  // managed CLI rows expose the bound native CLI id (null until the first
  // turn binds one). Pure Rust-agent sessions stay null — row hidden.
  const underlyingSessionId = useMemo(() => {
    const importedRawId = getImportedRawSessionId(sessionId);
    if (importedRawId) return importedRawId;
    if (boundCliIdState?.sessionId === sessionId) {
      return boundCliIdState.cliSessionId;
    }
    return null;
  }, [boundCliIdState, sessionId]);

  return { orgtrackSummary, transcriptLocation, underlyingSessionId };
}
